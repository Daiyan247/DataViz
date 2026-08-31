/**
 * Core data model — plain, serializable DTOs shared across the pure lib and the
 * presentational components. No React, no Vega, no DOM here.
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

// ── Column profiling ─────────────────────────────────────────────────────────

/**
 * Measurement level (statistical "kind of variable"), richer than the storage
 * type. This is what lets the LLM choose sensible charts and what the warnings
 * layer reasons over.
 *   - nominal      : unordered categories (region, product)
 *   - ordinal      : ordered categories (low/medium/high) — we only mark this
 *                    when detectable; otherwise categorical data is nominal
 *   - quantitative : numeric measures (revenue, temperature, counts)
 *   - temporal     : dates / times
 */
export type MeasurementLevel = 'nominal' | 'ordinal' | 'quantitative' | 'temporal'

export interface ColumnProfile {
  name: string
  storageType: ColumnType
  level: MeasurementLevel
  /** For quantitative columns: continuous (real-valued) vs discrete (counts/integers). */
  continuous: boolean
  /** Distinct non-null values (capped during counting). */
  distinct: number
  /** Total non-null values scanned. */
  count: number
  min?: number
  max?: number
  /**
   * Spread statistics for numeric columns (undefined for non-numeric). `mean` and
   * `stdDev` are exact (Welford, single streaming pass); the quartiles `q1`/
   * `median`/`q3` and `iqr` are exact when the column fits the reservoir cap and
   * an unbiased sampled estimate above it. Used to judge whether a box plot has
   * enough spread/observations to be meaningful.
   */
  mean?: number
  median?: number
  q1?: number
  q3?: number
  iqr?: number
  stdDev?: number
  /** A few example values, for the model to ground on. */
  examples: Cell[]
}

// ── Visualization spec (Vega-Lite) ───────────────────────────────────────────

/** Vega-Lite encoding data types — the variable-type system baked into the grammar. */
export type VegaType = 'quantitative' | 'nominal' | 'ordinal' | 'temporal'

/** The subset of Vega-Lite marks we expose. `geoshape` is our map type — it is
 *  rendered by a dedicated three.js MapView, not by Vega-Lite. */
export type VegaMark =
  | 'bar'
  | 'line'
  | 'area'
  | 'point'
  | 'circle'
  | 'tick'
  | 'arc'
  | 'rect'
  | 'boxplot'
  | 'geoshape'

export type Aggregate = 'sum' | 'mean' | 'median' | 'min' | 'max' | 'count'

/** One encoding channel — mirrors a Vega-Lite field definition. */
export interface Encoding {
  /** Column name. Omitted only when `aggregate` is "count". */
  field?: string
  type: VegaType
  aggregate?: Aggregate
  /** Bin a quantitative field (histograms). */
  bin?: boolean
}

/**
 * A resolved chart request. `encoding` is a Vega-Lite encoding object, so it maps
 * straight onto the grammar — the renderer just injects the data and theme.
 */
export interface VizSpec {
  mark: VegaMark
  encoding: {
    x?: Encoding
    y?: Encoding
    color?: Encoding
    size?: Encoding
    /** Angular extent for pie/donut (arc mark). */
    theta?: Encoding
    /** Map (geoshape): the region-name column (country/state). */
    location?: Encoding
    /** Map (geoshape): explicit latitude/longitude columns for point maps. */
    latitude?: Encoding
    longitude?: Encoding
  }
}

/** What the backend returns for a request. */
export interface VizResult {
  spec: VizSpec
  note: string
  /** Optional chart-advice line — e.g. explaining a fallback (a dot plot with no
   *  category rendered as a scatter instead). Shown in the advice panel. */
  notice?: string
}

// ── Filters ───────────────────────────────────────────────────────────────────

export type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'

export interface Filter {
  id: string
  column: string
  op: FilterOp
  value: Cell
}
