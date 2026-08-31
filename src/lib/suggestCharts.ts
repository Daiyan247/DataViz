import type { Aggregate, ColumnProfile, Encoding, VegaMark, VizSpec } from './types'
import { detectGeoKind } from './geo'

/**
 * Deterministic chart recommender. Given the column profiles it enumerates which
 * VISUALIZATION TYPES are valid for this data — one entry per type (bar, line,
 * pie, scatter, histogram, box plot, heatmap, …), each with a representative,
 * ready-to-render VizSpec. It intentionally does NOT list different field
 * relationships (no "revenue by region" vs "revenue by category") — just the
 * distinct chart types available. Pure and unit-tested.
 */

export type ChartKind =
  | 'bar'
  | 'dotplot'
  | 'line'
  | 'area'
  | 'scatter'
  | 'bubble'
  | 'pie'
  | 'histogram'
  | 'box'
  | 'strip'
  | 'heatmap'
  | 'map'

export interface Suggestion {
  id: string
  /** Human name of the chart TYPE, shown on the chip (e.g. "Box plot"). */
  label: string
  kind: ChartKind
  mark: VegaMark
  spec: VizSpec
  /** Descriptive sentence (the representative mapping), used as the tooltip. */
  note: string
}

const KIND_LABEL: Record<ChartKind, string> = {
  bar: 'Bar chart',
  dotplot: 'Dot plot',
  line: 'Line chart',
  area: 'Area chart',
  scatter: 'Scatter plot',
  bubble: 'Bubble chart',
  pie: 'Pie chart',
  histogram: 'Histogram',
  box: 'Box plot',
  strip: 'Strip plot',
  heatmap: 'Heatmap',
  map: 'Map',
}

// Preferred display order when nothing else ranks them.
const KIND_ORDER: ChartKind[] = ['bar', 'dotplot', 'line', 'area', 'scatter', 'bubble', 'pie', 'histogram', 'box', 'strip', 'heatmap', 'map']

// A quantitative column with at most this many distinct values reads as an ordered
// grouping (discount rates, ratings, small counts), so it can split a box/strip/dot.
const GROUPING_MAX_DISTINCT = 12

// Words that should surface a given type when typed into the query.
const KIND_SYNONYMS: Record<ChartKind, string[]> = {
  bar: ['bar', 'column', 'compare', 'ranking'],
  dotplot: ['dot', 'dotplot', 'cleveland'],
  line: ['line', 'trend', 'time', 'over'],
  area: ['area', 'filled'],
  scatter: ['scatter', 'point', 'vs', 'versus', 'correlation', 'relationship'],
  bubble: ['bubble'],
  pie: ['pie', 'donut', 'share', 'proportion', 'composition'],
  histogram: ['histogram', 'distribution', 'frequency'],
  box: ['box', 'boxplot', 'spread', 'quartile', 'distribution'],
  strip: ['strip', 'ticks', 'individual', 'raw', 'jitter'],
  heatmap: ['heatmap', 'matrix'],
  map: ['map', 'choropleth', 'geographic', 'geo', 'country', 'countries', 'state', 'states', 'region'],
}

export function chartKind(spec: VizSpec): ChartKind {
  switch (spec.mark) {
    case 'bar':
      return spec.encoding.x?.bin ? 'histogram' : 'bar'
    case 'tick':
      return 'strip'
    case 'point':
    case 'circle': {
      if (spec.encoding.size) return 'bubble'
      // A Cleveland dot plot is a point mark with ONE categorical axis and an
      // aggregated measure (one dot per category) — as opposed to a scatter's two
      // raw quantitative axes.
      const xCat = Boolean(spec.encoding.x) && spec.encoding.x!.type !== 'quantitative'
      const yCat = Boolean(spec.encoding.y) && spec.encoding.y!.type !== 'quantitative'
      const aggregated = Boolean(spec.encoding.x?.aggregate || spec.encoding.y?.aggregate)
      if (xCat !== yCat && aggregated) return 'dotplot'
      return 'scatter'
    }
    case 'arc':
      return 'pie'
    case 'rect':
      return 'heatmap'
    case 'boxplot':
      return 'box'
    case 'geoshape':
      return 'map'
    case 'line':
      return 'line'
    case 'area':
      return 'area'
    default:
      return 'bar'
  }
}

const q = (field: string, aggregate?: Aggregate): Encoding => ({
  field,
  type: 'quantitative',
  ...(aggregate ? { aggregate } : {}),
})
const dim = (p: ColumnProfile): Encoding => ({ field: p.name, type: p.level })

/**
 * The distinct chart types valid for these columns, one representative spec each.
 * `query` (the partial request) only re-ranks the list — it never changes which
 * types are feasible.
 */
export function suggestCharts(profiles: ColumnProfile[], query = ''): Suggestion[] {
  const measures = profiles.filter((p) => p.level === 'quantitative')
  const continuous = measures.filter((p) => p.continuous)
  const cats = profiles.filter((p) => p.level === 'nominal' || p.level === 'ordinal')
  const temporals = profiles.filter((p) => p.level === 'temporal')

  const primaryMeasure = continuous[0] ?? measures[0]
  const primaryCat = cats[0]
  const byKind = new Map<ChartKind, Suggestion>()

  const add = (mark: VegaMark, encoding: VizSpec['encoding'], note: string) => {
    const spec: VizSpec = { mark, encoding }
    const kind = chartKind(spec)
    if (byKind.has(kind)) return // one entry per TYPE
    byKind.set(kind, { id: kind, label: KIND_LABEL[kind], kind, mark, spec, note })
  }

  // Bar — a measure summed by a category (or a count when there's no measure).
  if (primaryCat) {
    if (primaryMeasure) {
      add('bar', { x: dim(primaryCat), y: q(primaryMeasure.name, 'sum') }, `Total ${primaryMeasure.name} by ${primaryCat.name}.`)
    } else {
      add('bar', { x: dim(primaryCat), y: { type: 'quantitative', aggregate: 'count' } }, `Count by ${primaryCat.name}.`)
    }
  }

  // Line / area — a measure over time.
  if (temporals[0] && primaryMeasure) {
    add('line', { x: dim(temporals[0]), y: q(primaryMeasure.name, 'sum') }, `${primaryMeasure.name} over ${temporals[0].name}.`)
    add('area', { x: dim(temporals[0]), y: q(primaryMeasure.name, 'sum') }, `${primaryMeasure.name} over ${temporals[0].name}.`)
  }

  // Scatter / bubble — two (or three) quantitative fields.
  if (measures.length >= 2) {
    add('point', { x: q(measures[0].name), y: q(measures[1].name) }, `${measures[1].name} vs ${measures[0].name}.`)
  }
  if (measures.length >= 3) {
    add('point', { x: q(measures[0].name), y: q(measures[1].name), size: q(measures[2].name) }, `${measures[1].name} vs ${measures[0].name}, sized by ${measures[2].name}.`)
  }

  // Pie — a measure split across ANY category. High cardinality is flagged by
  // the warnings layer (too many slices), not hidden here — every compatible
  // type should be offered.
  if (primaryMeasure && primaryCat) {
    add('arc', { theta: q(primaryMeasure.name, 'sum'), color: dim(primaryCat) }, `Share of ${primaryMeasure.name} by ${primaryCat.name}.`)
  }

  // Histogram — distribution of any numeric measure (binned).
  if (primaryMeasure) {
    add('bar', { x: { field: primaryMeasure.name, type: 'quantitative', bin: true }, y: { type: 'quantitative', aggregate: 'count' } }, `Distribution of ${primaryMeasure.name}.`)
  }

  // Box plot — spread of a measure across a category.
  if (primaryMeasure && primaryCat) {
    add('boxplot', { x: dim(primaryCat), y: q(primaryMeasure.name) }, `Spread of ${primaryMeasure.name} by ${primaryCat.name}.`)
  }

  // Strip plot — every raw value as a tick (a small-sample-friendly distribution
  // view; unlike a box plot it hides nothing and shows the real sample size).
  if (primaryMeasure) {
    const stripEnc: VizSpec['encoding'] = { y: q(primaryMeasure.name) }
    if (primaryCat) stripEnc.x = dim(primaryCat)
    add('tick', stripEnc, primaryCat ? `Every ${primaryMeasure.name} value by ${primaryCat.name}.` : `Every ${primaryMeasure.name} value.`)
  }

  // Dot plot (Cleveland) — the average of a measure per category, as dots on a
  // line; a lighter-ink comparison than a bar, good for many categories.
  if (primaryMeasure && primaryCat) {
    add('point', { y: dim(primaryCat), x: q(primaryMeasure.name, 'mean') }, `Average ${primaryMeasure.name} by ${primaryCat.name}.`)
  }

  // Heatmap — two categories counted.
  if (cats.length >= 2) {
    add('rect', { x: dim(cats[0]), y: dim(cats[1]), color: { type: 'quantitative', aggregate: 'count' } }, `Counts across ${cats[0].name} and ${cats[1].name}.`)
  }

  // Map — a measure (or count) shaded across a geographic column (countries or US
  // states). Offered only when such a column is detected.
  const geo = detectGeoKind(profiles)
  if (geo) {
    const color: Encoding = primaryMeasure ? q(primaryMeasure.name, 'sum') : { type: 'quantitative', aggregate: 'count' }
    const measureName = primaryMeasure ? primaryMeasure.name : 'count'
    const loc = profiles.find((p) => p.name === geo.field)
    if (loc) add('geoshape', { location: dim(loc), color }, `${measureName} by ${loc.name} on a map.`)
  }

  const list = KIND_ORDER.map((k) => byKind.get(k)).filter((s): s is Suggestion => Boolean(s))
  return rank(list, query)
}

/**
 * The chart types compatible with an EXACT set of columns the user named: a type
 * is included only if it can incorporate ALL of them and adds no other column.
 * (e.g. two quantitative columns → only a scatter; a category + measure → bar,
 * pie, box; three quantitatives → bubble.) Specs are built from exactly these
 * columns. Returns [] when no single chart uses all of them.
 */
export function suggestForColumns(named: ColumnProfile[]): Suggestion[] {
  const quant = named.filter((p) => p.level === 'quantitative')
  const cats = named.filter((p) => p.level === 'nominal' || p.level === 'ordinal')
  const temps = named.filter((p) => p.level === 'temporal')
  const dims = [...cats, ...temps] // non-quantitative dimensions
  const n = named.length
  const byKind = new Map<ChartKind, Suggestion>()

  const add = (mark: VegaMark, encoding: VizSpec['encoding'], note: string) => {
    const spec: VizSpec = { mark, encoding }
    const kind = chartKind(spec)
    if (!byKind.has(kind)) byKind.set(kind, { id: kind, label: KIND_LABEL[kind], kind, mark, spec, note })
  }
  const count = (): Encoding => ({ type: 'quantitative', aggregate: 'count' })

  // Scatter — two quantitative axes (+ optional one dimension as colour).
  if (quant.length === 2 && dims.length <= 1 && quant.length + dims.length === n) {
    const enc: VizSpec['encoding'] = { x: q(quant[0].name), y: q(quant[1].name) }
    if (dims.length === 1) enc.color = dim(dims[0])
    add('point', enc, `${quant[1].name} vs ${quant[0].name}.`)
  }

  // Two bare quantitatives where one is LOW-cardinality: that column reads as an
  // ordered GROUPING (e.g. discount rates, ratings), so a box / strip / dot plot
  // of the other measure is also valid — matching the deterministic mapper's
  // "boxplot of discount vs revenue". Without this the distribution/comparison
  // types never reach the compatibility strip for a numeric-vs-numeric request.
  if (quant.length === 2 && dims.length === 0 && n === 2) {
    const [group, measure] = quant[0].distinct <= quant[1].distinct ? [quant[0], quant[1]] : [quant[1], quant[0]]
    if (group.distinct <= GROUPING_MAX_DISTINCT) {
      const gx: Encoding = { field: group.name, type: 'ordinal' }
      add('boxplot', { x: gx, y: q(measure.name) }, `Spread of ${measure.name} by ${group.name}.`)
      add('tick', { x: gx, y: q(measure.name) }, `Every ${measure.name} value by ${group.name}.`)
      add('point', { y: gx, x: q(measure.name, 'mean') }, `Average ${measure.name} by ${group.name}.`)
    }
  }

  // Bubble — exactly three columns with at least two quantitative (y + size).
  if (n === 3 && quant.length >= 2) {
    const [xCol, yCol, sizeCol] =
      quant.length === 3 ? [quant[0], quant[1], quant[2]] : [dims[0], quant[0], quant[1]]
    const enc: VizSpec['encoding'] = {
      x: xCol.level === 'quantitative' ? q(xCol.name) : dim(xCol),
      y: q(yCol.name),
      size: q(sizeCol.name),
    }
    add('point', enc, `${yCol.name} vs ${xCol.name}, sized by ${sizeCol.name}.`)
  }

  // Bar — a measure (or count) across one or two dimensions.
  if (quant.length <= 1 && dims.length >= 1 && dims.length <= 2 && quant.length + dims.length === n) {
    const enc: VizSpec['encoding'] = { x: dim(dims[0]), y: quant.length ? q(quant[0].name, 'sum') : count() }
    if (dims.length === 2) enc.color = dim(dims[1])
    add('bar', enc, quant.length ? `${quant[0].name} by ${dims.map((d) => d.name).join(' & ')}.` : `Count by ${dims[0].name}.`)
  }

  // Line & area — a measure over a temporal axis (+ optional one category).
  if (temps.length === 1 && quant.length === 1 && cats.length <= 1 && n === 2 + cats.length) {
    const base: VizSpec['encoding'] = { x: dim(temps[0]), y: q(quant[0].name, 'sum') }
    if (cats.length === 1) base.color = dim(cats[0])
    add('line', { ...base }, `${quant[0].name} over ${temps[0].name}.`)
    add('area', { ...base }, `${quant[0].name} over ${temps[0].name}.`)
  }

  // Pie — one measure split across one category.
  if (quant.length === 1 && cats.length === 1 && temps.length === 0 && n === 2) {
    add('arc', { theta: q(quant[0].name, 'sum'), color: dim(cats[0]) }, `Share of ${quant[0].name} by ${cats[0].name}.`)
  }

  // Histogram — exactly one quantitative column.
  if (n === 1 && quant.length === 1) {
    add('bar', { x: { field: quant[0].name, type: 'quantitative', bin: true }, y: count() }, `Distribution of ${quant[0].name}.`)
  }

  // Box plot — one measure, optionally split by one dimension.
  if (quant.length === 1 && dims.length <= 1 && 1 + dims.length === n) {
    const enc: VizSpec['encoding'] = { y: q(quant[0].name) }
    if (dims.length === 1) enc.x = dim(dims[0])
    add('boxplot', enc, dims.length ? `Spread of ${quant[0].name} by ${dims[0].name}.` : `Spread of ${quant[0].name}.`)
  }

  // Strip plot — one measure, optionally split by one dimension (raw values).
  if (quant.length === 1 && dims.length <= 1 && 1 + dims.length === n) {
    const enc: VizSpec['encoding'] = { y: q(quant[0].name) }
    if (dims.length === 1) enc.x = dim(dims[0])
    add('tick', enc, dims.length ? `Every ${quant[0].name} value by ${dims[0].name}.` : `Every ${quant[0].name} value.`)
  }

  // Dot plot (Cleveland) — the average of one measure across one category.
  if (quant.length === 1 && cats.length === 1 && temps.length === 0 && n === 2) {
    add('point', { y: dim(cats[0]), x: q(quant[0].name, 'mean') }, `Average ${quant[0].name} by ${cats[0].name}.`)
  }

  // Heatmap — two dimensions, optionally coloured by one measure.
  if (dims.length === 2 && quant.length <= 1 && 2 + quant.length === n) {
    const color = quant.length ? q(quant[0].name, 'sum') : count()
    add('rect', { x: dim(dims[0]), y: dim(dims[1]), color }, `${dims[0].name} × ${dims[1].name}.`)
  }

  // Map — a geographic column (+ optionally one measure), using ALL named columns.
  const geo = detectGeoKind(named)
  if (geo) {
    const loc = named.find((p) => p.name === geo.field)
    const others = named.filter((p) => p.name !== geo.field)
    const measure = others.find((p) => p.level === 'quantitative')
    if (loc && (others.length === 0 || (others.length === 1 && measure))) {
      const color = measure ? q(measure.name, 'sum') : count()
      add('geoshape', { location: dim(loc), color }, measure ? `${measure.name} by ${loc.name} on a map.` : `Count by ${loc.name} on a map.`)
    }
  }

  return KIND_ORDER.map((k) => byKind.get(k)).filter((s): s is Suggestion => Boolean(s))
}

/**
 * The columns a spec ACTUALLY encodes, as profiles.
 *
 * The request text is not a complete account of what a chart is about: the app
 * resolves columns the user never typed — a map's geographic column detected from
 * the data ("world map of population_m" → country), a bubble's third field filled
 * in server-side, a channel the backend completes. The finished spec is the only
 * honest record of which columns are in play, so compatibility is derived from it
 * rather than from what the phrase happened to mention.
 */
export function specColumns(spec: VizSpec, profiles: ColumnProfile[]): ColumnProfile[] {
  const fields = new Set<string>()
  for (const enc of Object.values(spec.encoding)) {
    if (enc?.field) fields.add(enc.field)
  }
  return profiles.filter((p) => fields.has(p.name))
}

/** The named columns plus any the spec resolved on the user's behalf, de-duped and
 *  kept in dataset order — the true basis for "what else can show this data?". */
export function compatibilityBasis(
  named: ColumnProfile[],
  spec: VizSpec | null,
  profiles: ColumnProfile[],
): ColumnProfile[] {
  if (!spec) return named
  const inBasis = new Set(named.map((p) => p.name))
  for (const p of specColumns(spec, profiles)) inBasis.add(p.name)
  return profiles.filter((p) => inBasis.has(p.name))
}

/** Build a chip (Suggestion) from an existing spec — used to keep the chart the
 *  user is viewing / originally asked for present in the compatible strip. */
export function toSuggestion(spec: VizSpec, note?: string): Suggestion {
  const kind = chartKind(spec)
  return { id: kind, label: KIND_LABEL[kind], kind, mark: spec.mark, spec, note: note ?? KIND_LABEL[kind] }
}

/** Reorder the type list by a partial query, autocomplete-style. */
function rank(suggestions: Suggestion[], query: string): Suggestion[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return suggestions

  const scored = suggestions.map((s, i) => {
    const syn = KIND_SYNONYMS[s.kind]
    let score = 0
    for (const t of tokens) {
      if (syn.some((w) => w.startsWith(t) || t.startsWith(w))) score += 3
      if (s.label.toLowerCase().includes(t)) score += 1
    }
    return { s, score, i }
  })

  // Stable sort: higher score first, otherwise keep the default order.
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((x) => x.s)
}
