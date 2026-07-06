/**
 * Core data model — plain, serializable DTOs shared across the pure lib and the
 * presentational components. No React, no Recharts, no DOM here.
 */

export type ColumnType = 'number' | 'string' | 'boolean' | 'date'

export interface Column {
  name: string
  type: ColumnType
}

/** A single cell value after coercion. `null` means missing/blank. */
export type Cell = string | number | boolean | null

/** One record, keyed by column name. */
export type Row = Record<string, Cell>

export interface DataSet {
  columns: Column[]
  rows: Row[]
}

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'scatter'

export type Aggregate = 'sum' | 'avg' | 'count' | 'none'

/** A fully-resolved instruction for what to draw. */
export interface ChartSpec {
  type: ChartType
  /** Category / horizontal field. */
  x: string
  /** Measure / vertical field. */
  y: string
  aggregate: Aggregate
}

export type FilterOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'

export interface Filter {
  id: string
  column: string
  op: FilterOp
  value: Cell
}

/** A single point ready for Recharts: `{ name, value }` (+ optional group keys). */
export interface ChartDatum {
  name: string | number
  value: number
  [series: string]: string | number
}
