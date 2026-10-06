import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyEvent, streamAnalysis, type AnalysisEvent, type AnalysisInput, type AnalysisNode } from './requestAnalysis'
import type { ChartDigest } from './chartDigest'
import type { VizSpec } from './types'

/** A fetch Response whose body streams `chunks` verbatim — including awkward splits. */
function streamingResponse(chunks: string[], ok = true): Response {
  const encoder = new TextEncoder()
  let i = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(chunks[i++]))
    },
  })
  return { ok, body } as unknown as Response
}

const spec: VizSpec = {
  mark: 'bar',
  encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' } },
}

const input: AnalysisInput = {
  spec,
  digest: { kind: 'bar', mark: 'bar', rows: 4 } as ChartDigest,
  request: 'bar chart of revenue by region',
  kind: 'bar',
  columns: ['region', 'revenue'],
  image: null,
  mode: 'normal',
}

const frame = (e: AnalysisEvent) => `data: ${JSON.stringify(e)}\n\n`

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('streamAnalysis', () => {
  it('reports every node event in order and returns the conclusion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        streamingResponse([
          frame({ type: 'init', nodes: [{ id: 'chart-type', label: 'Identify the chart type' }] }),
          frame({ type: 'node', id: 'chart-type', status: 'done', detail: 'Bar chart (from your request)' }),
          frame({ type: 'result', conclusion: 'North leads at 800.' }),
        ]),
      ),
    )

    const seen: AnalysisEvent[] = []
    const out = await streamAnalysis(input, (e) => seen.push(e))

    expect(seen.map((e) => e.type)).toEqual(['init', 'node', 'result'])
    expect(out.conclusion).toBe('North leads at 800.')
    expect(out.error).toBeNull()
  })

  it('reassembles frames split across chunk boundaries', async () => {
    // A network read can land mid-JSON or mid-delimiter; a naive per-chunk parse
    // would silently drop these events and the progress list would stall.
    const whole =
      frame({ type: 'node', id: 'reference', status: 'done', detail: 'lead with the ranking' }) +
      frame({ type: 'result', conclusion: 'Done.' })
    const chunks = [whole.slice(0, 20), whole.slice(20, 55), whole.slice(55)]

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamingResponse(chunks)))

    const seen: AnalysisEvent[] = []
    const out = await streamAnalysis(input, (e) => seen.push(e))

    expect(seen).toHaveLength(2)
    expect(out.conclusion).toBe('Done.')
  })

  it('surfaces a backend error instead of failing silently', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(streamingResponse([frame({ type: 'error', message: 'Service unavailable.' })])),
    )
    const out = await streamAnalysis(input, () => {})
    expect(out.conclusion).toBeNull()
    expect(out.error).toBe('Service unavailable.')
  })

  it('reports a stream that ends with no result at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamingResponse([frame({ type: 'node', id: 'x', status: 'done' })])))
    const out = await streamAnalysis(input, () => {})
    expect(out.error).toMatch(/without a result/i)
  })

  it('reports an unreachable backend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))
    const out = await streamAnalysis(input, () => {})
    expect(out.error).toMatch(/could not reach/i)
  })

  it('treats an abort as a replacement, not a failure to report', async () => {
    // Aborting is how the app drops an analysis whose data changed underneath it —
    // showing the user an error for that would be noise.
    const abort = new DOMException('aborted', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort))
    const out = await streamAnalysis(input, () => {}, new AbortController().signal)
    expect(out).toEqual({ conclusion: null, error: null })
  })

  it('forwards delta events in order and the result carries the fully assembled text', async () => {
    // The backend streams the paragraph word-by-word so it can render live; this is
    // the mechanism that makes analysis feel fast instead of arriving all at once.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        streamingResponse([
          frame({ type: 'delta', text: 'South ' }),
          frame({ type: 'delta', text: 'leads.' }),
          frame({ type: 'result', conclusion: 'South leads.', mode: 'normal' }),
        ]),
      ),
    )

    const seen: AnalysisEvent[] = []
    const out = await streamAnalysis(input, (e) => seen.push(e))

    expect(seen.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text)).toEqual(['South ', 'leads.'])
    expect(out.conclusion).toBe('South leads.')
  })

  it('forwards a restart event so the caller can drop a rejected non-English draft', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        streamingResponse([
          frame({ type: 'delta', text: '南部' }),
          frame({ type: 'restart' }),
          frame({ type: 'delta', text: 'South leads.' }),
          frame({ type: 'result', conclusion: 'South leads.' }),
        ]),
      ),
    )
    const seen: AnalysisEvent[] = []
    const out = await streamAnalysis(input, (e) => seen.push(e))
    expect(seen.map((e) => e.type)).toEqual(['delta', 'restart', 'delta', 'result'])
    expect(out.conclusion).toBe('South leads.')
  })
})

describe('applyEvent', () => {
  const nodes: AnalysisNode[] = [
    { id: 'a', label: 'A', status: 'pending' },
    { id: 'b', label: 'B', status: 'pending' },
  ]

  it('seeds the list from init, all pending', () => {
    const next = applyEvent([], { type: 'init', nodes: [{ id: 'a', label: 'A' }] })
    expect(next).toEqual([{ id: 'a', label: 'A', status: 'pending' }])
  })

  it('updates only the named node', () => {
    const next = applyEvent(nodes, { type: 'node', id: 'b', status: 'done', detail: 'ok' })
    expect(next[0].status).toBe('pending')
    expect(next[1]).toMatchObject({ status: 'done', detail: 'ok' })
  })

  it('keeps a node detail when a later event omits it', () => {
    const withDetail = applyEvent(nodes, { type: 'node', id: 'a', status: 'running', detail: 'reading the image' })
    const next = applyEvent(withDetail, { type: 'node', id: 'a', status: 'done' })
    expect(next[0].detail).toBe('reading the image')
  })

  it('marks whatever was running as the node that failed', () => {
    const running = applyEvent(nodes, { type: 'node', id: 'b', status: 'running' })
    const next = applyEvent(running, { type: 'error', message: 'boom' })
    expect(next[1].status).toBe('error')
    expect(next[0].status).toBe('pending') // never started, so not an error
  })
})
