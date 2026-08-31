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

// Kept in step BY HAND with shadcn's tokens in src/index.css — Vega paints SVG
// attributes, which don't resolve var(). These are the neutral scale's oklch values
// converted to hex, so a plot sits on its Card without a visible seam.
export const CHROME_LIGHT: Chrome = {
  surface: '#ffffff', // --card        oklch(1 0 0)
  grid: '#e5e5e5', // --border      oklch(0.922 0 0)
  axis: '#d4d4d4', // --axis        oklch(0.87 0 0)
  tick: '#737373', // --muted-fg    oklch(0.556 0 0)
  label: '#0a0a0a', // --foreground  oklch(0.145 0 0)
}

export const CHROME_DARK: Chrome = {
  surface: '#262626', // --card        oklch(0.205 0 0)
  grid: '#3d3d3d', // --border      white 12%
  axis: '#4d4d4d', // --axis        white 22%
  tick: '#a1a1a1', // --muted-fg    oklch(0.708 0 0)
  label: '#fafafa', // --foreground  oklch(0.985 0 0)
}

/** Series hue for slot `i`, in fixed order, clamped to the ramp length. */
export function seriesColor(i: number, dark: boolean): string {
  const ramp = dark ? SERIES_DARK : SERIES_LIGHT
  return ramp[i % ramp.length]
}

export function chrome(dark: boolean): Chrome {
  return dark ? CHROME_DARK : CHROME_LIGHT
}
