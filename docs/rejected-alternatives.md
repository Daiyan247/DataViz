# Rejected alternatives

A running log of features and approaches that were built or considered and then
**deliberately removed / not adopted**, with the reasoning — so the decision isn't
re-litigated later. Newest first.

---

## Auto-fix — "Fix this chart" (removed 2026-08-17)

**What it was.** A deterministic one-click repair of the *current* chart's encoding
that kept the chart type but rewrote broken/misleading channels:
- bubble sized by a non-numeric column → size by an unused numeric column, or drop
  the size (becoming a plain scatter);
- a pie whose angle wasn't a real measure → count records per slice;
- any measure aggregating a non-numeric field → a row count.

It lived in `src/lib/autoFix.ts` (`correctSpec`) with a **"Fix this chart"** button
in the chart-advice popup (`WarningPopup`), wired through `App.tsx`
(`correctedSpec` / `applyFix` / `onFix`).

**Why it was removed.**
- **It silently changed what the chart shows.** Auto-rewriting which column or
  aggregation is displayed produces a chart the user didn't ask for, without clear
  consent — the opposite of the honest-advice goal. Chart advice should *explain*
  the problem and let the user decide.
- **It duplicated intent with "Switch to <type>".** The advisor already offers to
  switch to the AI-recommended better chart type; a second auto-mutating action
  competed with and muddied that.
- **It added surface area / another button** to a panel we were simplifying so the
  real, substantive advice (e.g. box-plot data-sufficiency warnings) reads clearly.

**What replaced it.** Nothing that mutates the spec automatically. The advisor now
only (a) shows warnings that *explain* the issue and (b) offers **"Switch to
<recommended type>"** when the AI recommends a better-fitting chart. The user stays
in control of the encoding.

**Removed:** `src/lib/autoFix.ts`, `src/lib/autoFix.test.ts`; the `onFix` prop and
"Fix this chart" button in `src/components/WarningPopup.tsx`; and
`correctSpec`/`correctedSpec`/`applyFix` in `src/App.tsx`.

**Backend follow-up (same intent).** The frontend removal exposed that the backend
was still *substituting* columns for explicit box-plot requests: "boxplot of
discount vs revenue" (two numerics, no category) made `_map_request` bail to the
LLM, which then invented an unnamed column (`region`) for the x-axis. Fixed in
`server/main.py` — the box-plot branch now builds the chart from ONLY the named
columns (y = the named numeric with the most distinct values; x = a named category
or the other named column, e.g. discount levels; or a single box), so an explicit
request is handled deterministically and never pulls in a column the user didn't
name. The general rule holds: name columns → they are honored; stay vague → the AI
may choose.

---

## Stratified stratum-mean sampling for spread stats (not adopted, 2026-08-17)

**What it was.** For the box-plot data-sufficiency check we need spread stats
(IQR/quartiles, std dev) on potentially large columns. A proposed optimization:
split the column into 20 contiguous sections, sample 20 points per section (400
total), average the per-section means to estimate the population mean, and judge
spread from that.

**Why it wasn't adopted** (measured on a 2M-row column, 300 trials):
- **The mean never needs sampling.** Welford's one-pass algorithm gives the *exact*
  mean + std dev at O(1) memory — 0.00% error, order-independent. Any sampled mean
  (stratified 0.6–5.4%) is strictly worse than free-and-exact.
- **The mean doesn't gate a box plot.** A box plot is Q1/median/Q3/IQR — the mean
  isn't drawn. The decision needs **IQR + count**, not the mean.
- **400 points is too noisy for IQR.** Pooled-400 → ~7% IQR error vs the chosen 20k
  reservoir → ~1%, and 20k floats is only ~160 KB (no memory pressure to justify
  shrinking).

**What we use instead.** Exact `count`/`mean`/`stdDev` via Welford (streaming, O(1)
memory) + `q1`/`median`/`q3`/`iqr` from a **Vitter reservoir sample capped at
~20 000** values (exact below the cap, unbiased ~1%-error estimate above it). See
`src/lib/profile.ts`.
