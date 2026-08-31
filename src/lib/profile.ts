import type { Cell, Column, ColumnProfile, MeasurementLevel, Row } from './types'

/**
 * Profile each column into a measurement level (nominal / ordinal / quantitative /
 * temporal) plus shape stats (cardinality, continuous-vs-discrete, range, examples).
 * This richer picture — not the raw storage type — is what the LLM uses to pick a
 * sensible chart and what the warnings layer reasons over. Pure and unit-tested.
 */

// Distinct strings that, taken together, imply an ordered categorical scale.
const ORDINAL_SCALES: string[][] = [
  ['low', 'medium', 'high'],
  ['small', 'medium', 'large'],
  ['xs', 's', 'm', 'l', 'xl', 'xxl'],
  ['poor', 'fair', 'good', 'very good', 'excellent'],
  ['strongly disagree', 'disagree', 'neutral', 'agree', 'strongly agree'],
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
]

/** True when the distinct string values fit inside a known ordered scale. */
function looksOrdinal(distinctValues: string[]): boolean {
  if (distinctValues.length < 2) return false
  const lowered = distinctValues.map((v) => v.toLowerCase().trim())
  return ORDINAL_SCALES.some((scale) => lowered.every((v) => scale.includes(v)))
}

function levelFor(column: Column, distinctValues: string[]): MeasurementLevel {
  switch (column.type) {
    case 'date':
      return 'temporal'
    case 'number':
      return 'quantitative'
    default:
      return looksOrdinal(distinctValues) ? 'ordinal' : 'nominal'
  }
}

const CARDINALITY_CAP = 2000
// Upper bound on values kept for quantile estimation. Below it the reservoir holds
// the whole column (exact quartiles); above it we keep a uniform random sample
// (Vitter reservoir sampling) — an unbiased estimate, ~1% IQR error at this size,
// for ~160 KB. Keeps profiling O(n) time / bounded memory on huge datasets.
const QUANTILE_SAMPLE_CAP = 20000

/** Value at percentile `p` (0..1) of an ascending-sorted array (linear interpolation). */
function quantile(sorted: number[], p: number): number {
  const n = sorted.length
  if (n === 0) return NaN
  if (n === 1) return sorted[0]
  const idx = (n - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

export function profileColumn(column: Column, rows: Row[]): ColumnProfile {
  const distinctSet = new Set<string>()
  const examples: Cell[] = []
  let count = 0
  let min = Infinity
  let max = -Infinity
  let hasFraction = false

  // Exact mean/variance in one streaming pass (Welford — O(1) memory, stable).
  let numSeen = 0
  let mean = 0
  let m2 = 0
  // Uniform random sample of numeric values for quantile estimation (Algorithm R).
  const reservoir: number[] = []

  for (const row of rows) {
    const v = row[column.name]
    if (v === null || v === undefined || v === '') continue
    count += 1
    const key = String(v)
    if (distinctSet.size < CARDINALITY_CAP && !distinctSet.has(key)) {
      distinctSet.add(key)
      if (examples.length < 5) examples.push(v)
    }
    if (typeof v === 'number') {
      if (v < min) min = v
      if (v > max) max = v
      if (!Number.isInteger(v)) hasFraction = true

      numSeen += 1
      const delta = v - mean
      mean += delta / numSeen
      m2 += delta * (v - mean)

      if (reservoir.length < QUANTILE_SAMPLE_CAP) {
        reservoir.push(v)
      } else {
        const j = Math.floor(Math.random() * numSeen)
        if (j < QUANTILE_SAMPLE_CAP) reservoir[j] = v
      }
    }
  }

  const distinctValues = [...distinctSet]
  const level = levelFor(column, distinctValues)
  const distinct = distinctSet.size

  const profile: ColumnProfile = {
    name: column.name,
    storageType: column.type,
    level,
    continuous: false,
    distinct,
    count,
    examples,
  }

  if (column.type === 'number' && numSeen > 0) {
    profile.min = min
    profile.max = max
    // Continuous if fractional values appear, or the integer axis is high-cardinality.
    profile.continuous = hasFraction || distinct > 20
    profile.mean = mean
    profile.stdDev = Math.sqrt(m2 / numSeen) // population standard deviation
    reservoir.sort((a, b) => a - b)
    profile.q1 = quantile(reservoir, 0.25)
    profile.median = quantile(reservoir, 0.5)
    profile.q3 = quantile(reservoir, 0.75)
    profile.iqr = profile.q3 - profile.q1
  }

  return profile
}

export function profileColumns(columns: Column[], rows: Row[]): ColumnProfile[] {
  return columns.map((c) => profileColumn(c, rows))
}
