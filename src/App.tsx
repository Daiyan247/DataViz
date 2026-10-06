import { useEffect, useMemo, useRef, useState } from 'react'
import { ChartColumnBig, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { parseDataFile } from './lib/parseData'
import { requestChartSpec } from './lib/requestChartSpec'
import { requestSuggestedKinds } from './lib/requestSuggestions'
import { requestRecommendation } from './lib/requestRecommendation'
import { applyEvent, streamAnalysis, type AnalysisMode, type AnalysisNode } from './lib/requestAnalysis'
import { captureChartImage } from './lib/captureChart'
import { chrome } from './lib/palette'
import { useIsDark } from './components/useIsDark'
import { chartDigest, digestHasContent } from './lib/chartDigest'
import { applyFilters } from './lib/filterRows'
import { preloadChart } from './lib/preloadChart'
import { profileColumns } from './lib/profile'
import { chartWarnings } from './lib/chartWarnings'
import { analyzeMapCoverage, detectMapScope } from './lib/geo'
import { chartKind, compatibilityBasis, suggestCharts, suggestForColumns, toSuggestion, type ChartKind, type Suggestion } from './lib/suggestCharts'
import { loadSpringParams } from './lib/springAnim'
import type { Column, ColumnProfile, DataSet, Filter, Row, VizSpec } from './lib/types'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Rotating status words while a chart is generated — all in the data-viz register.
const LOADING_WORDS = [
  'Visualising',
  'Plotting',
  'Charting',
  'Analysing',
  'Mapping the data',
  'Rendering',
  'Composing',
  'Crunching the numbers',
]

/**
 * Every advisory line for a chart, in reading order: the deterministic checks, a
 * map's data-coverage note, then the backend's fallback note. Shared by the render
 * memo and by handleSubmit, which needs to know whether the panel will already be
 * showing something at reveal time.
 */
function adviceFor(
  spec: VizSpec,
  profiles: ColumnProfile[],
  phrase: string,
  columns: Column[],
  rows: Row[],
  notice: string | null,
): string[] {
  const list = chartWarnings(spec, profiles)
  // A map's data-coverage note ("Europe isn't in your data") belongs in the same
  // Chart advice panel — not a separate overlay on the map.
  if (spec.mark === 'geoshape') {
    const cov = analyzeMapCoverage(detectMapScope(phrase), columns, rows)
    if (cov?.message) list.push(cov.message)
  }
  // Backend fallback note (e.g. a dot plot with no category -> scatter), last so it
  // reads after any type/data advice.
  if (notice) list.push(notice)
  return list
}

/** Columns the request names (normalized so "unit price" matches unit_price). */
function namedProfiles(profiles: ColumnProfile[], phrase: string): ColumnProfile[] {
  const norm = (s: string) => s.toLowerCase().replace(/[_\s]+/g, ' ').trim()
  const req = norm(phrase)
  return profiles.filter((p) => req.includes(norm(p.name)))
}
import { FileDrop } from './components/FileDrop'
import { ChartRequestInput } from './components/ChartRequestInput'
import { SuggestionBar } from './components/SuggestionBar'
import { ChartView } from './components/ChartView'
import { ChartErrorBoundary } from './components/ChartErrorBoundary'
import { WarningPopup } from './components/WarningPopup'
import { SpringText } from './components/SpringText'
import { AnimationLab } from './components/AnimationLab'
import { DataSummary } from './components/DataSummary'
import { FilterPanel } from './components/FilterPanel'
import { AnalysisPanel } from './components/AnalysisPanel'

/** One finished analysis, cached for the session. */
interface AnalysisRun {
  key: string
  nodes: AnalysisNode[]
  running: boolean
  conclusion: string | null
  error: string | null
}

export default function App() {
  const [fileName, setFileName] = useState<string | null>(null)
  const [dataset, setDataset] = useState<DataSet | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [request, setRequest] = useState('')
  const [spec, setSpec] = useState<VizSpec | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  // Charting progress (0–100) + the current step label, for the loading bar.
  const [progress, setProgress] = useState(0)
  // A rotating, data-viz-themed status word shown under the loading bar.
  const [loadingWord, setLoadingWord] = useState(LOADING_WORDS[0])
  // True during the brief fade-out after the bar fills, before the chart appears.
  const [finishing, setFinishing] = useState(false)
  // The phrase behind the current chart, and the AI's ranking of compatible
  // chart TYPES for it. Both are set on submit — suggestions come AFTER input.
  const [submitted, setSubmitted] = useState<string | null>(null)
  // The chart originally produced by "Chart it" — kept so it always stays in the
  // compatible strip (switching to another type never strands the original).
  const [submittedSpec, setSubmittedSpec] = useState<VizSpec | null>(null)
  const [submittedNote, setSubmittedNote] = useState<string | null>(null)
  // A chart-advice line from the backend (e.g. "a dot plot needs a category —
  // showing a scatter instead"). Cleared when the chart type changes.
  const [chartNotice, setChartNotice] = useState<string | null>(null)
  // Finished analyses, CACHED for the session under a key covering both the chart
  // and the data behind it (see `analysisKey`) — so revisiting a chart/filter
  // combination is instant and an analysis can never be shown against data it did
  // not describe.
  const [analysisCache, setAnalysisCache] = useState<Record<string, AnalysisRun>>({})
  // The run in progress (or the last one finished), whatever its key.
  const [analysis, setAnalysis] = useState<AnalysisRun | null>(null)
  // Cancels an in-flight analysis when the chart or the data changes under it.
  const analysisAbort = useRef<AbortController | null>(null)
  // "normal" (plain-English, no jargon) or "advanced" (named indices — HHI,
  // quartiles, r², ...). Part of the cache key: the two tiers describe the same
  // chart differently, so switching tiers must never show the other tier's text.
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('normal')
  // The CHART ONLY — captured as an image for the vision analyser. Deliberately not
  // the surrounding Card: capture takes the first <svg> it finds, and the advice
  // panel's warning icon is an <svg> that renders above the chart.
  const chartRef = useRef<HTMLDivElement>(null)
  const isDark = useIsDark()
  // Staged loading of the compatible strip: the primary chart shows first, then the
  // alternative chips fill in one-by-one (a queue) and only become clickable as each
  // "finishes". Tracked by chart KIND (not index) so the AI re-ranking can reorder
  // the strip without disturbing which ones are already done.
  const [readyKinds, setReadyKinds] = useState<Set<ChartKind>>(() => new Set())
  const [chartError, setChartError] = useState<string | null>(null)
  const [aiKinds, setAiKinds] = useState<{ query: string; list: ChartKind[] } | null>(null)
  // The AI's opinion that a different chart type would fit the data better.
  const [recommendation, setRecommendation] = useState<{ suggestion: ChartKind; reason: string } | null>(null)
  // Whether the advisor is collapsed to a pill (shown inline next to the note).
  const [advisorMin, setAdvisorMin] = useState(false)
  // Loading-word spring settings, read once from saved (Animation Lab) values.
  const springParams = useMemo(() => loadSpringParams(), [])

  const [filters, setFilters] = useState<Filter[]>([])

  const handleLoad = (name: string, text: string) => {
    try {
      const ds = parseDataFile(name, text)
      if (ds.rows.length === 0) {
        setLoadError('That file parsed to zero rows — check the format.')
        return
      }
      setDataset(ds)
      setFileName(name)
      setLoadError(null)
      setFilters([])
      setSpec(null)
      setNote(null)
      setSubmitted(null)
      setSubmittedSpec(null)
      setSubmittedNote(null)
      setAiKinds(null)
      setChartError(null)
      setChartNotice(null)
      setAnalysisCache({})
      setAnalysis(null)
      setReadyKinds(new Set())
      setRecommendation(null)
    } catch {
      // Never surface the raw parser error — it can leak internals. Keep it to a
      // generic, structure-free hint about the file itself.
      setLoadError('Could not read that file. Please check it is a valid CSV or JSON file.')
    }
  }

  // Profile columns once per dataset: measurement level + shape stats. This is
  // what the LLM reasons over and what the warnings layer checks against.
  const profiles = useMemo(
    () => (dataset ? profileColumns(dataset.columns, dataset.rows) : []),
    [dataset],
  )

  const handleSubmit = async () => {
    const phrase = request.trim()
    if (!dataset || phrase === '' || parsing) return
    // Enter loading; keep the previous chart hidden until EVERYTHING is ready so
    // the chart, its warning, and the AI tip all appear at the same moment.
    setParsing(true)
    setFinishing(false)
    setChartError(null)
    setChartNotice(null)
    setReadyKinds(new Set())
    setProgress(8)
    // Rotate the status word — randomly (no immediate repeat), at a calm pace.
    setLoadingWord(LOADING_WORDS[Math.floor(Math.random() * LOADING_WORDS.length)])
    const wordTimer = setInterval(() => {
      setLoadingWord((prev) => {
        let next = prev
        while (next === prev) next = LOADING_WORDS[Math.floor(Math.random() * LOADING_WORDS.length)]
        return next
      })
    }, 1900)
    // Trickle the bar forward during a stage (creeps toward the next milestone but
    // never reaches it until that step actually completes) so it always feels live.
    const trickle = setInterval(() => {
      setProgress((p) => (p < 90 ? p + Math.max(0.4, (90 - p) * 0.05) : p))
    }, 250)
    try {
      // 1) PRIMARY chart — the one the AI interprets from the request. AI-only (no
      //    local fallback, so a backend failure surfaces as an error, not a guess).
      //    Reveal it as soon as it's ready — before the alternatives are ranked.
      const { spec: nextSpec, note: nextNote, notice: nextNotice } = await requestChartSpec(phrase, profiles)
      const kind = chartKind(nextSpec)
      clearInterval(trickle)
      setSpec(nextSpec)
      setNote(nextNote)
      setSubmitted(phrase)
      setSubmittedSpec(nextSpec)
      setSubmittedNote(nextNote)
      setChartNotice(nextNotice ?? null)
      setAdvisorMin(false)
      // A map is lazy-loaded (three.js + the atlas), so without warming it here the
      // advice panel would paint at once and the map seconds later. Started now so
      // it runs THROUGH the reveal animation below rather than adding to it, and
      // swallowed on failure — MapView still loads on its own if this misses.
      const rowsNow = applyFilters(dataset.rows, filters)
      const mapReady = preloadChart(nextSpec, dataset.columns, rowsNow).catch(() => {})
      // Did the advisor have anything to show at the moment the chart appeared?
      // Deterministic checks are instant; the AI's opinion is not (see below).
      const adviceAtReveal = adviceFor(nextSpec, profiles, phrase, dataset.columns, rowsNow, nextNotice ?? null)
      // Fill the bar, hold, fade the loader, reveal the primary chart.
      setProgress(100)
      await wait(400)
      await mapReady
      clearInterval(wordTimer)
      setFinishing(true)
      await wait(300)
      setParsing(false)
      setFinishing(false)
      // 2) ALTERNATIVES — rank the compatible chart types + get the AI's better-fit
      //    opinion. Until these resolve, the compatible chips show as loading; then
      //    they enable one-by-one (the queue, driven by the effect below). The
      //    queue starts on its own once the chart is shown, so nothing to set here.
      const [kinds, rec] = await Promise.all([
        requestSuggestedKinds(phrase, profiles),
        requestRecommendation(kind, profiles),
      ])
      setAiKinds(kinds && kinds.length > 0 ? { query: phrase, list: kinds } : null)
      setRecommendation(rec)
      // These two model calls take a long time on a local model — measured at ~139s
      // for a map on this machine. If the advisor had nothing to say at reveal, an
      // expanded panel appearing now would drop itself over a chart the user has
      // been reading for two minutes. So late advice arrives COLLAPSED, as the small
      // pill beside the note; anything shown expanded appeared with the chart.
      if (rec && adviceAtReveal.length === 0) setAdvisorMin(true)
    } catch {
      clearInterval(trickle)
      clearInterval(wordTimer)
      setSpec(null)
      setNote(null)
      setAiKinds(null)
      setRecommendation(null)
      setReadyKinds(new Set())
      // Generic on purpose — no internals (paths, tooling, model) that could leak
      // the project structure. Details, if any, stay server-side.
      setChartError('Something went wrong on the backend. Please try again in a moment.')
      setParsing(false)
    }
  }

  // Vega-Lite aggregates/bins itself, so it receives the raw filtered rows.
  const filteredRows = useMemo(
    () => (dataset ? applyFilters(dataset.rows, filters) : []),
    [dataset, filters],
  )

  const warnings = useMemo(
    () =>
      spec
        ? adviceFor(spec, profiles, submitted ?? '', dataset?.columns ?? [], filteredRows, chartNotice)
        : [],
    [spec, profiles, submitted, dataset, filteredRows, chartNotice],
  )

  // The chart type, resolved once and shared: it keys the digest's trend branch, it
  // highlights the compatible strip, and it is what the analysis forwards to the
  // backend so the guide section is chosen from the request rather than re-inferred.
  const activeKind = spec ? chartKind(spec) : undefined

  // The AGGREGATED digest of the shown chart (browser-side — raw rows never leave).
  const chartDigestValue = useMemo(
    () => (spec && activeKind ? chartDigest(spec, filteredRows, activeKind) : null),
    [spec, filteredRows, activeKind],
  )

  // An analysis describes a CHART, the data behind it, AND which tier wrote it, so
  // the cache key covers all three. Keying on the spec alone was why filtering left
  // a stale paragraph in place: the filters change what the chart shows without
  // touching the spec. Mode has to be in the key for the same reason — normal and
  // advanced describe the same chart differently, and switching tiers must show
  // THAT tier's cached text (or generate it), never the other one's.
  const analysisKey = spec
    ? JSON.stringify({ spec, filters, rows: filteredRows.length, mode: analysisMode })
    : null

  // Anything in flight when the chart or the data changes is describing something
  // that is no longer on screen — drop it rather than letting it land.
  useEffect(() => {
    const inFlight = analysisAbort.current
    if (!inFlight) return
    inFlight.abort()
    analysisAbort.current = null
    // Settle the abandoned run too: it will never resolve, so leaving it marked as
    // running would show a permanent spinner if the user navigated back to it.
    setAnalysis((cur) => (cur?.running ? { ...cur, running: false } : cur))
  }, [analysisKey])

  const cached = analysisKey ? analysisCache[analysisKey] ?? null : null
  const live = analysis && analysis.key === analysisKey ? analysis : null
  const current = live ?? cached
  // The previous analysis is kept on screen, dimmed, when the data moves under it —
  // more useful than blanking the panel, as long as it is clearly marked.
  const previous = !current && analysis?.conclusion ? analysis : null
  const shown = current ?? previous
  const analysing = Boolean(live?.running)
  const stale = Boolean(previous)

  const digestReady = Boolean(chartDigestValue && digestHasContent(chartDigestValue))
  const canAnalyse = Boolean(spec && !parsing && digestReady) && !analysing
  const disabledReason = !spec
    ? 'Create a chart first.'
    : parsing
      ? 'Wait for the chart to finish.'
      : !digestReady
        ? 'The current filters leave nothing to analyse — clear or loosen them.'
        : undefined

  // ON-DEMAND analysis: capture the rendered chart as an image, then stream the
  // backend pipeline, folding each node event into the panel as it lands so the
  // wait on a local model shows real progress. `delta` events build the paragraph
  // up live — the whole point of streaming is that it appears as it's written,
  // not only once the entire thing is ready. Cached under `analysisKey`.
  const analyseGraph = async () => {
    if (!spec || !analysisKey || !chartDigestValue || !activeKind || analysing) return
    const controller = new AbortController()
    analysisAbort.current?.abort()
    analysisAbort.current = controller
    const key = analysisKey

    let nodes: AnalysisNode[] = []
    let liveText = ''
    setAnalysis({ key, nodes, running: true, conclusion: null, error: null })

    // The chart's real surface, so a dark-mode capture isn't pale text on white.
    const image = await captureChartImage(chartRef.current, chrome(isDark).surface)
    if (controller.signal.aborted) return

    const { conclusion, error } = await streamAnalysis(
      {
        spec,
        digest: chartDigestValue,
        // The phrase the chart was built from — the backend reads the chart TYPE
        // back out of it instead of guessing from the spec's shape.
        request: submitted ?? '',
        kind: activeKind,
        columns: dataset?.columns.map((c) => c.name) ?? [],
        image,
        mode: analysisMode,
      },
      (event) => {
        if (event.type === 'delta') {
          liveText += event.text
          setAnalysis((cur) => (cur && cur.key === key ? { ...cur, conclusion: liveText } : cur))
          return
        }
        if (event.type === 'restart') {
          // A non-English draft is being thrown away — clear it rather than
          // appending the retry's text onto the rejected one.
          liveText = ''
          setAnalysis((cur) => (cur && cur.key === key ? { ...cur, conclusion: null } : cur))
          return
        }
        nodes = applyEvent(nodes, event)
        const next = nodes
        setAnalysis((cur) => (cur && cur.key === key ? { ...cur, nodes: next } : cur))
      },
      controller.signal,
    )

    if (controller.signal.aborted) return
    const finished: AnalysisRun = { key, nodes, running: false, conclusion, error }
    setAnalysis((cur) => (cur && cur.key === key ? finished : cur))
    if (conclusion) setAnalysisCache((prev) => ({ ...prev, [key]: finished }))
  }

  // Chart types compatible with the columns this chart is ABOUT — each must use ALL
  // of them and add none. That set is the columns you named PLUS the ones the app
  // resolved for you (a map's geographic column, a bubble's third field): the phrase
  // "world map of population_m" never says "country", but the chart is about it, so
  // without it the strip would offer bare one-measure charts and drop the bar.
  // (Vague requests with no named columns still fall back to what the whole dataset
  // supports.) The AI's read of the phrase only ORDERS the list.
  const suggestions = useMemo(() => {
    if (!spec) return []
    const named = namedProfiles(profiles, submitted ?? '')
    const basis = compatibilityBasis(named, submittedSpec, profiles)
    const feasible = named.length >= 1 ? suggestForColumns(basis) : suggestCharts(profiles)
    const byKind = new Map(feasible.map((s) => [s.kind, s]))
    // Always keep the chart you originally asked for in the strip (restorable),
    // even if it uses columns beyond the named ones (e.g. a bubble's 3rd field).
    if (submittedSpec) {
      byKind.set(chartKind(submittedSpec), toSuggestion(submittedSpec, submittedNote ?? undefined))
    }
    const all = [...byKind.values()]
    const aiOrder = aiKinds?.query === submitted ? aiKinds.list : []
    const picked = aiOrder.map((k) => byKind.get(k)).filter((s): s is Suggestion => Boolean(s))
    const rest = all.filter((s) => !aiOrder.includes(s.kind))
    return [...picked, ...rest]
  }, [spec, aiKinds, submitted, submittedSpec, submittedNote, profiles])

  // Compatible-chart QUEUE — the alternatives reveal strictly ONE AT A TIME so the
  // strip fills in a visible queue. `loadingKind` is the chip currently "loading"
  // (skipping the one on screen); the effect marks it done after a beat, moving the
  // cursor on. Analysis itself is on-demand (the Analyse button), not tied here.
  const loadingKind =
    spec && !parsing
      ? suggestions.find((s) => s.kind !== activeKind && !readyKinds.has(s.kind))?.kind ?? null
      : null

  useEffect(() => {
    if (!loadingKind) return
    const timer = setTimeout(() => {
      setReadyKinds((prev) => {
        const next = new Set(prev)
        next.add(loadingKind)
        return next
      })
    }, 500) // clearly one-by-one, with the loading animation visible on each
    return () => clearTimeout(timer)
  }, [loadingKind])

  // The advisor can offer "Switch": the AI-recommended better chart type (must be
  // compatible). (There is no auto-"Fix" — see docs/rejected-alternatives.md.)
  const switchTarget =
    recommendation ? suggestions.find((s) => s.kind === recommendation.suggestion) : undefined
  const advisorRec = switchTarget ? { label: switchTarget.label, reason: recommendation!.reason } : null
  const hasAdvice = warnings.length > 0 || Boolean(advisorRec)

  // Clicking a compatible-chart chip swaps to that type instantly, without
  // touching the user's typed phrase.
  const handleSuggestion = (s: Suggestion) => {
    setSpec(s.spec)
    setNote(s.note)
    setRecommendation(null) // an explicit pick — don't second-guess it
    setChartNotice(null) // the fallback note was about the original request/type
    setAdvisorMin(false)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b bg-card px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ChartColumnBig className="size-4" />
          </span>
          <h1 className="text-sm font-medium">DataViz Studio</h1>
        </div>
        <Badge variant="outline" className="text-muted-foreground">
          CSV / JSON → charts · fully offline
        </Badge>
      </header>

      <main className="flex min-h-0 flex-1 gap-4 p-4">
        {dataset ? (
          <>
            <aside className="w-56 shrink-0">
              <Card className="dvs-scroll h-full gap-6 overflow-y-auto px-4">
                <DataSummary fileName={fileName ?? ''} dataset={dataset} filteredCount={filteredRows.length} />
                <FilterPanel
                columns={dataset.columns}
                rows={dataset.rows}
                filters={filters}
                // The analysis cache is keyed by the filters too, so it needs no
                // clearing here: a filter change simply misses the cache and the
                // panel offers a re-analysis for the data now on screen.
                onAdd={(f) => {
                  setFilters((prev) => [...prev, f])
                  setReadyKinds(new Set())
                }}
                onRemove={(id) => {
                  setFilters((prev) => prev.filter((x) => x.id !== id))
                  setReadyKinds(new Set())
                }}
                onClear={() => {
                  setFilters([])
                  setReadyKinds(new Set())
                }}
                />
              </Card>
            </aside>

            {/* CENTER: the chart alone — the dominant element of the layout. Its
                frame is capped at landscape-or-square (see .dvs-chart-frame in
                index.css): never a tall narrow slab, but also never forced into a
                literal square, which badly crops a world map. Generation and
                analysis moved to the right rail below so nothing else competes
                with the chart for space. */}
            <section className="dvs-chart-wrap flex min-w-0 flex-1 items-center justify-center">
              <Card className="dvs-chart-frame relative overflow-hidden p-4">
                {parsing ? (
                  <div
                    className="dvs-loader flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
                    style={{ opacity: finishing ? 0 : 1 }}
                  >
                    <div
                      className="dvs-progress"
                      role="progressbar"
                      aria-label="Building your chart"
                      aria-valuenow={Math.round(progress)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <span style={{ width: `${progress}%` }} />
                    </div>
                    {/* Each letter springs out of the ground; `trigger` re-plays it
                        on every new word. Tune the feel in the Animation Lab. */}
                    <div>
                      <SpringText text={loadingWord} params={springParams} trigger={loadingWord} />
                    </div>
                  </div>
                ) : spec ? (
                  <div className="dvs-fade-in flex h-full flex-col">
                    {/* Expanded advisor overlays the chart; collapsing shows a pill
                        inline right after the note (see below). */}
                    {!advisorMin && (
                      <WarningPopup
                        warnings={warnings}
                        recommendation={advisorRec}
                        onSwitch={switchTarget ? () => handleSuggestion(switchTarget) : undefined}
                        onMinimize={() => setAdvisorMin(true)}
                      />
                    )}
                    <div className="mb-3 flex items-center gap-2">
                      {note && <p className="truncate text-xs text-muted-foreground">{note}</p>}
                      {advisorMin && hasAdvice && (
                        <Badge
                          render={
                            <button type="button" onClick={() => setAdvisorMin(false)} aria-label="Show chart advice" />
                          }
                          variant="outline"
                          className="shrink-0 cursor-pointer border-warning-border bg-warning-bg text-warning"
                        >
                          <TriangleAlert className="size-3" />
                          Chart advice
                        </Badge>
                      )}
                    </div>
                    {/* `chartRef` is on the chart ALONE: the capture for the vision
                        analyser takes the first <svg> it finds, and the advice
                        panel's warning icon above is an <svg> too. */}
                    <div ref={chartRef} className="min-h-0 flex-1">
                      {/* Keying both by the full spec forces a clean Vega remount
                          on ANY spec change (agnostic — not just mark changes), so
                          no marks from a previous chart can linger. */}
                      <ChartErrorBoundary resetKey={JSON.stringify(spec)}>
                        <ChartView key={JSON.stringify(spec)} data={filteredRows} spec={spec} columns={dataset.columns} request={submitted ?? undefined} />
                      </ChartErrorBoundary>
                    </div>
                  </div>
                ) : chartError ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm">
                    <p className="text-warning">{chartError}</p>
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
                    <div className="max-w-md space-y-3">
                      <p>
                        Describe the chart you want on the right — e.g.{' '}
                        <span className="font-medium text-foreground">“bar chart of revenue by region”</span>,{' '}
                        <span className="font-medium text-foreground">“revenue over time as a line”</span>, or{' '}
                        <span className="font-medium text-foreground">“share of units by category as a pie”</span>.
                      </p>
                      <p className="text-xs">
                        Also try{' '}
                        <span className="font-medium text-foreground">bubble</span>,{' '}
                        <span className="font-medium text-foreground">radar</span>,{' '}
                        <span className="font-medium text-foreground">treemap</span>,{' '}
                        <span className="font-medium text-foreground">funnel</span>, and{' '}
                        <span className="font-medium text-foreground">radial/gauge</span> — e.g.{' '}
                        “bubble of revenue vs units sized by profit” or “treemap of revenue by category”.
                      </p>
                    </div>
                  </div>
                )}
              </Card>
            </section>

            {/* RIGHT: generation on top, analysis filling the rest of the rail.
                Moved off the chart's own column so the chart can be the one thing
                the center holds. */}
            <aside className="flex w-[300px] shrink-0 flex-col gap-3">
              <Card className="shrink-0 gap-3 p-3">
                <ChartRequestInput
                  value={request}
                  onChange={setRequest}
                  onSubmit={handleSubmit}
                  onAttach={handleLoad}
                  attachedFileName={fileName}
                  disabled={!dataset}
                  busy={parsing}
                />
                {!parsing && (
                  <SuggestionBar
                    suggestions={suggestions}
                    onSelect={handleSuggestion}
                    activeKind={activeKind}
                    readyKinds={readyKinds}
                    loadingKind={loadingKind}
                  />
                )}
              </Card>

              {spec && !parsing && (
                <Card className="dvs-fade-in min-h-0 flex-1 gap-0 overflow-hidden px-4 py-3">
                  <div className="dvs-scroll flex h-full flex-col overflow-y-auto">
                    <AnalysisPanel
                      nodes={shown?.nodes ?? []}
                      running={analysing}
                      conclusion={shown?.conclusion ?? null}
                      error={live?.error ?? cached?.error ?? null}
                      stale={stale}
                      canAnalyse={canAnalyse}
                      disabledReason={disabledReason}
                      onAnalyse={analyseGraph}
                      mode={analysisMode}
                      onModeChange={setAnalysisMode}
                    />
                  </div>
                </Card>
              )}
            </aside>
          </>
        ) : (
          <div className="flex w-full flex-col items-center justify-center gap-4">
            <div className="w-full max-w-xl">
              <FileDrop onLoad={handleLoad} />
              {loadError && (
                <Alert variant="destructive" className="mt-3">
                  <TriangleAlert />
                  <AlertTitle>Could not load that file</AlertTitle>
                  <AlertDescription>{loadError}</AlertDescription>
                </Alert>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Floating tuning tool for the per-letter loading spring (starts minimized). */}
      <AnimationLab />
    </div>
  )
}
