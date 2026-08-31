/**
 * Chart series colors — from the validated, colorblind-safe dataviz reference
 * palette. Categorical hues are assigned in FIXED order and NEVER cycled: a 9th
 * series folds into whatever the caller decides (we cap groups upstream).
 *
 * Recharts renders SVG presentation attributes (`fill`, `stroke`) which do not
 * resolve CSS `var()` reliably across browsers, so series colors are real hex
 * values chosen in JS by theme (see `useIsDark`), not CSS custom properties.
 */

export const SERIES_LIGHT = [
  '#2a78d6', // blue
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
  '#e87ba4', // magenta
  '#eb6834', // orange
] as const

export const SERIES_DARK = [
  '#3987e5', // blue
  '#199e70', // aqua
  '#c98500', // yellow
  '#008300', // green
  '#9085e9', // violet
  '#e66767', // red
  '#d55181', // magenta
  '#d95926', // orange
] as const

export interface Chrome {
  surface: string
  grid: string
  axis: string
  tick: string
  label: string
}

// Kept in step BY HAND with the tokens in src/index.css (Vega renders SVG
// attributes, which don't resolve var()). These are the same slate values the app
// chrome uses, so a chart sits on its card without a seam.
export const CHROME_LIGHT: Chrome = {
  surface: '#ffffff', // --card
  grid: '#e2e8f0', // --border
  axis: '#cbd5e1', // --axis
  tick: '#64748b', // --muted-foreground
  label: '#0f172a', // --foreground
}

export const CHROME_DARK: Chrome = {
  surface: '#111a2e', // --card
  grid: '#1e293b', // --border
  axis: '#334155', // --axis
  tick: '#94a3b8', // --muted-foreground
  label: '#f8fafc', // --foreground
}

/** Series hue for slot `i`, in fixed order, clamped to the ramp length. */
export function seriesColor(i: number, dark: boolean): string {
  const ramp = dark ? SERIES_DARK : SERIES_LIGHT
  return ramp[i % ramp.length]
}

export function chrome(dark: boolean): Chrome {
  return dark ? CHROME_DARK : CHROME_LIGHT
}
