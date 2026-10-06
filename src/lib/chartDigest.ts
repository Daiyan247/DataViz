import type { Aggregate, Cell, Encoding, Row, VizSpec } from './types'
import { chartKind, type ChartKind } from './suggestCharts'
import { CONTINENT_SET, COUNTRY_SET, canonicalCountry, canonicalContinent, canonicalState } from './geoData'

const US_STATE_COUNT = 51 // 50 states + DC (geoData.ts has no exported count)

/**
 * A compact, AGGREGATED digest of what a chart actually shows — computed in the
 * browser from the filtered rows. Only these derived numbers are sent to the local
 * model; the raw rows never leave. Pure and unit-tested.
 *
 * The digest is CHART-TYPE AWARE. Beyond the shared group/measure stats it builds a
 * `trend` block carrying the evidence for the ONE pattern this chart type uniquely
 * reveals — an ordered series for a line, quartiles for a box plot, bins for a
 * histogram, cells and margins for a heatmap. `server/chart_conclusion_guide.md`
 * asks the model to lead with that pattern, so the numbers behind it have to be in
 * the payload; otherwise the prompt is asking for a claim the data can't support,
 * which is an invitation to invent one.
 */

export interface DigestGroup {
  label: string
  value: number
  /** This group's share of the total, 0–1 — only for additive measures (sum/count)
   *  with no negative values, where a "share of the whole" is meaningful. */
  share?: number
}

/** A named value pair, used for leaders/laggards/peaks. */
export interface NamedValue {
  label: string
  value: number
}

/** Univariate stats for one numeric field. */
export interface AxisStats {
  field: string
  min: number
  max: number
  mean: number
  stdDev?: number
}

/** Ordered series evidence — line and area charts. */
export interface SeriesTrend {
  shape: 'series'
  field: string
  /** Points in X ORDER (not by value). Downsampled when long; see `sampled`. */
  points: NamedValue[]
  /** True when `points` is a thinned view of a longer series. */
  sampled?: boolean
  pointCount: number
  first: NamedValue
  last: NamedValue
  netChange: number
  pctChange?: number
  /** Compound growth per period — only for 3+ periods with a positive start. */
  cagr?: number
  direction: 'rising' | 'falling' | 'flat'
  /** Fraction of steps moving in the dominant direction, 0–1. See `steadiness` for
   *  the verdict already decided from this — don't re-bin it yourself. */
  monotonicShare: number
  /**
   * The verdict from `monotonicShare`, decided here rather than left for the model
   * to bin: an independent fact-check on a real run found monotonicShare 0.517 —
   * barely above the 0.5 "just fluctuating" midpoint — described as "relatively
   * steady", which is a real misreading of a number the model itself quoted
   * correctly. `>= 0.8` → `'steady'`, `>= 0.6` → `'uneven'`, else `'fluctuating'`
   * (no consistent direction).
   */
  steadiness: 'steady' | 'uneven' | 'fluctuating'
  peak: NamedValue
  trough: NamedValue
  largestRise?: { from: string; to: string; change: number }
  largestFall?: { from: string; to: string; change: number }
  /** Coefficient of variation (σ/mean). See `volatility` for the verdict already
   *  decided from this — don't re-bin it yourself. */
  cv?: number
  /**
   * The verdict from `cv`, decided here for the same reason as `steadiness`: the
   * same fact-check found cv 0.09 — under the guide's own 0.1 "stable" cutoff —
   * described as "moderate volatility". `< 0.1` → `'stable'`, `< 0.3` → `'moderate'`,
   * else `'volatile'`.
   */
  volatility?: 'stable' | 'moderate' | 'volatile'
  /** Total under the series — the quantity an area chart's fill represents. */
  total: number
}

/**
 * The concentration verdict, already decided so the model quotes it rather than
 * judging it. See `concentrationStats` for the metric and why it isn't the raw HHI.
 */
export type Concentration = 'low' | 'moderate' | 'high'

/**
 * Concentration evidence for a set of category values: the raw HHI (reported for
 * context) plus the "effective number of categories" — Adelman's (1969) numbers
 * equivalent, also derived independently by Hill (1973) for ecological diversity —
 * which is what actually decides `concentration`. See `concentrationStats` for why.
 */
export interface ConcentrationStats {
  /** Raw Herfindahl–Hirschman Index over percentage shares (0–10000). Reported for
   *  readers who know it from antitrust contexts; NOT what decides `concentration`
   *  (see below) since its floor of 10000/n makes it unusable for a small category
   *  count. */
  hhi: number
  /** Adelman (1969) "numbers equivalent" / Hill (1973) true diversity at q=2:
   *  1 / Σ(share_i²). Reads as "behaves like this many EQUAL-sized categories." */
  effectiveGroups: number
  /** effectiveGroups ÷ actual category count, 0–1. 1 = perfectly even shares. This,
   *  not the raw HHI, is what `concentration` is judged from — it means the same
   *  thing regardless of how many categories there are. */
  evenness: number
  concentration: Concentration
}

/** Ranking evidence — bar, dot plot and map. */
export interface RankingTrend {
  shape: 'ranking'
  leader: NamedValue
  second?: NamedValue
  laggard: NamedValue
  /**
   * The leader vs. the RUNNER-UP ONLY. Never use this ratio when talking about the
   * laggard — see `vsLaggard`, a genuinely different comparison that a real model
   * run conflated with this one ("leading by 1.37×" when 1.37 was actually the
   * leader-vs-laggard ratio and the true lead over second place was ~1.002×).
   */
  vsSecond?: { gap: number; ratio?: number }
  /** The leader vs. the SMALLEST category. Never use this ratio for "vs. second
   *  place" — see `vsSecond` above. */
  vsLaggard: { ratio?: number }
  topShare?: number
  top3Share?: number
  /** Absent when the values aren't additive (e.g. some are negative) — a share of
   *  the whole, and so a concentration verdict, isn't meaningful there. */
  concentration?: ConcentrationStats
  /** How many of the top categories are needed to reach 80% of the total. */
  paretoCount?: number
  /**
   * `paretoCount` as a fraction of ALL CATEGORIES — e.g. 7 of 20 countries is 0.35.
   * This is a share of the CATEGORY COUNT, never of the value/population those
   * categories hold — confusing the two is a confirmed real error: a model run
   * reported "the top 7 categories account for 35% of the population" by quoting
   * this field, when the top 7 actually hold ~80% (see `paretoShare`, the field
   * that exists specifically so nothing has to re-derive that number itself).
   */
  paretoFraction?: number
  /**
   * The REAL cumulative share of the total value held by the top `paretoCount`
   * categories (≥ 0.8 by construction — `paretoCountOf` stops as soon as the
   * running sum crosses 80%, so this is usually just over it, not exactly 0.8).
   * This is the number for "the top N categories hold X% of the total" — computed
   * here, not left for the model to sum the top groups and divide itself.
   */
  paretoShare?: number
  /**
   * True only when a SMALL minority of categories carries 80% — the actual Pareto
   * signature. Without it the raw count reads backwards: "4 of 4 categories to reach
   * 80%" is the definition of UNconcentrated, and gets quoted as evidence of
   * concentration.
   */
  paretoLike?: boolean
}

/** Part-to-whole evidence — pie charts. */
export interface CompositionTrend {
  shape: 'composition'
  sliceCount: number
  leader: NamedValue
  topShare?: number
  top2Share?: number
  top3Share?: number
  concentration?: ConcentrationStats
  /** Slices under 2% — not visually distinguishable, so grouped as negligible. */
  negligibleCount: number
  negligibleShare?: number
  /** True when the measure isn't additive, so "share of a whole" doesn't apply. */
  sharesMeaningless?: boolean
}

/** Shape evidence — histograms. */
export interface DistributionTrend {
  shape: 'distribution'
  field: string
  n: number
  min: number
  max: number
  mean: number
  median: number
  stdDev: number
  q1: number
  q3: number
  iqr: number
  /** Freedman–Diaconis bins: width = 2·IQR/n^(1/3). */
  bins: { from: number; to: number; count: number }[]
  binWidth: number
  modalBin: { from: number; to: number; count: number }
  /** Sample skewness g1. Bulmer: |g1|<0.5 symmetric, 0.5–1 moderate, >1 high. */
  skewness?: number
  /** Pearson's second coefficient, 3(mean−median)/σ — the quick equivalent. */
  pearsonSkew?: number
  skewDirection: 'right' | 'left' | 'symmetric'
  /** Local maxima separated by a real trough — 2+ suggests mixed subpopulations. */
  peakCount: number
}

/** Five-number summaries — box and strip plots. */
export interface SpreadGroup {
  label: string
  n: number
  min: number
  q1: number
  median: number
  q3: number
  max: number
  iqr: number
  /** Tukey fences: Q1 − 1.5·IQR and Q3 + 1.5·IQR. */
  lowerFence: number
  upperFence: number
  outlierCount: number
  /** A few actual outlier values, for naming in prose. */
  outliers: number[]
  /** True when n < 20 — Minitab's rule of thumb for when quartiles/outliers stop
   *  being reliable (Minitab Support, "Data considerations for Boxplot"). */
  underpowered: boolean
}

export interface SpreadTrend {
  shape: 'spread'
  field: string
  groupField?: string
  groups: SpreadGroup[]
  /** Groups below the n≥20 threshold for meaningful quartiles. */
  underpoweredGroups: string[]
  widestGroup?: string
  highestMedianGroup?: string
}

/** Association evidence — scatter and bubble. */
export interface RelationshipTrend {
  shape: 'relationship'
  n: number
  x: AxisStats
  y: AxisStats
  correlation: number
  /** r² — the share of variance explained. Quote it as a percentage. */
  r2: number
  direction: 'positive' | 'negative' | 'none'
  /** Evans (1996) band for |r|. */
  strength: 'very weak' | 'weak' | 'moderate' | 'strong' | 'very strong'
  /** Bubble only: the third variable and how it relates to each axis. */
  size?: AxisStats
  corrSizeX?: number
  corrSizeY?: number
  largestBubble?: { x: number; y: number; size: number }
  smallestBubble?: { x: number; y: number; size: number }
  /** Points beyond |z| > 3 (2.5 for small n) on either axis. */
  outliers: { x: number; y: number }[]
}

/** Cell + margin evidence — heatmaps. */
export interface MatrixTrend {
  shape: 'matrix'
  rowField: string
  colField: string
  rowCount: number
  colCount: number
  grandTotal: number
  /** Hottest cells, with the standardized residual against the margins. */
  topCells: { row: string; col: string; value: number; residual?: number }[]
  coldestCell?: { row: string; col: string; value: number }
  rowTotals: NamedValue[]
  colTotals: NamedValue[]
  /** Cells whose Pearson residual exceeds ±2 — real hotspots, not busy margins. */
  notableCells: { row: string; col: string; value: number; residual: number }[]
  /** True when the extremes are explained by a whole row/column rather than a cell. */
  marginDriven?: boolean
  emptyCells: number
}

export type Trend =
  | SeriesTrend
  | RankingTrend
  | CompositionTrend
  | DistributionTrend
  | SpreadTrend
  | RelationshipTrend
  | MatrixTrend

/** Stats over a set of numbers, tagged with what that set actually is. */
export interface LevelStats {
  field: string | null
  aggregate: string
  basis?: 'per-row'
  /** Plain-English statement of what these numbers describe. */
  describes?: string
  min?: number
  max?: number
  sum?: number
  mean?: number
  median?: number
}

export interface ChartDigest {
  /** The chart type this digest describes — the same vocabulary the guide is keyed on. */
  kind: ChartKind
  mark: string
  rows: number
  /**
   * Stats of the primary measure across individual rows, for charts that do NOT
   * group — where a row IS a mark on the chart, so these describe what's drawn.
   */
  measure?: LevelStats
  /**
   * The same row-level stats for a chart that DOES group — under a name that cannot
   * be read as the chart's own values.
   *
   * With this block called `measure`, a real model run put "the median revenue of
   * 14,989 sits below the mean of 20,914, so a few regions have disproportionately
   * high revenues" into an analysis of four region bars whose values are all around
   * 500,000. Both numbers were row-level; neither appears on the chart. Warning the
   * model not to confuse the two levels did not prevent it, so the ambiguity is
   * removed at the source instead.
   */
  underlyingRecords?: LevelStats
  /** The grouping dimension. `shown` flags truncation of the `groups` list. */
  dimension?: { field: string; groupCount: number; shown: number }
  /**
   * For a map: how much of the possible universe (all countries / continents / US
   * states) the data actually covers — so a summary never calls a 20-country sample
   * "global" or "the world's population". A real run said "57.3% of the global
   * population" from a 20-country dataset (of ~247 countries): the figure was a
   * correct share of the 20 rows present, but false once called global, because the
   * other 227 countries simply aren't in the data, not zero.
   */
  coverage?: { level: 'country' | 'continent' | 'state'; covered: number; of: number }
  /**
   * Stats across the GROUPS themselves (`basis: 'per-group'`) — the values actually
   * drawn. Row-level and group-level numbers differ (20 countries vs 5 continents),
   * and conflating them is how a summary ends up quoting a mean that appears nowhere
   * on the chart, so both are labelled and sent.
   */
  groupStats?: {
    basis: 'per-group'
    min: number
    max: number
    mean: number
    median: number
    sum: number
    /** max − min across groups. */
    range: number
    /** How many times larger the top group is than the bottom (min > 0 only). */
    topToBottomRatio?: number
    /** Share of the total held by the single largest group, 0–1 (additive only). */
    topShare?: number
    /**
     * Direction of mean vs. median across the GROUP values, decided here rather
     * than left for the model to compare: a real run read mean (501,953.45) as
     * "significantly higher than" median (503,810.18) when it is in fact slightly
     * LOWER, and called a 0.4%-of-range gap "significant". `symmetric` covers any
     * gap under 5% of the group range, so a rounding-level difference can't be
     * dressed up as skew.
     */
    skew: 'right' | 'left' | 'symmetric'
  }
  /** Top groups by value (category → aggregated measure or count), desc. */
  groups?: DigestGroup[]
  /** For scatter/bubble: per-axis range + mean. */
  axes?: { field: string; min: number; max: number; mean: number }[]
  /** For scatter/bubble: Pearson correlation of the two axes (−1..1). */
  correlation?: number
  /** Evidence for the pattern THIS chart type uniquely reveals. */
  trend?: Trend
}

const GROUP_CAP = 12
const SERIES_CAP = 30
const CELL_CAP = 8
const SPREAD_GROUP_CAP = 10
const OUTLIER_CAP = 5
/** Below this many observations a group's quartiles aren't meaningful. */
const MIN_FOR_QUARTILES = 20
/** Pie slices under this share can't be told apart visually. */
const NEGLIGIBLE_SHARE = 0.02

const CHANNELS = ['x', 'y', 'color', 'size', 'theta', 'location'] as const

const round = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 100) / 100)
/** Shares are fractions, so they need finer precision than display numbers (a 1.7%
 *  slice would otherwise round to a flat 2%). */
const roundShare = (n: number) => Math.round(n * 1000) / 1000

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function aggregate(vals: number[], agg: Aggregate): number {
  if (agg === 'count') return vals.length
  if (vals.length === 0) return 0
  switch (agg) {
    case 'sum':
      return vals.reduce((a, b) => a + b, 0)
    case 'mean':
      return vals.reduce((a, b) => a + b, 0) / vals.length
    case 'min':
      return Math.min(...vals)
    case 'max':
      return Math.max(...vals)
    case 'median':
      return quantile([...vals].sort((a, b) => a - b), 0.5)
    default:
      return vals.reduce((a, b) => a + b, 0)
  }
}

/** Linear-interpolation quantile (R type 7 / Excel PERCENTILE.INC) on a SORTED array. */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return lo === hi ? sorted[lo] : sorted[lo] + (i - lo) * (sorted[hi] - sorted[lo])
}

function mean(vals: number[]): number {
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
}

/** Sample standard deviation (n−1). */
function stdDev(vals: number[]): number {
  if (vals.length < 2) return 0
  const m = mean(vals)
  const ss = vals.reduce((a, b) => a + (b - m) ** 2, 0)
  return Math.sqrt(ss / (vals.length - 1))
}

/** Sample skewness g1 = [n/((n−1)(n−2))]·Σ((xi−x̄)/s)³. */
function skewness(vals: number[]): number | undefined {
  const n = vals.length
  if (n < 3) return undefined
  const s = stdDev(vals)
  if (s === 0) return undefined
  const m = mean(vals)
  const sum = vals.reduce((a, b) => a + ((b - m) / s) ** 3, 0)
  return (n / ((n - 1) * (n - 2))) * sum
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n === 0) return 0
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx
    const b = ys[i] - my
    num += a * b
    dx += a * a
    dy += b * b
  }
  const d = Math.sqrt(dx * dy)
  return d === 0 ? 0 : num / d
}

function numericStats(rows: Row[], field: string) {
  const vals = rows.map((r) => toNum(r[field])).filter((v): v is number => v != null)
  if (vals.length === 0) return null
  const sorted = [...vals].sort((a, b) => a - b)
  return {
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    mean: round(mean(vals)),
    median: round(quantile(sorted, 0.5)),
    sum: round(vals.reduce((a, b) => a + b, 0)),
  }
}

function axisStats(field: string, vals: number[]): AxisStats {
  return {
    field,
    min: round(Math.min(...vals)),
    max: round(Math.max(...vals)),
    mean: round(mean(vals)),
    stdDev: round(stdDev(vals)),
  }
}

/** Evans (1996) bands for |r|. */
function strengthOf(r: number): RelationshipTrend['strength'] {
  const a = Math.abs(r)
  if (a < 0.2) return 'very weak'
  if (a < 0.4) return 'weak'
  if (a < 0.6) return 'moderate'
  if (a < 0.8) return 'strong'
  return 'very strong'
}

/**
 * Concentration evidence for a set of (non-negative, positive-total) category
 * values: the raw HHI plus the effective-number-of-categories metric that actually
 * drives the `concentration` verdict.
 *
 * The raw Herfindahl–Hirschman Index (sum of squared percentage shares, the
 * standard concentration measure from antitrust economics — DOJ/FTC Horizontal
 * Merger Guidelines) has a floor of 10000/n: with four categories the smallest
 * value it can take is 2500 even when all four are exactly equal, because it was
 * built for markets with dozens of firms, not four bars on a chart. Reading any
 * fixed HHI threshold off the raw index for a small n therefore mislabels an
 * evenly-split field as concentrated — a real run called four near-identical
 * regions "highly concentrated" AND "evenly spread" in the same paragraph.
 *
 * `effectiveGroups` fixes this by asking a different, n-independent question:
 * "how many EQUAL-sized categories would produce this same HHI?" It is the
 * reciprocal of the fractional HHI — Adelman's (1969) "numbers equivalent",
 * independently derived by Hill (1973) as the diversity index of order 2, and the
 * standard fix economists now use for exactly this small-n bias (see M. Jost,
 * "Entropy and diversity", Oikos 113:2 (2006), for the modern treatment). Four
 * equal categories give effectiveGroups = 4, i.e. evenness = 1 — correctly "low"
 * concentration regardless of how small n is.
 */
function concentrationStats(values: number[]): ConcentrationStats | undefined {
  const total = values.reduce((a, b) => a + b, 0)
  const n = values.length
  if (total <= 0 || n === 0 || values.some((v) => v < 0)) return undefined
  const fractionalHhi = values.reduce((a, v) => a + (v / total) ** 2, 0)
  const effectiveGroups = fractionalHhi > 0 ? round(1 / fractionalHhi) : n
  const evenness = roundShare(Math.min(1, effectiveGroups / n))
  // This app's own descriptive bands (not an antitrust/legal standard): "low" means
  // the effective count is close to the actual count (shares are close to even).
  const concentration: Concentration = evenness >= 0.8 ? 'low' : evenness >= 0.5 ? 'moderate' : 'high'
  return { hhi: Math.round(fractionalHhi * 10000), effectiveGroups, evenness, concentration }
}

/** How many of the largest categories (desc) are needed to reach 80% of the total. */
function paretoCountOf(sortedDesc: number[]): number | undefined {
  const total = sortedDesc.reduce((a, b) => a + b, 0)
  if (total <= 0 || sortedDesc.some((v) => v < 0)) return undefined
  let acc = 0
  for (let i = 0; i < sortedDesc.length; i++) {
    acc += sortedDesc[i]
    if (acc / total >= 0.8) return i + 1
  }
  return sortedDesc.length
}

/** Sort key for an x-axis value, honouring temporal and numeric ordering. */
function orderKey(value: Cell, type: string | undefined): number | string {
  if (type === 'temporal') {
    const t = Date.parse(String(value))
    if (!Number.isNaN(t)) return t
  }
  const n = toNum(value)
  if (n != null) return n
  return String(value)
}

// ── Trend builders ───────────────────────────────────────────────────────────

/** Line / area: the ordered series and its direction, rate, turning points. */
function seriesTrend(
  rows: Row[],
  xField: string,
  xType: string | undefined,
  measureField: string | null,
  agg: Aggregate,
): SeriesTrend | undefined {
  const buckets = new Map<string, { key: number | string; vals: number[] }>()
  for (const r of rows) {
    const raw = r[xField]
    if (raw == null || raw === '') continue
    const label = String(raw)
    let b = buckets.get(label)
    if (!b) {
      b = { key: orderKey(raw, xType), vals: [] }
      buckets.set(label, b)
    }
    if (measureField) {
      const v = toNum(r[measureField])
      if (v == null) continue
      b.vals.push(v)
    } else {
      b.vals.push(0)
    }
  }
  if (buckets.size < 2) return undefined

  const ordered = [...buckets.entries()]
    .sort((a, b) => (a[1].key < b[1].key ? -1 : a[1].key > b[1].key ? 1 : 0))
    .map(([label, b]) => ({ label, value: round(aggregate(b.vals, measureField ? agg : 'count')) }))

  const values = ordered.map((p) => p.value)
  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  const netChange = round(last.value - first.value)

  let peak = ordered[0]
  let trough = ordered[0]
  for (const p of ordered) {
    if (p.value > peak.value) peak = p
    if (p.value < trough.value) trough = p
  }

  // Step-by-step movement: direction consistency and the biggest single moves.
  let ups = 0
  let downs = 0
  let largestRise: SeriesTrend['largestRise']
  let largestFall: SeriesTrend['largestFall']
  for (let i = 1; i < ordered.length; i++) {
    const change = ordered[i].value - ordered[i - 1].value
    if (change > 0) ups++
    else if (change < 0) downs++
    if (change > 0 && (!largestRise || change > largestRise.change)) {
      largestRise = { from: ordered[i - 1].label, to: ordered[i].label, change: round(change) }
    }
    if (change < 0 && (!largestFall || change < largestFall.change)) {
      largestFall = { from: ordered[i - 1].label, to: ordered[i].label, change: round(change) }
    }
  }
  const steps = ordered.length - 1
  const monotonicShare = steps > 0 ? roundShare(Math.max(ups, downs) / steps) : 0
  const steadiness: SeriesTrend['steadiness'] =
    monotonicShare >= 0.8 ? 'steady' : monotonicShare >= 0.6 ? 'uneven' : 'fluctuating'

  const span = Math.max(...values) - Math.min(...values)
  const direction: SeriesTrend['direction'] =
    span === 0 || Math.abs(netChange) < span * 0.05 ? 'flat' : netChange > 0 ? 'rising' : 'falling'

  const m = mean(values)
  const cv = m !== 0 ? round(Math.abs(stdDev(values) / m)) : undefined
  const volatility: SeriesTrend['volatility'] = cv == null ? undefined : cv < 0.1 ? 'stable' : cv < 0.3 ? 'moderate' : 'volatile'
  const pctChange = first.value !== 0 ? roundShare(netChange / Math.abs(first.value)) : undefined
  // CAGR only means something over 3+ periods growing from a positive base.
  const cagr =
    ordered.length >= 3 && first.value > 0 && last.value > 0
      ? roundShare((last.value / first.value) ** (1 / (ordered.length - 1)) - 1)
      : undefined

  // Thin a long series but never drop the endpoints or the turning points.
  let points = ordered
  let sampled = false
  if (ordered.length > SERIES_CAP) {
    const keep = new Set<number>([0, ordered.length - 1, ordered.indexOf(peak), ordered.indexOf(trough)])
    const step = Math.ceil(ordered.length / SERIES_CAP)
    for (let i = 0; i < ordered.length; i += step) keep.add(i)
    points = [...keep].sort((a, b) => a - b).map((i) => ordered[i])
    sampled = true
  }

  return {
    shape: 'series',
    field: measureField ?? 'count',
    points,
    ...(sampled ? { sampled } : {}),
    pointCount: ordered.length,
    first,
    last,
    netChange,
    ...(pctChange != null ? { pctChange } : {}),
    ...(cagr != null ? { cagr } : {}),
    direction,
    monotonicShare,
    steadiness,
    peak,
    trough,
    ...(largestRise ? { largestRise } : {}),
    ...(largestFall ? { largestFall } : {}),
    ...(cv != null ? { cv } : {}),
    ...(volatility != null ? { volatility } : {}),
    total: round(values.reduce((a, b) => a + b, 0)),
  }
}

/** Bar / dot plot / map: ranking, gaps and concentration. */
/** How many of the world's countries/continents/US states the map's own labels
 *  canonicalize to, against the fixed universe size — so a partial dataset is never
 *  described as global. Picks whichever level matches the most labels. */
function mapCoverage(labels: string[]): ChartDigest['coverage'] | undefined {
  if (labels.length === 0) return undefined
  const countries = new Set(labels.map(canonicalCountry).filter((c) => COUNTRY_SET.has(c)))
  const continents = new Set(labels.map(canonicalContinent).filter((c): c is string => c != null))
  const states = new Set(labels.map(canonicalState).filter((s): s is string => s != null))
  const best = [
    { level: 'country' as const, covered: countries.size, of: COUNTRY_SET.size },
    { level: 'continent' as const, covered: continents.size, of: CONTINENT_SET.size },
    { level: 'state' as const, covered: states.size, of: US_STATE_COUNT },
  ].sort((a, b) => b.covered - a.covered)[0]
  return best.covered > 0 ? best : undefined
}

function rankingTrend(groups: DigestGroup[]): RankingTrend | undefined {
  if (groups.length === 0) return undefined
  const values = groups.map((g) => g.value)
  const total = values.reduce((a, b) => a + b, 0)
  const additive = total > 0 && values.every((v) => v >= 0)
  const leader = groups[0]
  const second = groups[1]
  const laggard = groups[groups.length - 1]

  const trend: RankingTrend = {
    shape: 'ranking',
    leader: { label: leader.label, value: leader.value },
    ...(second ? { second: { label: second.label, value: second.value } } : {}),
    laggard: { label: laggard.label, value: laggard.value },
    vsLaggard: laggard.value > 0 ? { ratio: round(leader.value / laggard.value) } : {},
  }
  if (second) {
    trend.vsSecond = {
      gap: round(leader.value - second.value),
      ...(second.value > 0 ? { ratio: round(leader.value / second.value) } : {}),
    }
  }
  if (additive) {
    trend.topShare = roundShare(leader.value / total)
    trend.top3Share = roundShare(values.slice(0, 3).reduce((a, b) => a + b, 0) / total)
    const conc = concentrationStats(values)
    if (conc) trend.concentration = conc
    const pareto = paretoCountOf(values)
    if (pareto != null) {
      const fraction = pareto / groups.length
      trend.paretoCount = pareto
      trend.paretoFraction = roundShare(fraction)
      // The REAL population/value share for those top `pareto` categories — computed
      // here so the model never has to sum the top groups and divide itself (that
      // derivation, left to the model, is exactly how "top 7 categories account for
      // 35%" happened: it quoted paretoFraction, a share of CATEGORY COUNT, in place
      // of this number, a share of VALUE).
      trend.paretoShare = roundShare(values.slice(0, pareto).reduce((a, b) => a + b, 0) / total)
      // Only a small minority carrying 80% is the Pareto signature worth naming.
      trend.paretoLike = groups.length >= 5 && fraction <= 0.35
    }
  }
  return trend
}

/** Pie: concentration and the negligible tail. */
function compositionTrend(groups: DigestGroup[], shareable: boolean): CompositionTrend | undefined {
  if (groups.length === 0) return undefined
  const values = groups.map((g) => g.value)
  const total = values.reduce((a, b) => a + b, 0)
  const leader = groups[0]
  const trend: CompositionTrend = {
    shape: 'composition',
    sliceCount: groups.length,
    leader: { label: leader.label, value: leader.value },
    negligibleCount: 0,
  }
  if (!shareable || total <= 0) {
    trend.sharesMeaningless = true
    return trend
  }
  const negligible = groups.filter((g) => g.value / total < NEGLIGIBLE_SHARE)
  trend.topShare = roundShare(leader.value / total)
  trend.top2Share = roundShare(values.slice(0, 2).reduce((a, b) => a + b, 0) / total)
  trend.top3Share = roundShare(values.slice(0, 3).reduce((a, b) => a + b, 0) / total)
  trend.concentration = concentrationStats(values)
  trend.negligibleCount = negligible.length
  if (negligible.length) {
    trend.negligibleShare = roundShare(negligible.reduce((a, g) => a + g.value, 0) / total)
  }
  return trend
}

/** Direction of mean vs. median, gated so a rounding-level gap can't read as skew. */
function meanMedianSkew(mean: number, median: number, range: number): 'right' | 'left' | 'symmetric' {
  if (range === 0) return 'symmetric'
  const diff = mean - median
  if (Math.abs(diff) < range * 0.05) return 'symmetric'
  return diff > 0 ? 'right' : 'left'
}

/** Histogram: Freedman–Diaconis bins plus centre, spread, skew and modality. */
function distributionTrend(rows: Row[], field: string): DistributionTrend | undefined {
  const vals = rows.map((r) => toNum(r[field])).filter((v): v is number => v != null)
  if (vals.length < 2) return undefined
  const sorted = [...vals].sort((a, b) => a - b)
  const n = sorted.length
  const min = sorted[0]
  const max = sorted[n - 1]
  const q1 = quantile(sorted, 0.25)
  const q3 = quantile(sorted, 0.75)
  const med = quantile(sorted, 0.5)
  const iqr = q3 - q1
  const sd = stdDev(vals)
  const m = mean(vals)

  // Freedman–Diaconis width = 2·IQR/n^(1/3); fall back to Sturges when IQR is 0.
  let width = iqr > 0 ? (2 * iqr) / Math.cbrt(n) : 0
  if (!(width > 0)) width = (max - min) / Math.max(1, Math.ceil(Math.log2(n)) + 1)
  if (!(width > 0)) width = 1
  const binCount = Math.max(1, Math.min(40, Math.ceil((max - min) / width) || 1))
  const step = (max - min) / binCount || 1

  const bins = Array.from({ length: binCount }, (_, i) => ({
    from: round(min + i * step),
    to: round(min + (i + 1) * step),
    count: 0,
  }))
  for (const v of sorted) {
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor((v - min) / step)))
    bins[idx].count++
  }

  let modalBin = bins[0]
  for (const b of bins) if (b.count > modalBin.count) modalBin = b

  // Peaks: local maxima that clear a real trough — the bimodality signal.
  let peakCount = 0
  const threshold = modalBin.count * 0.25
  for (let i = 0; i < bins.length; i++) {
    const prev = bins[i - 1]?.count ?? 0
    const next = bins[i + 1]?.count ?? 0
    if (bins[i].count > prev && bins[i].count >= next && bins[i].count > threshold) peakCount++
  }

  const g1 = skewness(vals)
  const pearsonSkew = sd > 0 ? round((3 * (m - med)) / sd) : undefined
  const lean = g1 ?? pearsonSkew ?? 0

  return {
    shape: 'distribution',
    field,
    n,
    min: round(min),
    max: round(max),
    mean: round(m),
    median: round(med),
    stdDev: round(sd),
    q1: round(q1),
    q3: round(q3),
    iqr: round(iqr),
    bins,
    binWidth: round(step),
    modalBin,
    ...(g1 != null ? { skewness: round(g1) } : {}),
    ...(pearsonSkew != null ? { pearsonSkew } : {}),
    skewDirection: Math.abs(lean) < 0.5 ? 'symmetric' : lean > 0 ? 'right' : 'left',
    peakCount: Math.max(1, peakCount),
  }
}

/** Box / strip: a five-number summary and Tukey outliers, per group. */
function spreadTrend(
  rows: Row[],
  field: string,
  groupField: string | undefined,
): SpreadTrend | undefined {
  const buckets = new Map<string, number[]>()
  for (const r of rows) {
    const v = toNum(r[field])
    if (v == null) continue
    const label = groupField ? String(r[groupField] ?? '') : 'all'
    if (groupField && label === '') continue
    const arr = buckets.get(label)
    if (arr) arr.push(v)
    else buckets.set(label, [v])
  }
  if (buckets.size === 0) return undefined

  const groups: SpreadGroup[] = [...buckets.entries()]
    .map(([label, raw]) => {
      const sorted = [...raw].sort((a, b) => a - b)
      const q1 = quantile(sorted, 0.25)
      const q3 = quantile(sorted, 0.75)
      const iqr = q3 - q1
      const lowerFence = q1 - 1.5 * iqr
      const upperFence = q3 + 1.5 * iqr
      const outliers = sorted.filter((v) => v < lowerFence || v > upperFence)
      return {
        label,
        n: sorted.length,
        min: round(sorted[0]),
        q1: round(q1),
        median: round(quantile(sorted, 0.5)),
        q3: round(q3),
        max: round(sorted[sorted.length - 1]),
        iqr: round(iqr),
        lowerFence: round(lowerFence),
        upperFence: round(upperFence),
        outlierCount: outliers.length,
        outliers: outliers.slice(0, OUTLIER_CAP).map(round),
        underpowered: sorted.length < MIN_FOR_QUARTILES,
      }
    })
    .sort((a, b) => b.median - a.median)

  const shown = groups.slice(0, SPREAD_GROUP_CAP)
  const widest = [...groups].sort((a, b) => b.iqr - a.iqr)[0]
  return {
    shape: 'spread',
    field,
    ...(groupField ? { groupField } : {}),
    groups: shown,
    underpoweredGroups: groups.filter((g) => g.underpowered).map((g) => g.label).slice(0, SPREAD_GROUP_CAP),
    ...(widest ? { widestGroup: widest.label } : {}),
    ...(groups[0] ? { highestMedianGroup: groups[0].label } : {}),
  }
}

/** Scatter / bubble: association strength and — for a bubble — what size adds. */
function relationshipTrend(
  rows: Row[],
  xField: string,
  yField: string,
  sizeField: string | undefined,
): RelationshipTrend | undefined {
  const xs: number[] = []
  const ys: number[] = []
  const sizes: number[] = []
  for (const r of rows) {
    const x = toNum(r[xField])
    const y = toNum(r[yField])
    if (x == null || y == null) continue
    if (sizeField) {
      const s = toNum(r[sizeField])
      if (s == null) continue
      sizes.push(s)
    }
    xs.push(x)
    ys.push(y)
  }
  if (xs.length < 2) return undefined

  const r = pearson(xs, ys)
  const mx = mean(xs)
  const my = mean(ys)
  const sx = stdDev(xs)
  const sy = stdDev(ys)
  // Conventional far-from-the-mass threshold; looser for small samples.
  const zLimit = xs.length < 30 ? 2.5 : 3
  const outliers: { x: number; y: number }[] = []
  for (let i = 0; i < xs.length && outliers.length < OUTLIER_CAP; i++) {
    const zx = sx > 0 ? Math.abs((xs[i] - mx) / sx) : 0
    const zy = sy > 0 ? Math.abs((ys[i] - my) / sy) : 0
    if (zx > zLimit || zy > zLimit) outliers.push({ x: round(xs[i]), y: round(ys[i]) })
  }

  const trend: RelationshipTrend = {
    shape: 'relationship',
    n: xs.length,
    x: axisStats(xField, xs),
    y: axisStats(yField, ys),
    correlation: round(r),
    r2: round(r * r),
    direction: Math.abs(r) < 0.1 ? 'none' : r > 0 ? 'positive' : 'negative',
    strength: strengthOf(r),
    outliers,
  }

  if (sizeField && sizes.length === xs.length) {
    trend.size = axisStats(sizeField, sizes)
    trend.corrSizeX = round(pearson(sizes, xs))
    trend.corrSizeY = round(pearson(sizes, ys))
    let maxI = 0
    let minI = 0
    for (let i = 0; i < sizes.length; i++) {
      if (sizes[i] > sizes[maxI]) maxI = i
      if (sizes[i] < sizes[minI]) minI = i
    }
    trend.largestBubble = { x: round(xs[maxI]), y: round(ys[maxI]), size: round(sizes[maxI]) }
    trend.smallestBubble = { x: round(xs[minI]), y: round(ys[minI]), size: round(sizes[minI]) }
  }
  return trend
}

/** Heatmap: cells, margins and the residuals that separate hotspots from busy rows. */
function matrixTrend(
  rows: Row[],
  rowField: string,
  colField: string,
  measureField: string | null,
  agg: Aggregate,
): MatrixTrend | undefined {
  const cells = new Map<string, { row: string; col: string; vals: number[] }>()
  for (const r of rows) {
    const rv = r[rowField]
    const cv = r[colField]
    if (rv == null || rv === '' || cv == null || cv === '') continue
    const rl = String(rv)
    const cl = String(cv)
    const key = `${rl} ${cl}`
    let cell = cells.get(key)
    if (!cell) {
      cell = { row: rl, col: cl, vals: [] }
      cells.set(key, cell)
    }
    if (measureField) {
      const v = toNum(r[measureField])
      if (v == null) continue
      cell.vals.push(v)
    } else {
      cell.vals.push(0)
    }
  }
  if (cells.size === 0) return undefined

  const flat = [...cells.values()].map((c) => ({
    row: c.row,
    col: c.col,
    value: round(aggregate(c.vals, measureField ? agg : 'count')),
  }))
  const rowLabels = [...new Set(flat.map((c) => c.row))]
  const colLabels = [...new Set(flat.map((c) => c.col))]
  const grandTotal = flat.reduce((a, c) => a + c.value, 0)

  const totalBy = (key: 'row' | 'col', labels: string[]): NamedValue[] =>
    labels
      .map((label) => ({ label, value: round(flat.filter((c) => c[key] === label).reduce((a, c) => a + c.value, 0)) }))
      .sort((a, b) => b.value - a.value)

  const rowTotals = totalBy('row', rowLabels)
  const colTotals = totalBy('col', colLabels)
  const rowTotalMap = new Map(rowTotals.map((t) => [t.label, t.value]))
  const colTotalMap = new Map(colTotals.map((t) => [t.label, t.value]))

  // Pearson standardized residual vs what the margins predict: |residual| > 2 marks
  // a genuine interaction rather than a cell that is merely in a busy row.
  const withResidual = flat.map((c) => {
    const expected = grandTotal > 0 ? ((rowTotalMap.get(c.row) ?? 0) * (colTotalMap.get(c.col) ?? 0)) / grandTotal : 0
    const residual = expected > 0 ? round((c.value - expected) / Math.sqrt(expected)) : undefined
    return { ...c, ...(residual != null ? { residual } : {}) }
  })

  const sorted = [...withResidual].sort((a, b) => b.value - a.value)
  const notable = withResidual
    .filter((c): c is typeof c & { residual: number } => c.residual != null && Math.abs(c.residual) > 2)
    .sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual))
    .slice(0, CELL_CAP)

  const hottest = sorted[0]
  // If the hottest cell isn't a standout against its margins, the story is the row
  // or column, not the cell.
  const marginDriven = hottest?.residual != null ? Math.abs(hottest.residual) <= 2 : undefined

  return {
    shape: 'matrix',
    rowField,
    colField,
    rowCount: rowLabels.length,
    colCount: colLabels.length,
    grandTotal: round(grandTotal),
    topCells: sorted.slice(0, CELL_CAP),
    ...(sorted.length ? { coldestCell: sorted[sorted.length - 1] } : {}),
    rowTotals: rowTotals.slice(0, CELL_CAP),
    colTotals: colTotals.slice(0, CELL_CAP),
    notableCells: notable,
    ...(marginDriven != null ? { marginDriven } : {}),
    emptyCells: Math.max(0, rowLabels.length * colLabels.length - flat.length),
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function chartDigest(spec: VizSpec, rows: Row[], kind: ChartKind = chartKind(spec)): ChartDigest {
  const enc = spec.encoding
  const digest: ChartDigest = { kind, mark: spec.mark, rows: rows.length }

  // Histogram: a binned quantitative field → describe that field's distribution.
  const binned = CHANNELS.map((c) => enc[c]).find((e) => e?.bin && e.field && e.type === 'quantitative')
  if (binned?.field) {
    const s = numericStats(rows, binned.field)
    if (s) digest.measure = { field: binned.field, aggregate: 'distribution', basis: 'per-row', ...s }
    digest.trend = distributionTrend(rows, binned.field)
    return digest
  }

  // The measure: a channel with an aggregate, else a quantitative field.
  const measureCh = (['y', 'theta', 'color', 'x'] as const)
    .map((c) => enc[c])
    .find((e): e is Encoding => Boolean(e) && (Boolean(e!.aggregate) || e!.type === 'quantitative'))
  const measureField = measureCh?.field ?? null
  const measureAgg: Aggregate = measureCh?.aggregate ?? (measureField ? 'mean' : 'count')

  // The dimension: a channel with a non-quantitative field.
  const dimCh = (['x', 'color', 'location', 'y'] as const)
    .map((c) => enc[c])
    .find((e): e is Encoding => Boolean(e?.field) && e!.type !== 'quantitative')
  const dimField = dimCh?.field

  // Scatter / bubble: two raw quantitative axes, no grouping dimension.
  const xRaw = enc.x && enc.x.type === 'quantitative' && enc.x.field && !enc.x.aggregate
  const yRaw = enc.y && enc.y.type === 'quantitative' && enc.y.field && !enc.y.aggregate
  if (xRaw && yRaw && !dimField) {
    const xf = enc.x!.field!
    const yf = enc.y!.field!
    const pairs = rows
      .map((r) => [toNum(r[xf]), toNum(r[yf])] as const)
      .filter((p): p is readonly [number, number] => p[0] != null && p[1] != null)
    if (pairs.length) {
      const xs = pairs.map((p) => p[0])
      const ys = pairs.map((p) => p[1])
      digest.axes = [
        { field: xf, min: round(Math.min(...xs)), max: round(Math.max(...xs)), mean: round(mean(xs)) },
        { field: yf, min: round(Math.min(...ys)), max: round(Math.max(...ys)), mean: round(mean(ys)) },
      ]
      digest.correlation = round(pearson(xs, ys))
      digest.trend = relationshipTrend(rows, xf, yf, enc.size?.field)
    }
    return digest
  }

  // Box / strip: the measure's raw spread, optionally split by a grouping.
  if (kind === 'box' || kind === 'strip') {
    const measure = enc.y?.type === 'quantitative' ? enc.y.field : (enc.x?.type === 'quantitative' ? enc.x.field : null)
    const group = enc.y?.type === 'quantitative' ? enc.x?.field : enc.y?.field
    if (measure) {
      const s = numericStats(rows, measure)
      if (s) digest.measure = { field: measure, aggregate: 'raw', basis: 'per-row', ...s }
      digest.trend = spreadTrend(rows, measure, group)
      return digest
    }
  }

  // Heatmap: two categorical axes forming a cell grid.
  if (kind === 'heatmap' && enc.x?.field && enc.y?.field) {
    digest.trend = matrixTrend(rows, enc.y.field, enc.x.field, measureField, measureAgg)
  }

  // Row-level stats. Where they land depends on whether the chart groups: on a
  // grouped chart these describe the records BEHIND the marks, not the marks, so
  // they go under `underlyingRecords` where they cannot be mistaken for the values
  // on screen.
  const rowStats: LevelStats | null = measureField
    ? (() => {
        const s = numericStats(rows, measureField)
        return s ? { field: measureField, aggregate: measureAgg, basis: 'per-row' as const, ...s } : null
      })()
    : { field: null, aggregate: 'count', basis: 'per-row' }

  if (rowStats) {
    if (dimField) {
      digest.underlyingRecords = {
        ...rowStats,
        describes: `individual ${measureField ?? 'row'} values behind the ${dimField} groups — NOT the values drawn on the chart`,
      }
    } else {
      digest.measure = rowStats
    }
  }

  // Grouped aggregate: category → measure (or a row count).
  if (dimField) {
    const map = new Map<string, number[]>()
    for (const r of rows) {
      const raw = r[dimField]
      if (raw == null || raw === '') continue
      const label = String(raw)
      if (measureField) {
        const v = toNum(r[measureField])
        if (v == null) continue
        ;(map.get(label) ?? map.set(label, []).get(label)!).push(v)
      } else {
        ;(map.get(label) ?? map.set(label, []).get(label)!).push(0)
      }
    }
    const groups: DigestGroup[] = [...map.entries()]
      .map(([label, vals]) => ({ label, value: round(aggregate(vals, measureField ? measureAgg : 'count')) }))
      .sort((a, b) => b.value - a.value)

    let shareable = false
    if (groups.length) {
      const vals = groups.map((g) => g.value)
      const total = vals.reduce((a, b) => a + b, 0)
      const min = Math.min(...vals)
      const max = Math.max(...vals)
      // A "share of the whole" only means something for additive measures with no
      // negatives — an average or a temperature has no meaningful share.
      const additive = (measureField ? measureAgg : 'count') === 'sum' || !measureField || measureAgg === 'count'
      shareable = additive && min >= 0 && total > 0

      const groupMean = total / groups.length
      const groupMedian = aggregate(vals, 'median')
      digest.groupStats = {
        basis: 'per-group',
        min: round(min),
        max: round(max),
        mean: round(groupMean),
        median: round(groupMedian),
        sum: round(total),
        range: round(max - min),
        ...(min > 0 ? { topToBottomRatio: round(max / min) } : {}),
        ...(shareable ? { topShare: roundShare(max / total) } : {}),
        skew: meanMedianSkew(groupMean, groupMedian, max - min),
      }
      if (shareable) {
        for (const g of groups) g.share = roundShare(g.value / total)
      }
    }

    // `shown` makes truncation explicit: the guide tells the model it may name the
    // leaders from a truncated list but never the laggard.
    digest.groups = groups.slice(0, GROUP_CAP)
    digest.dimension = { field: dimField, groupCount: groups.length, shown: digest.groups.length }

    // The chart-type-specific pattern, built from ALL groups (not the shown slice).
    if (!digest.trend) {
      if (kind === 'line' || kind === 'area') {
        digest.trend = seriesTrend(rows, dimField, dimCh?.type, measureField, measureAgg)
      } else if (kind === 'pie') {
        digest.trend = compositionTrend(groups, shareable)
      } else if (kind === 'bar' || kind === 'dotplot' || kind === 'map') {
        digest.trend = rankingTrend(groups)
        if (kind === 'map') digest.coverage = mapCoverage(groups.map((g) => g.label))
      }
    }
  }

  return digest
}

/** True when the digest has something worth summarizing (else skip the request). */
export function digestHasContent(d: ChartDigest): boolean {
  return Boolean(
    (d.groups && d.groups.length > 0) ||
      d.axes ||
      d.trend ||
      d.measure?.field ||
      d.underlyingRecords?.field,
  )
}
