import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { VegaMark, VizSpec } from '../lib/types'

// Capture the spec react-vega would render, without pulling in the Vega runtime.
let lastSpec: Record<string, unknown> | null = null
vi.mock('react-vega', () => ({
  VegaLite: (props: { spec: Record<string, unknown> }) => {
    lastSpec = props.spec
    return null
  },
}))

import { ChartView } from './ChartView'

afterEach(cleanup)

const rows = [
  { region: 'West', units: 3, revenue: 100 },
  { region: 'East', units: 5, revenue: 250 },
]

const specFor = (mark: VegaMark): VizSpec => {
  switch (mark) {
    case 'point':
    case 'circle':
      return { mark, encoding: { x: { field: 'units', type: 'quantitative' }, y: { field: 'revenue', type: 'quantitative' } } }
    case 'arc':
      return { mark, encoding: { theta: { field: 'revenue', type: 'quantitative', aggregate: 'sum' }, color: { field: 'region', type: 'nominal' } } }
    default:
      return { mark, encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' } } }
  }
}

const MARKS: VegaMark[] = ['bar', 'line', 'area', 'point', 'circle', 'arc', 'rect', 'boxplot']

describe('ChartView', () => {
  for (const mark of MARKS) {
    it(`builds a valid Vega-Lite spec for a ${mark} mark`, () => {
      lastSpec = null
      const spec = specFor(mark)
      expect(() => render(<ChartView data={rows} spec={spec} />)).not.toThrow()
      const built = lastSpec as unknown as { mark?: { type?: string }; data?: { values?: unknown[] }; encoding?: object }
      expect(built?.mark).toMatchObject({ type: mark })
      expect(built?.data?.values).toHaveLength(2)
      expect(built?.encoding).toBeTruthy()
    })
  }

  it('renders box plots with min-max whiskers (no separate outlier circles)', () => {
    lastSpec = null
    render(<ChartView data={rows} spec={specFor('boxplot')} />)
    const mark = (lastSpec as unknown as { mark: Record<string, unknown> }).mark
    expect(mark).toMatchObject({ type: 'boxplot', extent: 'min-max' })
  })

  it('drops undefined field props (count aggregate has no field)', () => {
    lastSpec = null
    render(<ChartView data={rows} spec={{ mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { type: 'quantitative', aggregate: 'count' } } }} />)
    const enc = (lastSpec as unknown as { encoding: { y: Record<string, unknown> } }).encoding
    expect(enc.y).toEqual({ type: 'quantitative', aggregate: 'count' })
    expect('field' in enc.y).toBe(false)
  })

  it('slants a cramped categorical X axis (many/long labels), keeps few short ones flat', () => {
    const manyRows = Array.from({ length: 9 }, (_, i) => ({ region: `Category number ${i}`, revenue: i * 10 }))
    lastSpec = null
    render(<ChartView data={manyRows} spec={specFor('bar')} />)
    const cramped = (lastSpec as unknown as { encoding: { x: { axis?: { labelAngle?: number } } } }).encoding.x
    expect(cramped.axis?.labelAngle).toBe(-40)

    lastSpec = null
    render(<ChartView data={[{ region: 'A', revenue: 1 }, { region: 'B', revenue: 2 }]} spec={specFor('bar')} />)
    const roomy = (lastSpec as unknown as { encoding: { x: { axis?: { labelAngle?: number } } } }).encoding.x
    expect(roomy.axis?.labelAngle).toBe(0)
  })

  it('shows an empty state with no rows', () => {
    lastSpec = null
    const { getByText } = render(<ChartView data={[]} spec={specFor('bar')} />)
    expect(getByText(/no data to plot/i)).toBeInTheDocument()
  })
})
