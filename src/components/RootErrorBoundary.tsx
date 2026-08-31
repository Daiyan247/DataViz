import { Component, type ReactNode } from 'react'

/**
 * Last-resort boundary around the whole app. If anything outside the chart pane
 * throws during render (e.g. data parsing or a lib bug), this keeps the page from
 * going blank. It shows only a generic "frontend" message — never the raw error
 * text — so internal details (file paths, symbols, data) can't leak to the user.
 */

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            padding: 24,
            textAlign: 'center',
          }}
        >
          <p style={{ fontWeight: 600 }}>Something went wrong on the frontend.</p>
          <p style={{ maxWidth: 480, fontSize: 13, color: 'var(--muted-foreground)' }}>
            Please reload the page and try again.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              borderRadius: 'var(--radius)',
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--primary-foreground)',
              background: 'var(--primary)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
