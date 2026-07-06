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

export const CHROME_LIGHT: Chrome = {
  surface: '#fcfcfb',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  tick: '#52514e',
  label: '#0b0b0b',
}

export const CHROME_DARK: Chrome = {
  surface: '#1a1a19',
  grid: '#2c2c2a',
  axis: '#383835',
  tick: '#c3c2b7',
  label: '#ffffff',
}

/** Series hue for slot `i`, in fixed order, clamped to the ramp length. */
export function seriesColor(i: number, dark: boolean): string {
  const ramp = dark ? SERIES_DARK : SERIES_LIGHT
  return ramp[i % ramp.length]
}

export function chrome(dark: boolean): Chrome {
  return dark ? CHROME_DARK : CHROME_LIGHT
}
