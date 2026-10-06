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
from fastapi.responses import StreamingResponse
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

# /api/analyse sends only ONE chart section (not the whole guide), so its actual
# prompt runs smaller than the other endpoints' ~4k-token guide — giving it the same
# 8192 window over-allocates the KV cache for no benefit. Ollama's own guidance is to
# size num_ctx to the real prompt, not the max you might ever need (docs.ollama.com/
# faq): a needlessly large context window costs memory bandwidth on every token
# regardless of how much of it is used.
#
# 6144, not smaller: MEASURED via prompt_eval_count against this app's own worst
# realistic cases (a 30-point line series, a multi-group box plot, a heatmap grid)
# — the line case alone runs ~4,573 PROMPT tokens before any output, so a first
# attempt at 4096 was too tight and silently truncated the model's own JSON mid-
# string on one run in three. 6144 leaves >1,500 tokens of headroom over that
# worst case plus the num_predict budget below. Re-measure with the same method
# (see docs/analysis-repeatability.md) before lowering this further. This is the
# ADVANCED-mode window (full reference: generic stats, style, statistical
# conventions).
ANALYSE_NUM_CTX = int(os.getenv("OLLAMA_ANALYSE_NUM_CTX", "6144"))

# NORMAL mode sends no Generic-stats/Style block and a stripped-down per-chart
# section (3 bullets, no named conventions) — MEASURED via prompt_eval_count at
# ~2,394 tokens on this app's own worst case (the same 30-point line series used
# to calibrate ANALYSE_NUM_CTX above), against advanced mode's ~4,573. 3072 keeps
# comparable headroom over that plus the num_predict budget below. A smaller
# window is a real generation-time saving (Ollama FAQ: size num_ctx to the real
# prompt), on top of normal mode's own shorter num_predict.
ANALYSE_NUM_CTX_NORMAL = int(os.getenv("OLLAMA_ANALYSE_NUM_CTX_NORMAL", "3072"))

# How long Ollama keeps the model resident after a request (its own duration syntax,
# e.g. "30m", "1h", or "-1" for indefinitely). Ollama's default is 5 minutes; for an
# interactive session that calls this backend repeatedly, letting the model unload
# between charts means paying the full weight-load cost again on the next request.
# Keeping it warm removes that reload tax entirely. (docs.ollama.com/faq, "How do I
# keep a model loaded in memory or make it unload immediately?")
OLLAMA_KEEP_ALIVE = os.getenv("OLLAMA_KEEP_ALIVE", "30m")

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


class AnalyseRequest(BaseModel):
    spec: dict  # the finished Vega-Lite spec
    digest: dict  # aggregated values computed in the browser (no raw rows)
    # The user's ORIGINAL phrase. The chart came from this request, so the chart TYPE
    # is read back out of it rather than re-inferred from the spec's shape.
    request: str = ""
    kind: str | None = None  # the client's resolved ChartKind, used to cross-check
    columns: list[str] = []  # dataset column names, to find the ones the request named
    image: str | None = None  # optional PNG data URL of the rendered chart, for vision analysis
    # "normal": short, plain-English, no statistical terms — for a general reader.
    # "advanced": the full technical read (HHI/effective categories, quartiles and
    # Tukey fences, r² and correlation strength, CV, skewness, ...) for someone who
    # wants to see the actual indices behind the claim. Also drives how much of the
    # guide's reference gets sent (normal skips the "Statistical conventions" and
    # "Generic stats"/"Style" blocks entirely — smaller prompt, faster besides being
    # simpler) and how long the answer is allowed to run (normal is capped much
    # shorter, which is a real generation-time saving, not just a reading-time one).
    mode: str = "normal"


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


def _parse_conclusion_md(md: str) -> tuple[str, str, dict[str, tuple[str, str]]]:
    """Split the conclusion guide into (generic-stats block, style block, {kind slug:
    (label, section)}).

    Sections are keyed by the SAME chart-kind vocabulary the client uses ("### bar —
    Bar chart"), so looking one up is an exact match on the type resolved from the
    user's request — no re-deriving the chart type from the spec's shape. Carrying
    only the matched section keeps the prompt small enough for a local model.
    """
    generic: list[str] = []
    style: list[str] = []
    charts: dict[str, tuple[str, str]] = {}
    mode: str | None = None
    slug: str | None = None
    label = ""
    buf: list[str] = []

    def close() -> None:
        nonlocal slug, buf
        if slug is not None:
            charts[slug] = (label, "\n".join(buf).strip())
            slug, buf = None, []

    for line in md.splitlines():
        if line.startswith("## ") or (line.startswith("### ") and mode == "charts"):
            close()
        if line.startswith("## Generic stats"):
            mode = "generic"
        elif line.startswith("## Chart types"):
            mode = "charts"
        elif line.startswith("## Style"):
            mode = "style"
        elif line.startswith("## "):
            mode = None
        elif line.startswith("### ") and mode == "charts":
            head = line[4:].strip()
            # "bar — Bar chart" → slug "bar", label "Bar chart".
            parts = head.split("—", 1)
            slug = parts[0].strip()
            label = parts[1].strip() if len(parts) > 1 else slug
            buf = [head]
        elif mode == "generic":
            generic.append(line)
        elif mode == "style":
            style.append(line)
        elif mode == "charts" and slug is not None:
            buf.append(line)
    close()
    return "\n".join(generic).strip(), "\n".join(style).strip(), charts


CONCLUSION_GENERIC, CONCLUSION_STYLE, CONCLUSION_SECTIONS = _parse_conclusion_md(CHART_CONCLUSION)

# _detect_mark speaks in marks; the guide and the client speak in chart KINDS.
_MARK_TO_KIND = {"geoshape": "map", "boxplot": "box"}

KIND_LABELS = {slug: label for slug, (label, _text) in CONCLUSION_SECTIONS.items()}


def _kind_from_request(request: str, fallback: str | None) -> tuple[str, str]:
    """Resolve the chart TYPE from the user's own words — the chart was built from
    this request, so the request is the authority. Falls back to the kind the client
    derived from the rendered spec (vague requests name no type at all).

    Returns (kind, how) where `how` explains which source won, for the progress UI.
    """
    mark = _detect_mark(request)
    if mark:
        kind = _MARK_TO_KIND.get(mark, mark)
        if kind in CONCLUSION_SECTIONS:
            # The rendered chart wins on a genuine disagreement (the backend may have
            # fallen back — e.g. a dot plot with no category becomes a scatter), but
            # say so rather than silently analysing a chart that isn't on screen.
            if fallback and fallback in CONCLUSION_SECTIONS and fallback != kind:
                return fallback, f"asked for a {KIND_LABELS.get(kind, kind).lower()}, rendered as"
            return kind, "from your request"
    if fallback and fallback in CONCLUSION_SECTIONS:
        return fallback, "from the rendered chart"
    return "bar", "defaulted"


def _named_column_names(request: str, columns: list[str]) -> list[str]:
    """Columns the request names, in the order they appear in it (treating
    'unit price' as unit_price)."""
    req = _norm(request)
    hits: list[tuple[int, str]] = []
    for name in columns:
        n = _norm(name)
        if not n:
            continue
        i = req.find(n)
        if i >= 0:
            hits.append((i, name))
    hits.sort(key=lambda t: t[0])
    return [n for _, n in hits]


# Column-name unit suffixes the model would otherwise have to notice and keep
# track of itself — spelled out instead so a number is never quoted bare when
# the column already states what it's counted in (e.g. a real run reported
# "26 people" / "245.95 people" for a `population_m` column, dropping the
# "million" the column name states, understating those values 1,000,000x).
_UNIT_SUFFIXES: list[tuple[str, str]] = [
    ("_mn", "millions"),
    ("_m", "millions"),
    ("_bn", "billions"),
    ("_b", "billions"),
    ("_k", "thousands"),
    ("_pct", "percent"),
    ("_percent", "percent"),
    ("_usd", "US dollars"),
    ("_gbp", "British pounds"),
    ("_eur", "euros"),
]


def _unit_hint(field: str) -> str | None:
    """The unit a column name states about itself, if any, e.g. `population_m`
    -> "millions". Longer suffixes are checked first so `_mn` isn't missed by `_m`."""
    low = field.lower()
    for suffix, unit in _UNIT_SUFFIXES:
        if low.endswith(suffix):
            return unit
    return None


def _spec_roles(spec: dict) -> list[str]:
    """Each encoded column and the role it plays, e.g. "revenue (y, sum)" — so the
    model knows which named column is the measure and which is the category.
    When the column name states a unit (e.g. `population_m`), that unit is spelled
    out too, so it's never silently dropped when the model quotes a value."""
    enc = spec.get("encoding") or {}
    roles: list[str] = []
    for channel, e in enc.items():
        if not isinstance(e, dict):
            continue
        field = e.get("field")
        bits = [channel]
        if e.get("aggregate"):
            bits.append(str(e["aggregate"]))
        if e.get("bin"):
            bits.append("binned")
        role = f"{field or 'count'} ({', '.join(bits)})"
        unit = _unit_hint(field) if field else None
        if unit:
            role += f" — values are in {unit}, always say so"
        roles.append(role)
    return roles

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


# (No CONCLUSION_SCHEMA: this endpoint streams plain prose, not structured JSON —
# see _stream_analysis for why.)

# Kept short + static: the per-chart guidance is attached per request as a small
# chart-specific block (fast). When a chart IMAGE is supplied it's analysed by the
# vision model too. Two tiers of the same job: ADVANCED writes the full technical
# read (named indices, so a reader with a stats background can verify the claim
# against the numbers); NORMAL writes the same underlying claim in plain English,
# for a reader who has never heard of an interquartile range. Both are streamed as
# PLAIN PROSE, not JSON — see `_analysis_paragraph` for why.
CONCLUSION_SYSTEM_ADVANCED = """You are a professional data analyst writing an ANALYSIS of one chart for a report, for a reader who is comfortable with statistics and wants to see the actual reasoning, not just the conclusion.

The chart TYPE has already been resolved from the user's own request, and you are given the REFERENCE for exactly that type, the COLUMNS the user named and the role each plays (x/y/color/size/aggregate), a DIGEST of the chart's values, and (when available) the rendered chart IMAGE.

YOUR PRIMARY JOB is the SIGNATURE TREND. The reference names the one pattern this chart type exists to reveal — a line's direction and rate, a bar's ranking and gaps, a scatter's correlation strength, a pie's concentration, a histogram's shape, a box plot's median and spread, a heatmap's hotspots, a map's geographic clustering. Your FIRST SENTENCE must state that pattern as found in THIS data, with its numbers. A paragraph that could have been written about any chart type has failed, however many numbers it quotes.

The digest's `trend` block holds the evidence for that signature pattern — the ordered series, the correlation and r², the bins and skew, the quartiles and Tukey fences, the cells and residuals, the concentration figures. Lead from it. NAME the specific statistical quantity or convention you're using as you use it — HHI/effective categories, IQR/quartiles, r² and correlation strength, coefficient of variation, skewness, Tukey fences, standardized residuals — this is the ADVANCED tier specifically because it surfaces the actual technique, not just its conclusion. Apply the reference's thresholds and named conventions (correlation bands, skew bands, the 1.5×IQR fence, the n≥20 rule) rather than inventing your own adjectives.

Then, in 4–6 sentences total: support the signature trend with the GENERIC STATS (max, min, mean vs median, range), call out what breaks the pattern (outliers, laggards, cells or points against the trend), and close with the takeaway.

EVIDENCE — every analytical claim carries its example in the same sentence. Name the group, quote the number. "A few regions dominate" is incomplete; "the Americas and Asia hold 76% of the total (31.5 and 28.5 trillion)" is the same claim, proven. If a sentence characterises the data (dominant, skewed, concentrated, steep, weak) without naming the groups and numbers behind it, rewrite it with them.

NEVER INVENT A NUMBER, AND NEVER INVENT A UNIT. Every figure must come from the digest, and the digest holds bare numbers — write "577,731", never "577,731 trillion", "$577,731" or "577,731 million". Use a unit only when the column name states one. If the evidence for a claim is not there, drop the claim — a shorter honest paragraph beats a complete-sounding invented one.

Any field named `...Share`, `pctChange`, `cagr`, `evenness` or `hhiNormalized` is a FRACTION — 0.021 means 2.1%, so multiply by 100 before writing a percent sign; writing the bare fraction as "0.021%" is a 100x error and has happened before. When a field is already a VERDICT WORD (`skew`, `steadiness`, `volatility`, `concentration.concentration`, `marginDriven`, `paretoLike`), quote it and move on — do not immediately re-describe the same thing with a different, possibly contradictory adjective in the next clause (a prior run quoted `steadiness: "fluctuating"` correctly, then called the same movement "relatively steady" one clause later, which undoes the correct answer it had just given).

LEVELS — the digest tags each statistic with what it describes. `groupStats` (basis "per-group") describes the bars/regions ON the chart; its `skew` field is already decided ("right"/"left"/"symmetric") from mean vs median — quote it, never compare those two numbers yourself, since that comparison has produced a wrong-direction, overstated skew claim before. `underlyingRecords` describes the individual rows BEHIND them — its mean and max appear nowhere on the chart, so quote it only when explicitly discussing individual records, and say that is what you are doing. `measure` appears only on charts that do not group, where each row is itself a mark. Report `share`/`topShare` as percentages. Use `concentration.concentration` ("low"/"moderate"/"high") as given rather than judging it from the raw `concentration.hhi` yourself — the raw HHI has a floor that makes it misleading for a small number of categories, which is exactly why the verdict is computed from `concentration.effectiveGroups` instead. Claim that a few categories dominate only when `paretoLike` is true. `vsSecond` (leader vs. runner-up) and `vsLaggard` (leader vs. smallest) are DIFFERENT ratios — never quote one while describing the other. On a line/area chart, use `trend.steadiness` ("steady"/"uneven"/"fluctuating") and `trend.volatility` ("stable"/"moderate"/"volatile") exactly as given — an independent check found `monotonicShare` 0.517 called "relatively steady" and `cv` 0.09 called "moderate volatility" when the guide's own bands make both the OPPOSITE reading; these two fields exist so you never have to bin those raw numbers yourself. If `dimension.shown` is less than `dimension.groupCount` the group list is truncated: name leaders from it, never a laggard.

Professional, analytical prose. No preamble ("This chart shows"), no markdown, no bullet lists, no headings — just the paragraph. If the data is genuinely too thin for a real pattern, say so plainly.

LANGUAGE: Write in ENGLISH ONLY. Every word must be English. Never emit Chinese, Japanese, Korean or any other non-Latin script — not for a single word, term or punctuation mark. Column names and labels are copied verbatim from the data.
Output ONLY the paragraph itself — plain prose, no JSON, no quotes around it, no markdown, nothing before or after it."""

# NORMAL: the SAME underlying claim as advanced, translated — never the name of the
# statistic, always what it means. This exists because real users found the
# technical tier genuinely hard to follow ("what's an index?"), not because the
# underlying evidence changes — a normal-tier reader still deserves a grounded,
# specific answer, just not one that requires knowing what an interquartile range is.
CONCLUSION_SYSTEM_NORMAL = """You are explaining one chart to someone with no statistics background — a curious general reader, not a data analyst.

The chart TYPE has already been resolved from their own request, and you are given a short REFERENCE for what this chart type is designed to show, the COLUMNS they named, a DIGEST of the chart's actual values, and (when available) the rendered chart IMAGE.

Write 2–4 short, plain-spoken sentences that:
1. Say what the chart shows, in everyday words. Describe the finding directly — "South and North are neck-and-neck out in front" — never name the pattern abstractly ("the ranking exhibits...", "the signature trend is...").
2. Back it up with the real numbers from the digest, but round generously and speak in everyday terms — "about a quarter of the total" rather than "28.8%", "roughly twice as much" rather than "a ratio of 1.98", "spread pretty evenly" rather than "low concentration".
3. Close with the one-sentence takeaway a reader should walk away with.

BANNED: never use a statistical term or field name, in English or otherwise — no "HHI", "effective categories/groups", "evenness", "concentration index", "vsSecond", "vsLaggard", "monotonic share", "steadiness", "volatility", "coefficient of variation", "CV", "skewness", "quartile", "IQR", "interquartile range", "standard deviation", "r²", "correlation coefficient", "Tukey", "standardized residual", "Pareto", "percentile", "aggregate", "per-group", "per-row", "basis". If you're about to write one of these, or any other technical term, stop and rephrase it in plain language — describe what it MEANS for the data, never its NAME. (This is the one hard rule that separates this tier from the advanced one — the underlying facts are identical, only the words differ.)

NEVER INVENT A NUMBER OR A UNIT. Every figure must come from the digest, and the digest holds bare numbers — no units, no currency, no magnitude words — unless the column name itself states one (temp_c is Celsius; revenue has no stated unit, so it gets none).

No preamble ("This chart shows"), no markdown, no bullet points, no headings — just the plain-spoken paragraph. If the data is genuinely too thin to say anything meaningful, say so simply — "there's not quite enough here to spot a real pattern" — rather than manufacturing one.

LANGUAGE: Write in ENGLISH ONLY. Never emit Chinese, Japanese, Korean or any other non-Latin script.
Output ONLY the paragraph itself — plain prose, no JSON, no quotes around it, no markdown, nothing before or after it."""

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

# Magnitude words attached to a number, e.g. "577,731.34 trillion". The digest carries
# BARE numbers — no units, no scale — so any such word is invented, and inventing one
# restates the finding off by a factor of a thousand or a trillion. Instructing the
# model not to do it does not hold (qwen2.5:7b kept it across a reworded prompt), and
# because the payload provably has no units this is safe to strip deterministically.
_INVENTED_SCALE = re.compile(
    r"(?<=\d)(\s*)(trillion|billion|million|thousand|trillions|billions|millions|thousands)\b",
    re.I,
)
# A currency symbol glued to a number, same reasoning.
_INVENTED_CURRENCY = re.compile(r"(?<![\w.])[$£€¥](?=\d)")
# A sentence boundary is terminal punctuation NOT followed by a digit — otherwise the
# decimal point in "15.6 trillion" reads as the end of a sentence, and these
# paragraphs are full of decimals.
_SENTENCE_BOUNDARY = re.compile(r"[.!?](?!\d)[\"')\]]?(?=\s|$)")


def _strip_invented_units(text: str) -> str:
    """Remove scale words and currency symbols the model attached to bare numbers."""
    text = _INVENTED_SCALE.sub("", text)
    text = _INVENTED_CURRENCY.sub("", text)
    # Stripping "577,731 trillion," can leave a doubled space before the comma.
    return re.sub(r" {2,}", " ", text)


def _clean_paragraph(text: str) -> str:
    """Trim a generated paragraph back to the model's actual answer."""
    cut = _ARTIFACT.search(text)
    if cut:
        text = text[: cut.start()]
    text = _strip_invented_units(text)
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
            keep_alive=OLLAMA_KEEP_ALIVE,
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
            keep_alive=OLLAMA_KEEP_ALIVE,
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
            keep_alive=OLLAMA_KEEP_ALIVE,
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


# A chart-specific section, for NORMAL mode: keep only the plain-language bullets
# ("Uniquely shows", "Signature trend", "Analyse") and drop everything after —
# the "Statistical conventions" block (every named index/threshold) and, on the
# bar chart, the field-name-heavy "Two DIFFERENT ratios" bullet. Normal mode's
# system prompt already bans this vocabulary; not sending it too is both belt-
# and-braces AND a real prompt-size cut (see ANALYSE_NUM_CTX_NORMAL).
_ADVANCED_ONLY_MARKERS = ("- **Statistical conventions:**", "- **Two DIFFERENT ratios")


def _plain_section(section: str) -> str:
    cut = len(section)
    for marker in _ADVANCED_ONLY_MARKERS:
        i = section.find(marker)
        if i != -1:
            cut = min(cut, i)
    return section[:cut].rstrip()


# A few short sequences that end generation the instant the model starts past its
# answer — small models often keep going and improvise the NEXT conversational
# turn (see _ARTIFACT below) or open a stray brace. Stopping generation there is
# strictly faster than generating the junk and trimming it afterwards.
_STOP_SEQUENCES = ["\n\n", "{", "<|", "User:", "Assistant:"]


def _stream_analysis(system: str, user: str, image_b64: str | None, mode: str):
    """Generator over the analysis call: yields `{"delta": text}` as tokens arrive,
    `{"restart": True}` if a non-English answer triggers a retry (the caller should
    drop whatever it displayed so far), and finally `{"final": cleaned_text}`
    ("" on failure).

    Streamed PLAIN PROSE, not the structured-JSON `format=` every other endpoint
    uses: JSON-schema-constrained decoding doesn't stream a growing string
    cleanly (the value only becomes valid to display once its closing quote
    arrives), and prose needs no schema — this endpoint's whole output is one
    string. Streaming raw deltas is what actually lets the paragraph appear as
    it's written instead of only once the whole thing is ready, which is the
    single biggest perceived-speed win available without changing models.
    """
    num_predict = 220 if mode == "normal" else 500
    num_ctx = ANALYSE_NUM_CTX_NORMAL if mode == "normal" else ANALYSE_NUM_CTX

    def run(model: str, user_msg: dict, sys: str):
        stream = client.chat(
            model=model,
            messages=[{"role": "system", "content": sys}, user_msg],
            # temperature 0 (as every other endpoint): this is an analysis of fixed
            # numbers, not creative writing, and sampling is what lets a bilingual
            # model wander out of English mid-paragraph.
            options={
                "temperature": 0,
                "num_ctx": num_ctx * 2 if "images" in user_msg else num_ctx,
                "num_predict": num_predict,
                "stop": _STOP_SEQUENCES,
            },
            keep_alive=OLLAMA_KEEP_ALIVE,
            stream=True,
        )
        acc = ""
        for chunk in stream:
            piece = chunk.get("message", {}).get("content", "")
            if piece:
                acc += piece
                yield {"delta": piece}
        yield {"_acc": acc}  # internal only — _run_checked below pulls this out

    def run_checked(model: str, user_msg: dict):
        """One retry with a hard reminder if the model answered in another script;
        a still-drifted paragraph is dropped rather than shown to the user."""
        acc = ""
        for ev in run(model, user_msg, system):
            if "_acc" in ev:
                acc = ev["_acc"]
            else:
                yield ev
        text = _clean_paragraph(acc)
        if text and not _is_english(text):
            logger.warning("Model '%s' answered with non-English text; retrying", model)
            yield {"restart": True}
            acc = ""
            for ev in run(model, user_msg, system + _ENGLISH_RETRY):
                if "_acc" in ev:
                    acc = ev["_acc"]
                else:
                    yield ev
            text = _clean_paragraph(acc)
        if text and not _is_english(text):
            logger.warning("Model '%s' drifted out of English again; dropping the analysis", model)
            yield {"final": ""}
            return
        yield {"final": text}

    if image_b64:
        try:
            # If the vision model errors (not pulled, etc.), it does so on this
            # first request before any chunk — and so before any `delta` is
            # yielded — letting the fallback below run with nothing already shown.
            yield from run_checked(VISION_MODEL, {"role": "user", "content": user, "images": [image_b64]})
            return
        except Exception:
            logger.warning("Vision analysis unavailable (is '%s' pulled?); using text model", VISION_MODEL)
    yield from run_checked(MODEL, {"role": "user", "content": user})


# The analysis pipeline, as the user sees it. Each node reports when it completes so
# the wait on a slow local model is legible instead of one long spinner.
ANALYSIS_NODES = [
    {"id": "chart-type", "label": "Identify the chart type"},
    {"id": "reference", "label": "Load the analysis reference"},
    {"id": "columns", "label": "Resolve the columns in play"},
    {"id": "evidence", "label": "Gather the chart's evidence"},
    {"id": "analysis", "label": "Write the analysis"},
]


def _sse(payload: dict) -> str:
    """One server-sent event. `ensure_ascii` keeps the frame bytes plain ASCII."""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _signature_line(section: str, limit: int = 90) -> str:
    """The chart type's signature-trend sentence, as plain text for the progress UI.

    The guide writes it as "- **Signature trend — lead with this:** the direction and
    the rate — ...", so the bold markers come off before splitting on the colon, and
    the tail is trimmed at a word boundary rather than mid-word.
    """
    lines = section.splitlines()
    for i, line in enumerate(lines):
        if "Signature trend" not in line:
            continue
        # The guide hard-wraps its bullets, so take the continuation lines too —
        # otherwise the phrase ends mid-clause ("...the size of the gaps. Who").
        parts = [line.strip()]
        for cont in lines[i + 1 :]:
            stripped = cont.strip()
            if not stripped or cont.lstrip().startswith("-") or cont.startswith("#"):
                break
            parts.append(stripped)
        plain = " ".join(parts).replace("*", "").lstrip("- ").strip()
        _, _, rest = plain.partition(":")
        rest = rest.strip()
        if not rest:
            return ""
        if len(rest) <= limit:
            return rest
        cut = rest[:limit].rsplit(" ", 1)[0].rstrip(",;—- ")
        return f"{cut}…"
    return ""


def _describe_evidence(digest: dict) -> str:
    """One line naming what evidence the digest actually carries, for the progress UI."""
    trend = digest.get("trend") or {}
    shape = trend.get("shape")
    described = {
        "series": "ordered series, direction and turning points",
        "ranking": "ranking, gaps and concentration",
        "composition": "slice shares and concentration",
        "distribution": "bins, skew and modality",
        "spread": "quartiles, IQR and Tukey outliers",
        "relationship": "correlation, r² and outliers",
        "matrix": "cells, margins and residuals",
    }.get(shape or "")
    bits = []
    if described:
        bits.append(described)
    rows = digest.get("rows")
    if isinstance(rows, int):
        bits.append(f"{rows:,} rows")
    dim = digest.get("dimension") or {}
    if dim.get("groupCount"):
        bits.append(f"{dim['groupCount']} groups")
    return " · ".join(bits) or "summary statistics"


def _trim_digest_for_prompt(digest: dict) -> dict:
    """Drop fields from the digest that `trend` already carries in full, before it
    goes into the prompt. This is pure token reduction — nothing here changes what
    the model can see, only how many times it sees the same number.

    The digest keeps `axes`/`correlation`/`measure` as top-level fields for backward
    compatibility with anything else that might read a ChartDigest object, but nothing
    in the app does (verified: not referenced outside chartDigest.ts and its tests) —
    they were fully superseded by `trend` when the chart-type-aware trend blocks were
    added. Sending both copies to the model costs real prefill time for zero benefit:
    a scatter's `axes`+`correlation` restate exactly `trend.x`/`trend.y`/
    `trend.correlation`; a histogram's `measure` is a strict subset of `trend`'s
    min/max/mean/median (plus stdDev/quartiles/bins `measure` doesn't have).
    """
    trend = digest.get("trend") or {}
    shape = trend.get("shape")
    trimmed = dict(digest)
    if shape == "relationship":
        trimmed.pop("axes", None)
        trimmed.pop("correlation", None)
    elif shape == "distribution":
        trimmed.pop("measure", None)
    return trimmed


def _analysis_events(body: AnalyseRequest):
    """Run the analysis as a pipeline of nodes, yielding an SSE frame as each one
    completes. Nodes 1–3 are deterministic and instant — they assemble exactly what
    the model is allowed to reason from; node 5 is the (slow) model call."""
    yield _sse({"type": "init", "nodes": ANALYSIS_NODES})

    try:
        # 1) CHART TYPE — read back out of the request that produced the chart.
        yield _sse({"type": "node", "id": "chart-type", "status": "running"})
        kind, how = _kind_from_request(body.request, body.kind)
        label = KIND_LABELS.get(kind, kind)
        yield _sse({"type": "node", "id": "chart-type", "status": "done", "detail": f"{label} ({how})"})

        # 2) REFERENCE — the guide section for exactly that type.
        yield _sse({"type": "node", "id": "reference", "status": "running"})
        _label, section = CONCLUSION_SECTIONS.get(kind, ("", ""))
        signature = _signature_line(section)
        detail = f"lead with {signature}" if signature else f"{label} notes"
        yield _sse({"type": "node", "id": "reference", "status": "done", "detail": detail})

        # 3) COLUMNS — the ones the request named, plus the role each plays.
        yield _sse({"type": "node", "id": "columns", "status": "running"})
        named = _named_column_names(body.request, body.columns)
        roles = _spec_roles(body.spec)
        yield _sse(
            {
                "type": "node",
                "id": "columns",
                "status": "done",
                "detail": ", ".join(named) if named else (", ".join(roles) or "none named"),
            }
        )

        # 4) EVIDENCE — what the browser-side digest actually supports.
        yield _sse({"type": "node", "id": "evidence", "status": "running"})
        yield _sse({"type": "node", "id": "evidence", "status": "done", "detail": _describe_evidence(body.digest)})

        # 5) ANALYSIS — the model call, streamed.
        mode = body.mode if body.mode in ("normal", "advanced") else "normal"
        has_image = bool(body.image and "," in body.image)
        yield _sse(
            {
                "type": "node",
                "id": "analysis",
                "status": "running",
                "detail": ("reading the chart image" if has_image else "reasoning from the data")
                + (" — plain-English" if mode == "normal" else " — advanced"),
            }
        )
        if mode == "advanced":
            reference = (
                f"This chart is a {label}. The pattern it uniquely reveals, and how to analyse it:\n"
                f"{section}\n\n"
                f"Generic stats you can use:\n{CONCLUSION_GENERIC}\n\n"
                f"Style:\n{CONCLUSION_STYLE}"
            )
        else:
            # No Generic-stats/Style block, and the per-chart section is stripped
            # of its technical bullets (see _plain_section) — normal mode's system
            # prompt bans this vocabulary outright, so sending it would only cost
            # prompt tokens for guidance the answer isn't allowed to use anyway.
            reference = (
                f"This chart is a {label}. The pattern it uniquely reveals, and how to describe it in plain words:\n"
                f"{_plain_section(section)}"
            )
        columns_line = (
            f"Columns the user named: {', '.join(named)}\n" if named else ""
        ) + (f"Encoded as: {'; '.join(roles)}\n" if roles else "")
        # The raw Vega-Lite spec is NOT sent: `label`/`kind` already name the chart
        # type and `roles` already names every encoded column and its aggregate, so
        # the spec JSON would only repeat both in a more verbose form. Trimming the
        # digest removes the other source of duplication (see `_trim_digest_for_prompt`).
        # Together these are a real, measured cut to the analysis prompt's token count.
        user = (
            f"Reference:\n{reference}\n\n"
            f"The user's request: {body.request or '(not given)'}\n"
            f"{columns_line}\n"
            f"Value digest:\n{json.dumps(_trim_digest_for_prompt(body.digest))}"
        )
        image_b64 = body.image.split(",", 1)[1] if has_image else None
        system_prompt = CONCLUSION_SYSTEM_ADVANCED if mode == "advanced" else CONCLUSION_SYSTEM_NORMAL

        final_text = ""
        for ev in _stream_analysis(system_prompt, user, image_b64, mode):
            if "delta" in ev:
                yield _sse({"type": "delta", "text": ev["delta"]})
            elif "restart" in ev:
                # A non-English answer triggered a retry — whatever was streamed
                # so far is being thrown away; tell the client to clear it rather
                # than appending the retry's text onto the rejected draft.
                yield _sse({"type": "restart"})
            elif "final" in ev:
                final_text = ev["final"]

        if not final_text:
            yield _sse({"type": "node", "id": "analysis", "status": "error"})
            yield _sse({"type": "error", "message": "The analysis came back empty. Please try again."})
            return
        yield _sse({"type": "node", "id": "analysis", "status": "done", "detail": f"{len(final_text.split())} words"})
        yield _sse({"type": "result", "conclusion": final_text, "kind": kind, "label": label, "mode": mode})
    except Exception:
        logger.exception("Analysis pipeline failed")  # full detail stays server-side
        yield _sse({"type": "error", "message": "The service is temporarily unavailable. Please try again."})


@app.post("/api/analyse")
def analyse(body: AnalyseRequest) -> StreamingResponse:
    """A professional PARAGRAPH analysing the chart, STREAMED as a node pipeline.

    The chart type comes from the user's own request (the chart was built from it),
    which selects the guide section for that exact type; the columns the request named
    and the browser-computed digest supply the evidence. Each node emits an SSE frame
    as it completes so the UI can show progress through a slow local model call. No
    raw rows are ever sent, and only the matched guide section is attached.
    """
    return StreamingResponse(
        _analysis_events(body),
        media_type="text/event-stream",
        # Proxies otherwise buffer the whole stream and the progress arrives at once.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
