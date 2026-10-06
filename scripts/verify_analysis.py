"""
Verification harness for /api/analyse — the hybrid replacement for one-off
subagent verification.

For each test case (a saved {spec, digest, request, kind, columns} JSON, as
produced by the `__emit*.test.ts` pattern used during development) this:
  1. Runs the REAL analysis pipeline (via FastAPI's TestClient — same code path
     production uses) to get a fresh paragraph.
  2. Runs the deterministic checks (scripts/deterministic_checks.py) — the hard
     gate. These catch the exact bug patterns found in prior verification
     rounds (field conflation, fraction-as-percent, verdict contradiction,
     invented units) with zero LLM calls, so they're free, instant and cannot
     misjudge the way a same-tier local model can.
  3. Optionally scores RAGAS Faithfulness (soft, informational) — general
     groundedness against the digest, judged by a local Ollama model via its
     OpenAI-compatible endpoint. This is NOT a hard gate: a same-tier local
     judge was measured (see docs/analysis-repeatability.md) to sometimes score
     a response with a real attribution bug HIGHER than a correct one, so
     Faithfulness is reported for visibility, not treated as ground truth.

Usage:
    python scripts/verify_analysis.py case1.json [case2.json ...]
    python scripts/verify_analysis.py case1.json --no-faithfulness

Exit code is 0 only if every deterministic check passes on every case.

--- Installing the optional RAGAS/Faithfulness dependency ---
`pip install ragas` tries to build a native `scikit-network` wheel, which needs
a C++ compiler most machines don't have. Work around it by installing an old,
pure-Python release FIRST so pip finds the requirement already satisfied:
    pip install "scikit-network==0.12.1"
    pip install ragas openai
ragas 0.4.3 also unconditionally imports `langchain_community.chat_models.
vertexai.ChatVertexAI`, which no longer exists in current langchain-community
releases (VertexAI supp­ort moved to a separate package). This module never
uses VertexAI, so `_stub_vertexai()` below injects an empty placeholder module
before importing ragas rather than pulling in Google Cloud's SDK for a class
we'll never instantiate.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import server.main as server_main  # noqa: E402
from scripts.deterministic_checks import run_all  # noqa: E402

JUDGE_MODEL = "llama3.1:8b"  # a DIFFERENT model from the qwen2.5:7b generator by
# default, so Faithfulness isn't a model grading its own output — still just a
# soft signal (see module docstring for why it isn't a hard gate).
OLLAMA_OPENAI_BASE_URL = "http://localhost:11434/v1"


def _stub_vertexai() -> None:
    import sys as _sys
    import types

    if "langchain_community.chat_models.vertexai" in _sys.modules:
        return
    shim = types.ModuleType("langchain_community.chat_models.vertexai")

    class ChatVertexAI:  # never instantiated — this harness only uses Ollama
        pass

    shim.ChatVertexAI = ChatVertexAI  # type: ignore[attr-defined]
    _sys.modules["langchain_community.chat_models.vertexai"] = shim


def _run_pipeline(case: dict) -> tuple[str | None, str | None]:
    """Call the real /api/analyse SSE pipeline and return (conclusion, error)."""
    client = TestClient(server_main.app)
    body = {
        "spec": case["spec"],
        "digest": case["digest"],
        "request": case["request"],
        "kind": case["kind"],
        "columns": case["columns"],
        "image": None,
    }
    conclusion, error = None, None
    with client.stream("POST", "/api/analyse", json=body) as r:
        for line in r.iter_lines():
            if not line.startswith("data:"):
                continue
            event = json.loads(line[5:])
            if event["type"] == "result":
                conclusion = event["conclusion"]
            elif event["type"] == "error":
                error = event["message"]
    return conclusion, error


async def _faithfulness_score(request: str, conclusion: str, digest: dict) -> tuple[float, str] | None:
    try:
        _stub_vertexai()
        from openai import AsyncOpenAI
        from ragas.llms.base import llm_factory
        from ragas.metrics.collections import Faithfulness
    except ImportError:
        return None

    client = AsyncOpenAI(base_url=OLLAMA_OPENAI_BASE_URL, api_key="ollama")
    llm = llm_factory(JUDGE_MODEL, client=client)
    metric = Faithfulness(llm=llm)
    result = await metric.ascore(
        user_input=f"Analyse this {request!r} chart.",
        response=conclusion,
        retrieved_contexts=[json.dumps(digest)],
    )
    return float(result.value), (result.reason or "")


def verify_case(path: Path, use_faithfulness: bool) -> bool:
    case = json.loads(path.read_text(encoding="utf-8"))
    print(f"\n{'=' * 70}\n{path.name} — {case['request']!r}\n{'=' * 70}")

    conclusion, error = _run_pipeline(case)
    if error or not conclusion:
        print(f"PIPELINE ERROR: {error or 'no conclusion returned'}")
        return False
    print(conclusion)
    print()

    results = run_all(conclusion, case["digest"])
    all_pass = True
    for r in results:
        icon = {"pass": "PASS", "fail": "FAIL", "skip": "skip"}[r.status]
        print(f"  [{icon}] {r.name}")
        for d in r.details:
            print(f"          - {d}")
        if r.status == "fail":
            all_pass = False

    if use_faithfulness:
        score = asyncio.run(_faithfulness_score(case["request"], conclusion, case["digest"]))
        if score is None:
            print("  [info] ragas not installed — skipping Faithfulness (see module docstring to install)")
        else:
            value, reason = score
            print(f"  [info] Faithfulness (soft, judged by {JUDGE_MODEL}): {value:.2f}" + (f" — {reason}" if reason else ""))

    return all_pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cases", nargs="+", type=Path, help="Saved {spec,digest,request,kind,columns} JSON files")
    parser.add_argument("--no-faithfulness", action="store_true", help="Skip the RAGAS Faithfulness score")
    args = parser.parse_args()

    all_ok = True
    for path in args.cases:
        if not verify_case(path, use_faithfulness=not args.no_faithfulness):
            all_ok = False

    print(f"\n{'=' * 70}")
    print("ALL DETERMINISTIC CHECKS PASSED" if all_ok else "SOME DETERMINISTIC CHECKS FAILED — see FAIL lines above")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
