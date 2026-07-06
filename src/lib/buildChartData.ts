import type { ChartDatum, ChartSpec, Column, Row } from './types'

/**
 * Turn filtered rows + a ChartSpec into plot-ready `{ name, value }[]`.
 * Pure and unit-tested. Bar/line/area/pie group by the x field and aggregate the
 * y field; scatter emits raw (x, y) numeric pairs.
 */

const BLANK = '(blank)'

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isNaN(v) ? null : v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/,/g, ''))
    return Number.isNaN(n) ? null : n
  }
  return null
}

function labelOf(v: unknown): string {
  if (v === null || v === undefined || v === '') return BLANK
  return String(v)
}

/** Fold all but the top `max` groups (by value) into a single "Other" slice. */
export function foldToOther(data: ChartDatum[], max: number): ChartDatum[] {
  if (data.length <= max) return data
  const sorted = [...data].sort((a, b) => b.value - a.value)
  const keep = sorted.slice(0, max - 1)
  const rest = sorted.slice(max - 1)
  const other = rest.reduce((sum, d) => sum + d.value, 0)
  return [...keep, { name: 'Other', value: other }]
}

export function buildChartData(rows: Row[], spec: ChartSpec, columns: Column[]): ChartDatum[] {
  const xCol = columns.find((c) => c.name === spec.x)

  if (spec.type === 'scatter') {
    const points: ChartDatum[] = []
    for (const row of rows) {
      const x = toNumber(row[spec.x])
      const y = toNumber(row[spec.y])
      if (x === null || y === null) continue
      points.push({ name: x, value: y })
    }
    return points.sort((a, b) => Number(a.name) - Number(b.name))
  }

  // Group by x, preserving first-appearance order.
  const order: string[] = []
  const groups = new Map<string, { sum: number; count: number }>()
  for (const row of rows) {
    const key = labelOf(row[spec.x])
    let g = groups.get(key)
    if (!g) {
      g = { sum: 0, count: 0 }
      groups.set(key, g)
      order.push(key)
    }
    g.count += 1
    if (spec.aggregate === 'sum' || spec.aggregate === 'avg') {
      const n = toNumber(row[spec.y])
      if (n !== null) g.sum += n
    }
  }

  let data: ChartDatum[] = order.map((name) => {
    const g = groups.get(name)!
    let value: number
    switch (spec.aggregate) {
      case 'count':
        value = g.count
        break
      case 'avg':
        value = g.count ? g.sum / g.count : 0
        break
      default:
        value = g.sum
    }
    return { name, value }
  })

  // Chronological for time-based x; ranked (desc) for bar/pie categories.
  if (xCol?.type === 'date') {
    data = data.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  } else if (spec.type === 'bar' || spec.type === 'pie') {
    data = data.sort((a, b) => b.value - a.value)
  }

  // Pie legibility: cap slices (fixed palette is 8 hues) and fold the tail.
  if (spec.type === 'pie') data = foldToOther(data, 8)

  return data
}
