// Minimal typings for the extended projections we use from d3-geo-projection
// (the package ships no .d.ts and there's no @types package). Each returns a
// standard d3-geo GeoProjection.
declare module 'd3-geo-projection' {
  import type { GeoProjection } from 'd3-geo'
  export function geoRobinson(): GeoProjection
  export function geoWinkel3(): GeoProjection
  export function geoMiller(): GeoProjection
}
