import { describe, expect, it } from 'vitest'
import { profileColumns } from './profile'
import type { Column, Row } from './types'

const columns: Column[] = [
  { name: 'month', type: 'date' },
  { name: 'region', type: 'string' },
  { name: 'tier', type: 'string' },
  { name: 'units', type: 'number' },
  { name: 'revenue', type: 'number' },
]

const rows: Row[] = [
  { month: '2024-01', region: 'West', tier: 'low', units: 2, revenue: 100.5 },
  { month: '2024-02', region: 'East', tier: 'high', units: 5, revenue: 250.25 },
  { month: '2024-03', region: 'West', tier: 'medium', units: 3, revenue: 300 },
]

describe('profileColumns', () => {
  const profiles = profileColumns(columns, rows)
  const p = (name: string) => profiles.find((x) => x.name === name)!

  it('maps date to temporal', () => {
    expect(p('month').level).toBe('temporal')
  })

  it('maps plain strings to nominal', () => {
    expect(p('region').level).toBe('nominal')
  })

  it('detects an ordinal scale (low/medium/high)', () => {
    expect(p('tier').level).toBe('ordinal')
  })

  it('maps numbers to quantitative and flags continuous when fractional', () => {
    expect(p('revenue').level).toBe('quantitative')
    expect(p('revenue').continuous).toBe(true)
  })

  it('treats a small integer column as discrete quantitative', () => {
    expect(p('units').level).toBe('quantitative')
    expect(p('units').continuous).toBe(false)
  })

  it('reports cardinality, range, and examples', () => {
    expect(p('region').distinct).toBe(2)
    expect(p('units').min).toBe(2)
    expect(p('units').max).toBe(5)
    expect(p('region').examples.length).toBeGreaterThan(0)
  })
})

describe('profileColumn — spread statistics', () => {
  const cols: Column[] = [
    { name: 'v', type: 'number' },
    { name: 'label', type: 'string' },
  ]
  // 1..10 → mean 5.5, population variance 8.25; sorted-interpolated q1 3.25, med 5.5, q3 7.75.
  const rows: Row[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ v: n, label: 'x' }))
  const profiles = profileColumns(cols, rows)
  const v = profiles.find((p) => p.name === 'v')!
  const label = profiles.find((p) => p.name === 'label')!

  it('computes exact mean and population stdDev (Welford)', () => {
    expect(v.mean).toBeCloseTo(5.5, 10)
    expect(v.stdDev).toBeCloseTo(Math.sqrt(8.25), 10)
  })

  it('computes quartiles + IQR (exact below the reservoir cap)', () => {
    expect(v.q1).toBeCloseTo(3.25, 10)
    expect(v.median).toBeCloseTo(5.5, 10)
    expect(v.q3).toBeCloseTo(7.75, 10)
    expect(v.iqr).toBeCloseTo(4.5, 10)
  })

  it('leaves spread stats undefined for non-numeric columns', () => {
    expect(label.mean).toBeUndefined()
    expect(label.iqr).toBeUndefined()
    expect(label.stdDev).toBeUndefined()
  })

  it('reports zero spread for a constant column', () => {
    const p = profileColumns([{ name: 'c', type: 'number' }], [{ c: 7 }, { c: 7 }, { c: 7 }])[0]
    expect(p.iqr).toBe(0)
    expect(p.stdDev).toBe(0)
  })
})
