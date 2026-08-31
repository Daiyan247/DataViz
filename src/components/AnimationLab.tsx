import { useEffect, useState } from 'react'
import { SpringText } from './SpringText'
import { DEFAULT_SPRING, SPRING_STORAGE_KEY, loadSpringParams, type SpringParams } from '../lib/springAnim'

/**
 * A floating, minimizable tuning box for the per-letter spring animation. It
 * loops a set of words forever and exposes every SpringParams value as a slider
 * PLUS a number input (fine steps for high sensitivity), so the animation can be
 * dialed in live. Values persist to localStorage via Save, so they survive
 * reloads and code edits — copy the JSON to hand over for baking in as final.
 *
 * Dev/tuning tool: starts minimized so it stays out of the way until opened.
 */

const LAB_WORDS = ['Visualising', 'Contemplating', 'Plotting', 'Charting', 'Analysing', 'Rendering']

interface SliderDef {
  key: keyof Omit<SpringParams, 'easing'>
  label: string
  min: number
  max: number
  step: number
}

const SLIDERS: SliderDef[] = [
  { key: 'rise', label: 'Rise (px)', min: 0, max: 90, step: 1 },
  { key: 'overshoot', label: 'Overshoot (px)', min: 0, max: 50, step: 1 },
  { key: 'startScale', label: 'Start scale', min: 0.1, max: 1, step: 0.01 },
  { key: 'peakScale', label: 'Peak scale', min: 1, max: 1.9, step: 0.01 },
  { key: 'shake', label: 'Shake (deg)', min: 0, max: 40, step: 0.5 },
  { key: 'violentChance', label: 'Violent letters (%)', min: 0, max: 100, step: 5 },
  { key: 'violence', label: 'Shake violence (deg)', min: 0, max: 60, step: 1 },
  { key: 'duration', label: 'Duration (ms)', min: 120, max: 3000, step: 10 },
  { key: 'popInterval', label: 'Pop interval (ms)', min: 0, max: 400, step: 5 },
  { key: 'jitter', label: 'Timing jitter (ms)', min: 0, max: 600, step: 10 },
  { key: 'groundEffect', label: 'Ground puff (px)', min: 0, max: 40, step: 1 },
  { key: 'dustCount', label: 'Dust particles', min: 0, max: 14, step: 1 },
  { key: 'dustFloat', label: 'Dust float (px)', min: 0, max: 70, step: 1 },
  { key: 'dotCount', label: 'Dot count', min: 0, max: 6, step: 1 },
  { key: 'dotDelay', label: 'Dot timing (ms)', min: -1500, max: 2000, step: 50 },
  { key: 'dotStagger', label: 'Dot stagger (ms)', min: 0, max: 400, step: 10 },
  { key: 'dotFall', label: 'Dot fall (px)', min: 0, max: 140, step: 2 },
  { key: 'dotImpact', label: 'Dot impact', min: 0, max: 1, step: 0.05 },
  { key: 'dotDuration', label: 'Dot duration (ms)', min: 120, max: 1500, step: 10 },
  { key: 'wordInterval', label: 'Word interval (ms)', min: 500, max: 7000, step: 100 },
]

// X control points must stay in [0,1]; Y can overshoot to make it bounce.
const EASING: { label: string; min: number; max: number }[] = [
  { label: 'ease x1', min: 0, max: 1 },
  { label: 'ease y1', min: -2, max: 3 },
  { label: 'ease x2', min: 0, max: 1 },
  { label: 'ease y2', min: -2, max: 3 },
]

function Row({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  const commit = (raw: string) => {
    const v = parseFloat(raw)
    if (!Number.isNaN(v)) onChange(v)
  }
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <span className="w-28 shrink-0" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => commit(e.target.value)}
        className="min-w-0 flex-1 accent-[var(--accent)]"
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => commit(e.target.value)}
        className="w-16 shrink-0 rounded border px-1 py-0.5 text-right tabular-nums"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)' }}
      />
    </label>
  )
}

export function AnimationLab() {
  const [open, setOpen] = useState(false)
  // Start from whatever was last Saved (falls back to defaults).
  const [params, setParams] = useState<SpringParams>(() => loadSpringParams())
  const [tick, setTick] = useState(0)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)

  // Loop forever while open: advancing the tick both changes the word and
  // re-triggers the spring, so the animation plays on repeat for tuning.
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setTick((t) => t + 1), params.wordInterval)
    return () => clearInterval(id)
  }, [open, params.wordInterval])

  const set = (key: keyof Omit<SpringParams, 'easing'>, v: number) =>
    setParams((p) => ({ ...p, [key]: v }))
  const setEase = (i: number, v: number) =>
    setParams((p) => {
      const easing = [...p.easing] as [number, number, number, number]
      easing[i] = v
      return { ...p, easing }
    })

  const word = LAB_WORDS[tick % LAB_WORDS.length]
  const json = JSON.stringify(params, null, 2)

  const copy = () => {
    void navigator.clipboard?.writeText(json)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const save = () => {
    try {
      localStorage.setItem(SPRING_STORAGE_KEY, json)
      setSaved(true)
      setTimeout(() => setSaved(false), 1200)
    } catch {
      /* storage unavailable — ignore */
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg transition-opacity hover:opacity-80"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
      >
        🧪 Animation Lab
      </button>
    )
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex max-h-[85vh] w-80 flex-col overflow-hidden rounded-2xl border shadow-2xl"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
    >
      {/* Header + minimize */}
      <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--border)' }}>
        <span className="text-sm">🧪</span>
        <span className="text-xs font-semibold">Animation Lab</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Minimize Animation Lab"
          title="Minimize"
          className="ml-auto text-base leading-none transition-opacity hover:opacity-60"
          style={{ color: 'var(--text-secondary)' }}
        >
          −
        </button>
      </div>

      {/* Looping preview, sitting on a "ground" line the letters spring out of. */}
      <div
        className="relative flex items-end justify-center overflow-hidden"
        style={{ height: 90, background: 'var(--surface-2)' }}
      >
        <div className="pb-2 text-2xl font-semibold" style={{ color: 'var(--accent)', lineHeight: 1 }}>
          <SpringText text={word} params={params} trigger={tick} />
        </div>
        <div className="absolute bottom-0 left-0 right-0" style={{ height: 2, background: 'var(--border)' }} />
      </div>

      {/* Controls: each is a slider + a number input (fine steps = sensitive). */}
      <div className="flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
        {SLIDERS.map((s) => (
          <Row
            key={s.key}
            label={s.label}
            value={params[s.key]}
            min={s.min}
            max={s.max}
            step={s.step}
            onChange={(v) => set(s.key, v)}
          />
        ))}
        <div className="pt-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          Spring easing (cubic-bezier)
        </div>
        {EASING.map((e, i) => (
          <Row
            key={e.label}
            label={e.label}
            value={params.easing[i]}
            min={e.min}
            max={e.max}
            step={0.01}
            onChange={(v) => setEase(i, v)}
          />
        ))}
      </div>

      {/* Params readout + actions */}
      <div className="border-t px-3 py-2" style={{ borderColor: 'var(--border)' }}>
        <div className="mb-2 flex gap-2">
          <button
            type="button"
            onClick={save}
            className="rounded-full px-3 py-0.5 text-xs font-medium text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--accent)' }}
          >
            {saved ? 'Saved ✓' : 'Save'}
          </button>
          <button
            type="button"
            onClick={copy}
            className="rounded-full border px-3 py-0.5 text-xs font-medium transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={() => setParams(DEFAULT_SPRING)}
            className="rounded-full border px-3 py-0.5 text-xs font-medium transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            Reset
          </button>
        </div>
        <pre
          className="max-h-28 overflow-auto rounded border p-2 text-[10px] leading-tight"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
        >
          {json}
        </pre>
      </div>
    </div>
  )
}
