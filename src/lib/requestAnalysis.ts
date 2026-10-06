import type { VizSpec } from './types'
import type { ChartDigest } from './chartDigest'
import type { ChartKind } from './suggestCharts'

/**
 * Ask the backend to ANALYSE a chart, STREAMED as a pipeline of nodes.
 *
 * The chart type is forwarded from the request that produced the chart rather than
 * re-derived server-side, and each pipeline node reports as it completes so the UI
 * can show real progress through a slow local model call instead of one long
 * spinner. Guided server-side by `chart_conclusion_guide.md`.
 */

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export type NodeStatus = 'pending' | 'running' | 'done' | 'error'

export interface AnalysisNode {
  id: string
  label: string
  status: NodeStatus
  /** What this node resolved — the chart type, the columns, the evidence found. */
  detail?: string
}

export type AnalysisEvent =
  | { type: 'init'; nodes: { id: string; label: string }[] }
  | { type: 'node'; id: string; status: Exclude<NodeStatus, 'pending'>; detail?: string }
  /** A chunk of the analysis paragraph, as the model writes it — append to the
   *  running text. This is what makes the analysis feel fast: the paragraph
   *  appears as it's generated instead of only once the whole thing is ready. */
  | { type: 'delta'; text: string }
  /** A non-English draft is being thrown away and rewritten — the caller should
   *  clear whatever text it had accumulated from `delta` events so far. Rare. */
  | { type: 'restart' }
  | { type: 'result'; conclusion: string; kind?: string; label?: string; mode?: AnalysisMode }
  | { type: 'error'; message: string }

/** "normal": short, plain-English, no statistical jargon — for a general reader.
 *  "advanced": the full technical read (named indices — HHI, quartiles, r², ...)
 *  for someone who wants to see the actual reasoning behind the claim. */
export type AnalysisMode = 'normal' | 'advanced'

export interface AnalysisInput {
  spec: VizSpec
  digest: ChartDigest
  /** The user's original phrase — the authority on which chart type was asked for. */
  request: string
  kind: ChartKind
  /** Every dataset column name, so the backend can find the ones the request named. */
  columns: string[]
  image: string | null
  mode: AnalysisMode
}

export interface AnalysisOutcome {
  conclusion: string | null
  error: string | null
}

/** Split a growing SSE buffer into complete `data:` payloads. */
function drainFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = []
  let rest = buffer
  let cut = rest.indexOf('\n\n')
  while (cut !== -1) {
    const frame = rest.slice(0, cut)
    rest = rest.slice(cut + 2)
    for (const line of frame.split('\n')) {
      if (line.startsWith('data:')) frames.push(line.slice(5).trim())
    }
    cut = rest.indexOf('\n\n')
  }
  return { frames, rest }
}

export async function streamAnalysis(
  input: AnalysisInput,
  onEvent: (event: AnalysisEvent) => void,
  signal?: AbortSignal,
): Promise<AnalysisOutcome> {
  let conclusion: string | null = null
  let error: string | null = null

  try {
    const res = await fetch(`${API_BASE}/api/analyse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    })
    if (!res.ok || !res.body) {
      return { conclusion: null, error: 'Could not reach the analysis service. Please try again.' }
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const { frames, rest } = drainFrames(buffer)
      buffer = rest
      for (const raw of frames) {
        let event: AnalysisEvent
        try {
          event = JSON.parse(raw) as AnalysisEvent
        } catch {
          continue // a partial or malformed frame — skip it, the stream continues
        }
        if (event.type === 'result') conclusion = event.conclusion
        if (event.type === 'error') error = event.message
        onEvent(event)
      }
    }
    if (!conclusion && !error) {
      error = 'The analysis ended without a result. Please try again.'
    }
  } catch (err) {
    // An abort is the caller replacing this analysis (the data changed) — not a
    // failure to report.
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { conclusion: null, error: null }
    }
    error = 'Could not reach the analysis service. Please try again.'
  }

  return { conclusion, error }
}

/** Fold a streamed event into the node list the panel renders. */
export function applyEvent(nodes: AnalysisNode[], event: AnalysisEvent): AnalysisNode[] {
  if (event.type === 'init') {
    return event.nodes.map((n) => ({ ...n, status: 'pending' as NodeStatus }))
  }
  if (event.type === 'node') {
    return nodes.map((n) => (n.id === event.id ? { ...n, status: event.status, detail: event.detail ?? n.detail } : n))
  }
  if (event.type === 'error') {
    // Whatever was mid-flight is what failed; everything after it never ran.
    return nodes.map((n) => (n.status === 'running' ? { ...n, status: 'error' as NodeStatus } : n))
  }
  return nodes
}
