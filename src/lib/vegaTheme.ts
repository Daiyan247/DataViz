import { CHROME_DARK, CHROME_LIGHT, SERIES_DARK, SERIES_LIGHT } from './palette'

/**
 * Theme-aware Vega-Lite `config` built from the validated dataviz palette, so
 * charts match the app chrome in light and dark and use the colorblind-safe
 * categorical ramp. Returned as a plain config object the renderer injects.
 */
export function vegaConfig(dark: boolean) {
  const c = dark ? CHROME_DARK : CHROME_LIGHT
  const category = [...(dark ? SERIES_DARK : SERIES_LIGHT)]
  return {
    background: 'transparent',
    range: { category },
    font: 'system-ui, -apple-system, Segoe UI, sans-serif',
    axis: {
      labelColor: c.tick,
      titleColor: c.label,
      gridColor: c.grid,
      domainColor: c.axis,
      tickColor: c.axis,
      labelFontSize: 12,
      titleFontSize: 12,
    },
    legend: { labelColor: c.tick, titleColor: c.label, labelFontSize: 12, titleFontSize: 12 },
    view: { stroke: 'transparent' },
    title: { color: c.label },
    mark: { color: (dark ? SERIES_DARK : SERIES_LIGHT)[0] },
  }
}
