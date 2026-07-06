import type { Cell, Filter, Row } from './types'

/**
 * Row filtering. Pure: `applyFilters` returns a new array; the original is never
 * mutated. Multiple filters combine with AND (every filter must pass).
 */

function compareNumbers(a: Cell, b: Cell): number | null {
  const x = typeof a === 'number' ? a : Number(a)
  const y = typeof b === 'number' ? b : Number(b)
  if (Number.isNaN(x) || Number.isNaN(y)) return null
  return x - y
}

function passes(row: Row, filter: Filter): boolean {
  const cell = row[filter.column]
  const { op, value } = filter

  switch (op) {
    case 'eq':
      return String(cell ?? '') === String(value ?? '')
    case 'neq':
      return String(cell ?? '') !== String(value ?? '')
    case 'contains':
      return String(cell ?? '')
        .toLowerCase()
        .includes(String(value ?? '').toLowerCase())
    case 'gt': {
      const d = compareNumbers(cell, value)
      return d !== null && d > 0
    }
    case 'gte': {
      const d = compareNumbers(cell, value)
      return d !== null && d >= 0
    }
    case 'lt': {
      const d = compareNumbers(cell, value)
      return d !== null && d < 0
    }
    case 'lte': {
      const d = compareNumbers(cell, value)
      return d !== null && d <= 0
    }
    default:
      return true
  }
}

/** Keep only rows that pass every filter (AND). Empty filter list → all rows. */
export function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  if (filters.length === 0) return rows
  return rows.filter((row) => filters.every((f) => passes(row, f)))
}

/** Distinct non-null values for a column, as strings — for building filter UIs. */
export function distinctValues(rows: Row[], column: string): string[] {
  const set = new Set<string>()
  for (const row of rows) {
    const v = row[column]
    if (v !== null && v !== undefined) set.add(String(v))
  }
  return [...set].sort()
}
