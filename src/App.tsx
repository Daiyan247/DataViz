import { useEffect, useMemo, useRef, useState } from 'react'
import { ChartColumnBig, Loader2, RefreshCw, Search, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { parseDataFile } from './lib/parseData'
import { requestChartSpec } from './lib/requestChartSpec'
import { requestSuggestedKinds } from './lib/requestSuggestions'
import { requestRecommendation } from './lib/requestRecommendation'
import { requestAnalysis } from './lib/requestAnalysis'
import { captureChartImage } from './lib/captureChart'
import { chartDigest, digestHasContent } from './lib/chartDigest'
import { applyFilters } from './lib/filterRows'
import { profileColumns } from './lib/profile'
import { chartWarnings } from './lib/chartWarnings'
import { analyzeMapCoverage, detectMapScope } from './lib/geo'
import { chartKind, compatibilityBasis, suggestCharts, suggestForColumns, toSuggestion, type ChartKind, type Suggestion } from './lib/suggestCharts'
import { loadSpringParams } from './lib/springAnim'
import type { ColumnProfile, DataSet, Filter, VizSpec } from './lib/types'

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
  // The model's analytical CONCLUSION for each chart (from an aggregated digest
  // computed in the browser), keyed by the chart spec and CACHED for the session so
  // revisiting a chart is instant. Cleared when the underlying data changes.
  const [conclusions, setConclusions] = useState<Record<string, string>>({})
  // The spec currently being analysed (on-demand, via the Analyse button).
  const [analysingKey, setAnalysingKey] = useState<string | null>(null)
  // The chart container — captured as an image for the vision analyser.
  const chartRef = useRef<HTMLDivElement>(null)
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
      setConclusions({})
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
    setConclusions({})
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
      // Fill the bar, hold, fade the loader, reveal the primary chart.
      setProgress(100)
      await wait(400)
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

  const warnings = useMemo(() => {
    if (!spec) return []
    const list = chartWarnings(spec, profiles)
    // A map's data-coverage note ("Europe isn't in your data") is shown in the
    // same Chart advice panel — not a separate overlay on the map.
    if (spec.mark === 'geoshape') {
      const cov = analyzeMapCoverage(detectMapScope(submitted ?? ''), dataset?.columns ?? [], filteredRows)
      if (cov?.message) list.push(cov.message)
    }
    // Backend fallback note (e.g. a dot plot with no category → scatter), shown
    // last so it reads after any type/data advice.
    if (chartNotice) list.push(chartNotice)
    return list
  }, [spec, profiles, submitted, dataset, filteredRows, chartNotice])

  // The AGGREGATED digest of the shown chart (browser-side — raw rows never leave).
  const chartDigestValue = useMemo(() => (spec ? chartDigest(spec, filteredRows) : null), [spec, filteredRows])
  // Session-cached analyses are keyed by the exact chart spec.
  const specKey = spec ? JSON.stringify(spec) : null
  const conclusion = specKey ? conclusions[specKey] ?? null : null
  const analysing = Boolean(specKey && analysingKey === specKey)
  const canAnalyse = Boolean(spec && !parsing && chartDigestValue && digestHasContent(chartDigestValue))

  // ON-DEMAND analysis: capture the rendered chart as an image, send it (plus the
  // digest) to the vision analyser, and cache the resulting paragraph for the session.
  const analyseGraph = async () => {
    if (!spec || !specKey || !chartDigestValue || analysingKey) return
    setAnalysingKey(specKey)
    const image = await captureChartImage(chartRef.current)
    const text = await requestAnalysis(spec, chartDigestValue, image)
    setAnalysingKey((cur) => (cur === specKey ? null : cur))
    if (text) setConclusions((prev) => ({ ...prev, [specKey]: text }))
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

  // The chart type currently on screen — highlighted in the compatible strip.
  const activeKind = spec ? chartKind(spec) : undefined

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
            <aside className="w-64 shrink-0">
              <Card className="h-full gap-6 overflow-y-auto px-4">
                <DataSummary fileName={fileName ?? ''} dataset={dataset} filteredCount={filteredRows.length} />
                <FilterPanel
                columns={dataset.columns}
                rows={dataset.rows}
                filters={filters}
                onAdd={(f) => {
                  setFilters((prev) => [...prev, f])
                  setConclusions({}) // data changed → cached analyses are stale
                  setReadyKinds(new Set())
                }}
                onRemove={(id) => {
                  setFilters((prev) => prev.filter((x) => x.id !== id))
                  setConclusions({})
                  setReadyKinds(new Set())
                }}
                onClear={() => {
                  setFilters([])
                  setConclusions({})
                  setReadyKinds(new Set())
                }}
                />
              </Card>
            </aside>

            <section className="flex min-w-0 flex-1 flex-col gap-3">
              {/* The graph fills the space and re-fits; the analysis is a SEPARATE,
                  bounded panel below it (never covers or clips the graph). */}
              <Card ref={chartRef} className="relative min-h-0 flex-1 overflow-hidden p-4">
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
                    <div className="min-h-0 flex-1">
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
                        Describe the chart you want below — e.g.{' '}
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

              {spec && !parsing && (
                <Card className="dvs-fade-in max-h-[13rem] shrink-0 gap-0 overflow-y-auto px-4 py-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-medium">Analysis</h2>
                    {!analysing && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={analyseGraph}
                        disabled={!canAnalyse || Boolean(analysingKey)}
                      >
                        {conclusion ? <RefreshCw /> : <Search />}
                        {conclusion ? 'Re-analyse' : 'Analyse this graph'}
                      </Button>
                    )}
                  </div>
                  {analysing ? (
                    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      Analysing the graph…
                    </span>
                  ) : conclusion ? (
                    <p className="text-sm leading-relaxed text-muted-foreground">{conclusion}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Click “Analyse this graph” for a detailed, professional conclusion.
                    </p>
                  )}
                </Card>
              )}

              {!parsing && (
                <SuggestionBar
                  suggestions={suggestions}
                  onSelect={handleSuggestion}
                  activeKind={activeKind}
                  readyKinds={readyKinds}
                  loadingKind={loadingKind}
                />
              )}

              <ChartRequestInput
                value={request}
                onChange={setRequest}
                onSubmit={handleSubmit}
                onAttach={handleLoad}
                attachedFileName={fileName}
                disabled={!dataset}
                busy={parsing}
              />
            </section>
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
