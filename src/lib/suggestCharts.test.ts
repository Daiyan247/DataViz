import { describe, expect, it } from 'vitest'
import { chartKind, compatibilityBasis, suggestCharts, suggestForColumns, toSuggestion } from './suggestCharts'
import type { ColumnProfile, VizSpec } from './types'

const prof = (
  name: string,
  level: ColumnProfile['level'],
  extra: Partial<ColumnProfile> = {},
): ColumnProfile => ({
  name,
  storageType: level === 'quantitative' ? 'number' : level === 'temporal' ? 'date' : 'string',
  level,
  continuous: false,
  distinct: 5,
  count: 20,
  examples: [],
  ...extra,
})

const profiles: ColumnProfile[] = [
  prof('month', 'temporal'),
  prof('region', 'nominal', { distinct: 4 }),
  prof('units', 'quantitative'),
  prof('revenue', 'quantitative', { continuous: true, distinct: 50 }),
]

describe('suggestCharts', () => {
  const all = suggestCharts(profiles)
  const marks = new Set(all.map((s) => s.mark))

  it('only enumerates valid, ready-to-render specs', () => {
    expect(all.length).toBeGreaterThan(0)
    for (const s of all) {
      expect(s.spec.mark).toBe(s.mark)
      expect(s.spec.encoding).toBeTruthy()
    }
  })

  it('lists each chart TYPE at most once (types, not relationships)', () => {
    const kinds = all.map((s) => s.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
    // Labels are type names, not "field by field" relationships.
    expect(all.every((s) => !s.label.includes(' by '))).toBe(true)
  })

  it('offers bar, line (has a date), scatter (two measures) and pie (low-card category)', () => {
    expect(marks.has('bar')).toBe(true)
    expect(marks.has('line')).toBe(true)
    expect(marks.has('point')).toBe(true)
    expect(marks.has('arc')).toBe(true)
  })

  it('includes a histogram for a continuous measure', () => {
    const hist = all.find((s) => s.label.startsWith('Histogram'))
    expect(hist?.spec.encoding.x).toMatchObject({ field: 'revenue', bin: true })
  })

  it('offers a pie for a category even with many values (readability is warned, not hidden)', () => {
    const p = suggestCharts([prof('product', 'nominal', { distinct: 20 }), prof('price', 'quantitative')])
    expect(p.some((s) => s.kind === 'pie')).toBe(true)
  })

  it('offers a histogram for a discrete (non-continuous) numeric measure', () => {
    const p = suggestCharts([prof('rating', 'quantitative', { continuous: false, distinct: 5 })])
    expect(p.some((s) => s.kind === 'histogram')).toBe(true)
  })

  it('does NOT offer a line chart when there is no temporal column', () => {
    const noTime = suggestCharts([
      prof('region', 'nominal'),
      prof('revenue', 'quantitative', { continuous: true }),
    ])
    expect(noTime.some((s) => s.mark === 'line')).toBe(false)
  })

  it('does NOT offer a scatter with fewer than two measures', () => {
    const oneMeasure = suggestCharts([prof('region', 'nominal'), prof('revenue', 'quantitative')])
    // A dot plot also uses the `point` mark, so assert on the KIND, not the mark.
    expect(oneMeasure.some((s) => s.kind === 'scatter')).toBe(false)
  })

  it('re-ranks (not filters) by a partial query — the matching type floats first', () => {
    const pie = suggestCharts(profiles, 'pie')
    expect(pie[0].mark).toBe('arc')
    // The full set of available types is still present, just reordered.
    expect(pie.length).toBe(all.length)
  })

  it('surfaces box/histogram first for a distribution query', () => {
    const dist = suggestCharts(profiles, 'distribution')
    expect(['box', 'histogram']).toContain(dist[0].kind)
  })
})

describe('suggestForColumns — only types that use ALL named columns', () => {
  const kinds = (named: ColumnProfile[]) => suggestForColumns(named).map((s) => s.kind).sort()

  // Every suggestion must reference exactly the named columns (all, no extras).
  const usesExactly = (named: ColumnProfile[]) => {
    const want = new Set(named.map((p) => p.name))
    return suggestForColumns(named).every((s) => {
      const used = new Set(
        Object.values(s.spec.encoding)
          .map((e) => e?.field)
          .filter((f): f is string => Boolean(f)),
      )
      return used.size === want.size && [...want].every((n) => used.has(n))
    })
  }

  it('two high-cardinality quantitatives → scatter only (no bar/pie/histogram/bubble)', () => {
    const named = [prof('lat', 'quantitative', { distinct: 50 }), prof('lon', 'quantitative', { continuous: true, distinct: 80 })]
    expect(kinds(named)).toEqual(['scatter'])
    expect(usesExactly(named)).toBe(true)
  })

  it('two quantitatives where one is low-cardinality → also box, dot, strip (it groups the other)', () => {
    const named = [prof('discount', 'quantitative', { distinct: 5 }), prof('revenue', 'quantitative', { continuous: true, distinct: 80 })]
    expect(kinds(named)).toEqual(['box', 'dotplot', 'scatter', 'strip'])
    expect(usesExactly(named)).toBe(true)
  })

  it('one category + one measure → bar, box, dotplot, pie, strip (not scatter/histogram)', () => {
    const named = [prof('region', 'nominal'), prof('revenue', 'quantitative', { continuous: true })]
    expect(kinds(named)).toEqual(['bar', 'box', 'dotplot', 'pie', 'strip'])
    expect(usesExactly(named)).toBe(true)
  })

  it('a single quantitative → histogram, box, and strip', () => {
    expect(kinds([prof('revenue', 'quantitative', { continuous: true })])).toEqual(['box', 'histogram', 'strip'])
  })

  it('three quantitatives → bubble (uses all three)', () => {
    const named = [prof('a', 'quantitative'), prof('b', 'quantitative'), prof('c', 'quantitative')]
    expect(kinds(named)).toEqual(['bubble'])
    expect(usesExactly(named)).toBe(true)
  })

  it('one category + two quantitatives → scatter (coloured) and bubble, both using all three', () => {
    const named = [prof('region', 'nominal'), prof('units', 'quantitative'), prof('unit_price', 'quantitative')]
    expect(kinds(named)).toEqual(['bubble', 'scatter'])
    expect(usesExactly(named)).toBe(true)
  })

  it('two categories → bar and heatmap (both using both categories)', () => {
    const named = [prof('region', 'nominal'), prof('city', 'nominal')]
    expect(kinds(named)).toEqual(['bar', 'heatmap'])
    expect(usesExactly(named)).toBe(true)
  })
})

describe('strip & dot plots', () => {
  it('detects a strip plot (tick) and a Cleveland dot plot (point + category + aggregate)', () => {
    expect(chartKind({ mark: 'tick', encoding: { y: { field: 'revenue', type: 'quantitative' } } })).toBe('strip')
    expect(
      chartKind({ mark: 'point', encoding: { y: { field: 'region', type: 'nominal' }, x: { field: 'revenue', type: 'quantitative', aggregate: 'mean' } } }),
    ).toBe('dotplot')
    // a plain scatter (two raw numeric axes, no aggregate) is NOT a dot plot
    expect(chartKind({ mark: 'point', encoding: { x: { field: 'a', type: 'quantitative' }, y: { field: 'b', type: 'quantitative' } } })).toBe('scatter')
  })

  it('offers a strip plot for any measure and a Cleveland dot plot across a category', () => {
    const s = suggestCharts([prof('region', 'nominal', { distinct: 4 }), prof('revenue', 'quantitative', { continuous: true })])
    expect(s.some((x) => x.kind === 'strip' && x.mark === 'tick')).toBe(true)
    const dot = s.find((x) => x.kind === 'dotplot')
    expect(dot?.spec.encoding).toMatchObject({ y: { field: 'region' }, x: { field: 'revenue', aggregate: 'mean' } })
  })

  it('a strip plot works for a lone measure; a dot plot needs a category to compare', () => {
    const oneMeasure = suggestCharts([prof('revenue', 'quantitative', { continuous: true })])
    expect(oneMeasure.some((x) => x.kind === 'strip')).toBe(true)
    expect(oneMeasure.some((x) => x.kind === 'dotplot')).toBe(false)
  })
})

describe('toSuggestion — chip from an existing spec (keeps the original in the strip)', () => {
  it('recognizes a bubble (point + size) and preserves its spec', () => {
    const bubble: VizSpec = {
      mark: 'point',
      encoding: {
        x: { field: 'region', type: 'nominal' },
        y: { field: 'unit_price', type: 'quantitative' },
        size: { field: 'units', type: 'quantitative' },
      },
    }
    const s = toSuggestion(bubble, 'my bubble')
    expect(s.kind).toBe('bubble')
    expect(s.label).toBe('Bubble chart')
    expect(s.spec).toBe(bubble) // clicking restores the exact original
    expect(s.note).toBe('my bubble')
  })
})

describe('compatibilityBasis — columns the app resolved, not just the ones typed', () => {
  // world_population.json, the dataset behind the reported bug.
  const world: ColumnProfile[] = [
    prof('country', 'nominal', { distinct: 20, examples: ['China', 'India', 'Brazil'] }),
    prof('continent', 'nominal', { distinct: 6 }),
    prof('population_m', 'quantitative', { continuous: true, distinct: 20 }),
    prof('gdp_trillion', 'quantitative', { continuous: true, distinct: 20 }),
  ]
  // What "make me a world map of population_m" actually produces: the geographic
  // column is detected from the DATA, never typed by the user.
  const mapSpec: VizSpec = {
    mark: 'geoshape',
    encoding: {
      location: { field: 'country', type: 'nominal' },
      color: { field: 'population_m', type: 'quantitative', aggregate: 'sum' },
    },
  }
  // Text matching alone finds only population_m — "country" appears nowhere.
  const namedByText = [world[2]]

  it('adds the spec-resolved geo column the phrase never mentioned', () => {
    const basis = compatibilityBasis(namedByText, mapSpec, world).map((p) => p.name)
    expect(basis).toEqual(['country', 'population_m'])
  })

  it('offers per-country comparisons, including the bar that was missing', () => {
    const kinds = suggestForColumns(compatibilityBasis(namedByText, mapSpec, world)).map((s) => s.kind)
    expect(kinds).toContain('bar')
    expect(kinds).toContain('map')
    expect(kinds).toContain('pie')
    expect(kinds).toContain('dotplot')
  })

  it('splits box and strip BY COUNTRY rather than plotting a bare measure', () => {
    const out = suggestForColumns(compatibilityBasis(namedByText, mapSpec, world))
    for (const kind of ['box', 'strip'] as const) {
      const s = out.find((x) => x.kind === kind)
      expect(s, `${kind} should be offered`).toBeTruthy()
      expect(s!.spec.encoding.x?.field, `${kind} should be grouped by country`).toBe('country')
      expect(s!.spec.encoding.y?.field).toBe('population_m')
    }
  })

  it('drops the histogram, which ignores country and answers a different question', () => {
    const kinds = suggestForColumns(compatibilityBasis(namedByText, mapSpec, world)).map((s) => s.kind)
    expect(kinds).not.toContain('histogram')
  })

  it('regression: text-only matching produced the bad strip', () => {
    // The old behaviour, kept as a guard so the bug cannot quietly return.
    const old = suggestForColumns(namedByText).map((s) => s.kind).sort()
    expect(old).toEqual(['box', 'histogram', 'strip'])
    expect(old).not.toContain('bar')
  })

  it('generalizes: a bubble size column filled in server-side joins the basis', () => {
    const bubble: VizSpec = {
      mark: 'point',
      encoding: {
        x: { field: 'population_m', type: 'quantitative' },
        y: { field: 'gdp_trillion', type: 'quantitative' },
        size: { field: 'country', type: 'nominal' },
      },
    }
    const basis = compatibilityBasis([world[2]], bubble, world).map((p) => p.name)
    expect(basis).toEqual(['country', 'population_m', 'gdp_trillion'])
  })

  it('is a no-op when the phrase already named every column the spec uses', () => {
    const barSpec: VizSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'continent', type: 'nominal' },
        y: { field: 'population_m', type: 'quantitative', aggregate: 'sum' },
      },
    }
    const named = [world[1], world[2]]
    expect(compatibilityBasis(named, barSpec, world).map((p) => p.name)).toEqual(['continent', 'population_m'])
  })

  it('ignores count-only channels that carry no field', () => {
    const counted: VizSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'continent', type: 'nominal' },
        y: { type: 'quantitative', aggregate: 'count' },
      },
    }
    expect(compatibilityBasis([], counted, world).map((p) => p.name)).toEqual(['continent'])
  })
})
