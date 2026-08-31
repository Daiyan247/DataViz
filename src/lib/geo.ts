import type { Aggregate, Column, ColumnProfile, Row, VizSpec } from './types'
import {
  COUNTRY_ALIASES,
  COUNTRY_CONTINENT,
  COUNTRY_SET,
  canonicalContinent,
  canonicalCountry,
  canonicalState,
  continentCountries,
  normName as norm,
} from './geoData'

/**
 * Geographic detection + matching for the map visualization. Everything here is
 * pure/data-only (no three.js, no DOM) so it can be unit-tested and reused by the
 * suggestions and warnings layers. The country/state/continent knowledge base
 * lives in the editable MD files behind `geoData.ts`.
 *
 * Four modes, auto-detected from the columns and their values:
 *   - world     : a column of COUNTRY names → world choropleth
 *   - continent : a column of CONTINENT / UN-region names → world choropleth shaded
 *                 per continent (each continent's value fills its member countries,
 *                 so it reuses the country atlas and needs no extra geometry)
 *   - usa       : a column of US STATE names/abbreviations → US choropleth
 *   - points    : explicit latitude + longitude columns → markers on a map
 */

// Re-export so existing `from './geo'` imports keep working.
export { canonicalContinent, canonicalCountry, canonicalState } from './geoData'

export type GeoMode = 'world' | 'continent' | 'usa' | 'points'

export interface GeoPlan {
  mode: GeoMode
  /** Region-name column (world/usa). */
  locationField?: string
  /** Lat/long columns (points). */
  latField?: string
  lonField?: string
  /** The measure to shade/size by; undefined → a plain row count. */
  valueField?: string
  aggregate: Exclude<Aggregate, 'median' | 'min' | 'max'> // sum | mean | count
  /** Human label for the value (e.g. "sum of revenue", "count"). */
  valueLabel: string
}

// ── Detection ────────────────────────────────────────────────────────────────

function fractionMatching(values: unknown[], test: (v: string) => boolean): number {
  const strs = values.map((v) => (v == null ? '' : String(v))).filter(Boolean)
  if (strs.length === 0) return 0
  const hits = strs.filter((s) => test(s)).length
  return hits / strs.length
}

/** Profile-only detection (uses `examples`) for suggestions + warnings. Maps are
 *  region-based (countries/states extruded) — a lat/long column is aggregated to
 *  its region column, so we look for a country/state column here. */
export function detectGeoKind(profiles: ColumnProfile[]): { mode: GeoMode; field: string } | null {
  const cats = profiles.filter((p) => p.level === 'nominal' || p.level === 'ordinal')
  let best: { mode: GeoMode; field: string; score: number } | null = null
  for (const c of cats) {
    // Score every geography the column could be and take the strongest reading, so
    // a country column is never mistaken for a continent one (or vice versa) — e.g.
    // "Australia" is a country name that also reads as a continent to a human.
    const scores: [GeoMode, number][] = [
      ['world', fractionMatching(c.examples, (s) => COUNTRY_SET.has(canonicalCountry(s)))],
      ['usa', fractionMatching(c.examples, (s) => canonicalState(s) != null)],
      ['continent', fractionMatching(c.examples, (s) => canonicalContinent(s) != null)],
    ]
    for (const [mode, score] of scores) {
      if (score >= 0.5 && (!best || score > best.score)) best = { mode, field: c.name, score }
    }
  }
  return best ? { mode: best.mode, field: best.field } : null
}

/** The measure to shade a map by, read from the spec's color channel (field +
 *  aggregate), or a plain count when no measure is named. */
export function deriveMapValue(
  spec: VizSpec,
  columns: Column[],
): { valueField?: string; aggregate: GeoPlan['aggregate']; valueLabel: string } {
  const names = columns.map((c) => c.name)
  const color = spec.encoding.color
  const valueField = color?.field && names.includes(color.field) ? color.field : undefined
  const aggregate: GeoPlan['aggregate'] =
    !valueField || color?.aggregate === 'count'
      ? 'count'
      : color?.aggregate === 'mean' || color?.aggregate === 'median'
        ? 'mean'
        : 'sum'
  const valueLabel = valueField ? `${aggregate} of ${valueField}` : 'count'
  return { valueField, aggregate, valueLabel }
}

/** Full plan from the spec + actual data (used by the renderer). */
export function planGeo(spec: VizSpec, columns: Column[], rows: Row[]): GeoPlan | null {
  const names = columns.map((c) => c.name)
  const sample = rows.slice(0, 200)
  const valuesOf = (field: string) => sample.map((r) => r[field])
  const { valueField, aggregate, valueLabel } = deriveMapValue(spec, columns)

  // Regions: shade ONLY when the request explicitly named a location column (so
  // the spec carries `location`). We do NOT auto-scan every column — a stray geo
  // column in the data (e.g. a "state" column) is never shaded unless the user
  // asked for it, e.g. "map of sales by state".
  const hint = spec.encoding.location?.field
  if (hint && names.includes(hint)) {
    const vals = valuesOf(hint)
    const country = fractionMatching(vals, (s) => COUNTRY_SET.has(canonicalCountry(s)))
    const state = fractionMatching(vals, (s) => canonicalState(s) != null)
    const continent = fractionMatching(vals, (s) => canonicalContinent(s) != null)
    if (state >= 0.4 && state >= country && state >= continent) return { mode: 'usa', locationField: hint, valueField, aggregate, valueLabel }
    if (country >= 0.4 && country >= continent) return { mode: 'world', locationField: hint, valueField, aggregate, valueLabel }
    if (continent >= 0.4) return { mode: 'continent', locationField: hint, valueField, aggregate, valueLabel }
  }
  return null
}

// ── Map scope (parsed from the request phrase) ───────────────────────────────────

export type MapScope =
  | { kind: 'world' }
  | { kind: 'continent'; continent: string }
  | { kind: 'country'; country: string }

const CONTINENT_ALIASES: Record<string, string> = {
  'north america': 'North America',
  'south america': 'South America',
  europe: 'Europe',
  africa: 'Africa',
  asia: 'Asia',
  oceania: 'Oceania',
  australasia: 'Oceania',
}

const WORLD_RE = /\b(world|globe|global|planet|earth|everywhere|all countries|whole)\b/

const hasWord = (haystack: string, needle: string) =>
  new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(haystack)

/**
 * Read the geographic scope the user asked for from the request phrase:
 * a continent, a specific country, the whole world, or null (unspecified → the
 * caller should ask "map of what?").
 */
export function detectMapScope(phrase: string): MapScope | null {
  const p = norm(phrase)
  if (!p) return null
  for (const key of Object.keys(CONTINENT_ALIASES)) {
    if (hasWord(p, key)) return { kind: 'continent', continent: CONTINENT_ALIASES[key] }
  }
  // Longest country/alias name that appears as a whole word wins.
  let best = ''
  const consider = (name: string) => {
    if (name.length > best.length && hasWord(p, name)) best = name
  }
  for (const name of COUNTRY_SET) consider(name)
  for (const alias of Object.keys(COUNTRY_ALIASES)) consider(alias)
  if (best) return { kind: 'country', country: canonicalCountry(best) }
  if (WORLD_RE.test(p)) return { kind: 'world' }
  return null
}

export interface DataGeo {
  field: string
  mode: GeoMode
  /** Canonical country/state keys present in the data. */
  values: Set<string>
}

/** Detect the best geographic column actually present in the data (independent of
 *  the request) — used to reason about coverage, NOT to auto-shade. */
export function detectDataGeo(columns: Column[], rows: Row[]): DataGeo | null {
  const names = columns.map((c) => c.name)
  const sample = rows.slice(0, 300)
  let best: { field: string; mode: GeoMode; score: number } | null = null
  for (const field of names) {
    const vals = sample.map((r) => r[field])
    const country = fractionMatching(vals, (s) => COUNTRY_SET.has(canonicalCountry(s)))
    const state = fractionMatching(vals, (s) => canonicalState(s) != null)
    const continent = fractionMatching(vals, (s) => canonicalContinent(s) != null)
    // Country data is the most specific, so it wins ties — a dataset carrying both
    // (country + continent) reasons about coverage at country level.
    if (country >= 0.4 && country >= state && country >= continent && (!best || country > best.score)) best = { field, mode: 'world', score: country }
    else if (state >= 0.4 && state >= continent && (!best || state > best.score)) best = { field, mode: 'usa', score: state }
    else if (continent >= 0.4 && (!best || continent > best.score)) best = { field, mode: 'continent', score: continent }
  }
  if (!best) return null
  const values = new Set<string>()
  for (const r of rows) {
    const raw = r[best.field]
    if (raw == null || raw === '') continue
    const key =
      best.mode === 'usa'
        ? canonicalState(String(raw))
        : best.mode === 'continent'
          ? canonicalContinent(String(raw))
          : canonicalCountry(String(raw))
    if (key) values.add(key)
  }
  return { field: best.field, mode: best.mode, values }
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

/** True when continent key `outer` fully contains `inner` (e.g. Americas ⊃ South
 *  America) — datasets and requests can name the world at different granularities. */
function isSupersetContinent(outer: string, inner: string): boolean {
  if (outer === inner) return true
  const o = continentCountries(outer)
  const i = continentCountries(inner)
  return i.size > 0 && o.size > i.size && [...i].every((c) => o.has(c))
}

function describeCoverage(geo: DataGeo): string {
  if (geo.mode === 'usa') return 'US states'
  if (geo.mode === 'continent') {
    const list = [...geo.values].map(titleCase)
    return list.length ? list.join(', ') : 'a few regions'
  }
  const conts = new Set<string>()
  for (const c of geo.values) {
    const k = COUNTRY_CONTINENT[c]
    if (k) conts.add(k)
  }
  const list = [...conts]
  return list.length ? list.join(', ') : 'a few countries'
}

/**
 * Reason about whether the DATA covers the place the user asked for. Checks the
 * prompt's geographic scope (continent/country) against the geo column actually
 * present in the data. Returns a plain-language explanation when there's a gap
 * (e.g. "Europe isn't in your data"), or null when it's covered / not applicable.
 */
export function analyzeMapCoverage(scope: MapScope | null, columns: Column[], rows: Row[]): { message: string } | null {
  if (!scope || scope.kind === 'world') return null // only reason about a specific place
  const place = scope.kind === 'country' ? titleCase(scope.country) : scope.continent
  const geo = detectDataGeo(columns, rows)

  if (!geo) {
    return { message: `Your data has no country or region column, so ${place} can’t be filled with your data — showing the base map only.` }
  }

  if (scope.kind === 'country') {
    if (geo.mode === 'usa') {
      if (scope.country === 'united states') return null
      return { message: `Your data is US states, not world countries — ${place} isn’t in it. Showing the base map only.` }
    }
    if (geo.mode === 'continent') {
      // Continent data can still cover a country — via the continent it belongs to.
      const home = COUNTRY_CONTINENT[scope.country]
      if (home && [...geo.values].some((v) => continentCountries(v).has(scope.country))) return null
      return { message: `Your data is by ${describeCoverage(geo)}, which doesn’t cover ${place}. Showing the base map only.` }
    }
    if (geo.values.has(scope.country)) return null
    return { message: `${place} isn’t in your data (your data covers ${describeCoverage(geo)}). Showing the base map only.` }
  }

  // continent
  if (geo.mode === 'usa') {
    return { message: `Your data is US states, not world countries, so ${place} isn’t in it. Showing the base map only.` }
  }
  if (geo.mode === 'continent') {
    const wanted = canonicalContinent(scope.continent)
    if (wanted && geo.values.has(wanted)) return null
    // An umbrella region in the data ("Americas") covers North/South America.
    if (wanted && [...geo.values].some((v) => isSupersetContinent(v, wanted))) return null
    return { message: `${place} isn’t in your data (your data covers ${describeCoverage(geo)}). Showing the base map only.` }
  }
  const inContinent = [...geo.values].some((c) => COUNTRY_CONTINENT[c] === scope.continent)
  if (inContinent) return null
  return { message: `${place} isn’t in your data (your data covers ${describeCoverage(geo)}). Showing the base map only.` }
}

/** Rough continent for a lon/lat centroid (approximate bounding boxes). */
export function continentOf(lon: number, lat: number): string | null {
  if (lat <= -60) return null // Antarctica (excluded from the atlas anyway)
  if (lon >= -82 && lon <= -34 && lat <= 13 && lat >= -56) return 'South America'
  if (lon >= -170 && lon <= -52 && lat >= 7) return 'North America'
  if (lon >= -25 && lon <= 45 && lat >= 34 && lat <= 72) return 'Europe'
  if (lon >= -20 && lon <= 52 && lat >= -37 && lat <= 37) return 'Africa'
  if ((lon >= 112 || lon <= -140) && lat >= -50 && lat <= 8) return 'Oceania'
  if (lon >= 25 && lat >= -12 && lat <= 82) return 'Asia'
  return null
}

// ── Aggregation ────────────────────────────────────────────────────────────────

export interface RegionValue {
  /** Canonical key used to match the atlas geometry. */
  key: string
  /** The label as it appeared in the data. */
  label: string
  value: number
}

/** Aggregate rows to a value per region key (canonical country/state name). */
export function aggregateByRegion(
  rows: Row[],
  locationField: string,
  mode: GeoMode,
  valueField: string | undefined,
  aggregate: GeoPlan['aggregate'],
): Map<string, RegionValue> {
  const acc = new Map<string, { label: string; sum: number; n: number }>()
  const keyOf = (raw: string) =>
    mode === 'usa' ? canonicalState(raw) : mode === 'continent' ? canonicalContinent(raw) : canonicalCountry(raw)
  for (const row of rows) {
    const raw = row[locationField]
    if (raw == null || raw === '') continue
    const label = String(raw)
    const key = keyOf(label)
    if (!key) continue
    const num = valueField ? Number(row[valueField]) : 1
    const add = valueField ? (Number.isFinite(num) ? num : 0) : 1
    const cur = acc.get(key) ?? { label, sum: 0, n: 0 }
    cur.sum += add
    cur.n += 1
    acc.set(key, cur)
  }
  const out = new Map<string, RegionValue>()
  for (const [key, v] of acc) {
    const value = aggregate === 'count' ? v.n : aggregate === 'mean' ? v.sum / Math.max(1, v.n) : v.sum
    if (mode === 'continent') {
      // The atlas has no continent geometry, so a continent's value is painted onto
      // every country it contains — the map keys stay country keys and the existing
      // country join, hover and flag logic all keep working untouched. The label
      // stays the continent as written in the data, so the region reads "Asia".
      for (const country of continentCountries(key)) {
        out.set(country, { key: country, label: v.label, value })
      }
    } else {
      out.set(key, { key, label: v.label, value })
    }
  }
  return out
}

export interface PointValue {
  lat: number
  lon: number
  value: number
  label: string
}

/** Collect lat/long points with an optional measure. */
export function collectPoints(
  rows: Row[],
  latField: string,
  lonField: string,
  valueField: string | undefined,
): PointValue[] {
  const out: PointValue[] = []
  for (const row of rows) {
    const lat = Number(row[latField])
    const lon = Number(row[lonField])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const v = valueField ? Number(row[valueField]) : 1
    out.push({ lat, lon, value: Number.isFinite(v) ? v : 1, label: valueField ? String(row[valueField]) : '' })
  }
  return out
}

// ── Geometry loading (lazy: keeps the atlas JSON out of the main bundle) ───────

export interface GeoFeature {
  name: string
  /** Outer rings only (holes ignored): list of rings, each a list of [lon, lat]. */
  rings: [number, number][][]
}

function toFeature(f: {
  properties?: { name?: string }
  id?: string | number
  geometry: { type: string; coordinates: unknown }
}): GeoFeature {
  const name = f.properties?.name ?? String(f.id ?? '')
  const rings: [number, number][][] = []
  const geom = f.geometry
  if (geom.type === 'Polygon') {
    const poly = geom.coordinates as [number, number][][]
    if (poly[0]) rings.push(poly[0])
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates as [number, number][][][]) {
      if (poly[0]) rings.push(poly[0])
    }
  }
  return { name, rings }
}

/** Load + featureize the bundled atlas for a mode. Dynamically imported. */
export async function loadGeometry(mode: GeoMode): Promise<GeoFeature[]> {
  const topojson = await import('topojson-client')
  if (mode === 'usa') {
    const topo = ((await import('us-atlas/states-10m.json')) as { default: unknown }).default as never
    const fc = topojson.feature(topo, (topo as { objects: { states: never } }).objects.states) as unknown as {
      features: Parameters<typeof toFeature>[0][]
    }
    return fc.features.map(toFeature)
  }
  const topo = ((await import('world-atlas/countries-110m.json')) as { default: unknown }).default as never
  const fc = topojson.feature(topo, (topo as { objects: { countries: never } }).objects.countries) as unknown as {
    features: Parameters<typeof toFeature>[0][]
  }
  return fc.features.map(toFeature).filter((f) => f.name !== 'Antarctica')
}

/** Canonical key for an atlas feature name, matching `aggregateByRegion` keys. */
export function featureKey(name: string, mode: GeoMode): string {
  return mode === 'usa' ? (canonicalState(name) ?? norm(name)) : canonicalCountry(name)
}

/** lon/lat centroid of a feature (average of all its ring vertices). */
export function featureCentroid(f: GeoFeature): [number, number] {
  let sx = 0
  let sy = 0
  let n = 0
  for (const ring of f.rings)
    for (const [lon, lat] of ring) {
      sx += lon
      sy += lat
      n += 1
    }
  return n ? [sx / n, sy / n] : [0, 0]
}

/** A GeoJSON feature carrying a joined value in its properties (for Vega-Lite). */
export interface RawFeature {
  type?: string
  properties: { name?: string; value?: number | null }
  geometry: unknown
}
export interface RawFeatureCollection {
  type?: string
  features: RawFeature[]
}

/** Full GeoJSON FeatureCollection (complete geometry, holes included) for the
 *  Vega-Lite 2D choropleth. Reuses the same dynamically-imported atlas chunks. */
export async function loadFeatureCollection(mode: GeoMode): Promise<RawFeatureCollection> {
  const topojson = await import('topojson-client')
  if (mode === 'usa') {
    const topo = ((await import('us-atlas/states-10m.json')) as { default: unknown }).default as never
    return topojson.feature(topo, (topo as { objects: { states: never } }).objects.states) as unknown as RawFeatureCollection
  }
  const topo = ((await import('world-atlas/countries-110m.json')) as { default: unknown }).default as never
  // Keep Antarctica: a printed world map shows it, and it gives the projection its
  // familiar full-height proportions. (The antimeridian is clipped at render time.)
  return topojson.feature(topo, (topo as { objects: { countries: never } }).objects.countries) as unknown as RawFeatureCollection
}
