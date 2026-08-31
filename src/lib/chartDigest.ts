import type { Aggregate, Encoding, Row, VizSpec } from './types'

/**
 * A compact, AGGREGATED digest of what a chart actually shows — computed in the
 * browser from the filtered rows. Only these derived numbers (top groups, ranges,
 * means, a correlation) are sent to the local model for a summary; the raw rows
 * never leave. Pure and unit-tested.
 */

export interface DigestGroup {
  label: string
  value: number
  /** This group's share of the total, 0–1 — only for additive measures (sum/count)
   *  with no negative values, where a "share of the whole" is meaningful. */
  share?: number
}

export interface ChartDigest {
  mark: string
  rows: number
  /**
   * Stats of the primary measure across INDIVIDUAL ROWS (`basis: 'per-row'`).
   * These describe single records, NOT the bars/regions the chart draws — for a
   * chart that groups, `groupStats` is the one that describes what's on screen.
   */
  measure?: { field: string | null; aggregate: string; basis?: 'per-row'; min?: number; max?: number; sum?: number; mean?: number; median?: number }
  /** The grouping dimension, when the chart aggregates a measure by a category. */
  dimension?: { field: string; groupCount: number }
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
  }
  /** Top groups by value (category → aggregated measure or count), desc. */
  groups?: DigestGroup[]
  /** For scatter/bubble: per-axis range + mean. */
  axes?: { field: string; min: number; max: number; mean: number }[]
  /** For scatter/bubble: Pearson correlation of the two axes (−1..1). */
  correlation?: number
}

const GROUP_CAP = 12
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
    case 'median': {
      const s = [...vals].sort((a, b) => a - b)
      const m = Math.floor(s.length / 2)
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
    }
    default:
      return vals.reduce((a, b) => a + b, 0)
  }
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n === 0) return 0
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
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
  return {
    min: round(Math.min(...vals)),
    max: round(Math.max(...vals)),
    mean: round(aggregate(vals, 'mean')),
    median: round(aggregate(vals, 'median')),
    sum: round(aggregate(vals, 'sum')),
  }
}

export function chartDigest(spec: VizSpec, rows: Row[]): ChartDigest {
  const enc = spec.encoding
  const digest: ChartDigest = { mark: spec.mark, rows: rows.length }

  // Histogram: a binned quantitative field → describe that field's distribution.
  const binned = CHANNELS.map((c) => enc[c]).find((e) => e?.bin && e.field && e.type === 'quantitative')
  if (binned?.field) {
    const s = numericStats(rows, binned.field)
    if (s) digest.measure = { field: binned.field, aggregate: 'distribution', basis: 'per-row', ...s }
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
        { field: xf, min: round(Math.min(...xs)), max: round(Math.max(...xs)), mean: round(aggregate(xs, 'mean')) },
        { field: yf, min: round(Math.min(...ys)), max: round(Math.max(...ys)), mean: round(aggregate(ys, 'mean')) },
      ]
      digest.correlation = round(pearson(xs, ys))
    }
    return digest
  }

  // Overall measure stats.
  if (measureField) {
    const s = numericStats(rows, measureField)
    if (s) digest.measure = { field: measureField, aggregate: measureAgg, basis: 'per-row', ...s }
  } else {
    digest.measure = { field: null, aggregate: 'count', basis: 'per-row' }
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
    digest.dimension = { field: dimField, groupCount: groups.length }

    if (groups.length) {
      const vals = groups.map((g) => g.value)
      const total = vals.reduce((a, b) => a + b, 0)
      const min = Math.min(...vals)
      const max = Math.max(...vals)
      // A "share of the whole" only means something for additive measures with no
      // negatives — an average or a temperature has no meaningful share.
      const additive = (measureField ? measureAgg : 'count') === 'sum' || !measureField || measureAgg === 'count'
      const shareable = additive && min >= 0 && total > 0

      digest.groupStats = {
        basis: 'per-group',
        min: round(min),
        max: round(max),
        mean: round(total / groups.length),
        median: round(aggregate(vals, 'median')),
        sum: round(total),
        range: round(max - min),
        ...(min > 0 ? { topToBottomRatio: round(max / min) } : {}),
        ...(shareable ? { topShare: roundShare(max / total) } : {}),
      }
      if (shareable) {
        for (const g of groups) g.share = roundShare(g.value / total)
      }
    }

    digest.groups = groups.slice(0, GROUP_CAP)
  }

  return digest
}

/** True when the digest has something worth summarizing (else skip the request). */
export function digestHasContent(d: ChartDigest): boolean {
  return Boolean((d.groups && d.groups.length > 0) || d.axes || (d.measure && d.measure.field))
}
