import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { geoAlbersUsa, geoEqualEarth, geoEquirectangular, geoMercator, geoNaturalEarth1, geoStream, type GeoProjection } from 'd3-geo'
import { geoMiller, geoRobinson, geoWinkel3 } from 'd3-geo-projection'
import {
  aggregateByRegion,
  canonicalCountry,
  continentOf,
  deriveMapValue,
  detectDataGeo,
  detectMapScope,
  featureKey,
  loadFeatureCollection,
  planGeo,
  type GeoPlan,
} from '../lib/geo'

// Every flat-world-map projection, from the d3 projection libraries. `antarctica`
// is false for projections that blow up at the poles (Mercator) so we drop it.
interface ProjectionDef {
  id: string
  name: string
  make: () => GeoProjection
  antarctica: boolean
}
const PROJECTIONS: ProjectionDef[] = [
  { id: 'mercator', name: 'Mercator (poles largest)', make: geoMercator, antarctica: false },
  { id: 'miller', name: 'Miller (wall map)', make: geoMiller, antarctica: true },
  { id: 'equirectangular', name: 'Equirectangular', make: geoEquirectangular, antarctica: true },
  { id: 'robinson', name: 'Robinson', make: geoRobinson, antarctica: true },
  { id: 'winkel3', name: 'Winkel Tripel', make: geoWinkel3, antarctica: true },
  { id: 'equalEarth', name: 'Equal Earth (true areas)', make: geoEqualEarth, antarctica: true },
  { id: 'naturalEarth', name: 'Natural Earth', make: geoNaturalEarth1, antarctica: true },
]
// Miller shows Antarctica + the Arctic and enlarges the high latitudes — a
// complete world map. (Mercator is available in the picker but can't show the
// poles, so it drops Antarctica.)
const DEFAULT_PROJECTION = 'miller'

/** lon/lat centroid of a raw GeoJSON Polygon/MultiPolygon (for scope filtering). */
function geomCentroid(geometry: { type: string; coordinates: unknown }): [number, number] {
  const polys = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) as number[][][][]
  let sx = 0
  let sy = 0
  let n = 0
  for (const poly of polys) for (const ring of poly) for (const [lon, lat] of ring) {
    sx += lon
    sy += lat
    n += 1
  }
  return n ? [sx / n, sy / n] : [0, 0]
}
import type { Column, Row, VizSpec } from '../lib/types'

/**
 * "2.5D" map (react-three-fiber). Height rises with the camera tilt (2D↔3D,
 * seamless). Beyond height, the value can be shown through a browsable set of
 * ENCODINGS (color, glow, saturation, opacity, sheen, pulse, labels, bubbles,
 * spikes) — the standard visual variables adapted to a 3D map. A minimisable
 * panel (bottom-right) hosts both the Style presets and the Encoding toggles.
 */

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

const MAX_HEIGHT = 22
const DEFAULT_RADIUS = 90
// Border edges longer than this (in world units; map is ~120 wide) are pole lines
// or antimeridian-clip edges — real coastline segments are tiny at 110m — so we
// don't draw them as borders (avoids a straight line across the bottom/edges).
const MAX_BORDER_EDGE = 6
const FLAT_PHI = 0.06
const FULL_PHI = 0.95
const PHI_2D = 0.02
const PHI_3D = 1.02
const MIN_SCALE_Y = 0.01

// ── Aesthetics ──────────────────────────────────────────────────────────────────

interface Aesthetic {
  id: string
  name: string
  rampLow: string
  rampHigh: string
  gray: string
  border: string
  borderOpacity: number
  highlight: string
  roughness: number
  metalness: number
  emissiveIntensity: number
  ambient: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  keyIntensity: number
  rim: string
  rimIntensity: number
  background: string
}

const AESTHETICS: Aesthetic[] = [
  { id: 'broadcast', name: 'Broadcast', rampLow: '#0a2a5c', rampHigh: '#4da3ff', gray: '#41527a', border: '#dfefff', borderOpacity: 0.5, highlight: '#ffd24d', roughness: 0.28, metalness: 0.6, emissiveIntensity: 0.14, ambient: 0.25, hemiSky: '#9fc4ff', hemiGround: '#0a0e1a', hemiIntensity: 0.8, keyIntensity: 0.95, rim: '#66aaff', rimIntensity: 0.7, background: '#0a1226' },
  { id: 'minimal', name: 'Editorial', rampLow: '#e0e7ff', rampHigh: '#1e3a8a', gray: '#c4cad3', border: '#334155', borderOpacity: 0.35, highlight: '#f59e0b', roughness: 0.7, metalness: 0.05, emissiveIntensity: 0.04, ambient: 0.5, hemiSky: '#ffffff', hemiGround: '#c8ccd4', hemiIntensity: 1.1, keyIntensity: 0.7, rim: '#dbeafe', rimIntensity: 0.3, background: '#f4f4f5' },
  { id: 'neon', name: 'Neon', rampLow: '#3b0764', rampHigh: '#22d3ee', gray: '#33334d', border: '#05060a', borderOpacity: 0.6, highlight: '#f0abfc', roughness: 0.2, metalness: 0.7, emissiveIntensity: 0.5, ambient: 0.15, hemiSky: '#7c3aed', hemiGround: '#0a0a12', hemiIntensity: 0.6, keyIntensity: 0.7, rim: '#22d3ee', rimIntensity: 1.0, background: '#08080f' },
  { id: 'terrain', name: 'Terrain', rampLow: '#fde68a', rampHigh: '#b91c1c', gray: '#c1ae8c', border: '#5b3a29', borderOpacity: 0.4, highlight: '#2563eb', roughness: 0.62, metalness: 0.1, emissiveIntensity: 0.05, ambient: 0.42, hemiSky: '#fff5e0', hemiGround: '#8a7a60', hemiIntensity: 1.0, keyIntensity: 0.95, rim: '#ffd8a8', rimIntensity: 0.4, background: '#f5efe6' },
  { id: 'slate', name: 'Slate', rampLow: '#cbd5e1', rampHigh: '#020617', gray: '#46516a', border: '#e2e8f0', borderOpacity: 0.35, highlight: '#38bdf8', roughness: 0.5, metalness: 0.25, emissiveIntensity: 0.06, ambient: 0.35, hemiSky: '#dbe4f0', hemiGround: '#0b1220', hemiIntensity: 0.8, keyIntensity: 0.85, rim: '#93c5fd', rimIntensity: 0.4, background: '#0b1220' },
]

const rampHex = (t: number, low: string, high: string): string =>
  `#${new THREE.Color(low).lerp(new THREE.Color(high), clamp01(t)).getHexString()}`

/** The value color gradient (low → high), editable via the color-wheel pickers. */
interface Gradient {
  low: string
  high: string
}
const DEFAULT_GRADIENT: Gradient = { low: '#22c55e', high: '#ef4444' } // green low → red high

function desaturateHex(hex: string, amount: number): string {
  const c = new THREE.Color(hex)
  const g = c.r * 0.299 + c.g * 0.587 + c.b * 0.114
  c.lerp(new THREE.Color(g, g, g), clamp01(amount))
  return `#${c.getHexString()}`
}

// ── Encodings (browsable value channels) ─────────────────────────────────────────

type EncId = 'color' | 'glow' | 'saturation' | 'opacity' | 'sheen' | 'pulse' | 'flags' | 'bubbles' | 'spikes'
type EncFlags = Record<EncId, boolean>

const ENCODINGS: { id: EncId; name: string; hint: string }[] = [
  { id: 'color', name: 'Color', hint: 'Value → sequential color ramp' },
  { id: 'glow', name: 'Glow', hint: 'Higher value glows brighter (luminance)' },
  { id: 'saturation', name: 'Saturation', hint: 'Low values fade toward grey' },
  { id: 'opacity', name: 'Opacity', hint: 'Low values become more transparent' },
  { id: 'sheen', name: 'Sheen', hint: 'Higher value = glossier/metallic' },
  { id: 'pulse', name: 'Pulse', hint: 'Higher value pulses stronger (motion)' },
  { id: 'flags', name: 'Flags', hint: 'A flag on a pole showing the number — always faces you' },
  { id: 'bubbles', name: 'Bubbles', hint: 'A sphere sized by value on each region' },
  { id: 'spikes', name: 'Spikes', hint: 'A column sized by value on each region' },
]

const DEFAULT_ENC: EncFlags = {
  color: true, glow: false, saturation: false, opacity: false, sheen: false, pulse: false, flags: false, bubbles: false, spikes: false,
}

function fmt(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}k`
  return `${Math.round(v)}`
}

const luminance = (hex: string): number => {
  const c = new THREE.Color(hex)
  return c.r * 0.299 + c.g * 0.587 + c.b * 0.114
}

/** Draw a flag (rectangle with a swallow-tail notch on the fly end) filled with
 *  the region color, with the count written ON the flag. */
function makeFlagTexture(text: string, flagColor: string): THREE.CanvasTexture {
  const font = 30
  const padX = 16
  const padY = 12
  const notch = 16
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = `bold ${font}px system-ui, sans-serif`
  const tw = Math.ceil(measure.measureText(text).width)
  const w = tw + padX * 2 + notch
  const h = font + padY * 2
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(w, 0)
  ctx.lineTo(w - notch, h / 2)
  ctx.lineTo(w, h)
  ctx.lineTo(0, h)
  ctx.closePath()
  ctx.fillStyle = flagColor
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.stroke()
  ctx.fillStyle = luminance(flagColor) > 0.55 ? '#0a0a0a' : '#ffffff'
  ctx.font = `bold ${font}px system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  ctx.fillText(text, padX, h / 2 + 1)
  const tex = new THREE.CanvasTexture(canvas)
  tex.anisotropy = 4
  return tex
}

// ── Geometry model ──────────────────────────────────────────────────────────────

interface RegionGeo {
  key: string
  name: string
  geometry: THREE.BufferGeometry
  borderGeom: THREE.BufferGeometry
  cx: number
  cz: number
}
interface RegionValue {
  value: number
  norm: number
  colorHex: string
  height: number
  label: string
}
interface Loaded {
  regions: RegionGeo[]
}
type Selected = { key: string; name: string; value: number | null } | null

const TILT_MAX = 1.45
function Controls({
  controlsRef,
  zoomLocked,
  tiltLocked,
}: {
  controlsRef: RefObject<OrbitControls | null>
  zoomLocked: boolean
  tiltLocked: boolean
}) {
  const camera = useThree((s) => s.camera)
  const domElement = useThree((s) => s.gl.domElement)
  useEffect(() => {
    const controls = new OrbitControls(camera, domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 12
    controls.maxDistance = 300
    controls.minPolarAngle = 0
    controls.maxPolarAngle = TILT_MAX
    controlsRef.current = controls
    return () => {
      controls.dispose()
      controlsRef.current = null
    }
  }, [camera, domElement, controlsRef])
  // Zoom lock: freeze scroll/pinch zoom (rotate + pan stay live) until unlocked.
  useEffect(() => {
    if (controlsRef.current) controlsRef.current.enableZoom = !zoomLocked
  }, [zoomLocked, controlsRef])
  // Tilt lock: freeze the up/down (polar) angle at its current value, so the 2D↔3D
  // tilt can't change. Unlocking restores the full tilt range.
  useEffect(() => {
    const c = controlsRef.current
    if (!c) return
    if (tiltLocked) {
      const a = c.getPolarAngle()
      c.minPolarAngle = a
      c.maxPolarAngle = a
    } else {
      c.minPolarAngle = 0
      c.maxPolarAngle = TILT_MAX
    }
  }, [tiltLocked, controlsRef])
  return null
}

/** A flag planted on a region: a fixed-height pole with a banner at the top that
 *  shows the number and always faces the camera (billboarded sprite anchored at
 *  its left edge, so it flies off the pole like a real flag). The group's Y is
 *  corrected each frame to sit on the (tilt-morphed) region top. */
const POLE_LEN = 7
function Flag({ text, x, z, height, flagColor, poleColor }: { text: string; x: number; z: number; height: number; flagColor: string; poleColor: string }) {
  const texture = useMemo(() => makeFlagTexture(text, flagColor), [text, flagColor])
  useEffect(() => () => texture.dispose(), [texture])
  const spriteRef = useRef<THREE.Sprite>(null)
  useEffect(() => {
    spriteRef.current?.center.set(0, 0.5) // anchor flag's left-middle to the pole top
  }, [])
  const img = texture.image as HTMLCanvasElement
  const bannerH = 3.2
  return (
    <group position={[x, height, z]} userData={{ flagHeight: height }}>
      <mesh position={[0, POLE_LEN / 2, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.13, 0.13, POLE_LEN, 6]} />
        <meshBasicMaterial color={poleColor} />
      </mesh>
      <sprite
        ref={spriteRef}
        position={[0, POLE_LEN, 0]}
        scale={[(bannerH * img.width) / img.height, bannerH, 1]}
        raycast={() => null}
      >
        <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} />
      </sprite>
    </group>
  )
}

// ── Scene ────────────────────────────────────────────────────────────────────────

interface SceneProps {
  plan: GeoPlan
  data: Row[]
  mode: '2d' | '3d'
  aesthetic: Aesthetic
  gradient: Gradient
  enc: EncFlags
  /** Narrow the base map to a continent/country (null = whole extent). */
  scopeFilter: ((name: string, lon: number, lat: number) => boolean) | null
  projection: ProjectionDef
  resetToken: number
  zoomLocked: boolean
  tiltLocked: boolean
  selectedKey: string | null
  onSelect: (s: Selected) => void
  onReady: () => void
}

function Scene({ plan, data, mode, aesthetic, gradient, enc, scopeFilter, projection, resetToken, zoomLocked, tiltLocked, selectedKey, onSelect, onReady }: SceneProps) {
  const { camera } = useThree()
  const controlsRef = useRef<OrbitControls | null>(null)
  const groupRef = useRef<THREE.Group>(null)
  const labelGroupRef = useRef<THREE.Group>(null)
  const tweenRef = useRef<number | null>(mode === '3d' ? PHI_3D : PHI_2D)
  const modeRef = useRef(mode)
  const sphRef = useRef(new THREE.Spherical())
  const unitCylinder = useMemo(() => new THREE.CylinderGeometry(1.1, 1.1, 1, 20), [])
  const unitSphere = useMemo(() => new THREE.SphereGeometry(1, 18, 12), [])
  useEffect(() => () => {
    unitCylinder.dispose()
    unitSphere.dispose()
  }, [unitCylinder, unitSphere])
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let cancelled = false
    const created: THREE.BufferGeometry[] = []
    const baseMode = plan.mode === 'usa' ? 'usa' : 'world'
    loadFeatureCollection(baseMode)
      .then((fc) => {
        if (cancelled) return
        // Drop Antarctica for projections that can't represent the poles (Mercator).
        let features = fc.features.filter(
          (f) => f.properties?.name && (baseMode === 'usa' || projection.antarctica || f.properties.name !== 'Antarctica'),
        )
        // Narrow to the requested continent/country (fit + build only those).
        if (scopeFilter) {
          const kept = features.filter((f) => {
            const [lon, lat] = geomCentroid(f.geometry as { type: string; coordinates: unknown })
            return scopeFilter(f.properties.name ?? '', lon, lat)
          })
          if (kept.length) features = kept
        }

        // The user-chosen flat-map projection (see PROJECTIONS). Using the
        // projection's STREAM (not point-by-point) clips polygons at the
        // antimeridian, so Russia/Fiji/Alaska no longer streak across.
        const proj: GeoProjection = baseMode === 'usa' ? geoAlbersUsa() : projection.make()
        proj.fitExtent(
          [
            [-60, -31],
            [60, 31],
          ],
          { type: 'FeatureCollection', features } as never,
        )

        // Shoelace signed area — exterior rings and holes wind oppositely.
        const ringArea = (r: [number, number][]) => {
          let a = 0
          for (let i = 0; i < r.length; i++) {
            const [x1, y1] = r[i]
            const [x2, y2] = r[(i + 1) % r.length]
            a += x1 * y2 - x2 * y1
          }
          return a / 2
        }
        // Ray-cast point-in-polygon (to assign a hole to its containing exterior).
        const pointInRing = (px: number, py: number, r: [number, number][]) => {
          let inside = false
          for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
            const [xi, yi] = r[i]
            const [xj, yj] = r[j]
            if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
          }
          return inside
        }

        const regions: RegionGeo[] = []
        for (const f of features) {
          // Stream the geometry → antimeridian-clipped, projected rings (ALL of
          // them). We must NOT rely on emission order to tell exteriors from
          // holes: after antimeridian clipping d3 can emit a country's main body
          // as a non-first ring (this was silently dropping Russia's mainland).
          const rings: [number, number][][] = []
          let cur: [number, number][] | null = null
          const sink = {
            polygonStart() {},
            polygonEnd() {},
            lineStart() {
              cur = []
            },
            lineEnd() {
              if (cur && cur.length >= 3) rings.push(cur)
              cur = null
            },
            point(x: number, y: number) {
              cur?.push([x, -y]) // flip y so north is up in shape space
            },
            sphere() {},
          }
          geoStream(f.geometry as never, proj.stream(sink as never))
          if (rings.length === 0) continue

          // Classify by winding: the largest-|area| ring is exterior; rings that
          // share its sign are exteriors (filled), the rest are holes (cut out,
          // e.g. Lesotho inside South Africa).
          const areas = rings.map(ringArea)
          let maxAbs = 0
          let extSign = 1
          areas.forEach((a) => {
            if (Math.abs(a) > maxAbs) {
              maxAbs = Math.abs(a)
              extSign = Math.sign(a) || 1
            }
          })
          const exteriors = rings.filter((_, i) => Math.sign(areas[i]) === extSign)
          const holes = rings.filter((_, i) => Math.sign(areas[i]) !== extSign)

          const ringGeoms: THREE.BufferGeometry[] = []
          const segs: number[] = []
          const cxs: number[] = []
          const czs: number[] = []
          for (const ring of exteriors) {
            const shape = new THREE.Shape()
            ring.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)))
            for (const h of holes) {
              if (h.length && pointInRing(h[0][0], h[0][1], ring)) {
                const path = new THREE.Path()
                h.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)))
                shape.holes.push(path)
              }
            }
            const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false })
            g.rotateX(-Math.PI / 2)
            g.computeVertexNormals()
            ringGeoms.push(g)
            for (const [x, y] of ring) {
              cxs.push(x)
              czs.push(y)
            }
          }
          if (ringGeoms.length === 0) continue
          // Borders: every ring's edges (exteriors + holes), skipping long
          // pole/antimeridian-clip segments.
          for (const ring of rings) {
            for (let i = 0; i < ring.length; i++) {
              const a = ring[i]
              const b = ring[(i + 1) % ring.length]
              if (Math.hypot(a[0] - b[0], a[1] - b[1]) > MAX_BORDER_EDGE) continue // skip pole/clip lines
              segs.push(a[0], 1, -a[1], b[0], 1, -b[1])
            }
          }
          let geometry: THREE.BufferGeometry
          if (ringGeoms.length === 1) geometry = ringGeoms[0]
          else {
            const merged = mergeGeometries(ringGeoms, false)
            if (merged) {
              geometry = merged
              ringGeoms.forEach((g) => g.dispose())
            } else geometry = ringGeoms[0]
          }
          const borderGeom = new THREE.BufferGeometry()
          borderGeom.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3))
          created.push(geometry, borderGeom)
          const name = f.properties.name ?? ''
          regions.push({
            key: featureKey(name, baseMode),
            name,
            geometry,
            borderGeom,
            cx: cxs.reduce((p, c) => p + c, 0) / cxs.length,
            cz: -(czs.reduce((p, c) => p + c, 0) / czs.length),
          })
        }
        if (cancelled) created.forEach((g) => g.dispose())
        else {
          setLoaded({ regions })
          onReady()
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      created.forEach((g) => g.dispose())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan])

  const values = useMemo(() => {
    const map = new Map<string, RegionValue>()
    if (!loaded || plan.mode === 'points' || !plan.locationField) return map
    const agg = aggregateByRegion(data, plan.locationField, plan.mode, plan.valueField, plan.aggregate)
    const vals = [...agg.values()].map((v) => v.value)
    const vMin = vals.length ? Math.min(...vals) : 0
    const vMax = vals.length ? Math.max(...vals) : 1
    for (const [key, rv] of agg) {
      const norm = vMax > vMin ? (rv.value - vMin) / (vMax - vMin) : 0.5
      let colorHex = enc.color ? rampHex(norm, gradient.low, gradient.high) : rampHex(0.55, gradient.low, gradient.high)
      if (enc.saturation) colorHex = desaturateHex(colorHex, 1 - norm)
      map.set(key, { value: rv.value, norm, colorHex, height: 1 + norm * MAX_HEIGHT, label: rv.label })
    }
    return map
  }, [loaded, data, plan, gradient, enc.color, enc.saturation])

  const regionByKey = useMemo(() => new Map((loaded?.regions ?? []).map((r) => [r.key, r] as const)), [loaded])

  // Flags: top-N by value + the selected region.
  const labelList = useMemo(() => {
    if (!enc.flags || plan.mode === 'points') return []
    const entries = [...values.entries()].filter(([k]) => regionByKey.has(k)).sort((a, b) => b[1].value - a[1].value)
    const top = entries.slice(0, 12)
    if (selectedKey && values.has(selectedKey) && !top.some(([k]) => k === selectedKey)) {
      top.push([selectedKey, values.get(selectedKey)!])
    }
    return top.map(([key, v]) => {
      const r = regionByKey.get(key)!
      return { key, x: r.cx, z: r.cz, height: v.height, text: fmt(v.value), colorHex: v.colorHex }
    })
  }, [enc.flags, plan.mode, values, regionByKey, selectedKey])

  useFrame((state) => {
    const controls = controlsRef.current
    const group = groupRef.current
    if (!controls || !group) return
    if (tweenRef.current != null) {
      const sph = sphRef.current
      const offset = camera.position.clone().sub(controls.target)
      sph.setFromVector3(offset)
      sph.phi += (tweenRef.current - sph.phi) * 0.12
      if (Math.abs(sph.phi - tweenRef.current) < 0.004) {
        sph.phi = tweenRef.current
        tweenRef.current = null
      }
      sph.makeSafe()
      offset.setFromSpherical(sph)
      camera.position.copy(controls.target).add(offset)
    }
    const sy = Math.max(MIN_SCALE_Y, smoothstep(FLAT_PHI, FULL_PHI, controls.getPolarAngle()))
    group.scale.y = sy
    controls.update()

    // Pulse: oscillate region emissive by value (motion encoding).
    if (enc.pulse) {
      const wave = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 3.5)
      group.traverse((o) => {
        const ud = o.userData
        if (ud?.isRegion && (o as THREE.Mesh).material instanceof THREE.MeshStandardMaterial) {
          ;((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity =
            (ud.baseEmissive as number) + (ud.norm as number) * 0.9 * wave
        }
      })
    }
    // Keep flags planted on the (morphed) region tops.
    const lg = labelGroupRef.current
    if (lg) for (const c of lg.children) c.position.y = ((c.userData.flagHeight as number) ?? 0) * sy
  })

  useEffect(() => {
    modeRef.current = mode
    tweenRef.current = mode === '3d' ? PHI_3D : PHI_2D
  }, [mode])

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    controls.target.set(0, 0, 0)
    camera.position.setFromSpherical(new THREE.Spherical(DEFAULT_RADIUS, Math.max(0.0001, modeRef.current === '3d' ? PHI_3D : PHI_2D), 0))
    controls.update()
    queueMicrotask(() => onSelect(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken])

  const focus = (cx: number, worldTop: number, cz: number) => {
    const controls = controlsRef.current
    if (!controls) return
    const c = new THREE.Vector3(cx, worldTop, cz)
    controls.target.copy(c)
    const dir = camera.position.clone().sub(c)
    if (dir.lengthSq() < 1e-4) dir.set(0, 1, 1)
    camera.position.copy(c.clone().add(dir.normalize().multiplyScalar(42)))
    controls.update()
  }
  const groupScaleY = () => groupRef.current?.scale.y ?? 1

  return (
    <>
      <color attach="background" args={[aesthetic.background]} />
      <hemisphereLight args={[aesthetic.hemiSky, aesthetic.hemiGround, aesthetic.hemiIntensity]} />
      <directionalLight position={[40, 90, 50]} intensity={aesthetic.keyIntensity} />
      <directionalLight position={[-50, 35, -45]} intensity={aesthetic.rimIntensity} color={aesthetic.rim} />
      <ambientLight intensity={aesthetic.ambient} />
      <Controls controlsRef={controlsRef} zoomLocked={zoomLocked} tiltLocked={tiltLocked} />

      <group ref={groupRef}>
        {loaded?.regions.map((g) => {
          const v = values.get(g.key)
          const height = v ? v.height : 0.6
          const norm = v ? v.norm : 0
          const colorHex = v ? v.colorHex : aesthetic.gray
          const isSel = selectedKey === g.key
          const baseEmissive = aesthetic.emissiveIntensity + (enc.glow ? norm * 0.85 : 0)
          return (
            <mesh
              key={g.key}
              geometry={g.geometry}
              scale={[1, height, 1]}
              userData={{ isRegion: true, norm, baseEmissive }}
              onClick={
                v
                  ? (e) => {
                      e.stopPropagation()
                      onSelect({ key: g.key, name: v.label, value: v.value })
                      focus(g.cx, height * groupScaleY(), g.cz)
                    }
                  : undefined
              }
            >
              <meshStandardMaterial
                color={colorHex}
                emissive={isSel ? aesthetic.highlight : colorHex}
                emissiveIntensity={isSel ? 0.55 : baseEmissive}
                roughness={enc.sheen ? Math.max(0.05, 0.7 - norm * 0.55) : aesthetic.roughness}
                metalness={enc.sheen ? Math.min(1, 0.1 + norm * 0.85) : aesthetic.metalness}
                transparent={enc.opacity}
                opacity={enc.opacity ? 0.25 + norm * 0.75 : 1}
                side={THREE.DoubleSide}
                polygonOffset
                polygonOffsetFactor={1}
                polygonOffsetUnits={1}
              />
              <lineSegments geometry={g.borderGeom} renderOrder={1}>
                <lineBasicMaterial color={aesthetic.border} transparent opacity={aesthetic.borderOpacity} depthWrite={false} />
              </lineSegments>
            </mesh>
          )
        })}

        {/* Bubbles — proportional sphere per region */}
        {enc.bubbles &&
          loaded?.regions.map((g) => {
            const v = values.get(g.key)
            if (!v) return null
            const r = 0.7 + v.norm * 4.5
            return (
              <mesh key={`b-${g.key}`} geometry={unitSphere} position={[g.cx, v.height, g.cz]} scale={r} raycast={() => null}>
                <meshStandardMaterial color={v.colorHex} emissive={v.colorHex} emissiveIntensity={0.25} roughness={0.3} metalness={0.3} />
              </mesh>
            )
          })}

        {/* Spikes — proportional column per region */}
        {enc.spikes &&
          loaded?.regions.map((g) => {
            const v = values.get(g.key)
            if (!v) return null
            const h = 2 + v.norm * 16
            return (
              <mesh key={`s-${g.key}`} geometry={unitCylinder} position={[g.cx, v.height + h / 2, g.cz]} scale={[0.45, h, 0.45]} raycast={() => null}>
                <meshStandardMaterial color={v.colorHex} emissive={v.colorHex} emissiveIntensity={0.3} roughness={0.3} metalness={0.4} />
              </mesh>
            )
          })}
      </group>

      {/* Flags — outside the tilt group so the pole keeps constant height and the
          banner stays undistorted; each flag's base Y tracks its region top per frame. */}
      <group ref={labelGroupRef}>
        {labelList.map((l) => (
          <Flag key={l.key} text={l.text} x={l.x} z={l.z} height={l.height} flagColor={l.colorHex} poleColor={aesthetic.highlight} />
        ))}
      </group>
    </>
  )
}

// ── Minimisable panel (bottom-right): Style + Encoding ───────────────────────────

function MapPanel({
  aestheticId,
  onAesthetic,
  projectionId,
  onProjection,
  gradient,
  onGradient,
  styleRamp,
  enc,
  onToggleEnc,
  zoomLocked,
  onToggleZoom,
  tiltLocked,
  onToggleTilt,
}: {
  aestheticId: string
  onAesthetic: (id: string) => void
  projectionId: string
  onProjection: (id: string) => void
  gradient: Gradient
  onGradient: (g: Gradient) => void
  styleRamp: [string, string]
  enc: EncFlags
  onToggleEnc: (id: EncId) => void
  zoomLocked: boolean
  onToggleZoom: () => void
  tiltLocked: boolean
  onToggleTilt: () => void
}) {
  const [open, setOpen] = useState(false)
  const activeCount = ENCODINGS.filter((e) => enc[e.id]).length
  const swatch = 'h-6 w-6 shrink-0 cursor-pointer rounded'
  const swatchStyle = { padding: 0, border: '1px solid var(--border)', background: 'transparent' }

  // Zoom + tilt locks — bare icons sitting just above the Map style control. Zoom
  // lock freezes scroll/pinch zoom; tilt lock freezes the 2D↔3D up/down angle.
  // (Rotate/pan otherwise stay live.)
  const lockBtn = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onToggleZoom}
        aria-label={zoomLocked ? 'Unlock map zoom' : 'Lock map zoom'}
        aria-pressed={zoomLocked}
        title={zoomLocked ? 'Zoom locked — click to unlock' : 'Zoom unlocked — click to lock'}
        className="flex h-8 w-8 items-center justify-center rounded-full border text-sm shadow-lg transition-opacity hover:opacity-80"
        style={{
          background: 'var(--surface-1)',
          borderColor: zoomLocked ? 'var(--accent)' : 'var(--border)',
          color: zoomLocked ? 'var(--accent)' : 'var(--text-secondary)',
        }}
      >
        {zoomLocked ? '🔒' : '🔓'}
      </button>
      <button
        type="button"
        onClick={onToggleTilt}
        aria-label={tiltLocked ? 'Unlock map tilt' : 'Lock map tilt'}
        aria-pressed={tiltLocked}
        title={tiltLocked ? 'Tilt locked — click to unlock' : 'Tilt unlocked — click to lock'}
        className="flex h-8 w-8 items-center justify-center rounded-full border text-sm shadow-lg transition-opacity hover:opacity-80"
        style={{
          background: 'var(--surface-1)',
          borderColor: tiltLocked ? 'var(--accent)' : 'var(--border)',
          color: tiltLocked ? 'var(--accent)' : 'var(--text-secondary)',
        }}
      >
        {tiltLocked ? '⛰️' : '⤢'}
      </button>
    </div>
  )

  if (!open) {
    return (
      <div className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2">
        {lockBtn}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg transition-opacity hover:opacity-80"
          style={{ background: 'var(--surface-1)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        >
          🎨 Map style{activeCount > 1 ? ` · ${activeCount} encodings` : ''}
        </button>
      </div>
    )
  }

  return (
    <div className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2">
      {lockBtn}
      <div
        className="w-64 rounded-xl border p-3 shadow-2xl"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
      >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm">🎨</span>
        <span className="text-xs font-semibold">Map style</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Minimise"
          title="Minimise"
          className="ml-auto text-base leading-none transition-opacity hover:opacity-60"
          style={{ color: 'var(--text-secondary)' }}
        >
          −
        </button>
      </div>

      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
        Aesthetic
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {AESTHETICS.map((a) => (
          <button
            key={a.id}
            type="button"
            title={a.name}
            aria-label={a.name}
            onClick={() => onAesthetic(a.id)}
            className="h-6 w-8 rounded-[4px] transition-transform hover:scale-110"
            style={{
              background: `linear-gradient(135deg, ${a.rampLow}, ${a.rampHigh})`,
              outline: aestheticId === a.id ? '2px solid var(--accent)' : '1px solid rgba(128,128,128,0.3)',
              outlineOffset: aestheticId === a.id ? 1 : 0,
            }}
          />
        ))}
      </div>

      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
        Projection
      </div>
      <select
        value={projectionId}
        onChange={(e) => onProjection(e.target.value)}
        className="mb-3 w-full rounded-md border px-2 py-1 text-xs"
        style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
      >
        {PROJECTIONS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
        Value gradient
      </div>
      <div className="mb-1 flex items-center gap-2">
        <input
          type="color"
          value={gradient.low}
          onChange={(e) => onGradient({ ...gradient, low: e.target.value })}
          title="Low value color"
          aria-label="Low value color"
          className={swatch}
          style={swatchStyle}
        />
        <div className="h-3 flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${gradient.low}, ${gradient.high})` }} />
        <input
          type="color"
          value={gradient.high}
          onChange={(e) => onGradient({ ...gradient, high: e.target.value })}
          title="High value color"
          aria-label="High value color"
          className={swatch}
          style={swatchStyle}
        />
      </div>
      <div className="mb-3 flex items-center justify-between text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
        <span>Low</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onGradient({ low: gradient.high, high: gradient.low })}
            className="rounded px-1.5 py-0.5 hover:opacity-70"
            style={{ color: 'var(--text-secondary)' }}
          >
            ⇄ swap
          </button>
          <button
            type="button"
            onClick={() => onGradient({ low: styleRamp[0], high: styleRamp[1] })}
            className="rounded px-1.5 py-0.5 hover:opacity-70"
            style={{ color: 'var(--accent)' }}
          >
            use style
          </button>
        </div>
        <span>High</span>
      </div>

      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
          Show value by
        </span>
        <span className="text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
          + height (always)
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ENCODINGS.map((e) => {
          const on = enc[e.id]
          return (
            <button
              key={e.id}
              type="button"
              title={e.hint}
              aria-pressed={on}
              onClick={() => onToggleEnc(e.id)}
              className="rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors"
              style={{
                background: on ? 'var(--accent)' : 'var(--surface-2)',
                borderColor: on ? 'var(--accent)' : 'var(--border)',
                color: on ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {e.name}
            </button>
          )
        })}
      </div>
      </div>
    </div>
  )
}

// ── Shell ────────────────────────────────────────────────────────────────────────

/** Shown when a map is requested without a scope ("create a map") — asks the
 *  user what to map, grounded in the same guidance the AI reference (chart_guide)
 *  gives for map prompts. */
function ClarifyPrompt() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center" style={{ color: 'var(--text-secondary)' }}>
      <div className="text-3xl">🗺️</div>
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        Map of what, specifically?
      </p>
      <ul className="space-y-1 text-xs">
        <li>
          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>“world map”</span> — the whole world
        </li>
        <li>
          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>“map of Europe”</span> /{' '}
          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>“map of Japan”</span> — a continent or country
        </li>
        <li>
          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>“map of sales by state”</span> — shade your data by a country/state column
        </li>
      </ul>
    </div>
  )
}

export interface MapViewProps {
  data: Row[]
  columns: Column[]
  spec: VizSpec
  /** The natural-language request, used to read the map scope (world/continent/country). */
  request?: string
}

export function MapView({ data, columns, spec, request }: MapViewProps) {
  const scope = useMemo(() => detectMapScope(request ?? ''), [request])
  // Explicit "by <geo column>" shading (spec carries `location`).
  const explicitPlan = useMemo(() => (data.length ? planGeo(spec, columns, data) : null), [spec, columns, data])
  // The measure the user named (e.g. "sales") + the best geo column in the data.
  const value = useMemo(() => deriveMapValue(spec, columns), [spec, columns])
  const dataGeo = useMemo(() => (data.length ? detectDataGeo(columns, data) : null), [columns, data])

  // Decide what to render:
  //  1. explicit "by column" → shade it
  //  2. a NAMED measure + a geo column in the data → shade that column by the
  //     measure (this is "map of the world FOR sales"); country-level scopes need
  //     country data
  //  3. a scope but no data to shade → the requested geography as a base map
  //  4. nothing → ask "map of what?"
  const plan = useMemo<GeoPlan | null>(() => {
    if (explicitPlan) return explicitPlan
    // Country AND continent data can both fill a world-scoped request; only US-state
    // data can't (it has no geometry outside the US).
    if (value.valueField && dataGeo && (!scope || dataGeo.mode === 'world' || dataGeo.mode === 'continent')) {
      return { mode: dataGeo.mode, locationField: dataGeo.field, valueField: value.valueField, aggregate: value.aggregate, valueLabel: value.valueLabel }
    }
    if (scope) return { mode: 'world', aggregate: 'count', valueLabel: '' }
    return null
  }, [explicitPlan, value, dataGeo, scope])

  const scopeFilter = useMemo<SceneProps['scopeFilter']>(() => {
    if (!plan || plan.mode !== 'world' || !scope || scope.kind === 'world') return null
    if (scope.kind === 'continent') {
      const c = scope.continent
      return (_n, lon, lat) => continentOf(lon, lat) === c
    }
    const country = scope.country
    return (name) => canonicalCountry(name) === country
  }, [plan, scope])

  const viewKey = plan
    ? `${plan.mode}:${plan.locationField ?? ''}:${plan.valueField ?? ''}:${plan.aggregate}:${scope ? (scope.kind === 'continent' ? scope.continent : scope.kind === 'country' ? scope.country : 'world') : ''}`
    : 'clarify'

  // Fixed to a flat start; drag still tilts the map (the 2D↔3D height morph
  // follows the camera angle). The old Tilt/Reset buttons were removed.
  const [mode] = useState<'2d' | '3d'>('2d')
  const [aestheticId, setAestheticId] = useState('broadcast')
  const [projectionId, setProjectionId] = useState(DEFAULT_PROJECTION)
  const [gradient, setGradient] = useState<Gradient>(DEFAULT_GRADIENT)
  const [enc, setEnc] = useState<EncFlags>(DEFAULT_ENC)
  const [resetToken] = useState(0)
  const [zoomLocked, setZoomLocked] = useState(false)
  const [tiltLocked, setTiltLocked] = useState(false)
  const [selected, setSelected] = useState<Selected>(null)
  const [ready, setReady] = useState(false)
  const aesthetic = AESTHETICS.find((a) => a.id === aestheticId) ?? AESTHETICS[0]
  const projection = PROJECTIONS.find((p) => p.id === projectionId) ?? PROJECTIONS[0]

  if (!plan) return <ClarifyPrompt />

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg">
      <Canvas
        key={`${viewKey}:${projectionId}`}
        // Perf: cap the pixel ratio (Retina renders ~2x the pixels otherwise) and
        // ask for the discrete GPU. logarithmicDepthBuffer was dropped — it forces
        // per-fragment depth writes (disabling the GPU's early-Z, so hidden pixels
        // still run the lighting shader). A tight near/far range + polygonOffset on
        // the region fills keep z-fighting/borders clean without it.
        dpr={[1, 1.5]}
        camera={{ position: [0, 88, 4], fov: 45, near: 2, far: 600 }}
        gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.08, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
        onPointerMissed={() => setSelected(null)}
        style={{ width: '100%', height: '100%' }}
      >
        <Scene
          plan={plan}
          data={data}
          mode={mode}
          aesthetic={aesthetic}
          gradient={gradient}
          enc={enc}
          scopeFilter={scopeFilter}
          projection={projection}
          resetToken={resetToken}
          zoomLocked={zoomLocked}
          tiltLocked={tiltLocked}
          selectedKey={selected?.key ?? null}
          onSelect={setSelected}
          onReady={() => setReady(true)}
        />
      </Canvas>

      <MapPanel
        aestheticId={aestheticId}
        onAesthetic={setAestheticId}
        projectionId={projectionId}
        onProjection={setProjectionId}
        gradient={gradient}
        onGradient={setGradient}
        styleRamp={[aesthetic.rampLow, aesthetic.rampHigh]}
        enc={enc}
        onToggleEnc={(id) => setEnc((e) => ({ ...e, [id]: !e[id] }))}
        zoomLocked={zoomLocked}
        onToggleZoom={() => setZoomLocked((v) => !v)}
        tiltLocked={tiltLocked}
        onToggleTilt={() => setTiltLocked((v) => !v)}
      />

      {selected && (
        <div
          className="absolute bottom-3 left-3 z-20 rounded-md border px-3 py-2 text-xs shadow"
          style={{ background: 'var(--surface-1)', borderColor: 'var(--accent)', color: 'var(--text-primary)' }}
        >
          <div className="font-semibold">{selected.name}</div>
          <div style={{ color: 'var(--text-secondary)' }}>
            {plan.valueLabel}: {selected.value == null ? '—' : selected.value.toLocaleString()}
          </div>
        </div>
      )}
      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm" style={{ color: 'var(--text-secondary)' }}>
          Loading map…
        </div>
      )}
    </div>
  )
}
