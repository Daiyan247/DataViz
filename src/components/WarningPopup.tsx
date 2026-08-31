/**
 * Chart advisor (expanded panel) that pops up over the chart when the chosen chart
 * may not suit the data. It explains why — deterministic checks (`warnings`) plus
 * the AI's MD-grounded opinion (`recommendation`) — and can offer to switch:
 * `onSwitch` swaps to a better chart type. `onMinimize` collapses it (the parent
 * then shows a small pill next to the note).
 * Controlled: the parent decides whether the expanded panel or the pill is shown.
 */

export interface WarningPopupProps {
  warnings: string[]
  /** The AI's better-fit opinion: the alternative chart's label + why. */
  recommendation?: { label: string; reason: string } | null
  /** Apply the recommended different chart type. */
  onSwitch?: () => void
  /** Collapse the panel (parent shows the pill). */
  onMinimize: () => void
}

export function WarningPopup({ warnings, recommendation, onSwitch, onMinimize }: WarningPopupProps) {
  const hasContent = warnings.length > 0 || Boolean(recommendation)
  if (!hasContent) return null

  const actionStyle = { borderColor: 'var(--accent)', color: 'var(--accent)' }

  return (
    <div
      className="absolute left-4 right-4 top-4 z-10 rounded-lg border p-3 shadow-lg"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--warning-border)', color: 'var(--warning)' }}
      role="alert"
    >
      {/* Title row with the minimize control right beside the title. */}
      <div className="mb-1 flex items-center gap-2">
        <span aria-hidden className="text-sm leading-5">
          ⚠️
        </span>
        <span className="text-xs font-medium">Chart advice</span>
        <button
          type="button"
          onClick={onMinimize}
          aria-label="Minimize chart advice"
          title="Minimize"
          className="text-base leading-none transition-opacity hover:opacity-60"
          style={{ color: 'var(--text-secondary)' }}
        >
          −
        </button>
      </div>
      <div className="text-xs">
        {warnings.length > 0 && (
          <ul className="space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        {recommendation && (
          <p className={warnings.length > 0 ? 'mt-2' : ''}>
            💡 A {recommendation.label.toLowerCase()} may describe it better
            {recommendation.reason ? ` — ${recommendation.reason}` : '.'}
          </p>
        )}
        {onSwitch && recommendation && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSwitch}
              className="rounded-full border px-3 py-0.5 font-medium transition-opacity hover:opacity-70"
              style={actionStyle}
            >
              Switch to {recommendation.label}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
