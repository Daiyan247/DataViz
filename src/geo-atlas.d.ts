// The world-atlas / us-atlas packages ship TopoJSON as JSON with no bundled
// types; we only ever hand them to topojson-client, so `unknown` is enough.
declare module 'world-atlas/countries-110m.json' {
  const topology: unknown
  export default topology
}
declare module 'us-atlas/states-10m.json' {
  const topology: unknown
  export default topology
}
