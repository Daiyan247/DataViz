import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ChartErrorBoundary } from './ChartErrorBoundary'

afterEach(cleanup)

function Boom(): never {
  throw new Error('chart blew up')
}

describe('ChartErrorBoundary', () => {
  it('renders children when they do not throw', () => {
    render(
      <ChartErrorBoundary resetKey="a">
        <div>chart here</div>
      </ChartErrorBoundary>,
    )
    expect(screen.getByText('chart here')).toBeInTheDocument()
  })

  it('catches a child throw and shows a fallback instead of crashing', () => {
    // Silence React's expected error logging for this case.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <ChartErrorBoundary resetKey="a">
          <Boom />
        </ChartErrorBoundary>,
      ),
    ).not.toThrow()
    expect(screen.getByText(/couldn’t be drawn/i)).toBeInTheDocument()
    spy.mockRestore()
  })

  it('recovers on the next request when resetKey changes', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(
      <ChartErrorBoundary resetKey="a">
        <Boom />
      </ChartErrorBoundary>,
    )
    expect(screen.getByText(/couldn’t be drawn/i)).toBeInTheDocument()
    rerender(
      <ChartErrorBoundary resetKey="b">
        <div>fresh chart</div>
      </ChartErrorBoundary>,
    )
    expect(screen.getByText('fresh chart')).toBeInTheDocument()
    spy.mockRestore()
  })
})
