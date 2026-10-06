"""
Repeatability check for /api/analyse.

Runs the SAME chart request N times against the real backend pipeline (same
digest every time — it's computed once in the browser and is deterministic, so
this isolates variance to the model call alone) and writes every generation to
a markdown file, then extracts the checkable facts from each paragraph and
reports where they agree or disagree.

Usage:  python scripts/repeatability_check.py <digest.json> <out.md> [N]
"""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server.main as m  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

N = int(sys.argv[3]) if len(sys.argv) > 3 else 10
DIGEST_PATH = Path(sys.argv[1])
OUT_PATH = Path(sys.argv[2])

case = json.loads(DIGEST_PATH.read_text(encoding="utf-8"))
client = TestClient(m.app)


def run_once() -> dict:
    body = {
        "spec": case["spec"],
        "digest": case["digest"],
        "request": case["request"],
        "kind": case["kind"],
        "columns": case["columns"],
        "image": None,
    }
    t0 = time.time()
    conclusion = None
    error = None
    with client.stream("POST", "/api/analyse", json=body) as r:
        for line in r.iter_lines():
            if not line.startswith("data:"):
                continue
            e = json.loads(line[5:])
            if e["type"] == "result":
                conclusion = e["conclusion"]
            elif e["type"] == "error":
                error = e["message"]
    return {"conclusion": conclusion, "error": error, "seconds": round(time.time() - t0, 1)}


# ---- Fact extraction --------------------------------------------------------
# The digest is FIXED, so every correct generation should agree on these checkable
# facts even though the wording varies. Pulled with regex rather than trusting the
# model's own labels, since the extraction has to be independent of what it wrote.

TREND = case["digest"]["trend"]
GROUPS = case["digest"]["groups"]
EXPECTED = {
    "leader": TREND["leader"]["label"],
    "laggard": TREND["laggard"]["label"],
    "concentration": TREND["concentration"],
    "top_share_pct": round(TREND["topShare"] * 100, 1) if TREND.get("topShare") is not None else None,
}


def extract_facts(text: str) -> dict:
    lower = text.lower()
    facts: dict[str, object] = {}

    # Which region is named FIRST as the leader — the model should open with it.
    order = []
    for g in GROUPS:
        idx = lower.find(g["label"].lower())
        if idx != -1:
            order.append((idx, g["label"]))
    order.sort()
    facts["first_region_named"] = order[0][1] if order else None
    facts["regions_named"] = [label for _, label in order]

    # Concentration verdict — must be quoted verbatim per the guide's instruction.
    for verdict in ("low", "moderate", "high"):
        if re.search(rf"\b{verdict}\b[^.]*concentrat", lower) or re.search(rf"concentrat[^.]*\b{verdict}\b", lower):
            facts["concentration_stated"] = verdict
            break
    else:
        facts["concentration_stated"] = None

    # Any invented magnitude word attached to a number — should be ZERO after the
    # _strip_invented_units scrub; this is the regression check for that fix.
    facts["invented_units"] = bool(m._INVENTED_SCALE.search(text) or m._INVENTED_CURRENCY.search(text))

    # Non-English drift — should never happen given the CJK guard, but check anyway.
    facts["non_english"] = not m._is_english(text)

    # Sentence count (rough) and word count, for consistency of LENGTH/style.
    facts["word_count"] = len(text.split())
    facts["sentence_count"] = len(re.findall(r"[.!?](?:\s|$)", text))

    return facts


# ---- Run --------------------------------------------------------------------

print(f"Request: {case['request']!r}")
print(f"Running {N} generations against {m.MODEL} (temperature=0, digest fixed)...")

runs = []
for i in range(N):
    print(f"  [{i + 1}/{N}] ...", end="", flush=True)
    r = run_once()
    if r["conclusion"]:
        r["facts"] = extract_facts(r["conclusion"])
    runs.append(r)
    print(f" {r['seconds']}s" + (" ERROR" if r["error"] else ""))

# ---- Write the markdown report ----------------------------------------------

lines: list[str] = []
lines.append("# Analysis repeatability check\n")
lines.append(f"**Model:** `{m.MODEL}` (temperature 0) · **Runs:** {N}\n")
lines.append(f"**Request:** `{case['request']}`\n")
lines.append(
    "**Why temperature 0 isn't enough on its own:** Ollama serves qwen2.5 with "
    "llama.cpp, which does floating-point reduction in a batch- and hardware-dependent "
    "order — so even greedy decoding is not bit-for-bit deterministic run to run. This "
    "check measures how much that matters in practice: whether the checkable FACTS "
    "(leader, concentration verdict, no invented units) stay fixed while only the "
    "prose varies, or whether the numbers themselves drift.\n"
)
lines.append("## Fixed inputs (same for every run)\n")
lines.append("```json")
lines.append(json.dumps(case["digest"], indent=2))
lines.append("```\n")

lines.append("## Generations\n")
for i, r in enumerate(runs, 1):
    lines.append(f"### Run {i} ({r['seconds']}s)\n")
    if r["error"]:
        lines.append(f"**ERROR:** {r['error']}\n")
    else:
        lines.append(r["conclusion"] + "\n")

lines.append("## Fact consistency\n")
lines.append(f"Every run analysed the identical digest, so `{EXPECTED['leader']}` is the only correct leader,")
lines.append(f"`{EXPECTED['laggard']}` the only correct laggard, and `{EXPECTED['concentration']}`")
lines.append("the only correct concentration verdict — these don't vary by writing style, so any")
lines.append("disagreement here is a factual error, not a phrasing difference.\n")
lines.append("| Run | Leader named first | Concentration stated | Invented units | Non-English | Words |")
lines.append("|---|---|---|---|---|---|")
for i, r in enumerate(runs, 1):
    if r["error"]:
        lines.append(f"| {i} | — ERROR — | | | | |")
        continue
    f = r["facts"]
    leader_ok = "✅" if f["first_region_named"] == EXPECTED["leader"] else "❌"
    conc_ok = "✅" if f["concentration_stated"] == EXPECTED["concentration"] else "❌"
    units_ok = "✅" if not f["invented_units"] else "❌ FOUND"
    lang_ok = "✅" if not f["non_english"] else "❌ FOUND"
    lines.append(
        f"| {i} | {f['first_region_named']} {leader_ok} | {f['concentration_stated']} {conc_ok} "
        f"| {units_ok} | {lang_ok} | {f['word_count']} |"
    )

ok_runs = [r for r in runs if not r["error"]]
leader_agree = sum(1 for r in ok_runs if r["facts"]["first_region_named"] == EXPECTED["leader"])
conc_agree = sum(1 for r in ok_runs if r["facts"]["concentration_stated"] == EXPECTED["concentration"])
units_clean = sum(1 for r in ok_runs if not r["facts"]["invented_units"])
words = [r["facts"]["word_count"] for r in ok_runs]

lines.append("\n## Summary\n")
lines.append(f"- **{len(ok_runs)}/{N}** runs completed without a pipeline error.")
lines.append(f"- **{leader_agree}/{len(ok_runs)}** correctly led with the actual leader (`{EXPECTED['leader']}`).")
lines.append(f"- **{conc_agree}/{len(ok_runs)}** stated the correct concentration verdict (`{EXPECTED['concentration']}`).")
lines.append(f"- **{units_clean}/{len(ok_runs)}** had no invented units after the scrub.")
if words:
    lines.append(f"- Word count ranged **{min(words)}–{max(words)}** (mean {round(sum(words) / len(words))}).")

OUT_PATH.write_text("\n".join(lines), encoding="utf-8")
print(f"\nWrote {OUT_PATH}")
print(f"Leader agreement: {leader_agree}/{len(ok_runs)} | Concentration agreement: {conc_agree}/{len(ok_runs)} | Units clean: {units_clean}/{len(ok_runs)}")
