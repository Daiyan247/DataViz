import type { ColumnProfile } from './types'
import type { ChartKind } from './suggestCharts'

/**
 * Ask the backend (the local model + pros/cons reference) for its opinion: would a
 * different chart type describe this data more accurately than the one shown?
 * Returns a suggestion + reason, or null (current chart is fine / backend down).
 * Advisory only — never blocks rendering.
 */

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export async function requestRecommendation(
  chosen: ChartKind,
  profiles: ColumnProfile[],
  signal?: AbortSignal,
): Promise<{ suggestion: ChartKind; reason: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chosen, columns: profiles }),
      signal,
    })
    if (!res.ok) throw new Error(`Backend responded ${res.status}`)
    const data = (await res.json()) as { suggestion?: ChartKind | null; reason?: string }
    if (data?.suggestion) return { suggestion: data.suggestion, reason: data.reason ?? '' }
    return null
  } catch {
    return null
  }
}
