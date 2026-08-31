import { lazy, Suspense } from 'react'
import { VegaLite, type VisualizationSpec } from 'react-vega'
import type { Column, Row, VizSpec } from '../lib/types'
import { vegaConfig } from '../lib/vegaTheme'
import { useIsDark } from './useIsDark'

// three.js + the atlas geometry are heavy and only needed for maps, so load the
// MapView lazily — it stays out of the main bundle until a map is shown.
const MapView = lazy(() => import('./MapView').then((m) => ({ default: m.MapView })))

/**
 * Presentational chart renderer built on Vega-Lite (react-vega). The VizSpec's
 * `encoding` already carries each field's data type (quantitative/temporal/
 * ordinal/nominal), so we just inject the filtered rows + a theme and let
 * Vega-Lite do the aggregation, binning, and layout.
 */

export interface ChartViewProps {
  data: Row[]
  spec: VizSpec
  /** Full column list — needed by the map renderer to detect geographic columns. */
  columns?: Column[]
  /** The natural-language request — the map reads its scope (world/continent/country) from it. */
  request?: string
}

/** Drop empty channels / undefined props so Vega-Lite gets a clean encoding. */
function toVegaEncoding(encoding: VizSpec['encoding']): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [channel, def] of Object.entries(encoding)) {
    if (!def) continue
    const field: Record<string, unknown> = { type: def.type }
    if (def.field) field.field = def.field
    if (def.aggregate) field.aggregate = def.aggregate
    if (def.bin) field.bin = true
    out[channel] = field
  }
  return out
}

/**
 * Prettify: slant a categorical X axis when it would be cramped (many categories
 * or long labels), so ticks stay readable instead of overlapping. See
 * `server/styling_guide.md` for the conventions. Applied at render time because
 * it depends on the actual label count/length, not the data mapping.
 */
function prettifyXAxis(encoding: Record<string, unknown>, data: Row[]): void {
  const x = encoding.x as { field?: string; type?: string; axis?: Record<string, unknown> } | undefined
  if (!x?.field || (x.type !== 'nominal' && x.type !== 'ordinal')) return

  const seen = new Set<string>()
  let maxLen = 0
  for (const row of data) {
    const label = String(row[x.field] ?? '')
    seen.add(label)
    if (label.length > maxLen) maxLen = label.length
  }
  const cramped = seen.size > 6 || maxLen > 10
  x.axis = { ...(x.axis ?? {}), labelAngle: cramped ? -40 : 0, labelLimit: 200 }
}

export function ChartView({ data, spec, columns, request }: ChartViewProps) {
  const dark = useIsDark()

  // Maps render via the dedicated three.js view (even with no rows → world base).
  if (spec.mark === 'geoshape') {
    const cols: Column[] = columns ?? Object.keys(data[0] ?? {}).map((name) => ({ name, type: 'string' as const }))
    return (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--text-secondary)' }}>
            Loading map…
          </div>
        }
      >
        <MapView data={data} columns={cols} spec={spec} request={request} />
      </Suspense>
    )
  }

  if (data.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ color: 'var(--text-secondary)' }}
      >
        No data to plot for this request.
      </div>
    )
  }

  const isPoint = spec.mark === 'point' || spec.mark === 'circle'
  const isBubble = isPoint && Boolean(spec.encoding.size)
  // Cleveland dot plot: a point mark with one categorical axis + an aggregated
  // measure (one dot per category), as opposed to a scatter's two raw axes.
  const xCat = Boolean(spec.encoding.x) && spec.encoding.x!.type !== 'quantitative'
  const yCat = Boolean(spec.encoding.y) && spec.encoding.y!.type !== 'quantitative'
  const isDot = isPoint && !isBubble && xCat !== yCat && Boolean(spec.encoding.x?.aggregate || spec.encoding.y?.aggregate)

  const mark: Record<string, unknown> = { type: spec.mark, tooltip: true }
  if (spec.mark === 'line') mark.point = true
  if (spec.mark === 'bar' || spec.mark === 'rect') mark.cornerRadius = 2
  // Whiskers span the full range so outliers aren't drawn as separate circles
  // (which read like leftover scatter points). No data is hidden.
  if (spec.mark === 'boxplot') mark.extent = 'min-max'
  // Strip plot: every raw value as a tick, semi-transparent so overlaps read.
  if (spec.mark === 'tick') {
    mark.opacity = 0.6
    mark.thickness = 2
  }
  // Bubble/scatter styled like ggplot: filled, semi-transparent circles with a
  // thin stroke so overlapping points stay legible.
  if (isPoint) {
    mark.filled = true
    mark.opacity = isDot ? 1 : isBubble ? 0.6 : 0.75
    mark.stroke = dark ? '#1a1a19' : '#fcfcfb'
    mark.strokeWidth = 0.5
    // Cleveland dot plot: one solid, generously sized dot per category.
    if (isDot) mark.size = 140
  }

  const encoding = toVegaEncoding(spec.encoding)
  prettifyXAxis(encoding, data)
  // Give bubbles a generous, readable size range (Vega's default is too small).
  if (isBubble && encoding.size) {
    ;(encoding.size as Record<string, unknown>).scale = { range: [40, 1200] }
  }

  const vlSpec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    data: { values: data },
    mark,
    encoding,
    width: 'container',
    height: 'container',
    autosize: { type: 'fit', contains: 'padding' },
    config: vegaConfig(dark),
  } as unknown as VisualizationSpec

  return (
    <div className="h-full w-full">
      <VegaLite
        spec={vlSpec}
        actions={false}
        renderer="svg"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
