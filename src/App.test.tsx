import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// No Vega runtime in jsdom.
vi.mock('react-vega', () => ({ VegaLite: () => null }))

import App from './App'

const CSV = [
  'month,region,category,units,revenue',
  '2024-01,West,Laptops,45,43740',
  '2024-01,East,Monitors,28,16934',
  '2024-02,West,Phones,44,25828',
].join('\n')

const AI_SPEC = {
  spec: {
    mark: 'bar',
    encoding: {
      x: { field: 'region', type: 'nominal' },
      y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
    },
  },
  note: 'Bar chart of revenue by region',
}

const json = (obj: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(obj) } as Response)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function loadData(user: ReturnType<typeof userEvent.setup>) {
  const file = new File([CSV], 'sales.csv', { type: 'text/csv' })
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  await user.upload(input, file)
  await screen.findByPlaceholderText(/bar chart of revenue/i)
}

describe('App — AI-only charting', () => {
  it('renders the chart the backend returns and keeps the composer usable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).includes('/api/suggest') ? json({ kinds: ['bar', 'pie'] }) : json(AI_SPEC),
      ),
    )
    const user = userEvent.setup()
    render(<App />)
    await loadData(user)

    const textbox = await screen.findByPlaceholderText(/bar chart of revenue/i)
    const button = screen.getByRole('button', { name: /chart it/i })

    await user.type(textbox, 'revenue by region')
    await user.click(button)
    // Chart reveals after the loading bar fills + fades, so allow extra time.
    await waitFor(() => expect(screen.getByText('Bar chart of revenue by region')).toBeInTheDocument(), {
      timeout: 3000,
    })
    expect(button).toBeEnabled()

    // A second request still works.
    await user.clear(textbox)
    await user.type(textbox, 'another chart')
    await user.click(button)
    await waitFor(() => expect(screen.getByRole('button', { name: /chart it/i })).toBeInTheDocument(), {
      timeout: 3000,
    })
  })

  it('shows an error (no silent fallback) when the AI backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const user = userEvent.setup()
    render(<App />)
    await loadData(user)

    const textbox = await screen.findByPlaceholderText(/bar chart of revenue/i)
    await user.type(textbox, 'pie of condition and city')
    await user.click(screen.getByRole('button', { name: /chart it/i }))

    // Generic message only — no internals (tooling/paths) that could leak structure.
    await waitFor(() => expect(screen.getByText(/something went wrong on the backend/i)).toBeInTheDocument(), {
      timeout: 3000,
    })
    // No chart note rendered — nothing was guessed.
    expect(screen.queryByText(/Bar chart of/i)).not.toBeInTheDocument()
  })
})
