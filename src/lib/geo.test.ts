import { describe, expect, it } from 'vitest'
import { aggregateByRegion, analyzeMapCoverage, canonicalContinent, canonicalCountry, canonicalState, continentOf, deriveMapValue, detectDataGeo, detectGeoKind, detectMapScope, planGeo } from './geo'
import type { Column, ColumnProfile, Row, VizSpec } from './types'

const prof = (
  name: string,
  level: ColumnProfile['level'],
  examples: ColumnProfile['examples'],
): ColumnProfile => ({
  name,
  storageType: level === 'quantitative' ? 'number' : 'string',
  level,
  continuous: level === 'quantitative',
  distinct: examples.length,
  count: examples.length,
  examples,
})

describe('geo — name canonicalization', () => {
  it('folds country aliases to a shared key', () => {
    expect(canonicalCountry('USA')).toBe('united states')
    expect(canonicalCountry('United States of America')).toBe('united states')
    expect(canonicalCountry('U.K.')).toBe('united kingdom')
  })
  it('resolves US states by name and abbreviation', () => {
    expect(canonicalState('California')).toBe('california')
    expect(canonicalState('CA')).toBe('california')
    expect(canonicalState('Nowhere')).toBeNull()
  })
})

describe('geo — detection from profiles', () => {
  it('detects a country column → world', () => {
    const g = detectGeoKind([
      prof('country', 'nominal', ['United States', 'Germany', 'Japan', 'Brazil']),
      prof('revenue', 'quantitative', [1, 2, 3]),
    ])
    expect(g).toEqual({ mode: 'world', field: 'country' })
  })

  it('detects a US-state column → usa', () => {
    const g = detectGeoKind([prof('state', 'nominal', ['California', 'TX', 'New York'])])
    expect(g?.mode).toBe('usa')
    expect(g?.field).toBe('state')
  })

  it('prefers a country column over lat/long (maps are region-based, no poles)', () => {
    const g = detectGeoKind([
      prof('lat', 'quantitative', [40.7, 51.5]),
      prof('lon', 'quantitative', [-74, -0.1]),
      prof('country', 'nominal', ['United States', 'United Kingdom', 'France']),
    ])
    expect(g).toEqual({ mode: 'world', field: 'country' })
  })

  it('returns null for pure lat/long with no region column', () => {
    expect(detectGeoKind([prof('lat', 'quantitative', [1]), prof('lon', 'quantitative', [2])])).toBeNull()
  })

  it('returns null when nothing is geographic', () => {
    expect(detectGeoKind([prof('product', 'nominal', ['A', 'B', 'C'])])).toBeNull()
  })
})

describe('geo — planning + aggregation', () => {
  const columns: Column[] = [
    { name: 'country', type: 'string' },
    { name: 'revenue', type: 'number' },
  ]
  const rows: Row[] = [
    { country: 'United States', revenue: 100 },
    { country: 'usa', revenue: 50 },
    { country: 'Germany', revenue: 30 },
  ]

  it('plans a world choropleth from a geoshape spec', () => {
    const spec: VizSpec = {
      mark: 'geoshape',
      encoding: {
        location: { field: 'country', type: 'nominal' },
        color: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
      },
    }
    const plan = planGeo(spec, columns, rows)
    expect(plan?.mode).toBe('world')
    expect(plan?.locationField).toBe('country')
    expect(plan?.valueField).toBe('revenue')
    expect(plan?.aggregate).toBe('sum')
  })

  it('sums a measure per region, folding aliases together', () => {
    const agg = aggregateByRegion(rows, 'country', 'world', 'revenue', 'sum')
    expect(agg.get('united states')?.value).toBe(150) // "United States" + "usa"
    expect(agg.get('germany')?.value).toBe(30)
  })

  it('counts rows per region when there is no measure', () => {
    const agg = aggregateByRegion(rows, 'country', 'world', undefined, 'count')
    expect(agg.get('united states')?.value).toBe(2)
    expect(agg.get('germany')?.value).toBe(1)
  })

  it('does NOT shade regions unless the spec names a location column (opt-in)', () => {
    // A "map" request with no location field: a stray geo column must NOT auto-shade.
    const spec: VizSpec = { mark: 'geoshape', encoding: { color: { type: 'quantitative', aggregate: 'count' } } }
    expect(planGeo(spec, columns, rows)).toBeNull()
  })
})

describe('geo — map scope from the request', () => {
  it('reads the whole world', () => {
    expect(detectMapScope('world map')).toEqual({ kind: 'world' })
    expect(detectMapScope('show me the whole map')).toEqual({ kind: 'world' })
  })
  it('reads a continent', () => {
    expect(detectMapScope('map of Europe')).toEqual({ kind: 'continent', continent: 'Europe' })
    expect(detectMapScope('a map of south america please')).toEqual({ kind: 'continent', continent: 'South America' })
  })
  it('reads a specific country', () => {
    expect(detectMapScope('map of France')).toEqual({ kind: 'country', country: 'france' })
    expect(detectMapScope('map of the united states')).toEqual({ kind: 'country', country: 'united states' })
  })
  it('now knows countries the old hard-coded list lacked (from the library)', () => {
    // Croatia, Kazakhstan were not in the old ~120 list.
    expect(detectMapScope('map of Croatia')).toEqual({ kind: 'country', country: 'croatia' })
    expect(detectMapScope('map of Kazakhstan')).toEqual({ kind: 'country', country: 'kazakhstan' })
    // "Turkey" and "Türkiye" fold to the same canonical (reconcile alias + accents).
    expect(canonicalCountry('Turkey')).toBe(canonicalCountry('Türkiye'))
    expect(canonicalCountry('DR Congo')).toBe('democratic republic of the congo')
    expect(canonicalCountry('USA')).toBe('united states')
  })
  it('returns null for a bare/ambiguous map request (→ ask "map of what?")', () => {
    expect(detectMapScope('create a map')).toBeNull()
    expect(detectMapScope('show me a map')).toBeNull()
  })
  it('classifies a centroid into a continent (approximate)', () => {
    expect(continentOf(2, 47)).toBe('Europe') // France-ish
    expect(continentOf(-60, -15)).toBe('South America') // Brazil-ish
    expect(continentOf(135, 35)).toBe('Asia') // Japan-ish
  })
})

describe('geo — data coverage reasoning', () => {
  const stateCols: Column[] = [{ name: 'state', type: 'string' }, { name: 'sales', type: 'number' }]
  const stateRows: Row[] = [{ state: 'California', sales: 1 }, { state: 'Texas', sales: 2 }]
  const countryCols: Column[] = [{ name: 'country', type: 'string' }, { name: 'revenue', type: 'number' }]
  const euRows: Row[] = [{ country: 'Germany', revenue: 1 }, { country: 'France', revenue: 2 }]

  it('explains that Europe is not in US-states data', () => {
    const msg = analyzeMapCoverage({ kind: 'continent', continent: 'Europe' }, stateCols, stateRows)
    expect(msg?.message).toMatch(/US states/)
  })

  it('explains a country that is not in the data + lists what is', () => {
    const msg = analyzeMapCoverage({ kind: 'country', country: 'japan' }, countryCols, euRows)
    expect(msg?.message).toMatch(/Japan isn’t in your data/)
    expect(msg?.message).toMatch(/Europe/)
  })

  it('is silent when the place IS covered', () => {
    expect(analyzeMapCoverage({ kind: 'continent', continent: 'Europe' }, countryCols, euRows)).toBeNull()
    expect(analyzeMapCoverage({ kind: 'country', country: 'germany' }, countryCols, euRows)).toBeNull()
  })

  it('flags data with no geographic column', () => {
    const cols: Column[] = [{ name: 'product', type: 'string' }, { name: 'qty', type: 'number' }]
    const rows: Row[] = [{ product: 'A', qty: 1 }]
    expect(analyzeMapCoverage({ kind: 'country', country: 'france' }, cols, rows)?.message).toMatch(/no country or region column/)
  })

  it('does not reason about a plain world request', () => {
    expect(analyzeMapCoverage({ kind: 'world' }, countryCols, euRows)).toBeNull()
    expect(analyzeMapCoverage(null, countryCols, euRows)).toBeNull()
  })
})

describe('geo — value + world-for-measure shading', () => {
  const columns: Column[] = [{ name: 'country', type: 'string' }, { name: 'sales', type: 'number' }]
  const rows: Row[] = [{ country: 'United States', sales: 10 }, { country: 'Germany', sales: 5 }]

  it('derives the measure from the color channel', () => {
    const spec: VizSpec = { mark: 'geoshape', encoding: { color: { field: 'sales', type: 'quantitative', aggregate: 'sum' } } }
    expect(deriveMapValue(spec, columns)).toEqual({ valueField: 'sales', aggregate: 'sum', valueLabel: 'sum of sales' })
  })
  it('falls back to a count when no measure column is named', () => {
    const spec: VizSpec = { mark: 'geoshape', encoding: { color: { type: 'quantitative', aggregate: 'count' } } }
    expect(deriveMapValue(spec, columns)).toEqual({ valueField: undefined, aggregate: 'count', valueLabel: 'count' })
  })
  it('detects the country column in the data so "world for sales" can shade it', () => {
    // "map of the world for sales": spec has the measure but no location; the
    // data's country column is what gets shaded.
    expect(detectDataGeo(columns, rows)).toMatchObject({ field: 'country', mode: 'world' })
  })
})

describe('continents as a map geography', () => {
  const cprof = (name: string, examples: ColumnProfile['examples']): ColumnProfile => ({
    name,
    storageType: 'string',
    level: 'nominal',
    continuous: false,
    distinct: examples.length,
    count: examples.length,
    examples,
  })

  it('recognizes a continent column instead of rejecting it', () => {
    const g = detectGeoKind([cprof('continent', ['Asia', 'Europe', 'Africa', 'Oceania'])])
    expect(g).toEqual({ mode: 'continent', field: 'continent' })
  })

  it('accepts the UN "Americas" region that country libraries omit', () => {
    const g = detectGeoKind([cprof('continent', ['Asia', 'Americas', 'Europe'])])
    expect(g?.mode).toBe('continent')
    expect(canonicalContinent('Americas')).toBe('americas')
    expect(canonicalContinent('the Americas')).toBe('americas')
  })

  it('still prefers countries over continents when a column holds both kinds', () => {
    const g = detectGeoKind([cprof('place', ['Australia', 'Brazil', 'Japan', 'Kenya'])])
    expect(g?.mode).toBe('world')
  })

  it('is not fooled by ordinary categories', () => {
    expect(detectGeoKind([cprof('product', ['Widget', 'Gadget', 'Doohickey'])])).toBeNull()
  })

  it('paints a continent value onto every country it contains', () => {
    const rows = [
      { continent: 'Asia', gdp: 10 },
      { continent: 'Asia', gdp: 5 },
      { continent: 'Africa', gdp: 3 },
    ]
    const agg = aggregateByRegion(rows, 'continent', 'continent', 'gdp', 'sum')
    expect(agg.get('china')?.value).toBe(15)
    expect(agg.get('japan')?.value).toBe(15)
    expect(agg.get('kenya')?.value).toBe(3)
    expect(agg.get('france')).toBeUndefined()
    expect(agg.get('china')?.label).toBe('Asia')
  })

  it('spreads an "Americas" row across both American continents', () => {
    const agg = aggregateByRegion([{ region: 'Americas', v: 7 }], 'region', 'continent', 'v', 'sum')
    expect(agg.get('united states')?.value).toBe(7)
    expect(agg.get('brazil')?.value).toBe(7)
    expect(agg.get('china')).toBeUndefined()
  })

  it('averages per continent rather than per country', () => {
    const rows = [
      { c: 'Asia', v: 10 },
      { c: 'Asia', v: 20 },
    ]
    const agg = aggregateByRegion(rows, 'c', 'continent', 'v', 'mean')
    expect(agg.get('china')?.value).toBe(15)
  })

  it('plans a continent map from a spec naming that column', () => {
    const columns = [
      { name: 'continent', type: 'string' as const },
      { name: 'gdp', type: 'number' as const },
    ]
    const rows = [
      { continent: 'Asia', gdp: 1 },
      { continent: 'Europe', gdp: 2 },
    ]
    const spec: VizSpec = {
      mark: 'geoshape',
      encoding: {
        location: { field: 'continent', type: 'nominal' },
        color: { field: 'gdp', type: 'quantitative', aggregate: 'sum' },
      },
    }
    expect(planGeo(spec, columns, rows)).toMatchObject({
      mode: 'continent',
      locationField: 'continent',
      valueField: 'gdp',
      aggregate: 'sum',
    })
  })

  it('does not claim a continent is missing when the data covers it', () => {
    const columns = [{ name: 'continent', type: 'string' as const }]
    const rows = [{ continent: 'Americas' }, { continent: 'Asia' }]
    expect(analyzeMapCoverage({ kind: 'continent', continent: 'South America' }, columns, rows)).toBeNull()
    expect(analyzeMapCoverage({ kind: 'continent', continent: 'Asia' }, columns, rows)).toBeNull()
    const gap = analyzeMapCoverage({ kind: 'continent', continent: 'Europe' }, columns, rows)
    expect(gap?.message).toContain('Europe')
  })
})
