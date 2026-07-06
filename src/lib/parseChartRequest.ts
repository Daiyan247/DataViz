import type { Aggregate, ChartSpec, ChartType, Column } from './types'

/**
 * Deterministic natural-language → ChartSpec parser. No LLM: keyword matching is
 * testable, offline, and instant. It reads the request text plus the dataset's
 * columns and resolves the chart type, x/y fields, and aggregation.
 *
 * Examples it understands:
 *   "bar chart of revenue by region"      → bar,  x=region,  y=revenue, sum
 *   "revenue over time as a line"          → line, x=<date>,  y=revenue, sum
 *   "share of units by category as a pie"  → pie,  x=category,y=units,   sum
 *   "scatter of revenue vs units"          → scatter, x=units, y=revenue, none
 *   "count of orders by region"            → bar,  x=region,  y=<any>,   count
 */

export interface ChartRequestResult {
  spec: ChartSpec
  note: string
}

const TYPE_KEYWORDS: Array<{ type: ChartType; words: RegExp }> = [
  { type: 'pie', words: /\b(pie|donut|doughnut|share|proportion|breakdown|split)\b/ },
  { type: 'scatter', words: /\b(scatter|correlat|relationship|vs\.?|versus|against)\b/ },
  { type: 'area', words: /\b(area|stacked area|filled)\b/ },
  { type: 'line', words: /\b(line|trend|trendline|over time|time series|timeseries)\b/ },
  { type: 'bar', words: /\b(bar|column|histogram|ranking|rank|compare|comparison)\b/ },
]

const CONNECTIVES = [
  { word: 'by', re: /\bby\b/ },
  { word: 'per', re: /\bper\b/ },
  { word: 'across', re: /\bacross\b/ },
  { word: 'over', re: /\bover\b/ },
  { word: 'against', re: /\bagainst\b/ },
  { word: 'versus', re: /\bversus\b/ },
  { word: 'vs', re: /\bvs\.?\b/ },
]

function detectType(text: string): ChartType {
  for (const { type, words } of TYPE_KEYWORDS) {
    if (words.test(text)) return type
  }
  return 'bar'
}

function detectAggregate(text: string): Aggregate | null {
  if (/\b(count|number of|how many|frequency|tally)\b/.test(text)) return 'count'
  if (/\b(average|avg|mean)\b/.test(text)) return 'avg'
  if (/\b(sum|total|totals|combined)\b/.test(text)) return 'sum'
  return null
}

interface Mention {
  column: Column
  index: number
}

function findMentions(text: string, columns: Column[]): Mention[] {
  const hits: Mention[] = []
  for (const column of columns) {
    const name = column.name.toLowerCase()
    const variants = new Set([
      name,
      name.replace(/[_\s]+/g, ' '),
      name.replace(/[_\s]+/g, ''),
    ])
    let best = -1
    for (const v of variants) {
      if (!v) continue
      const idx = text.indexOf(v)
      if (idx >= 0 && (best < 0 || idx < best)) best = idx
    }
    if (best >= 0) hits.push({ column, index: best })
  }
  return hits.sort((a, b) => a.index - b.index)
}

function firstConnective(text: string): { word: string; index: number } | null {
  let best: { word: string; index: number } | null = null
  for (const { word, re } of CONNECTIVES) {
    const m = re.exec(text)
    if (m && (best === null || m.index < best.index)) best = { word, index: m.index }
  }
  return best
}

const isNumeric = (c: Column) => c.type === 'number'
const isCategoryish = (c: Column) => c.type !== 'number'

/**
 * Resolve a chart request against a dataset. Always returns a usable spec:
 * unresolved fields fall back to sensible defaults (first numeric measure, first
 * date/category dimension), and `note` explains what was understood.
 */
export function parseChartRequest(request: string, columns: Column[]): ChartRequestResult {
  const text = request.toLowerCase().trim()
  const type = detectType(text)
  const mentions = findMentions(text, columns)
  const connective = firstConnective(text)

  const numericCols = columns.filter(isNumeric)
  const dateCols = columns.filter((c) => c.type === 'date')
  const categoryCols = columns.filter(isCategoryish)

  let x: Column | undefined
  let y: Column | undefined

  if (connective && mentions.length) {
    const left = [...mentions].reverse().find((m) => m.index < connective.index)
    const right = mentions.find((m) => m.index > connective.index)
    if (connective.word === 'vs' || connective.word === 'versus' || connective.word === 'against') {
      // "A vs B" → y = A (left), x = B (right)
      y = left?.column
      x = right?.column
    } else {
      // "measure by/per/over/across dimension" → y = left, x = right
      y = left?.column
      x = right?.column
    }
  }

  // Fill measure (y): prefer a numeric mention, then a numeric column.
  if (!y || (type !== 'scatter' && !isNumeric(y))) {
    const numericMention = mentions.find((m) => isNumeric(m.column))
    y = y && isNumeric(y) ? y : (numericMention?.column ?? numericCols[0] ?? columns[0])
  }

  // Fill dimension (x): prefer an explicit category/date mention, then a date
  // column (for line/area), then the first category column, then any column ≠ y.
  if (!x) {
    const catMention = mentions.find((m) => isCategoryish(m.column) && m.column.name !== y?.name)
    const plainCat = columns.find(
      (c) => (c.type === 'string' || c.type === 'boolean') && c.name !== y?.name,
    )
    if (catMention) x = catMention.column
    else if (type === 'line' || type === 'area') x = dateCols[0] ?? plainCat ?? categoryCols[0]
    else x = plainCat ?? dateCols[0] ?? categoryCols[0]
  }
  if (!x) x = columns.find((c) => c.name !== y?.name) ?? columns[0]

  // For scatter both axes want a measure; fall back to two distinct numerics.
  if (type === 'scatter') {
    if (!x || !isNumeric(x)) x = numericCols.find((c) => c.name !== y?.name) ?? x ?? columns[0]
  }

  const explicitAgg = detectAggregate(text)
  let aggregate: Aggregate
  if (type === 'scatter') aggregate = 'none'
  else if (explicitAgg) aggregate = explicitAgg
  else aggregate = y && isNumeric(y) ? 'sum' : 'count'

  const spec: ChartSpec = {
    type,
    x: x?.name ?? '',
    y: y?.name ?? '',
    aggregate,
  }

  const aggLabel = aggregate === 'none' ? '' : `${aggregate} of `
  const note =
    type === 'scatter'
      ? `Scatter of ${spec.y} vs ${spec.x}.`
      : `${cap(type)} chart: ${aggLabel}${spec.y} by ${spec.x}.`

  return { spec, note }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
