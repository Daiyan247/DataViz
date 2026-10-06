"""
Deterministic, code-only checks for the exact bug patterns found in prior
verification rounds (see docs/analysis-repeatability.md and the fixes in
server/chart_conclusion_guide.md / src/lib/chartDigest.ts).

These exist because a local 7-8B judge model, asked to grade the SAME kind of
attribution error via an LLM rubric, could not reliably catch it: qwen2.5:7b and
llama3.1:8b both scored a response that swapped vsSecond/vsLaggard as "correct".
A regex + JSON comparison catches it deterministically, for free, every time —
no judge model, no ambiguity, no cost. Use `verify_analysis.py`'s RAGAS
Faithfulness score for general groundedness; use THESE for the specific known
failure modes.

No third-party dependencies — stdlib only.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class CheckResult:
    name: str
    status: str  # "pass" | "fail" | "skip"
    details: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.status != "fail"


_NUMBER = re.compile(r"-?\d[\d,]*(?:\.\d+)?")


def _numbers_near(text: str, keyword: str, window: int = 90) -> list[float]:
    """The CLOSEST number to each occurrence of `keyword` (one per occurrence),
    not every number within the window. A first version returned every number in
    range and produced a false positive on "...second place) by about 1.0x, and
    beats East (smallest) by 1.37x" — 1.37 sits inside the window around "second"
    too, even though it plainly belongs to "smallest". Distance-to-keyword, not
    mere proximity-within-a-window, is what actually identifies which number a
    keyword's clause is about.
    """
    out: list[float] = []
    lower = text.lower()
    kw = keyword.lower()
    start = 0
    while True:
        i = lower.find(kw, start)
        if i == -1:
            break
        kw_end = i + len(kw)
        lo, hi = max(0, i - window), min(len(text), kw_end + window)
        best: float | None = None
        best_dist: int | None = None
        for m in _NUMBER.finditer(text[lo:hi]):
            abs_start, abs_end = lo + m.start(), lo + m.end()
            dist = i - abs_end if abs_end <= i else (abs_start - kw_end if abs_start >= kw_end else 0)
            if best_dist is None or dist < best_dist:
                try:
                    best, best_dist = float(m.group(0).replace(",", "")), dist
                except ValueError:
                    pass
        if best is not None:
            out.append(best)
        start = kw_end
    return out


def _close(a: float, b: float, tol: float = 0.03) -> bool:
    return abs(a - b) <= max(0.02, tol * max(abs(a), abs(b), 1e-9))


# ── Check 1: vsSecond / vsLaggard (and analogous ratio pairs) attribution ────

_SECOND_KEYWORDS = ["second", "runner-up", "runner up", "2nd"]
_LAGGARD_KEYWORDS = ["smallest", "laggard", "lowest", "bottom", "last place", "last-place", "weakest"]


def check_ratio_attribution(text: str, digest: dict) -> CheckResult:
    """The exact bug: quoting vsLaggard's ratio while describing the lead over
    SECOND place, or vice versa. Only fires when the two ratios actually differ
    enough to matter — on data where they're nearly equal there's nothing to catch."""
    trend = digest.get("trend") or {}
    if trend.get("shape") != "ranking":
        return CheckResult("ratio_attribution", "skip", ["not a ranking-shaped trend"])

    vs_second = trend.get("vsSecond") or {}
    vs_laggard = trend.get("vsLaggard") or {}
    second_ratio = vs_second.get("ratio")
    laggard_ratio = vs_laggard.get("ratio")
    if second_ratio is None or laggard_ratio is None:
        return CheckResult("ratio_attribution", "skip", ["one of the two ratios is absent"])
    if _close(second_ratio, laggard_ratio):
        return CheckResult("ratio_attribution", "skip", ["ratios too close to distinguish a swap"])

    errors: list[str] = []
    for kw in _SECOND_KEYWORDS:
        for num in _numbers_near(text, kw):
            if _close(num, laggard_ratio) and not _close(num, second_ratio):
                errors.append(
                    f"near '{kw}': text quotes {num}, which matches vsLaggard.ratio "
                    f"({laggard_ratio}) — not vsSecond.ratio ({second_ratio})"
                )
    for kw in _LAGGARD_KEYWORDS:
        for num in _numbers_near(text, kw):
            if _close(num, second_ratio) and not _close(num, laggard_ratio):
                errors.append(
                    f"near '{kw}': text quotes {num}, which matches vsSecond.ratio "
                    f"({second_ratio}) — not vsLaggard.ratio ({laggard_ratio})"
                )
    return CheckResult("ratio_attribution", "fail" if errors else "pass", errors)


# ── Check 2: a fraction field printed as if it were already a percentage ────

# Every digest field that is a FRACTION (0-1), wherever it may appear nested.
_FRACTION_FIELD_NAMES = {
    "pctChange", "cagr", "topShare", "top2Share", "top3Share",
    "evenness", "negligibleShare", "paretoFraction", "monotonicShare",
}
_PERCENT_TOKEN = re.compile(r"-?\d[\d,]*(?:\.\d+)?\s*%")


def _collect_fraction_fields(node: object, path: str = "") -> list[tuple[str, float]]:
    found: list[tuple[str, float]] = []
    if isinstance(node, dict):
        for k, v in node.items():
            p = f"{path}.{k}" if path else k
            if k in _FRACTION_FIELD_NAMES and isinstance(v, (int, float)):
                found.append((p, float(v)))
            else:
                found.extend(_collect_fraction_fields(v, p))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            found.extend(_collect_fraction_fields(v, f"{path}[{i}]"))
    return found


def check_fraction_as_percent(text: str, digest: dict) -> CheckResult:
    """`pctChange: 0.021` means 2.1% — printing "0.021%" is a real bug caught in a
    prior run. Flags any percent-sign number in the text that matches a fraction
    field's BARE value rather than its correctly-scaled (×100) form."""
    fields = _collect_fraction_fields(digest)
    if not fields:
        return CheckResult("fraction_as_percent", "skip", ["no fraction-valued fields in this digest"])

    percents: list[float] = []
    for m in _PERCENT_TOKEN.finditer(text):
        try:
            percents.append(float(m.group(0).rstrip("% ").replace(",", "")))
        except ValueError:
            pass
    if not percents:
        return CheckResult("fraction_as_percent", "skip", ["no percentages quoted in the text"])

    errors: list[str] = []
    for path, value in fields:
        if abs(value) < 1e-9:
            continue
        # Compare magnitudes: a negative pctChange is routinely written as a
        # positive number plus a direction word ("a 2.1% decrease"), so signed
        # comparison alone would miss it.
        magnitude, expected = abs(value), abs(value) * 100
        for p in percents:
            ap = abs(p)
            # The bug signature: the printed percent matches the BARE fraction,
            # not its correctly-scaled form (the two only coincide near zero,
            # which `abs(value) < 1e-9` above already excludes).
            if _close(ap, magnitude, tol=0.01) and not _close(ap, expected, tol=0.01):
                errors.append(f"{path} = {value} (i.e. {expected:g}%), but text says \"{p:g}%\" — off by 100x")
    return CheckResult("fraction_as_percent", "fail" if errors else "pass", errors)


# ── Check 3: quoting a verdict word, then contradicting it ──────────────────

# Each verdict field's possible values, and phrases that would signal the OTHER
# values — i.e. contradicting evidence, not just a synonym for the true one.
_VERDICT_CONTRADICTION_PHRASES: dict[str, dict[str, list[str]]] = {
    "skew": {
        "right": ["right skew", "right-skewed", "skewed right", "skew to the right", "skewed to the right"],
        "left": ["left skew", "left-skewed", "skewed left", "skew to the left", "skewed to the left"],
        "symmetric": ["symmetric", "symmetrical", "no skew", "not skewed", "no significant skew"],
    },
    "steadiness": {
        "steady": ["relatively steady", "a steady trend", "steadily", "consistently rising", "consistently falling"],
        "uneven": ["an uneven trend", "somewhat uneven"],
        "fluctuating": ["fluctuating", "no consistent trend", "no clear trend", "just fluctuation"],
    },
    "volatility": {
        "stable": ["stable volatility", "low volatility", "minimal volatility", "minimal fluctuation"],
        "moderate": ["moderate volatility"],
        "volatile": ["high volatility", "highly volatile", "quite volatile"],
    },
}


def _verdict_field(digest: dict, dotted_path: str) -> str | None:
    node: object = digest
    for part in dotted_path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node if isinstance(node, str) else None


def check_verdict_contradiction(text: str, digest: dict) -> CheckResult:
    """Quoting the correct verdict word and then re-describing the same thing
    with a DIFFERENT, contradicting adjective nearby (found in two prior runs:
    "symmetric ... slight skew to the right"; "'fluctuating' ... relatively
    steady")."""
    lower = text.lower()
    errors: list[str] = []
    paths = {
        "skew": "groupStats.skew",
        "steadiness": "trend.steadiness",
        "volatility": "trend.volatility",
    }
    checked_any = False
    for field_name, path in paths.items():
        actual = _verdict_field(digest, path)
        if actual is None:
            continue
        options = _VERDICT_CONTRADICTION_PHRASES.get(field_name, {})
        if actual not in options:
            continue
        checked_any = True
        for other_value, phrases in options.items():
            if other_value == actual:
                continue
            for phrase in phrases:
                if phrase in lower:
                    errors.append(
                        f"{path} = \"{actual}\", but text also says \"{phrase}\" (a {other_value} phrase)"
                    )
    if not checked_any:
        return CheckResult("verdict_contradiction", "skip", ["no checkable verdict fields in this digest"])
    return CheckResult("verdict_contradiction", "fail" if errors else "pass", errors)


# ── Check 4: invented units (reuses the app's own production guard) ─────────


def check_invented_units(text: str) -> CheckResult:
    """Reuses server/main.py's own `_INVENTED_SCALE`/`_INVENTED_CURRENCY` guard —
    the SAME regex the shipped pipeline applies — so this check can never drift
    out of sync with what production actually strips."""
    import server.main as m  # local import: keeps this module dependency-free otherwise

    errors: list[str] = []
    for m_ in m._INVENTED_SCALE.finditer(text):
        errors.append(f"invented magnitude word: \"{m_.group(0).strip()}\"")
    for m_ in m._INVENTED_CURRENCY.finditer(text):
        errors.append(f"invented currency symbol near: \"{text[max(0, m_.start()-5):m_.end()+8]}\"")
    return CheckResult("invented_units", "fail" if errors else "pass", errors)


ALL_CHECKS = [check_ratio_attribution, check_fraction_as_percent, check_verdict_contradiction]


def run_all(text: str, digest: dict) -> list[CheckResult]:
    """Every deterministic check, in one call."""
    return [c(text, digest) for c in ALL_CHECKS] + [check_invented_units(text)]


if __name__ == "__main__":
    # Self-test against the exact known-bad / known-good sentences from the
    # verification rounds that found these bugs — a regression suite with no
    # test framework required.
    digest = {
        "groupStats": {"skew": "symmetric"},
        "trend": {
            "shape": "ranking",
            "vsSecond": {"gap": 1328.63, "ratio": 1.0},
            "vsLaggard": {"ratio": 1.37},
            "steadiness": "fluctuating",
            "volatility": "stable",
            "pctChange": -0.021,
        },
    }

    cases = [
        ("South leads, beating North (second place) by 1.37 times.", False),  # BAD: swapped
        ("South leads North (second place) by about 1.0x, and beats East (smallest) by 1.37x.", True),
        ("The distribution is symmetric, with a slight skew to the right.", False),  # BAD: contradiction
        ("The series is 'fluctuating', indicating a relatively steady movement.", False),  # BAD
        ("Net change represents a 0.021% decrease.", False),  # BAD: should be 2.1%
        ("Net change represents a 2.1% decrease.", True),
        ("Revenue grew to 577,731.34 trillion.", False),  # BAD: invented unit
    ]

    print(f"Self-test: {len(cases)} known cases\n")
    all_ok = True
    for text, should_pass in cases:
        results = run_all(text, digest)
        failed = [r for r in results if r.status == "fail"]
        actually_passed = len(failed) == 0
        marker = "OK" if actually_passed == should_pass else "MISMATCH"
        if marker == "MISMATCH":
            all_ok = False
        print(f"[{marker}] expected {'PASS' if should_pass else 'FAIL'}, got {'PASS' if actually_passed else 'FAIL'}: {text!r}")
        for r in failed:
            for d in r.details:
                print(f"    - {r.name}: {d}")
    print("\nAll self-test cases matched expectations." if all_ok else "\nSELF-TEST FAILED — see MISMATCH lines above.")
