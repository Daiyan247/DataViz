import { Loader2, RefreshCw, Search, ThumbsUp, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AnalysisMode, AnalysisNode } from '../lib/requestAnalysis'

/**
 * The analysis panel and its PIPELINE PROGRESS.
 *
 * Analysis on a local model takes a long time, and a single spinner says nothing
 * about whether anything is happening or what it is reasoning from. So each node of
 * the backend pipeline — chart type, reference, columns, evidence, the model call —
 * reports as it finishes and gets a thumbs up here, with the value it resolved. The
 * finished list doubles as an audit trail: you can see the chart type came from your
 * request and which columns it used, before you read a word of the conclusion.
 *
 * The conclusion itself STREAMS in — `conclusion` grows word by word while
 * `running` is still true, so it renders live rather than waiting for `running`
 * to flip false; that's the whole point of streaming it.
 */

export interface AnalysisPanelProps {
  nodes: AnalysisNode[]
  running: boolean
  conclusion: string | null
  error: string | null
  /** The data changed under a finished analysis, so it no longer describes the chart. */
  stale: boolean
  canAnalyse: boolean
  /** Why the button is unavailable, when it is — never leave it dead and silent. */
  disabledReason?: string
  onAnalyse: () => void
  mode: AnalysisMode
  onModeChange: (mode: AnalysisMode) => void
}

function NodeRow({ node }: { node: AnalysisNode }) {
  const icon =
    node.status === 'done' ? (
      <ThumbsUp className="size-3.5 shrink-0 text-success" />
    ) : node.status === 'running' ? (
      <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
    ) : node.status === 'error' ? (
      <TriangleAlert className="size-3.5 shrink-0 text-warning" />
    ) : (
      <span className="size-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground/40" />
    )

  return (
    <li className="flex items-start gap-2 text-xs">
      <span className="mt-0.5">{icon}</span>
      <span className={node.status === 'pending' ? 'text-muted-foreground/50' : 'text-muted-foreground'}>
        <span className={node.status === 'done' ? 'text-foreground' : undefined}>{node.label}</span>
        {node.detail && <span className="text-muted-foreground"> — {node.detail}</span>}
      </span>
    </li>
  )
}

const MODES: { id: AnalysisMode; label: string; hint: string }[] = [
  { id: 'normal', label: 'Normal', hint: 'Plain English — no statistical terms' },
  { id: 'advanced', label: 'Advanced', hint: 'Names the actual indices and thresholds behind each claim' },
]

export function AnalysisPanel({
  nodes,
  running,
  conclusion,
  error,
  stale,
  canAnalyse,
  disabledReason,
  onAnalyse,
  mode,
  onModeChange,
}: AnalysisPanelProps) {
  const showNodes = nodes.length > 0 && (running || Boolean(error) || Boolean(conclusion))
  // Streamed in live, so it's worth showing the moment there's ANY text, not only
  // once `running` finishes — the whole point of streaming is not waiting.
  const showConclusion = Boolean(conclusion)

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Analysis</h2>
        {!running && (
          <Button
            type="button"
            variant={stale ? 'default' : 'outline'}
            size="sm"
            onClick={onAnalyse}
            disabled={!canAnalyse}
            title={canAnalyse ? undefined : disabledReason}
          >
            {conclusion || error ? <RefreshCw /> : <Search />}
            {stale ? 'Re-analyse for this data' : conclusion || error ? 'Re-analyse' : 'Analyse this graph'}
          </Button>
        )}
      </div>

      {/* Normal vs Advanced: same evidence, different vocabulary. Locked while an
          analysis is in flight so a switch mid-stream can't mix the two tiers'
          text together. */}
      <div className="mb-3 inline-flex gap-0.5 rounded-sm border bg-muted/40 p-0.5" role="radiogroup" aria-label="Analysis detail level">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            title={m.hint}
            disabled={running}
            onClick={() => onModeChange(m.id)}
            className={`rounded-[3px] px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              mode === m.id
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {showNodes && (
        <ul className="mb-3 space-y-1.5 border-l-2 border-muted pl-3">
          {nodes.map((n) => (
            <NodeRow key={n.id} node={n} />
          ))}
        </ul>
      )}

      {stale && conclusion && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-warning">
          <TriangleAlert className="size-3.5 shrink-0" />
          The filters changed — this analysis describes the earlier data.
        </p>
      )}

      {error ? (
        <p className="text-sm text-warning">{error}</p>
      ) : showConclusion ? (
        <p className={`text-sm leading-relaxed ${stale ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}>
          {conclusion}
          {/* A blinking cursor while still streaming — the same convention every
              chat UI uses to show text is actively arriving, not finished. */}
          {running && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-muted-foreground/50 align-text-bottom" />}
        </p>
      ) : running ? (
        <p className="text-sm text-muted-foreground">Thinking…</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {canAnalyse
            ? 'Click “Analyse this graph” for a detailed, professional conclusion.'
            : (disabledReason ?? 'Nothing to analyse yet.')}
        </p>
      )}
    </>
  )
}
