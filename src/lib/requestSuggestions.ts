import type { ColumnProfile } from './types'
import type { ChartKind } from './suggestCharts'

/**
 * Ask the backend (the local model) to READ the request and return which chart TYPES fit
 * it, best first (from the fixed kind vocabulary). The client maps those to the
 * representative specs. Returns null on failure / abort so the caller falls back
 * to the deterministic type ordering.
 */

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export async function requestSuggestedKinds(
  request: string,
  profiles: ColumnProfile[],
  signal?: AbortSignal,
): Promise<ChartKind[] | null> {
  try {
    const res = await fetch(`${API_BASE}/api/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request, columns: profiles }),
      signal,
    })
    if (!res.ok) throw new Error(`Backend responded ${res.status}`)
    const data = (await res.json()) as { kinds?: ChartKind[] }
    return Array.isArray(data?.kinds) ? data.kinds : null
  } catch {
    return null // network error, abort, or bad payload → caller falls back
  }
}
