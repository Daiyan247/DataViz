import { describe, expect, it } from 'vitest'
import { parseChartRequest } from './parseChartRequest'
import type { Column } from './types'

const columns: Column[] = [
  { name: 'date', type: 'date' },
  { name: 'region', type: 'string' },
  { name: 'category', type: 'string' },
  { name: 'units', type: 'number' },
  { name: 'revenue', type: 'number' },
]

describe('parseChartRequest', () => {
  it('parses "bar chart of revenue by region"', () => {
    const { spec } = parseChartRequest('bar chart of revenue by region', columns)
    expect(spec).toEqual({ type: 'bar', x: 'region', y: 'revenue', aggregate: 'sum' })
  })

  it('parses "revenue over time as a line" using the date column', () => {
    const { spec } = parseChartRequest('revenue over time as a line', columns)
    expect(spec.type).toBe('line')
    expect(spec.x).toBe('date')
    expect(spec.y).toBe('revenue')
  })

  it('parses a pie share request', () => {
    const { spec } = parseChartRequest('share of units by category as a pie', columns)
    expect(spec.type).toBe('pie')
    expect(spec.x).toBe('category')
    expect(spec.y).toBe('units')
  })

  it('parses a scatter of two measures', () => {
    const { spec } = parseChartRequest('scatter of revenue vs units', columns)
    expect(spec.type).toBe('scatter')
    expect(spec.y).toBe('revenue')
    expect(spec.x).toBe('units')
    expect(spec.aggregate).toBe('none')
  })

  it('detects a count aggregate', () => {
    const { spec } = parseChartRequest('count of orders by region', columns)
    expect(spec.aggregate).toBe('count')
    expect(spec.x).toBe('region')
  })

  it('detects an average aggregate', () => {
    const { spec } = parseChartRequest('average revenue by category', columns)
    expect(spec.aggregate).toBe('avg')
  })

  it('falls back to defaults when nothing is recognized', () => {
    const { spec } = parseChartRequest('make me something nice', columns)
    expect(spec.type).toBe('bar')
    expect(spec.y).toBe('units') // first numeric column
    expect(spec.x).toBe('region') // first categorical column
  })

  it('always returns a note', () => {
    const { note } = parseChartRequest('revenue by region', columns)
    expect(note.length).toBeGreaterThan(0)
  })
})
