import { describe, expect, it } from 'vitest'
import { chartDigest } from './chartDigest'
import type {
  CompositionTrend,
  DistributionTrend,
  MatrixTrend,
  RankingTrend,
  RelationshipTrend,
  SeriesTrend,
  SpreadTrend,
} from './chartDigest'
import type { Row, VizSpec } from './types'

/**
 * The `trend` block is the evidence for the ONE pattern each chart type exists to
 * reveal — the thing the conclusion guide tells the model to lead with. If a chart
 * type's signature statistic isn't computed here, the prompt asks for a claim the
 * payload can't support, which is how an analysis ends up inventing numbers. So each
 * chart type gets a test that its own signature evidence is present and correct.
 */

describe('series trend (line / area)', () => {
  const rows: Row[] = [
    { month: '2024-01', revenue: 100 },
    { month: '2024-02', revenue: 120 },
    { month: '2024-03', revenue: 90 },
    { month: '2024-04', revenue: 200 },
  ]
  const spec: VizSpec = {
    mark: 'line',
    encoding: {
      x: { field: 'month', type: 'temporal' },
      y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
    },
  }

  it('orders points by the X AXIS, not by value', () => {
    // The groups list is sorted by magnitude; a trend needs time order or there is
    // no trend to read. This is the distinction that makes a line chart analysable.
    const t = chartDigest(spec, rows).trend as SeriesTrend
    expect(t.shape).toBe('series')
    expect(t.points.map((p) => p.label)).toEqual(['2024-01', '2024-02', '2024-03', '2024-04'])
    expect(chartDigest(spec, rows).groups?.map((g) => g.label)).toEqual([
      '2024-04',
      '2024-02',
      '2024-01',
      '2024-03',
    ])
  })

  it('reports direction, net change and the turning points with their labels', () => {
    const t = chartDigest(spec, rows).trend as SeriesTrend
    expect(t.direction).toBe('rising')
    expect(t.netChange).toBe(100) // 200 − 100
    expect(t.pctChange).toBe(1)
    expect(t.peak).toEqual({ label: '2024-04', value: 200 })
    expect(t.trough).toEqual({ label: '2024-03', value: 90 })
    expect(t.largestFall).toMatchObject({ from: '2024-02', to: '2024-03', change: -30 })
    expect(t.largestRise).toMatchObject({ from: '2024-03', to: '2024-04', change: 110 })
  })

  it('separates a steady trend from noise via the monotonic share', () => {
    const steady: Row[] = [1, 2, 3, 4, 5].map((n) => ({ month: `2024-0${n}`, revenue: n * 10 }))
    const t = chartDigest(spec, steady).trend as SeriesTrend
    expect(t.monotonicShare).toBe(1) // every step in the same direction
    expect(t.steadiness).toBe('steady')
    // The mixed series above moves up, down, up → 2 of 3 steps.
    const mixed = chartDigest(spec, rows).trend as SeriesTrend
    expect(mixed.monotonicShare).toBeCloseTo(0.667, 2)
    expect(mixed.steadiness).toBe('uneven')
  })

  it('decides steadiness/volatility here so the model cannot misread a borderline number', () => {
    // An independent fact-check on a real model run found monotonicShare 0.517 —
    // barely off a coin flip between rises and falls — described as "relatively
    // steady", and cv 0.09 — under the guide's own 0.1 "stable" cutoff — described
    // as "moderate volatility". Both readings are backwards. Precomputing the
    // verdict removes the model's chance to get either wrong again.
    const nearCoinFlip: Row[] = [
      { month: '01', revenue: 10 },
      { month: '02', revenue: 11 },
      { month: '03', revenue: 10 },
      { month: '04', revenue: 11 },
      { month: '05', revenue: 10 },
      { month: '06', revenue: 11 },
      { month: '07', revenue: 10 },
    ]
    const t = chartDigest(spec, nearCoinFlip).trend as SeriesTrend
    expect(t.monotonicShare).toBeLessThanOrEqual(0.5) // an exact coin flip — 3 ups, 3 downs
    expect(t.steadiness).toBe('fluctuating')
    expect(t.cv ?? 1).toBeLessThan(0.1)
    expect(t.volatility).toBe('stable')
  })

  it('calls a genuinely volatile series volatile', () => {
    const wild: Row[] = [
      { month: '01', revenue: 10 },
      { month: '02', revenue: 90 },
      { month: '03', revenue: 5 },
      { month: '04', revenue: 100 },
    ]
    const t = chartDigest(spec, wild).trend as SeriesTrend
    expect(t.volatility).toBe('volatile')
  })
})

describe('ranking trend (bar / dot plot / map)', () => {
  const rows: Row[] = [
    { region: 'North', revenue: 800 },
    { region: 'South', revenue: 100 },
    { region: 'East', revenue: 60 },
    { region: 'West', revenue: 40 },
  ]
  const spec: VizSpec = {
    mark: 'bar',
    encoding: {
      x: { field: 'region', type: 'nominal' },
      y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
    },
  }

  it('separates the gap to SECOND from the ratio to the LAGGARD — never the same number', () => {
    // A real model run conflated these: it reported "leading by 1.37x" for the gap
    // over second place, when 1.37 was actually leader-vs-laggard and the true lead
    // over second was ~1.002x. Nesting them under distinct, explicit keys is the fix.
    const t = chartDigest(spec, rows).trend as RankingTrend
    expect(t.shape).toBe('ranking')
    expect(t.leader).toEqual({ label: 'North', value: 800 })
    expect(t.second).toEqual({ label: 'South', value: 100 })
    expect(t.laggard).toEqual({ label: 'West', value: 40 })
    expect(t.vsSecond).toEqual({ gap: 700, ratio: 8 })
    expect(t.vsLaggard).toEqual({ ratio: 20 }) // 800/40 — a DIFFERENT number from vsSecond.ratio
    expect(t.topShare).toBeCloseTo(0.8, 2)
    // HHI over percentage shares: 80² + 10² + 6² + 4² = 6552 (reported, not the verdict).
    expect(t.concentration?.hhi).toBe(6552)
    expect(t.concentration?.concentration).toBe('high')
    expect(t.paretoCount).toBe(1) // one category already carries 80%
    expect(t.paretoShare).toBeCloseTo(0.8, 2) // North alone: 800/1000
  })

  it('computes the REAL population share for paretoCount, not just a share of category count', () => {
    // The exact reported bug: a real run had paretoCount=7 out of 20 countries
    // (paretoFraction 0.35) and wrote "the top 7 categories account for 35% of
    // the population" — quoting paretoFraction (a share of CATEGORY COUNT) as if
    // it were a share of population. The actual population share for those top 7
    // is paretoShare, which by construction is >= 0.8 (paretoCountOf stops the
    // instant the running sum crosses 80%), never anywhere near 35%.
    const sevenBigPlusThirteenSmall: Row[] = [
      { region: 'A', revenue: 1412 },
      { region: 'B', revenue: 1408 },
      { region: 'C', revenue: 900 },
      { region: 'D', revenue: 700 },
      { region: 'E', revenue: 500 },
      { region: 'F', revenue: 400 },
      { region: 'G', revenue: 300 },
      ...Array.from({ length: 13 }, (_, i) => ({ region: `S${i}`, revenue: 100 })),
    ]
    const t = chartDigest(spec, sevenBigPlusThirteenSmall).trend as RankingTrend
    expect(t.paretoCount).toBe(7) // takes exactly these 7 of 20 to cross 80%
    expect(t.paretoFraction).toBeCloseTo(7 / 20, 2) // "7 of 20 countries" — a count share
    expect(t.paretoShare).toBeGreaterThanOrEqual(0.8) // what those 7 ACTUALLY hold
    expect(t.paretoShare).not.toBeCloseTo(t.paretoFraction ?? -1, 1) // must never collide
  })

  it('uses the effective-category count so four EVEN categories do not read as concentrated', () => {
    // The raw HHI cannot fall below 10000/n, so four near-equal regions still score
    // ~2556 — over the classic "highly concentrated" threshold. Judged that way, a
    // real run produced "high concentration" and "evenly spread" in one paragraph.
    // effectiveGroups (Adelman 1969 / Hill 1973) asks "how many EQUAL categories
    // behave like this?" instead, which isn't biased by n.
    const even: Row[] = [
      { region: 'A', revenue: 288 },
      { region: 'B', revenue: 287 },
      { region: 'C', revenue: 215 },
      { region: 'D', revenue: 210 },
    ]
    const t = chartDigest(spec, even).trend as RankingTrend
    expect(t.concentration?.hhi).toBeGreaterThan(2500) // the raw index still says "concentrated"
    expect(t.concentration?.effectiveGroups).toBeGreaterThan(3.9) // ~4 — behaves like all 4 are equal
    expect(t.concentration?.evenness).toBeGreaterThan(0.95)
    expect(t.concentration?.concentration).toBe('low')
  })

  it('still calls a genuinely dominated field concentrated', () => {
    const skewed: Row[] = [
      { region: 'A', revenue: 900 },
      { region: 'B', revenue: 40 },
      { region: 'C', revenue: 35 },
      { region: 'D', revenue: 25 },
    ]
    const t = chartDigest(spec, skewed).trend as RankingTrend
    // 900/1000 in one category behaves like ~1.2 equal categories out of 4.
    expect(t.concentration?.evenness).toBeLessThan(0.5)
    expect(t.concentration?.concentration).toBe('high')
  })

  it('does not call an evenly spread field Pareto-like', () => {
    // Ten equal categories need EIGHT of them to reach 80% — the opposite of
    // concentration. A raw paretoCount got quoted as evidence of dominance, so the
    // digest states the verdict as a boolean instead.
    const even: Row[] = Array.from({ length: 10 }, (_, i) => ({ region: `R${i}`, revenue: 100 }))
    const t = chartDigest(spec, even).trend as RankingTrend
    expect(t.paretoCount).toBe(8)
    expect(t.paretoLike).toBe(false)
    expect(t.concentration?.effectiveGroups).toBe(10) // all 10 count fully — perfectly even
    expect(t.concentration?.concentration).toBe('low')
  })

  it('marks a genuine 80/20 split as Pareto-like', () => {
    const skewed: Row[] = [
      ...['A', 'B'].map((region) => ({ region, revenue: 400 })),
      ...['C', 'D', 'E', 'F', 'G', 'H'].map((region) => ({ region, revenue: 30 })),
    ]
    const t = chartDigest(spec, skewed).trend as RankingTrend
    expect(t.paretoLike).toBe(true)
    expect(t.paretoFraction ?? 1).toBeLessThanOrEqual(0.35)
  })
})

describe('composition trend (pie)', () => {
  const spec: VizSpec = {
    mark: 'arc',
    encoding: {
      theta: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
      color: { field: 'category', type: 'nominal' },
    },
  }

  it('counts the negligible tail that a pie cannot render legibly', () => {
    const rows: Row[] = [
      { category: 'A', revenue: 600 },
      { category: 'B', revenue: 380 },
      { category: 'C', revenue: 10 },
      { category: 'D', revenue: 10 },
    ]
    const t = chartDigest(spec, rows).trend as CompositionTrend
    expect(t.shape).toBe('composition')
    expect(t.sliceCount).toBe(4)
    expect(t.topShare).toBeCloseTo(0.6, 2)
    expect(t.top2Share).toBeCloseTo(0.98, 2)
    expect(t.negligibleCount).toBe(2) // C and D are both under 2%
  })

  it('flags that shares are meaningless for a non-additive measure', () => {
    const avg: VizSpec = {
      mark: 'arc',
      encoding: {
        theta: { field: 'revenue', type: 'quantitative', aggregate: 'mean' },
        color: { field: 'category', type: 'nominal' },
      },
    }
    const t = chartDigest(avg, [
      { category: 'A', revenue: 10 },
      { category: 'B', revenue: 20 },
    ]).trend as CompositionTrend
    expect(t.sharesMeaningless).toBe(true)
    expect(t.topShare).toBeUndefined()
  })
})

describe('distribution trend (histogram)', () => {
  const spec: VizSpec = {
    mark: 'bar',
    encoding: {
      x: { field: 'v', type: 'quantitative', bin: true },
      y: { type: 'quantitative', aggregate: 'count' },
    },
  }

  it('bins the field and reports the shape statistics the guide asks for', () => {
    // A right-skewed set: a tight cluster with a long upper tail.
    const vals = [1, 1, 2, 2, 2, 3, 3, 4, 5, 6, 9, 14, 22, 40]
    const t = chartDigest(spec, vals.map((v) => ({ v }))).trend as DistributionTrend
    expect(t.shape).toBe('distribution')
    expect(t.n).toBe(vals.length)
    expect(t.bins.reduce((a, b) => a + b.count, 0)).toBe(vals.length) // every value binned
    expect(t.binWidth).toBeGreaterThan(0)
    expect(t.modalBin.count).toBeGreaterThan(0)
    // mean well above median → right skew, the direction the guide keys on.
    expect(t.mean).toBeGreaterThan(t.median)
    expect(t.skewDirection).toBe('right')
    expect(t.skewness ?? 0).toBeGreaterThan(1) // "highly skewed" by Bulmer's band
    expect(t.iqr).toBe(t.q3 - t.q1)
  })

  it('calls a symmetric spread symmetric', () => {
    const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    const t = chartDigest(spec, vals.map((v) => ({ v }))).trend as DistributionTrend
    expect(t.skewDirection).toBe('symmetric')
  })
})

describe('spread trend (box / strip)', () => {
  const spec: VizSpec = {
    mark: 'boxplot',
    encoding: {
      x: { field: 'grp', type: 'nominal' },
      y: { field: 'v', type: 'quantitative' },
    },
  }

  it('computes a five-number summary and Tukey outliers per group', () => {
    const rows: Row[] = [
      ...[10, 11, 12, 13, 14, 15, 16, 200].map((v) => ({ grp: 'A', v })),
      ...[1, 2, 3, 4].map((v) => ({ grp: 'B', v })),
    ]
    const t = chartDigest(spec, rows).trend as SpreadTrend
    expect(t.shape).toBe('spread')
    const a = t.groups.find((g) => g.label === 'A')!
    expect(a.n).toBe(8)
    expect(a.median).toBe(13.5)
    expect(a.iqr).toBe(a.q3 - a.q1)
    expect(a.upperFence).toBe(a.q3 + 1.5 * a.iqr)
    // 200 sits far beyond the upper fence — the one thing a box plot is for.
    expect(a.outlierCount).toBe(1)
    expect(a.outliers).toContain(200)
  })

  it('flags groups too small for meaningful quartiles (n < 20)', () => {
    const rows: Row[] = [
      ...Array.from({ length: 25 }, (_, i) => ({ grp: 'big', v: i })),
      ...Array.from({ length: 4 }, (_, i) => ({ grp: 'small', v: i })),
    ]
    const t = chartDigest(spec, rows).trend as SpreadTrend
    expect(t.underpoweredGroups).toEqual(['small'])
    expect(t.groups.find((g) => g.label === 'big')!.underpowered).toBe(false)
  })
})

describe('relationship trend (scatter / bubble)', () => {
  const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({
    x: i,
    y: i * 2 + 1,
    weight: 100 - i,
  }))

  it('bands the correlation strength and reports r²', () => {
    const spec: VizSpec = {
      mark: 'point',
      encoding: { x: { field: 'x', type: 'quantitative' }, y: { field: 'y', type: 'quantitative' } },
    }
    const t = chartDigest(spec, rows).trend as RelationshipTrend
    expect(t.shape).toBe('relationship')
    expect(t.correlation).toBeCloseTo(1, 5)
    expect(t.r2).toBeCloseTo(1, 5)
    expect(t.direction).toBe('positive')
    expect(t.strength).toBe('very strong') // Evans band for |r| >= 0.8
    expect(t.n).toBe(30)
  })

  it('describes what the SIZE variable adds on a bubble — the reason it is not a scatter', () => {
    const spec: VizSpec = {
      mark: 'point',
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
        size: { field: 'weight', type: 'quantitative' },
      },
    }
    const t = chartDigest(spec, rows).trend as RelationshipTrend
    expect(t.size?.field).toBe('weight')
    expect(t.corrSizeX).toBeCloseTo(-1, 5) // weight falls as x rises
    expect(t.corrSizeY).toBeCloseTo(-1, 5)
    expect(t.largestBubble).toMatchObject({ size: 100 })
    expect(t.smallestBubble).toMatchObject({ size: 71 })
  })
})

describe('matrix trend (heatmap)', () => {
  it('keeps the cell grid and separates a hotspot from a busy row', () => {
    const rows: Row[] = [
      { r: 'A', c: 'X' },
      { r: 'A', c: 'X' },
      { r: 'A', c: 'X' },
      { r: 'A', c: 'Y' },
      { r: 'B', c: 'X' },
      { r: 'B', c: 'Y' },
    ]
    const spec: VizSpec = {
      mark: 'rect',
      encoding: {
        x: { field: 'c', type: 'nominal' },
        y: { field: 'r', type: 'nominal' },
        color: { type: 'quantitative', aggregate: 'count' },
      },
    }
    const t = chartDigest(spec, rows).trend as MatrixTrend
    expect(t.shape).toBe('matrix')
    expect(t.rowField).toBe('r')
    expect(t.colField).toBe('c')
    expect(t.rowCount).toBe(2)
    expect(t.colCount).toBe(2)
    expect(t.grandTotal).toBe(6)
    // The cell grid survives — a single-dimension group list would have lost it.
    expect(t.topCells[0]).toMatchObject({ row: 'A', col: 'X', value: 3 })
    expect(t.rowTotals.find((x) => x.label === 'A')?.value).toBe(4)
    expect(t.colTotals.find((x) => x.label === 'X')?.value).toBe(4)
  })
})

describe('groupStats.skew — decided here, not left for the model to compare', () => {
  const spec: VizSpec = {
    mark: 'bar',
    encoding: {
      x: { field: 'region', type: 'nominal' },
      y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
    },
  }

  it('calls a near-tie SYMMETRIC rather than reading a tiny gap as skew', () => {
    // groupStats mean 501,953.45 vs median 503,810.18 — mean is actually LOWER, by
    // under 0.4% of the group range. A real model run called this "significantly
    // higher" and inferred a right skew from it; both the direction and the
    // "significant" framing were wrong. skew removes the model's need to compare.
    const rows: Row[] = [
      { region: 'South', revenue: 577731.34 },
      { region: 'North', revenue: 576402.71 },
      { region: 'West', revenue: 431217.66 },
      { region: 'East', revenue: 422462.09 },
    ]
    const d = chartDigest(spec, rows)
    expect(d.groupStats?.mean).toBeLessThan(d.groupStats?.median ?? 0)
    expect(d.groupStats?.skew).toBe('symmetric')
  })

  it('calls a real right skew right, and a real left skew left', () => {
    const right: Row[] = [
      { region: 'A', revenue: 10 },
      { region: 'B', revenue: 12 },
      { region: 'C', revenue: 14 },
      { region: 'D', revenue: 100 },
    ]
    expect(chartDigest(spec, right).groupStats?.skew).toBe('right')

    const left: Row[] = [
      { region: 'A', revenue: 100 },
      { region: 'B', revenue: 98 },
      { region: 'C', revenue: 96 },
      { region: 'D', revenue: 10 },
    ]
    expect(chartDigest(spec, left).groupStats?.skew).toBe('left')
  })
})

describe('truncation is visible', () => {
  it('marks how many groups were shown against how many exist', () => {
    const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({ k: `g${i}`, v: i + 1 }))
    const spec: VizSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'k', type: 'nominal' },
        y: { field: 'v', type: 'quantitative', aggregate: 'sum' },
      },
    }
    const d = chartDigest(spec, rows)
    expect(d.dimension).toEqual({ field: 'k', groupCount: 30, shown: 12 })
    // The stats still cover EVERY group, so the minimum is real even though the
    // group it belongs to was cut from the list — which is exactly why the guide
    // forbids naming a laggard from a truncated list.
    expect(d.groupStats?.min).toBe(1)
    expect(d.groups?.some((g) => g.value === 1)).toBe(false)
  })
})
