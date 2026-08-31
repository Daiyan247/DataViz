import type { ColumnProfile, Encoding, VizSpec } from './types'
import { detectGeoKind } from './geo'

/**
 * Advisory fit warnings, computed from the chart spec + column profiles. These
 * catch variable-type / chart mismatches that render but mislead — e.g. a pie of
 * a continuous field, a line over unordered categories, or a scatter axis that
 * isn't quantitative. Pure and unit-tested; the chart still draws (warn-only).
 */

const MARK_LABEL: Record<VizSpec['mark'], string> = {
  bar: 'bar chart',
  line: 'line chart',
  area: 'area chart',
  point: 'scatter plot',
  circle: 'scatter plot',
  tick: 'strip plot',
  arc: 'pie chart',
  rect: 'heatmap',
  boxplot: 'box plot',
  geoshape: 'map',
}

// Box-plot data-sufficiency thresholds. A box plot "works best when the sample
// size is at least 20; if the sample size is too small, the quartiles and outliers
// shown by the boxplot may not be meaningful" (Minitab; Nature Methods). Below
// these, a strip/dot plot showing the raw points is more honest.
const BOX_MIN_OBS = 20 // observations per group for reliable quartiles/outliers
const BOX_LOW_DISTINCT = 5 // few distinct values → coarse, step-like box
const BOX_MAX_GROUPS = 20 // more boxes than this are hard to compare at once

export function chartWarnings(spec: VizSpec, profiles: ColumnProfile[]): string[] {
  const byName = new Map(profiles.map((p) => [p.name, p]))
  const warnings: string[] = []
  const enc = spec.encoding
  // A point mark can be a scatter, a bubble (has size), or a Cleveland dot plot
  // (one categorical axis + an aggregated measure) — name it correctly.
  const isPointMark = spec.mark === 'point' || spec.mark === 'circle'
  const isBubble = isPointMark && Boolean(enc.size)
  const xCat = Boolean(enc.x) && enc.x!.type !== 'quantitative'
  const yCat = Boolean(enc.y) && enc.y!.type !== 'quantitative'
  const isDot = isPointMark && !isBubble && xCat !== yCat && Boolean(enc.x?.aggregate || enc.y?.aggregate)
  const label = isBubble ? 'bubble chart' : isDot ? 'dot plot' : MARK_LABEL[spec.mark]

  const profileOf = (e?: Encoding) => (e?.field ? byName.get(e.field) : undefined)

  // Unknown fields (model hallucinated a column).
  for (const [channel, e] of Object.entries(enc)) {
    if (e?.field && !byName.has(e.field)) {
      warnings.push(`“${e.field}” (${channel}) isn’t a column in this dataset.`)
    }
  }

  // Scatter/bubble: a categorical axis is fine (points grouped by category), but
  // if NEITHER axis is numeric there's no numeric relationship to show. Bubble
  // size must be numeric.
  if (spec.mark === 'point' || spec.mark === 'circle') {
    const xp = profileOf(enc.x)
    const yp = profileOf(enc.y)
    const xNumeric = !xp || xp.level === 'quantitative'
    const yNumeric = !yp || yp.level === 'quantitative'
    if (!xNumeric && !yNumeric) {
      warnings.push(`A ${label} shows a relationship between numbers, but neither axis (“${enc.x?.field}”, “${enc.y?.field}”) is numeric. A bar chart or heatmap fits categories better.`)
    }
    const size = profileOf(enc.size)
    if (size && size.level !== 'quantitative') {
      warnings.push(`Bubble size should be a numeric field, but “${size.name}” is ${size.level}.`)
    }
  }

  // Pie: theta must be a numeric measure (or a count); color a small category.
  if (spec.mark === 'arc') {
    const theta = enc.theta
    const thetaProfile = profileOf(theta)
    const thetaIsMeasure =
      theta?.aggregate === 'count' || (thetaProfile ? thetaProfile.level === 'quantitative' : false)
    if (theta && !thetaIsMeasure) {
      warnings.push(`A ${label} sizes slices by a number, but “${theta.field}” is ${thetaProfile?.level ?? 'not numeric'}. A pie needs a numeric measure — to compare two categories, use a bar chart or heatmap instead.`)
    }
    const cat = profileOf(enc.color)
    if (cat && cat.level === 'quantitative' && cat.continuous) {
      warnings.push(`A ${label} needs categories, but “${cat.name}” is a continuous number — each value becomes its own slice. A histogram or bar chart fits better.`)
    }
    if (cat && cat.distinct > 8) {
      warnings.push(`“${cat.name}” has ${cat.distinct} categories — too many to read as pie slices. A bar chart is clearer.`)
    }
    if (cat && cat.distinct === 1) {
      warnings.push(`“${cat.name}” has only one value, so a ${label} would be a single full circle — nothing to compare.`)
    }
  }

  // Bar / histogram readability.
  if (spec.mark === 'bar') {
    const x = profileOf(enc.x)
    if (enc.x?.bin && x && x.distinct <= 10) {
      // A "histogram" of a field with few distinct values isn't a distribution.
      warnings.push(`“${x.name}” has only ${x.distinct} distinct values — a histogram won’t show a smooth distribution. A bar chart of counts per value is clearer.`)
    } else if (x && x.level !== 'quantitative' && x.distinct > 30) {
      warnings.push(`“${x.name}” has ${x.distinct} categories — that’s a lot of bars to read. Consider filtering to the top values or a different view.`)
    }
  }

  // Heatmap with too many rows/columns turns into an unreadable grid.
  if (spec.mark === 'rect') {
    for (const ch of ['x', 'y'] as const) {
      const p = profileOf(enc[ch])
      if (p && p.distinct > 25) {
        warnings.push(`“${p.name}” has ${p.distinct} categories — a heatmap with that many ${ch === 'x' ? 'columns' : 'rows'} is hard to read.`)
      }
    }
  }

  // Box plot: quartiles/whiskers only mean something with enough observations and
  // real spread. Warn (the chart still draws) when the data is too thin or flat.
  if (spec.mark === 'boxplot') {
    const m = profileOf(enc.y)
    const cat = profileOf(enc.x)
    if (m && m.level !== 'quantitative') {
      warnings.push(`A ${label} summarises the spread of a number, but “${m.name}” is ${m.level}. Put a numeric measure on the value axis.`)
    } else if (m) {
      const groups = cat ? Math.max(1, cat.distinct) : 1
      const perGroup = m.count / groups
      if (perGroup < BOX_MIN_OBS) {
        warnings.push(
          cat && cat.distinct > 1
            ? `Across ${cat.distinct} groups, “${m.name}” averages only ~${Math.round(perGroup)} values per box — below ~${BOX_MIN_OBS} the quartiles and outliers aren’t reliable. Showing the individual points (a strip/dot plot) is more honest.`
            : `“${m.name}” has only ${m.count} value${m.count === 1 ? '' : 's'} — below ~${BOX_MIN_OBS} a box plot’s quartiles and outliers aren’t reliable. Showing the individual points (a strip/dot plot) is more honest.`,
        )
      }
      if (m.iqr === 0) {
        warnings.push(`“${m.name}” barely varies — its middle 50% is a single value, so a ${label} collapses to a flat line with nothing to compare.`)
      } else if (m.distinct <= BOX_LOW_DISTINCT && m.count > m.distinct) {
        warnings.push(`“${m.name}” has only ${m.distinct} distinct values — a ${label} will show coarse steps rather than a smooth spread. A bar of counts per value may read clearer.`)
      }
      if (cat && cat.distinct > BOX_MAX_GROUPS) {
        warnings.push(`“${cat.name}” has ${cat.distinct} groups — that’s a lot of boxes to compare at once. Consider filtering to fewer categories.`)
      }
    }
  }

  // Map (geoshape): needs a geographic column, and a numeric measure to shade by.
  if (spec.mark === 'geoshape') {
    const value = enc.color
    const vp = profileOf(value)
    if (value?.field && value.aggregate && value.aggregate !== 'count' && vp && vp.level !== 'quantitative') {
      warnings.push(`A ${label} shades regions by a number, but “${vp.name}” isn’t numeric. Pick a numeric measure or count records instead.`)
    }
    const hasLatLon = Boolean(enc.latitude?.field && enc.longitude?.field)
    if (!hasLatLon) {
      const loc = enc.location
      if (!loc?.field) {
        warnings.push(`A ${label} needs a geographic column — a list of countries, continents, US states, or latitude & longitude columns.`)
      } else {
        const lp = profileOf(loc)
        if (lp && !detectGeoKind([lp])) {
          warnings.push(`“${loc.field}” doesn’t look like countries, continents or US states, so it can’t be placed on a map. Use country/continent/state names, or latitude & longitude columns.`)
        }
      }
    }
  }

  // Line/area want an ordered X (time or ordinal), not unordered categories.
  if (spec.mark === 'line' || spec.mark === 'area') {
    const x = profileOf(enc.x)
    if (x && x.level === 'nominal') {
      warnings.push(`A ${label} connects points in order, but “${x.name}” is unordered (nominal). A bar chart usually reads better.`)
    }
  }

  // Aggregating a non-quantitative measure yields misleading values.
  const measure = enc.y ?? enc.theta
  const mp = profileOf(measure)
  if (measure?.aggregate && measure.aggregate !== 'count' && mp && mp.level !== 'quantitative') {
    warnings.push(`“${mp.name}” isn’t numeric, so it can’t be aggregated (${measure.aggregate}). Try counting rows instead.`)
  }

  // Too many colors are hard to tell apart.
  const color = profileOf(enc.color)
  if (color && spec.mark !== 'arc' && color.level !== 'quantitative' && color.distinct > 12) {
    warnings.push(`“${color.name}” has ${color.distinct} categories — that many colors are hard to distinguish.`)
  }

  return warnings
}
