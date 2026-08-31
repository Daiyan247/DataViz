import {
  Activity,
  AreaChart,
  BarChart3,
  Box,
  CircleDot,
  Grid3x3,
  LayoutGrid,
  Loader2,
  Map,
  MoreHorizontal,
  PieChart,
  ScatterChart,
  SignalHigh,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ChartKind, Suggestion } from '../lib/suggestCharts'

/**
 * A strip of chart TYPES compatible with the submitted request + columns, shown
 * alongside the rendered chart. The chart currently on screen (`activeKind`) is
 * highlighted. Clicking a chip swaps to that type instantly — no AI round-trip.
 * Presentational only.
 */

// Keyed by chart KIND (not the Vega mark) so types that share a mark — e.g. a dot
// plot and a scatter (both `point`), or a histogram and a bar — get distinct icons.
// Lucide glyphs rather than the old emoji/box-drawing mix: they inherit size and
// colour from the Button and sit on the text baseline, which that set never did.
const ICON: Record<ChartKind, LucideIcon> = {
  bar: BarChart3,
  dotplot: MoreHorizontal,
  line: Activity,
  area: AreaChart,
  scatter: ScatterChart,
  bubble: CircleDot,
  pie: PieChart,
  histogram: SignalHigh,
  box: Box,
  strip: Grid3x3,
  heatmap: LayoutGrid,
  map: Map,
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
        const anim = st === 'loading' ? 'dvs-chip-loading' : st === 'queued' ? 'dvs-chip-queued' : ''
        const Icon = ICON[s.kind]
        return (
          <Button
            key={s.id}
            type="button"
            // The type on screen is a solid button, the alternatives are outlines —
            // shadcn's own way of marking one active choice in a row of peers.
            variant={active ? 'default' : 'outline'}
            size="sm"
            title={ready ? s.note : st === 'loading' ? 'Loading…' : 'Queued'}
            aria-current={active ? 'true' : undefined}
            aria-busy={st === 'loading'}
            disabled={!ready}
            onClick={ready ? () => onSelect(s) : undefined}
            className={anim}
          >
            {st === 'loading' ? <Loader2 className="animate-spin" /> : <Icon />}
            {s.label}
          </Button>
        )
      })}
    </div>
  )
}
