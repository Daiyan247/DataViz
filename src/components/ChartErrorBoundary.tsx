import { Component, type ReactNode } from 'react'

/**
 * Contains chart render failures. `ChartView` renders third-party (Recharts) SVG
 * that can throw for a specific chart-type/data combination; without a boundary
 * that throw would unmount the whole React root — including the request input,
 * leaving the app frozen. This catches it, shows a message, and keeps the rest of
 * the UI alive. It resets whenever `resetKey` changes (i.e. a new chart request),
 * so the next request gets a fresh attempt.
 */

interface Props {
  resetKey: string
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ChartErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    // A new request (or type) clears a previous failure so we re-attempt render.
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">This chart couldn’t be drawn.</p>
          <p className="max-w-sm">
            That chart type didn’t work for this data. Try a different chart type or request —
            everything else still works.
          </p>
        </div>
      )
    }
    return this.props.children
  }
}
