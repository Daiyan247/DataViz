import { describe, expect, it } from 'vitest'
import { chartWarnings } from './chartWarnings'
import type { ColumnProfile, VizSpec } from './types'

const prof = (
  name: string,
  level: ColumnProfile['level'],
  extra: Partial<ColumnProfile> = {},
): ColumnProfile => ({
  name,
  storageType: level === 'quantitative' ? 'number' : 'string',
  level,
  continuous: false,
  distinct: 4,
  count: 10,
  examples: [],
  ...extra,
})

const profiles: ColumnProfile[] = [
  prof('region', 'nominal'),
  prof('units', 'quantitative'),
  prof('revenue', 'quantitative', { continuous: true, distinct: 50 }),
]

describe('chartWarnings', () => {
  it('no warnings for a well-formed bar chart', () => {
    const spec: VizSpec = {
      mark: 'bar',
      encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' } },
    }
    expect(chartWarnings(spec, profiles)).toEqual([])
  })

  it('does NOT warn about a scatter/bubble with one categorical axis (valid grouping)', () => {
    const spec: VizSpec = {
      mark: 'point',
      encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } },
    }
    expect(chartWarnings(spec, profiles)).toEqual([])
  })

  it('warns only when a scatter has NO numeric axis (both categorical)', () => {
    const cols = [prof('region', 'nominal'), prof('city', 'nominal')]
    const spec: VizSpec = {
      mark: 'point',
      encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'city', type: 'nominal' } },
    }
    expect(chartWarnings(spec, cols).some((w) => /relationship between numbers/.test(w))).toBe(true)
  })

  it('warns that a bubble sized by a category must use a numeric field', () => {
    const cols = [prof('discount', 'quantitative'), prof('revenue', 'quantitative'), prof('category', 'nominal')]
    const spec: VizSpec = {
      mark: 'point',
      encoding: {
        x: { field: 'discount', type: 'quantitative' },
        y: { field: 'revenue', type: 'quantitative' },
        size: { field: 'category', type: 'nominal' },
      },
    }
    const w = chartWarnings(spec, cols)
    expect(w.some((m) => /size should be a numeric field.*category/i.test(m))).toBe(true)
  })

  it('calls a point chart with a size channel a "bubble chart" in warnings', () => {
    const cols = [prof('region', 'nominal'), prof('city', 'nominal'), prof('units', 'quantitative')]
    const spec: VizSpec = {
      mark: 'point',
      encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'city', type: 'nominal' }, size: { field: 'units', type: 'quantitative' } },
    }
    expect(chartWarnings(spec, cols).some((w) => /bubble chart/.test(w))).toBe(true)
  })

  it('warns when a pie uses a continuous field as its category', () => {
    const spec: VizSpec = {
      mark: 'arc',
      encoding: { theta: { field: 'units', type: 'quantitative', aggregate: 'sum' }, color: { field: 'revenue', type: 'quantitative' } },
    }
    expect(chartWarnings(spec, profiles).some((w) => /continuous number/.test(w))).toBe(true)
  })

  it('warns when a pie has no numeric measure (two categories)', () => {
    const cols = [prof('condition', 'nominal'), prof('city', 'nominal')]
    const spec: VizSpec = {
      mark: 'arc',
      // condition on the angle channel is categorical → not a valid measure.
      encoding: { theta: { field: 'condition', type: 'nominal' }, color: { field: 'city', type: 'nominal' } },
    }
    expect(chartWarnings(spec, cols).some((w) => /needs a numeric measure/.test(w))).toBe(true)
  })

  it('does not warn about theta when it is a count', () => {
    const cols = [prof('city', 'nominal')]
    const spec: VizSpec = {
      mark: 'arc',
      encoding: { theta: { type: 'quantitative', aggregate: 'count' }, color: { field: 'city', type: 'nominal' } },
    }
    expect(chartWarnings(spec, cols).some((w) => /numeric measure/.test(w))).toBe(false)
  })

  it('warns when a pie has too many categories', () => {
    const many = [...profiles, prof('sku', 'nominal', { distinct: 40 })]
    const spec: VizSpec = {
      mark: 'arc',
      encoding: { theta: { field: 'revenue', type: 'quantitative', aggregate: 'sum' }, color: { field: 'sku', type: 'nominal' } },
    }
    expect(chartWarnings(spec, many).some((w) => /too many to read as pie slices/.test(w))).toBe(true)
  })

  it('warns when a line uses an unordered (nominal) x', () => {
    const spec: VizSpec = {
      mark: 'line',
      encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' } },
    }
    expect(chartWarnings(spec, profiles).some((w) => /connects points in order/.test(w))).toBe(true)
  })

  it('warns that a histogram of few distinct values should be a bar of counts', () => {
    const cols = [prof('rating', 'quantitative', { distinct: 5 })]
    const spec: VizSpec = {
      mark: 'bar',
      encoding: { x: { field: 'rating', type: 'quantitative', bin: true }, y: { type: 'quantitative', aggregate: 'count' } },
    }
    expect(chartWarnings(spec, cols).some((w) => /won’t show a smooth distribution/.test(w))).toBe(true)
  })

  it('warns when a bar has too many categories', () => {
    const cols = [prof('sku', 'nominal', { distinct: 50 }), prof('revenue', 'quantitative')]
    const spec: VizSpec = {
      mark: 'bar',
      encoding: { x: { field: 'sku', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' } },
    }
    expect(chartWarnings(spec, cols).some((w) => /lot of bars/.test(w))).toBe(true)
  })

  it('warns when a pie has only one category', () => {
    const cols = [prof('only', 'nominal', { distinct: 1 }), prof('revenue', 'quantitative')]
    const spec: VizSpec = {
      mark: 'arc',
      encoding: { theta: { field: 'revenue', type: 'quantitative', aggregate: 'sum' }, color: { field: 'only', type: 'nominal' } },
    }
    expect(chartWarnings(spec, cols).some((w) => /only one value/.test(w))).toBe(true)
  })

  it('warns on an unknown field', () => {
    const spec: VizSpec = {
      mark: 'bar',
      encoding: { x: { field: 'nope', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } },
    }
    expect(chartWarnings(spec, profiles).some((w) => /isn’t a column/.test(w))).toBe(true)
  })
})

describe('chartWarnings — box plot data sufficiency', () => {
  const box = (m: ColumnProfile, cat?: ColumnProfile): VizSpec => ({
    mark: 'boxplot',
    encoding: { y: { field: m.name, type: 'quantitative' }, ...(cat ? { x: { field: cat.name, type: cat.level } } : {}) },
  })

  it('warns when there are too few observations (<20)', () => {
    const m = prof('score', 'quantitative', { count: 8, distinct: 8, iqr: 4 })
    expect(chartWarnings(box(m), [m]).some((w) => /aren’t reliable/.test(w))).toBe(true)
  })

  it('warns per-group when the groups are too thin', () => {
    const m = prof('score', 'quantitative', { count: 30, distinct: 25, iqr: 4 })
    const c = prof('team', 'nominal', { distinct: 10 })
    expect(chartWarnings(box(m, c), [m, c]).some((w) => /per box/.test(w))).toBe(true)
  })

  it('warns when the measure has no spread (IQR = 0)', () => {
    const m = prof('flat', 'quantitative', { count: 100, distinct: 3, iqr: 0 })
    expect(chartWarnings(box(m), [m]).some((w) => /barely varies/.test(w))).toBe(true)
  })

  it('warns when the measure has only a few distinct values', () => {
    const m = prof('rating', 'quantitative', { count: 100, distinct: 5, iqr: 2 })
    expect(chartWarnings(box(m), [m]).some((w) => /coarse steps/.test(w))).toBe(true)
  })

  it('warns when there are too many groups (boxes)', () => {
    const m = prof('score', 'quantitative', { count: 1000, distinct: 100, iqr: 5 })
    const c = prof('sku', 'nominal', { distinct: 30 })
    expect(chartWarnings(box(m, c), [m, c]).some((w) => /lot of boxes/.test(w))).toBe(true)
  })

  it('warns when the value axis is not numeric', () => {
    const m = prof('category', 'nominal', { count: 100 })
    expect(chartWarnings(box(m), [m]).some((w) => /numeric measure on the value axis/.test(w))).toBe(true)
  })

  it('does NOT warn for a well-populated, well-spread box plot', () => {
    const m = prof('revenue', 'quantitative', { continuous: true, count: 200, distinct: 50, iqr: 10 })
    const c = prof('region', 'nominal', { distinct: 4 })
    expect(chartWarnings(box(m, c), [m, c])).toEqual([])
  })
})
