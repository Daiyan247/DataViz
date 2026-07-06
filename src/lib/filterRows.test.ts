import { describe, expect, it } from 'vitest'
import { applyFilters, distinctValues } from './filterRows'
import type { Filter, Row } from './types'

const rows: Row[] = [
  { region: 'West', revenue: 100, active: true },
  { region: 'East', revenue: 250, active: false },
  { region: 'West', revenue: 300, active: true },
  { region: 'North', revenue: null, active: true },
]

const f = (partial: Omit<Filter, 'id'>): Filter => ({ id: 'f', ...partial })

describe('applyFilters', () => {
  it('returns all rows when there are no filters', () => {
    expect(applyFilters(rows, [])).toHaveLength(4)
  })

  it('filters by equality', () => {
    const out = applyFilters(rows, [f({ column: 'region', op: 'eq', value: 'West' })])
    expect(out).toHaveLength(2)
  })

  it('filters by numeric comparison', () => {
    const out = applyFilters(rows, [f({ column: 'revenue', op: 'gte', value: 250 })])
    expect(out.map((r) => r.revenue)).toEqual([250, 300])
  })

  it('drops rows that cannot be compared numerically', () => {
    const out = applyFilters(rows, [f({ column: 'revenue', op: 'gt', value: 0 })])
    expect(out.every((r) => r.revenue !== null)).toBe(true)
  })

  it('supports case-insensitive contains', () => {
    const out = applyFilters(rows, [f({ column: 'region', op: 'contains', value: 'est' })])
    expect(out).toHaveLength(2)
  })

  it('combines multiple filters with AND', () => {
    const out = applyFilters(rows, [
      f({ column: 'region', op: 'eq', value: 'West' }),
      f({ column: 'revenue', op: 'gt', value: 200 }),
    ])
    expect(out).toEqual([{ region: 'West', revenue: 300, active: true }])
  })

  it('does not mutate the input array', () => {
    const copy = [...rows]
    applyFilters(rows, [f({ column: 'region', op: 'eq', value: 'West' })])
    expect(rows).toEqual(copy)
  })
})

describe('distinctValues', () => {
  it('returns sorted distinct non-null values as strings', () => {
    expect(distinctValues(rows, 'region')).toEqual(['East', 'North', 'West'])
  })
})
