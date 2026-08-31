import { describe, expect, it } from 'vitest'
import { chartDigest, digestHasContent } from './chartDigest'
import type { Row, VizSpec } from './types'

const rows: Row[] = [
  { region: 'North', revenue: 100, visitors: 10 },
  { region: 'North', revenue: 50, visitors: 8 },
  { region: 'South', revenue: 30, visitors: 5 },
  { region: 'East', revenue: 20, visitors: 4 },
]

describe('chartDigest', () => {
  it('aggregates a measure by a category, sorted desc', () => {
    const spec: VizSpec = { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' } } }
    const d = chartDigest(spec, rows)
    expect(d.dimension).toEqual({ field: 'region', groupCount: 3 })
    // revenue sums: North 150, South 30, East 20 -> total 200
    expect(d.groups?.[0]).toEqual({ label: 'North', value: 150, share: 0.75 })
    expect(d.groups?.map((g) => g.label)).toEqual(['North', 'South', 'East'])
    expect(d.measure?.field).toBe('revenue')
    expect(digestHasContent(d)).toBe(true)
  })

  it('gives per-axis stats + a positive correlation for a scatter', () => {
    const spec: VizSpec = { mark: 'point', encoding: { x: { field: 'visitors', type: 'quantitative' }, y: { field: 'revenue', type: 'quantitative' } } }
    const d = chartDigest(spec, rows)
    expect(d.axes?.map((a) => a.field)).toEqual(['visitors', 'revenue'])
    expect(d.axes?.[0]).toMatchObject({ min: 4, max: 10 })
    expect(d.correlation ?? 0).toBeGreaterThan(0.5)
  })

  it('describes the binned field for a histogram, with generic stats (min/max/mean/median)', () => {
    const spec: VizSpec = { mark: 'bar', encoding: { x: { field: 'revenue', type: 'quantitative', bin: true }, y: { type: 'quantitative', aggregate: 'count' } } }
    const d = chartDigest(spec, rows)
    // revenue = [100,50,30,20] → min 20, max 100, mean 50, median (30+50)/2 = 40
    expect(d.measure).toMatchObject({ field: 'revenue', min: 20, max: 100, mean: 50, median: 40 })
  })

  it('counts rows per category when there is no measure', () => {
    const spec: VizSpec = { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { type: 'quantitative', aggregate: 'count' } } }
    const d = chartDigest(spec, rows)
    expect(d.groups?.[0]).toEqual({ label: 'North', value: 2, share: 0.5 })
  })

  it('reports no content when there is nothing to summarize (count, no dimension)', () => {
    const spec: VizSpec = { mark: 'bar', encoding: { y: { type: 'quantitative', aggregate: 'count' } } }
    expect(digestHasContent(chartDigest(spec, rows))).toBe(false)
  })
})

describe('chartDigest — per-group vs per-row statistics', () => {
  const spec: VizSpec = {
    mark: 'bar',
    encoding: {
      x: { field: 'region', type: 'nominal' },
      y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
    },
  }
  const d = chartDigest(spec, rows)

  it('summarises the GROUPS the chart actually draws', () => {
    // 3 groups: 150, 30, 20 (not the 4 raw rows).
    expect(d.groupStats).toMatchObject({
      basis: 'per-group',
      min: 20,
      max: 150,
      mean: 66.67, // 200 / 3 groups
      median: 30,
      sum: 200,
      range: 130,
      topToBottomRatio: 7.5,
      topShare: 0.75,
    })
  })

  it('keeps row-level stats separate and labelled, so the two cannot be confused', () => {
    // The raw rows are 100/50/30/20 -> mean 50, max 100. Neither is a bar on the
    // chart, which is exactly why this is tagged 'per-row'.
    expect(d.measure).toMatchObject({ basis: 'per-row', mean: 50, max: 100 })
    expect(d.groupStats?.mean).not.toBe(d.measure?.mean)
  })

  it('omits shares for a non-additive measure, where a share is meaningless', () => {
    const avg: VizSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'region', type: 'nominal' },
        y: { field: 'revenue', type: 'quantitative', aggregate: 'mean' },
      },
    }
    const a = chartDigest(avg, rows)
    expect(a.groupStats?.basis).toBe('per-group')
    expect(a.groupStats?.topShare).toBeUndefined()
    expect(a.groups?.[0].share).toBeUndefined()
  })

  it('omits shares and the ratio when a group value is negative or zero', () => {
    const negRows: Row[] = [
      { region: 'North', profit: -5 },
      { region: 'South', profit: 10 },
    ]
    const negSpec: VizSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'region', type: 'nominal' },
        y: { field: 'profit', type: 'quantitative', aggregate: 'sum' },
      },
    }
    const n = chartDigest(negSpec, negRows)
    expect(n.groupStats?.min).toBe(-5)
    expect(n.groupStats?.topShare).toBeUndefined()
    expect(n.groupStats?.topToBottomRatio).toBeUndefined()
  })
})
