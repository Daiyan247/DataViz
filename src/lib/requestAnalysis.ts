import type { VizSpec } from './types'
import type { ChartDigest } from './chartDigest'

/**
 * Ask the backend to ANALYSE a chart and return a professional paragraph — from its
 * spec, an aggregated digest of its values, and (optionally) a PNG image of the
 * rendered chart for the vision model to actually look at. Guided server-side by
 * chart_conclusion_guide.md. Returns null on failure/abort.
 */

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export async function requestAnalysis(
  spec: VizSpec,
  digest: ChartDigest,
  image: string | null,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/analyse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec, digest, image }),
      signal,
    })
    if (!res.ok) return null
    const data = (await res.json()) as { conclusion?: string }
    const s = typeof data?.conclusion === 'string' ? data.conclusion.trim() : ''
    return s || null
  } catch {
    return null
  }
}
