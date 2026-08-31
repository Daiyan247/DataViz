import type { ColumnProfile, VizResult } from './types'

/**
 * Ask the backend (FastAPI + local model via Ollama) to turn a natural-language
 * request into a Vega-Lite VizSpec. AI-only: there is NO local fallback — if the
 * backend is unreachable or errors, this throws and the caller surfaces an error
 * rather than silently guessing a chart.
 *
 * Only the request text and the column PROFILES (name + measurement level + shape
 * stats) are sent — the parsed rows stay in the browser.
 */

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export async function requestChartSpec(
  request: string,
  profiles: ColumnProfile[],
): Promise<VizResult> {
  const res = await fetch(`${API_BASE}/api/chart-spec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request, columns: profiles }),
  })
  if (!res.ok) throw new Error(`Chart backend responded ${res.status}`)
  const data = (await res.json()) as VizResult
  if (!data?.spec?.mark) throw new Error('Malformed response from chart backend')
  return data
}
