"""
DataViz Studio backend (FastAPI + Ollama).

POST /api/chart-spec turns a natural-language chart request + the dataset's column
PROFILES (name + measurement level + shape stats) into a Vega-Lite chart spec,
using a local qwen2.5:7b model served by Ollama. The raw rows never leave the
browser — only the profiles are sent here.

Run:  uvicorn server.main:app --reload --port 8000
Model: pull it once with `ollama pull qwen2.5:7b`.
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import ollama

load_dotenv()

MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
# A vision model (e.g. "llama3.2-vision", "llava") used to actually LOOK at the chart
# image during analysis. If it isn't pulled, analysis falls back to the text model +
# the data digest — so this is optional. Pull it once to enable vision.
# Prefer an English-primary one: this model writes the analysis PARAGRAPH, so a
# bilingual VL model reintroduces the non-English drift the guard below catches.
VISION_MODEL = os.getenv("OLLAMA_VISION_MODEL", "llama3.2-vision")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

# The chart-spec / suggest / recommend prompts embed the whole chart guide and run
# ~4k tokens before a single column profile is appended — right at Ollama's 4096
# default. Past that it silently drops tokens from the FRONT of the prompt, which is
# where the instructions and the start of the guide live, so a wide dataset would
# quietly cost the model the reference it reasons from. Pin a window with headroom.
GUIDE_NUM_CTX = int(os.getenv("OLLAMA_NUM_CTX", "8192"))

MARKS = ["bar", "line", "area", "point", "circle", "tick", "arc", "rect", "boxplot", "geoshape"]
VEGA_TYPES = ["quantitative", "nominal", "ordinal", "temporal"]
AGGREGATES = ["sum", "mean", "median", "min", "max", "count"]

client = ollama.Client(host=OLLAMA_HOST)

# Full error detail is logged HERE (server console) only — never returned to the
# client, so responses can't leak internals (tooling, model, paths, tracebacks).
logger = logging.getLogger("uvicorn.error")

app = FastAPI(title="DataViz Studio API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- Request models --------------------------------------------------------


class Profile(BaseModel):
    name: str
    level: str = "nominal"  # nominal | ordinal | quantitative | temporal
    continuous: bool = False
    distinct: int = 0
    count: int = 0  # non-null rows — lets the model judge if there's enough data (e.g. a box plot wants ~20+ per group)
    examples: list = []


class ChartSpecRequest(BaseModel):
    request: str
    columns: list[Profile]  # column profiles


class RecommendRequest(BaseModel):
    chosen: str  # the chart kind currently shown (bar, scatter, bubble, ...)
    columns: list[Profile]


class ConclusionRequest(BaseModel):
    spec: dict  # the finished Vega-Lite spec
    digest: dict  # aggregated values computed in the browser (no raw rows)
    image: str | None = None  # optional PNG data URL of the rendered chart, for vision analysis


# A Vega-Lite encoding channel and the overall spec, as a JSON schema the model
# must fill (Ollama structured outputs).
_ENCODING = {
    "type": "object",
    "properties": {
        "field": {"type": "string"},
        "type": {"type": "string", "enum": VEGA_TYPES},
        "aggregate": {"type": "string", "enum": AGGREGATES},
        "bin": {"type": "boolean"},
    },
    "required": ["type"],
}

SPEC_SCHEMA = {
    "type": "object",
    "properties": {
        "mark": {"type": "string", "enum": MARKS},
        "encoding": {
            "type": "object",
            "properties": {
                "x": _ENCODING,
                "y": _ENCODING,
                "color": _ENCODING,
                "size": _ENCODING,
                "theta": _ENCODING,
                "location": _ENCODING,
                "latitude": _ENCODING,
                "longitude": _ENCODING,
            },
        },
        "note": {"type": "string"},
    },
    "required": ["mark", "encoding", "note"],
}

# Chart references the model consults.
CHART_GUIDE = (Path(__file__).parent / "chart_guide.md").read_text(encoding="utf-8")
CHART_TRADEOFFS = (Path(__file__).parent / "chart_tradeoffs.md").read_text(encoding="utf-8")
CHART_CONCLUSION = (Path(__file__).parent / "chart_conclusion_guide.md").read_text(encoding="utf-8")


def _parse_conclusion_md(md: str) -> tuple[str, str, dict[str, str]]:
    """Split the conclusion guide into (generic-stats block, style block, {chart name:
    section}). This lets a conclusion request carry ONLY the relevant chart's section
    instead of the whole ~3k-token guide — much faster on a small local model."""
    generic: list[str] = []
    style: list[str] = []
    charts: dict[str, str] = {}
    mode: str | None = None
    name: str | None = None
    buf: list[str] = []
    for line in md.splitlines():
        if line.startswith("## ") or (line.startswith("### ") and mode == "charts"):
            if name is not None:  # close the open chart section
                charts[name] = "\n".join(buf).strip()
                name, buf = None, []
        if line.startswith("## Generic stats"):
            mode = "generic"
        elif line.startswith("## Style"):
            mode = "style"
        elif line.startswith("## "):
            mode = "charts"  # the "What each chart type shows" container
        elif line.startswith("### ") and mode == "charts":
            name, buf = line[4:].strip(), [line]
        elif mode == "generic":
            generic.append(line)
        elif mode == "style":
            style.append(line)
        elif mode == "charts" and name is not None:
            buf.append(line)
    if name is not None:
        charts[name] = "\n".join(buf).strip()
    return "\n".join(generic).strip(), "\n".join(style).strip(), charts


CONCLUSION_GENERIC, CONCLUSION_STYLE, CONCLUSION_SECTIONS = _parse_conclusion_md(CHART_CONCLUSION)


def _conclusion_label(spec: dict) -> str:
    """The chart_conclusion_guide.md section name for this spec's chart type."""
    enc = spec.get("encoding") or {}

    def ch(name: str) -> dict:
        return enc.get(name) or {}

    mark = spec.get("mark")
    if mark == "bar":
        return "Histogram" if ch("x").get("bin") else "Bar chart"
    if mark in ("point", "circle"):
        if ch("size").get("field"):
            return "Bubble chart"
        x_cat = ch("x").get("type") not in (None, "quantitative")
        y_cat = ch("y").get("type") not in (None, "quantitative")
        if (x_cat != y_cat) and (ch("x").get("aggregate") or ch("y").get("aggregate")):
            return "Dot plot (Cleveland)"
        return "Scatter plot"
    return {
        "tick": "Strip plot",
        "arc": "Pie chart",
        "rect": "Heatmap",
        "boxplot": "Box plot",
        "geoshape": "Map (choropleth)",
        "line": "Line chart",
        "area": "Area chart",
    }.get(mark or "", "Bar chart")

SYSTEM = f"""You translate a natural-language chart request into a Vega-Lite specification.

You are given the dataset's columns as PROFILES: name, measurement level, whether numeric columns are continuous, how many distinct values they have, and the row count. Choose the best chart and map it onto the ACTUAL columns.

Use this chart reference to recognise the chart the user asks for and to fill its encoding correctly:

{CHART_GUIDE}

Rules:
- Follow the reference above: pick the mark it describes for the chart the user names, and give that mark the encoding channels it lists (e.g. a "bubble" MUST include a size channel; a scatter must not).
- "field" values MUST be exact names from the profiles — never invent names.
- ALWAYS use the columns the user explicitly names, and ALL of them. Match names ignoring case and treating spaces and underscores as the same (e.g. "unit price" is the column unit_price). Never swap in a column the user didn't name.
- Keep "note" to one short sentence.
Respond with ONLY the JSON object."""


KINDS = ["bar", "dotplot", "line", "area", "scatter", "bubble", "pie", "histogram", "box", "strip", "heatmap", "map"]

SUGGEST_SCHEMA = {
    "type": "object",
    "properties": {
        "kinds": {"type": "array", "items": {"type": "string", "enum": KINDS}},
    },
    "required": ["kinds"],
}

SUGGEST_SYSTEM = f"""You recommend which TYPES of chart fit a user's request for a dataset.

You are given the columns as profiles (name, measurement level, continuous?, distinct count, row count) and the user's request. From this FIXED list of chart types, return the ones that fit — best first, no duplicates:
bar, dotplot, line, area, scatter, bubble, pie, histogram, box, strip, heatmap, map

Use this reference for what each type is for and the columns it needs:

{CHART_GUIDE}

Only include a type when the columns support it (scatter needs >= 2 quantitative; bubble needs >= 3; line/area need a temporal column; heatmap needs >= 2 categorical; histogram/box need a quantitative measure; pie needs a category + a quantitative measure; map needs a geographic column — country or US-state names — or latitude + longitude columns).

Return ONLY the JSON object, e.g. {{"kinds": ["box", "histogram", "bar"]}}."""


RECOMMEND_SCHEMA = {
    "type": "object",
    "properties": {
        "better_fit": {"type": "string", "enum": [*KINDS, "same"]},
        "reason": {"type": "string"},
    },
    "required": ["better_fit", "reason"],
}

RECOMMEND_SYSTEM = f"""You judge whether a chart is the best way to describe some data.

You are given the chart TYPE the user is currently viewing and the columns it uses
(with measurement levels). Use this pros/cons reference to decide whether a DIFFERENT
chart type would describe the data more accurately:

{CHART_TRADEOFFS}

Rules:
- If the current chart is a good fit, return {{"better_fit": "same", "reason": ""}}.
- Otherwise return the better chart type (one of: bar, line, area, scatter, bubble, pie, histogram, box, heatmap, map) and a ONE-sentence reason grounded in the pros/cons.
- Only suggest a type the columns can actually support.
- Be conservative — recommend a change only when it is clearly better, not for taste.
Return ONLY the JSON object."""


CONCLUSION_SCHEMA = {
    "type": "object",
    "properties": {"conclusion": {"type": "string"}},
    "required": ["conclusion"],
}

# Kept short + static: the per-chart guidance is attached per request as a small
# chart-specific block (fast). When a chart IMAGE is supplied it's analysed by the
# vision model too. The output is a full professional PARAGRAPH.
CONCLUSION_SYSTEM = """You are a professional data analyst writing an ANALYSIS of one chart for a report.

You are given the chart's Vega-Lite spec, a DIGEST of its aggregated values, a short REFERENCE for this chart type, and (when available) the rendered chart IMAGE — study all of them.

Write a single cohesive PARAGRAPH (4–6 sentences) that:
1. Names the signature pattern this chart type reveals (a line = change over time, a bar = comparison/ranking, a scatter = relationship, a pie = composition, a histogram = distribution, a box = spread, a map = geographic variation, etc.) and describes it in THIS data.
2. Weaves in the GENERIC STATS from the digest — the maximum, minimum, mean and (where given) median, range and spread — with concrete labels and numbers (rounded sensibly, e.g. 68,000 not 67,842.3).
3. Calls out the SPECIFIC trends/patterns for this chart type (the leader and the gap, the direction and steepness of a trend, the strength of a correlation, outliers, skew, concentration, etc.) and closes with the key takeaway.

EVIDENCE — every analytical claim carries its example in the same sentence. Name the group, quote the number. "A few regions dominate" is incomplete; "the Americas and Asia hold 76% of the total (31.5 and 28.5 trillion)" is the same claim, proven. If a sentence characterises the data (dominant, skewed, concentrated, steep, weak) without naming the groups and numbers behind it, rewrite it with them.

LEVELS — the digest tags each statistic with what it describes. `groupStats` (basis "per-group") describes the bars/regions ON the chart; `measure` (basis "per-row") describes the individual records behind them, whose mean and max may appear nowhere on the chart. When the chart groups, quote `groupStats` — calling a per-row mean "the average per continent" is a factual error. Report `share`/`topShare` as percentages.

Professional, analytical prose. No preamble ("This chart shows"), no markdown, no bullet lists, no headings — just the paragraph. If the data is genuinely too thin for a real pattern, say so plainly.

LANGUAGE: Write in ENGLISH ONLY. Every word must be English. Never emit Chinese, Japanese, Korean or any other non-Latin script — not for a single word, term or punctuation mark. Column names and labels are copied verbatim from the data.
Return ONLY the JSON object: {"conclusion": "<the paragraph>"}."""

# Bilingual models drift into Chinese on free-form prose, and the default (qwen2.5)
# is one — so this guard is load-bearing, not belt-and-braces. The other endpoints
# are enum/JSON-constrained so drift can't surface there; this is the only one
# writing a paragraph, so its output is checked and retried before it reaches the
# browser. Swapping to an English-primary model makes it a no-op, not redundant.
_CJK = re.compile(
    "["
    "　-〿"  # CJK punctuation
    "぀-ヿ"  # hiragana + katakana
    "㐀-䶿"  # CJK ideographs, extension A
    "一-鿿"  # CJK ideographs (the common Han block)
    "가-힯"  # hangul syllables
    "豈-﫿"  # CJK compatibility ideographs
    "＀-￯"  # fullwidth / halfwidth forms
    "]"
)

_ENGLISH_RETRY = (
    "\n\nCRITICAL: your previous answer contained non-English characters and was rejected. "
    "Write the paragraph again using ENGLISH words only."
)


def _is_english(text: str) -> bool:
    """False when the text contains CJK characters — i.e. the model drifted."""
    return not _CJK.search(text)


# Small models often keep generating past their answer and start improvising the
# NEXT turn of the conversation ("...contributors.}<tool_call> user Thank you, could
# you also..."). The JSON schema doesn't stop it, because that rambling is still
# valid content for the string it's filling. The paragraph is meant to be plain
# prose — no markup, no braces — so the first such character marks where the real
# answer ended.
_ARTIFACT = re.compile(r"\{|\}|<\||</|<[a-z_]*tool|\bHere is the updated\b", re.I)
_SENTENCE_END = re.compile(r"[.!?][\"')\]]?\s*$")
# A sentence boundary is terminal punctuation NOT followed by a digit — otherwise the
# decimal point in "15.6 trillion" reads as the end of a sentence, and these
# paragraphs are full of decimals.
_SENTENCE_BOUNDARY = re.compile(r"[.!?](?!\d)[\"')\]]?(?=\s|$)")


def _clean_paragraph(text: str) -> str:
    """Trim a generated paragraph back to the model's actual answer."""
    cut = _ARTIFACT.search(text)
    if cut:
        text = text[: cut.start()]
    text = text.strip()
    # Drop a dangling half-sentence — left either by the trim above or by hitting the
    # token limit mid-thought. If the text contains no complete sentence at all, keep
    # it as-is rather than returning nothing.
    if text and not _SENTENCE_END.search(text):
        ends = [m.end() for m in _SENTENCE_BOUNDARY.finditer(text)]
        if ends:
            text = text[: ends[-1]]
    return text.strip()


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "model": MODEL, "backend": "ollama"}


@app.post("/api/chart-spec")
def chart_spec(body: ChartSpecRequest) -> dict:
    request = body.request.strip()
    profiles = [p for p in body.columns if p.name]
    if not request or not profiles:
        raise HTTPException(status_code=400, detail='Both "request" and "columns" are required.')

    # Explicit requests (a chart-type keyword + named columns) are mapped
    # deterministically — reliable for multi-column cases the small model fumbles
    # (e.g. a bubble plot's three columns) and it always honors the exact chart
    # type and columns you named. Vague requests fall through to the model.
    mapped = _map_request(request, profiles)
    if mapped is not None:
        spec, note = mapped
        spec = _ensure_bubble(spec, request, profiles)
        return {"spec": spec, "note": note, "notice": _dotplot_fallback_notice(request, spec), "source": "mapped"}

    lines = [
        f"- {p.name}: {p.level}"
        + (", continuous" if p.level == "quantitative" and p.continuous else "")
        + f", {p.distinct} distinct, {p.count} rows"
        for p in profiles
    ]
    user = "Columns:\n" + "\n".join(lines) + f"\n\nRequest: {request}"

    try:
        resp = client.chat(
            model=MODEL,
            messages=[
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": user},
            ],
            format=SPEC_SCHEMA,
            options={"temperature": 0, "num_ctx": GUIDE_NUM_CTX},
        )
        raw = json.loads(resp["message"]["content"])
    except Exception as err:  # Ollama down, model not pulled, or bad JSON.
        logger.exception("Model request failed")  # full detail stays server-side
        raise HTTPException(
            status_code=503,
            detail="The service is temporarily unavailable. Please try again.",
        ) from err

    spec, note = _validate(raw, profiles, request)
    spec = _ensure_bubble(spec, request, profiles)
    return {"spec": spec, "note": note, "notice": _dotplot_fallback_notice(request, spec), "source": "ai"}


@app.post("/api/suggest")
def suggest(body: ChartSpecRequest) -> dict:
    """Read the user's request and return the chart TYPES that fit, best first.
    The client owns the concrete specs; here we only rank the type vocabulary."""
    request = body.request.strip()
    profiles = [p for p in body.columns if p.name]
    if not request or not profiles:
        raise HTTPException(status_code=400, detail='Both "request" and "columns" are required.')

    lines = [
        f"- {p.name}: {p.level}"
        + (", continuous" if p.level == "quantitative" and p.continuous else "")
        + f", {p.distinct} distinct, {p.count} rows"
        for p in profiles
    ]
    user = "Columns:\n" + "\n".join(lines) + f"\n\nRequest: {request}"

    try:
        resp = client.chat(
            model=MODEL,
            messages=[
                {"role": "system", "content": SUGGEST_SYSTEM},
                {"role": "user", "content": user},
            ],
            format=SUGGEST_SCHEMA,
            options={"temperature": 0, "num_ctx": GUIDE_NUM_CTX},
        )
        raw = json.loads(resp["message"]["content"])
    except Exception as err:
        logger.exception("Model request failed")  # full detail stays server-side
        raise HTTPException(
            status_code=503,
            detail="The service is temporarily unavailable. Please try again.",
        ) from err

    seen: set[str] = set()
    kinds: list[str] = []
    for k in (raw.get("kinds") if isinstance(raw, dict) else None) or []:
        if k in KINDS and k not in seen:
            seen.add(k)
            kinds.append(k)

    return {"kinds": kinds, "source": "ai"}


@app.post("/api/recommend")
def recommend(body: RecommendRequest) -> dict:
    """The model's opinion: would a different chart type describe this data more
    accurately than the one being shown? Grounded in the pros/cons reference.
    Returns a suggestion (or null) — advisory only."""
    chosen = body.chosen.strip()
    profiles = [p for p in body.columns if p.name]
    if not chosen or not profiles:
        raise HTTPException(status_code=400, detail='Both "chosen" and "columns" are required.')

    lines = [
        f"- {p.name}: {p.level}"
        + (", continuous" if p.level == "quantitative" and p.continuous else "")
        + f", {p.distinct} distinct, {p.count} rows"
        for p in profiles
    ]
    user = f"Current chart: {chosen}\n\nColumns:\n" + "\n".join(lines)

    try:
        resp = client.chat(
            model=MODEL,
            messages=[
                {"role": "system", "content": RECOMMEND_SYSTEM},
                {"role": "user", "content": user},
            ],
            format=RECOMMEND_SCHEMA,
            options={"temperature": 0, "num_ctx": GUIDE_NUM_CTX},
        )
        raw = json.loads(resp["message"]["content"])
    except Exception as err:
        logger.exception("Model request failed")  # full detail stays server-side
        raise HTTPException(
            status_code=503,
            detail="The service is temporarily unavailable. Please try again.",
        ) from err

    better = raw.get("better_fit") if isinstance(raw, dict) else None
    reason = raw.get("reason", "") if isinstance(raw, dict) else ""
    if better in KINDS and better != chosen:
        return {"suggestion": better, "reason": str(reason).strip()}
    return {"suggestion": None, "reason": ""}


def _analysis_paragraph(system: str, user: str, image_b64: str | None) -> str:
    """Run the analysis. If an image + a vision model are available, LOOK at the chart
    (vision model); otherwise reason from the digest with the text model. Falls back
    to text if the vision model isn't pulled. Returns the paragraph ('' on failure)."""

    def run(model: str, user_msg: dict, sys: str) -> str:
        resp = client.chat(
            model=model,
            messages=[{"role": "system", "content": sys}, user_msg],
            format=CONCLUSION_SCHEMA,
            # temperature 0 (as every other endpoint): this is an analysis of fixed
            # numbers, not creative writing, and sampling is what lets a bilingual
            # model wander out of English mid-paragraph.
            options={"temperature": 0, "num_predict": 400},  # room for a full paragraph
        )
        raw = json.loads(resp["message"]["content"])
        text = raw.get("conclusion") if isinstance(raw, dict) else None
        return _clean_paragraph(text) if isinstance(text, str) else ""

    def run_checked(model: str, user_msg: dict) -> str:
        """One retry with a hard reminder if the model answered in another script;
        a still-drifted paragraph is dropped rather than shown to the user."""
        text = run(model, user_msg, system)
        if text and not _is_english(text):
            logger.warning("Model '%s' answered with non-English text; retrying", model)
            text = run(model, user_msg, system + _ENGLISH_RETRY)
        if text and not _is_english(text):
            logger.warning("Model '%s' drifted out of English again; dropping the analysis", model)
            return ""
        return text

    if image_b64:
        try:
            return run_checked(VISION_MODEL, {"role": "user", "content": user, "images": [image_b64]})
        except Exception:
            logger.warning("Vision analysis unavailable (is '%s' pulled?); using text model", VISION_MODEL)
    return run_checked(MODEL, {"role": "user", "content": user})


@app.post("/api/analyse")
def analyse(body: ConclusionRequest) -> dict:
    """A professional PARAGRAPH analysing the chart's variables (generic stats +
    the chart-type's specific trends/patterns), from its spec + a digest of AGGREGATED
    values, and — when supplied — the rendered chart IMAGE (analysed by a vision model,
    falling back to text). No raw rows are ever sent; only the relevant guide section
    is attached, keeping it fast."""
    label = _conclusion_label(body.spec)
    reference = (
        f"Generic stats you can use: {CONCLUSION_GENERIC}\n\n"
        f"This chart is a {label} — what it uniquely shows and what to analyse:\n"
        f"{CONCLUSION_SECTIONS.get(label, '')}\n\n"
        f"Style: {CONCLUSION_STYLE}"
    )
    user = (
        f"Reference:\n{reference}\n\nChart spec:\n{json.dumps(body.spec)}"
        f"\n\nValue digest:\n{json.dumps(body.digest)}"
    )
    # The browser sends a PNG data URL; the model wants the bare base64.
    image_b64 = None
    if body.image and "," in body.image:
        image_b64 = body.image.split(",", 1)[1]
    try:
        text = _analysis_paragraph(CONCLUSION_SYSTEM, user, image_b64)
    except Exception as err:
        logger.exception("Analysis request failed")  # full detail stays server-side
        raise HTTPException(
            status_code=503,
            detail="The service is temporarily unavailable. Please try again.",
        ) from err
    return {"conclusion": text}


# ---- Validation / coercion -------------------------------------------------


def _norm(s: str) -> str:
    """Normalize a name for matching: lowercase, underscores/spaces unified."""
    return re.sub(r"[_\s]+", " ", s.lower()).strip()


def _named_columns(request: str, profiles: list[Profile]) -> list[Profile]:
    """Columns the user referenced by name (treating 'unit price' == unit_price)."""
    req = _norm(request)
    return [p for p in profiles if _norm(p.name) and _norm(p.name) in req]


def _named_in_order(request: str, profiles: list[Profile]) -> list[Profile]:
    """Named columns sorted by where they first appear in the request."""
    req = _norm(request)
    hits: list[tuple[int, Profile]] = []
    for p in profiles:
        n = _norm(p.name)
        if not n:
            continue
        i = req.find(n)
        if i >= 0:
            hits.append((i, p))
    hits.sort(key=lambda t: t[0])
    return [p for _, p in hits]


# Chart-type keyword → mark, in priority order (bubble before scatter, etc.).
_MARK_KEYWORDS: list[tuple[str, list[str]]] = [
    ("bubble", ["bubble"]),
    ("pie", ["pie", "donut", "doughnut"]),
    ("histogram", ["histogram", "distribution"]),
    ("heatmap", ["heatmap", "heat map"]),  # before "map" so it isn't stolen
    ("geoshape", ["choropleth", "map"]),
    ("boxplot", ["box plot", "boxplot", "box"]),
    ("strip", ["strip plot", "stripplot", "strip", "jitter"]),
    ("dotplot", ["dot plot", "dotplot", "cleveland", "dot chart", "dot"]),
    ("scatter", ["scatter", "correlation", "relationship"]),
    ("line", ["line", "trend", "over time", "time series"]),
    ("area", ["area"]),
    ("bar", ["bar", "column"]),
]


def _detect_mark(request: str) -> str | None:
    req = _norm(request)
    for mark, keywords in _MARK_KEYWORDS:
        if any(_norm(kw) in req for kw in keywords):
            return mark
    return None


def _column_after(request: str, profiles: list[Profile], keywords: list[str]) -> Profile | None:
    """First named column that appears after a keyword like 'sized by'."""
    req = _norm(request)
    pos = -1
    for kw in keywords:
        i = req.find(_norm(kw))
        if i >= 0:
            pos = i + len(_norm(kw))
            break
    if pos < 0:
        return None
    best: Profile | None = None
    best_i = len(req) + 1
    for p in profiles:
        n = _norm(p.name)
        i = req.find(n, pos)
        if i >= 0 and i < best_i:
            best_i, best = i, p
    return best


def _map_request(request: str, profiles: list[Profile]) -> tuple[dict, str] | None:
    """Deterministic request → Vega-Lite spec for EXPLICIT requests (a chart-type
    keyword plus enough named columns). Honors the exact columns/order the user
    typed — including a third column for bubble size — instead of relying on the
    model. Returns None when the request isn't explicit enough, so the LLM handles it.
    """
    mark = _detect_mark(request)
    if mark is None:
        return None

    named = _named_in_order(request, profiles)
    by = {p.name: p for p in profiles}
    quant = [p for p in named if p.level == "quantitative"]
    cats = [p for p in named if p.level in ("nominal", "ordinal", "temporal")]

    def enc(p: Profile, aggregate: str | None = None) -> dict:
        e: dict = {"field": p.name, "type": p.level}
        if aggregate:
            e["aggregate"] = aggregate
        return e

    if mark in ("scatter", "bubble"):
        if len(named) < 2:
            return None
        size_col = None
        if mark == "bubble":
            size_col = _column_after(request, profiles, ["sized by", "sized", "size by", "size"])
            if size_col is None and len(named) >= 3:
                size_col = named[2]
        axes = [p for p in named if not (size_col and p.name == size_col.name)]
        if len(axes) < 2:
            axes = named[:2]
        x, y = axes[0], axes[1]
        encoding = {"x": enc(x), "y": enc(y)}
        note_size = ""
        if mark == "bubble" and size_col:
            # Honor the size column the user named even if it's NOT numeric — the
            # chart renders as asked and the warnings layer flags "size must be a
            # number" rather than silently dropping the request.
            encoding["size"] = {"field": size_col.name, "type": by[size_col.name].level}
            note_size = f", sized by {size_col.name}"
        kind = "Bubble" if mark == "bubble" else "Scatter"
        return {"mark": "point", "encoding": encoding}, f"{kind} of {y.name} vs {x.name}{note_size}."

    if mark == "geoshape":
        # A map shades a geographic column by a measure (or a count). The browser
        # re-detects the actual geographic column from the data, so the location
        # here is a hint; the measure/count is what matters.
        measure = quant[0] if quant else None
        color = enc(measure, "sum") if measure else {"type": "quantitative", "aggregate": "count"}
        loc = cats[0] if cats else None
        encoding: dict = {"color": color}
        if loc:
            encoding["location"] = {"field": loc.name, "type": loc.level}
        what = measure.name if measure else "count"
        who = loc.name if loc else "region"
        return {"mark": "geoshape", "encoding": encoding}, f"{what} by {who} on a map."

    if mark == "pie":
        if not quant or not cats:
            return None
        return {"mark": "arc", "encoding": {"theta": enc(quant[0], "sum"), "color": enc(cats[0])}}, f"Share of {quant[0].name} by {cats[0].name}."

    if mark == "histogram":
        if not quant:
            return None
        m = quant[0]
        return {"mark": "bar", "encoding": {"x": {"field": m.name, "type": "quantitative", "bin": True}, "y": {"type": "quantitative", "aggregate": "count"}}}, f"Distribution of {m.name}."

    if mark == "boxplot":
        # A box plot summarises the spread of ONE numeric measure, optionally split
        # by a grouping column. Build it ONLY from the columns the user named — never
        # pull in an unnamed column (e.g. "boxplot of discount vs revenue" must not
        # invent "region"). y = the measure (the named numeric with the most distinct
        # values); x = a grouping: a named category, else the other named column
        # (e.g. discount levels), else nothing → a single box.
        if not quant:
            return None
        measure = max(quant, key=lambda p: p.distinct)
        group = cats[0] if cats else next((p for p in named if p.name != measure.name), None)
        encoding: dict = {"y": enc(measure)}
        if group is not None:
            # A numeric grouping with few, ordered levels reads as ordinal buckets.
            gtype = "ordinal" if group.level == "quantitative" else group.level
            encoding["x"] = {"field": group.name, "type": gtype}
        label = f"Spread of {measure.name}" + (f" by {group.name}" if group is not None else "")
        return {"mark": "boxplot", "encoding": encoding}, f"{label}."

    if mark == "strip":
        # A strip plot shows EVERY raw value as a tick (no aggregation), optionally
        # split by a grouping — the honest small-sample alternative to a box plot.
        # Built only from named columns (same rules as the box plot above).
        if not quant:
            return None
        measure = max(quant, key=lambda p: p.distinct)
        group = cats[0] if cats else next((p for p in named if p.name != measure.name), None)
        encoding = {"y": enc(measure)}
        if group is not None:
            gtype = "ordinal" if group.level == "quantitative" else group.level
            encoding["x"] = {"field": group.name, "type": gtype}
        label = f"Every {measure.name} value" + (f" by {group.name}" if group is not None else "")
        return {"mark": "tick", "encoding": encoding}, f"{label}."

    if mark == "dotplot":
        # A Cleveland dot plot: one dot per category at the AVERAGE of the measure
        # (a lighter-ink bar alternative). It NEEDS a category to compare across.
        if not quant:
            return None
        if not cats:
            # No category → a dot plot can't be formed. Fall back to a scatter of
            # the two named measures (what "dot plot of X vs Y" really is). The
            # caller adds a chart-advice note explaining the fallback.
            if len(quant) >= 2:
                x, y = quant[0], quant[1]
                return {"mark": "point", "encoding": {"x": enc(x), "y": enc(y)}}, f"Scatter of {y.name} vs {x.name}."
            return None
        measure = max(quant, key=lambda p: p.distinct)
        cat = cats[0]
        return {"mark": "point", "encoding": {"y": enc(cat), "x": enc(measure, "mean")}}, f"Average {measure.name} by {cat.name}."

    if mark == "heatmap":
        if len(cats) < 2:
            return None
        return {"mark": "rect", "encoding": {"x": enc(cats[0]), "y": enc(cats[1]), "color": {"type": "quantitative", "aggregate": "count"}}}, f"Counts across {cats[0].name} and {cats[1].name}."

    if mark in ("line", "area"):
        if not quant:
            return None
        xcol = next((p for p in named if p.level == "temporal"), None) or (cats[0] if cats else None)
        if xcol is None:
            return None
        return {"mark": mark, "encoding": {"x": enc(xcol), "y": enc(quant[0], "sum")}}, f"{mark.capitalize()} of {quant[0].name} over {xcol.name}."

    # bar
    if cats and quant:
        return {"mark": "bar", "encoding": {"x": enc(cats[0]), "y": enc(quant[0], "sum")}}, f"Total {quant[0].name} by {cats[0].name}."
    if cats:
        return {"mark": "bar", "encoding": {"x": enc(cats[0]), "y": {"type": "quantitative", "aggregate": "count"}}}, f"Count by {cats[0].name}."
    return None


def _ensure_bubble(spec: dict, request: str, profiles: list[Profile]) -> dict:
    """Agnostic guarantee: a BUBBLE must encode a THIRD variable as point size.
    Whatever produced the spec (mapper or model), if the user asked for a bubble
    and the point chart has no size channel, add one from an unused quantitative
    column (preferring a column the user named). No-op for non-bubble requests.
    """
    if "bubble" not in _norm(request):
        return spec
    if spec.get("mark") not in ("point", "circle"):
        return spec
    encoding = {k: dict(v) for k, v in (spec.get("encoding") or {}).items() if isinstance(v, dict)}
    if encoding.get("size", {}).get("field"):
        return spec  # already has the third variable

    used = {encoding[c].get("field") for c in ("x", "y") if encoding.get(c, {}).get("field")}
    named = _named_columns(request, profiles)
    named_quant = [p for p in named if p.level == "quantitative" and p.name not in used]
    any_quant = [p for p in profiles if p.level == "quantitative" and p.name not in used]
    chosen = named_quant[0] if named_quant else (any_quant[0] if any_quant else None)
    if chosen is None:
        return spec  # no spare numeric column to size by

    encoding["size"] = {"field": chosen.name, "type": "quantitative"}
    return {"mark": spec["mark"], "encoding": encoding}


def _dotplot_fallback_notice(request: str, spec: dict) -> str | None:
    """When the user asked for a DOT PLOT but the result is a scatter (a point mark
    with no aggregate — i.e. no category to average across), return a chart-advice
    line explaining the fallback. None otherwise."""
    if _detect_mark(request) != "dotplot":
        return None
    if spec.get("mark") not in ("point", "circle"):
        return None
    enc = spec.get("encoding") or {}
    aggregated = any(isinstance(enc.get(c), dict) and enc[c].get("aggregate") for c in ("x", "y"))
    if aggregated:
        return None  # it really is a dot plot (one aggregated dot per category)
    return (
        "A dot plot shows one aggregated value per category, but this request has no "
        "category to group by — so this is a scatter of the two measures instead. For a "
        "dot plot, compare a measure across a category (e.g. “dot plot of sales by region”)."
    )


def _validate(raw: dict, profiles: list[Profile], request: str = "") -> tuple[dict, str]:
    """Build a renderable spec that reflects the ACTUAL column types.

    Key rule: the encoding data type comes from the column's real profile (the
    inferred type in the data), NOT from whatever the model guessed. We keep the
    model's field choices and only fill a channel when it's missing — we do NOT
    silently "fix" a mismatched pairing. That way the chart shows the columns as
    they really are, and the warnings layer can flag when they don't suit the mark.
    """
    by_name = {p.name: p for p in profiles}
    quant = [p.name for p in profiles if p.level == "quantitative"]
    cats = [p.name for p in profiles if p.level in ("nominal", "ordinal")]
    temporal = [p.name for p in profiles if p.level == "temporal"]

    mark = raw.get("mark") if raw.get("mark") in MARKS else "bar"
    raw_enc = raw.get("encoding") or {}

    def clean(channel: dict | None) -> dict | None:
        if not isinstance(channel, dict):
            return None
        field = channel.get("field")
        agg = channel.get("aggregate") if channel.get("aggregate") in AGGREGATES else None
        binned = channel.get("bin") is True
        # Drop hallucinated columns; only real fields (or a plain count) survive.
        if field not in by_name and agg != "count":
            return None
        # Type is dictated by the real column, not the model's guess.
        out: dict = {"type": by_name[field].level if field in by_name else "quantitative"}
        if field in by_name:
            out["field"] = field
        if agg:
            out["aggregate"] = agg
        if binned:
            out["bin"] = True
            out["type"] = "quantitative"  # binning only applies to quantitative
        return out

    enc = {ch: clean(raw_enc.get(ch)) for ch in ("x", "y", "color", "size", "theta", "location", "latitude", "longitude")}
    enc = {ch: v for ch, v in enc.items() if v is not None}

    # Fill only the essential channels the model left empty (never override its picks).
    first_cat = (cats or temporal or [p.name for p in profiles])[0]
    first_quant = (quant or [p.name for p in profiles])[0]

    def field_enc(name: str, aggregate: str | None = None) -> dict:
        e = {"field": name, "type": by_name[name].level}
        if aggregate:
            e["aggregate"] = aggregate
        return e

    if mark == "geoshape":
        # A map needs a value to shade by; default to a row count. The geographic
        # column is detected in the browser from the real data.
        if "color" not in enc:
            enc["color"] = {"type": "quantitative", "aggregate": "count"}
    elif mark in ("point", "circle"):
        if "x" not in enc:
            enc["x"] = field_enc(first_quant)
        if "y" not in enc:
            other = next((n for n in quant if n != enc["x"].get("field")), first_quant)
            enc["y"] = field_enc(other)
    elif mark == "arc":
        if "theta" not in enc:
            enc["theta"] = field_enc(first_quant, "sum")
        if "color" not in enc:
            enc["color"] = field_enc(first_cat)
    elif mark in ("boxplot", "tick"):
        # A box/strip plot shows RAW values, not a sum — fill the measure un-aggregated.
        if "x" not in enc:
            enc["x"] = field_enc(first_cat)
        if "y" not in enc:
            enc["y"] = field_enc(first_quant)
    else:  # bar, line, area, rect
        if "x" not in enc:
            use_time = mark in ("line", "area") and temporal
            enc["x"] = field_enc(temporal[0] if use_time else first_cat)
        if "y" not in enc:
            enc["y"] = field_enc(first_quant, "sum")

    # Honor the columns the user explicitly named. If they named a measure or a
    # category and the model didn't use it, put it on the matching channel. This
    # enforces the user's intent (the opposite of substituting columns they never
    # asked for) — e.g. "product vs unit price" must use product, not region.
    named = _named_columns(request, profiles)
    if named and mark != "geoshape":
        used = {e.get("field") for e in enc.values() if isinstance(e, dict) and e.get("field")}
        named_quant = [p for p in named if p.level == "quantitative"]
        named_dim = [p for p in named if p.level in ("nominal", "ordinal", "temporal")]
        measure_ch = "theta" if mark == "arc" else "y"
        dim_ch = "color" if mark == "arc" else "x"
        if named_quant and not any(p.name in used for p in named_quant):
            prev = enc.get(measure_ch) or {}
            agg = prev.get("aggregate") if prev.get("aggregate") in AGGREGATES else "sum"
            enc[measure_ch] = {"field": named_quant[0].name, "type": "quantitative", "aggregate": agg}
        if named_dim and not any(p.name in used for p in named_dim):
            p = named_dim[0]
            enc[dim_ch] = {"field": p.name, "type": p.level}

    # Sanitize invalid encodings that render as broken charts (not a field/intent
    # change — just removing nonsensical options the model sometimes emits):
    #  - `bin` is only meaningful on the x/y axes (histograms); strip it elsewhere.
    #  - a pie's angle (`theta`) must be an aggregated measure, never binned/raw.
    for ch in ("color", "size", "theta"):
        if ch in enc:
            enc[ch].pop("bin", None)
    if mark == "arc" and "theta" in enc:
        enc["theta"].pop("bin", None)
        if enc["theta"].get("type") == "quantitative" and "aggregate" not in enc["theta"]:
            enc["theta"]["aggregate"] = "sum"

    spec = {"mark": mark, "encoding": enc}
    note = raw.get("note")
    if not isinstance(note, str) or not note.strip():
        note = _label(spec)
    return spec, note.strip()


def _label(spec: dict) -> str:
    """Compact human label for a spec, used when the model omits one."""
    enc = spec["encoding"]
    mark = spec["mark"]

    def field(channel: str) -> str:
        e = enc.get(channel) or {}
        return e.get("field") or e.get("aggregate") or "?"

    if mark == "geoshape":
        return f"Map · {field('color')} by {field('location')}"
    if mark == "tick":
        return f"Strip · {field('y')} by {field('x')}"
    if mark in ("point", "circle"):
        x = enc.get("x") or {}
        y = enc.get("y") or {}
        x_cat = x.get("type") not in (None, "quantitative")
        y_cat = y.get("type") not in (None, "quantitative")
        if (x_cat != y_cat) and (x.get("aggregate") or y.get("aggregate")):
            measure, cat = ("x", "y") if not x_cat else ("y", "x")
            return f"Dot · {field(measure)} by {field(cat)}"
        return f"Scatter · {field('y')} vs {field('x')}"
    if mark == "arc":
        return f"Pie · {field('theta')} by {field('color')}"
    if mark == "rect":
        return f"Heatmap · {field('x')} × {field('y')}"
    if mark == "boxplot":
        return f"Box · {field('y')} by {field('x')}"
    pretty = {"bar": "Bar", "line": "Line", "area": "Area"}.get(mark, mark)
    return f"{pretty} · {field('y')} by {field('x')}"
