import { Lightbulb, Minus, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * Chart advisor (expanded panel) that pops up over the chart when the chosen chart
 * may not suit the data. It explains why — deterministic checks (`warnings`) plus
 * the AI's MD-grounded opinion (`recommendation`) — and can offer to switch:
 * `onSwitch` swaps to a better chart type. `onMinimize` collapses it (the parent
 * then shows a small pill next to the note).
 * Controlled: the parent decides whether the expanded panel or the pill is shown.
 *
 * A shadcn Alert carrying the app's amber warning tokens: shadcn ships default and
 * destructive only, and this is neither — nothing is broken, the chart just may not
 * be the best choice.
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

  return (
    <Alert
      className="absolute inset-x-4 top-4 z-10 border-warning-border bg-warning-bg text-warning shadow-lg"
      role="alert"
    >
      <TriangleAlert />
      <AlertTitle className="flex items-center justify-between gap-2">
        Chart advice
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onMinimize}
          aria-label="Minimize chart advice"
          title="Minimize"
          className="-my-1 text-warning"
        >
          <Minus />
        </Button>
      </AlertTitle>
      <AlertDescription className="text-warning/90">
        {warnings.length > 0 && (
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        {recommendation && (
          <p className={warnings.length > 0 ? 'mt-2 flex gap-1.5' : 'flex gap-1.5'}>
            <Lightbulb className="mt-0.5 size-3.5 shrink-0" />
            <span>
              A {recommendation.label.toLowerCase()} may describe it better
              {recommendation.reason ? ` — ${recommendation.reason}` : '.'}
            </span>
          </p>
        )}
        {onSwitch && recommendation && (
          <div className="mt-2.5">
            <Button type="button" variant="outline" size="sm" onClick={onSwitch}>
              Switch to {recommendation.label}
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  )
}
