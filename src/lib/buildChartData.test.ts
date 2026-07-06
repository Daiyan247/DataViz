import { describe, expect, it } from 'vitest'
import { buildChartData, foldToOther } from './buildChartData'
import type { ChartSpec, Column, Row } from './types'

const columns: Column[] = [
  { name: 'date', type: 'date' },
  { name: 'region', type: 'string' },
  { name: 'units', type: 'number' },
  { name: 'revenue', type: 'number' },
]

const rows: Row[] = [
  { date: '2024-02-01', region: 'West', units: 2, revenue: 100 },
  { date: '2024-01-01', region: 'East', units: 5, revenue: 250 },
  { date: '2024-03-01', region: 'West', units: 3, revenue: 300 },
]

const spec = (p: Partial<ChartSpec>): ChartSpec => ({
  type: 'bar',
  x: 'region',
  y: 'revenue',
  aggregate: 'sum',
  ...p,
})

describe('buildChartData', () => {
  it('sums a measure grouped by category, ranked desc', () => {
    const data = buildChartData(rows, spec({}), columns)
    expect(data).toEqual([
      { name: 'West', value: 400 },
      { name: 'East', value: 250 },
    ])
  })

  it('counts rows per group', () => {
    const data = buildChartData(rows, spec({ aggregate: 'count' }), columns)
    const west = data.find((d) => d.name === 'West')
    expect(west?.value).toBe(2)
  })

  it('averages a measure per group', () => {
    const data = buildChartData(rows, spec({ aggregate: 'avg' }), columns)
    const west = data.find((d) => d.name === 'West')
    expect(west?.value).toBe(200)
  })

  it('sorts chronologically for a date x-axis (line)', () => {
    const data = buildChartData(rows, spec({ type: 'line', x: 'date', aggregate: 'sum' }), columns)
    expect(data.map((d) => d.name)).toEqual(['2024-01-01', '2024-02-01', '2024-03-01'])
  })

  it('emits raw numeric pairs for scatter', () => {
    const data = buildChartData(
      rows,
      spec({ type: 'scatter', x: 'units', y: 'revenue', aggregate: 'none' }),
      columns,
    )
    expect(data).toEqual([
      { name: 2, value: 100 },
      { name: 3, value: 300 },
      { name: 5, value: 250 },
    ])
  })

  it('labels blank groups', () => {
    const data = buildChartData([{ region: null, revenue: 10 }], spec({}), columns)
    expect(data[0].name).toBe('(blank)')
  })
})

describe('foldToOther', () => {
  it('keeps everything when under the cap', () => {
    const d = [
      { name: 'a', value: 3 },
      { name: 'b', value: 2 },
    ]
    expect(foldToOther(d, 8)).toHaveLength(2)
  })

  it('folds the tail into a single Other slice', () => {
    const d = [
      { name: 'a', value: 5 },
      { name: 'b', value: 4 },
      { name: 'c', value: 3 },
      { name: 'd', value: 2 },
    ]
    const out = foldToOther(d, 2)
    expect(out).toEqual([
      { name: 'a', value: 5 },
      { name: 'Other', value: 9 },
    ])
  })
})
