import type { ChartKind, Suggestion } from '../lib/suggestCharts'

/**
 * A strip of chart TYPES compatible with the submitted request + columns, shown
 * alongside the rendered chart. The chart currently on screen (`activeKind`) is
 * highlighted. Clicking a chip swaps to that type instantly — no AI round-trip.
 * Presentational only.
 */

// Keyed by chart KIND (not the Vega mark) so types that share a mark — e.g. a dot
// plot and a scatter (both `point`), or a histogram and a bar — get distinct icons.
const GLYPH: Record<ChartKind, string> = {
  bar: '▊',
  dotplot: '⋯',
  line: '📈',
  area: '⛰',
  scatter: '⣿',
  bubble: '⣿',
  pie: '◕',
  histogram: '▥',
  box: '⊟',
  strip: '┊',
  heatmap: '▦',
  map: '🗺',
}

export interface SuggestionBarProps {
  suggestions: Suggestion[]
  onSelect: (s: Suggestion) => void
  /** The chart type currently displayed — its chip is highlighted. */
  activeKind?: ChartKind
  /** Kinds already processed by the queue (ready/clickable). The active chip is
   *  always ready. Omit to make every chip ready immediately. */
  readyKinds?: Set<ChartKind>
  /** The single kind currently "loading" in the queue (it animates). */
  loadingKind?: ChartKind | null
}

type ChipState = 'ready' | 'loading' | 'queued'

export function SuggestionBar({ suggestions, onSelect, activeKind, readyKinds, loadingKind }: SuggestionBarProps) {
  if (suggestions.length === 0) return null
  // One-at-a-time queue: the chart on screen and every finished kind are ready; the
  // single `loadingKind` animates; the rest wait their turn.
  const stateOf = (s: Suggestion): ChipState => {
    if (s.kind === activeKind || readyKinds == null || readyKinds.has(s.kind)) return 'ready'
    if (s.kind === loadingKind) return 'loading'
    return 'queued'
  }
  const allReady = suggestions.every((s) => stateOf(s) === 'ready')
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
      <span className="shrink-0 text-xs font-medium text-muted-foreground">
        {allReady ? 'Compatible' : 'Loading charts…'}
      </span>
      {suggestions.map((s) => {
        const active = s.kind === activeKind
        const st = stateOf(s)
        const ready = st === 'ready'
        const anim = st === 'loading' ? ' dvs-chip-loading' : st === 'queued' ? ' dvs-chip-queued' : ''
        return (
          <button
            key={s.id}
            type="button"
            title={ready ? s.note : st === 'loading' ? 'Loading…' : 'Queued'}
            aria-current={active ? 'true' : undefined}
            aria-busy={st === 'loading'}
            disabled={!ready}
            onClick={ready ? () => onSelect(s) : undefined}
            className={`dvs-btn dvs-btn-sm gap-1.5 ${
              active
                ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                : 'border border-border bg-card shadow-sm hover:bg-muted'
            }${ready ? '' : ' cursor-not-allowed'}${anim}`}
          >
            <span aria-hidden className={active ? 'opacity-80' : 'text-muted-foreground'}>
              {st === 'loading' ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]" />
              ) : (
                GLYPH[s.kind]
              )}
            </span>
            {s.label}
          </button>
        )
      })}
    </div>
  )
}
