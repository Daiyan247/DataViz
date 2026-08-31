import { detectDataGeo, loadFeatureCollection, planGeo } from './geo'
import type { Column, Row, VizSpec } from './types'

/**
 * Warm a map's chunk and its atlas BEFORE the chart is revealed.
 *
 * MapView is lazy (three.js + the topology are heavy and only maps need them), so
 * without this the advice panel — which needs nothing but the spec — paints at once
 * while the map is still fetching behind a "Loading map…" fallback, and the two
 * arrive seconds apart. Awaiting this during the loading bar means the map is ready
 * the moment the chart is shown, so they appear together.
 *
 * A no-op for every non-map chart. Lives here rather than in ChartView because a
 * component file that also exports plain functions breaks React fast refresh; the
 * dynamic import still resolves to the same chunk ChartView lazy-loads.
 */
export async function preloadChart(spec: VizSpec, columns: Column[], rows: Row[]): Promise<void> {
  if (spec.mark !== 'geoshape') return
  // The same choice MapView makes: an explicit `location` plan wins, else whatever
  // geography the data itself holds. Continent maps draw on the country atlas.
  const plan = planGeo(spec, columns, rows)
  const mode = (plan?.mode ?? detectDataGeo(columns, rows)?.mode) === 'usa' ? 'usa' : 'world'
  await Promise.all([import('../components/MapView'), loadFeatureCollection(mode)])
}
