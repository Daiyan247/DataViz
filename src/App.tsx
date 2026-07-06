import { useMemo, useState } from 'react'
import { parseDataFile } from './lib/parseData'
import { parseChartRequest } from './lib/parseChartRequest'
import { applyFilters } from './lib/filterRows'
import { buildChartData } from './lib/buildChartData'
import type { ChartSpec, DataSet, Filter } from './lib/types'
import { FileDrop } from './components/FileDrop'
import { ChartRequestInput } from './components/ChartRequestInput'
import { ChartView } from './components/ChartView'
import { DataSummary } from './components/DataSummary'
import { FilterPanel } from './components/FilterPanel'

export default function App() {
  const [fileName, setFileName] = useState<string | null>(null)
  const [dataset, setDataset] = useState<DataSet | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [request, setRequest] = useState('')
  const [spec, setSpec] = useState<ChartSpec | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const [filters, setFilters] = useState<Filter[]>([])

  const handleLoad = (name: string, text: string) => {
    try {
      const ds = parseDataFile(name, text)
      if (ds.rows.length === 0) {
        setLoadError('That file parsed to zero rows — check the format.')
        return
      }
      setDataset(ds)
      setFileName(name)
      setLoadError(null)
      setFilters([])
      setSpec(null)
      setNote(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not read that file.')
    }
  }

  const handleSubmit = () => {
    if (!dataset || request.trim() === '') return
    const { spec: nextSpec, note: nextNote } = parseChartRequest(request, dataset.columns)
    setSpec(nextSpec)
    setNote(nextNote)
  }

  const filteredRows = useMemo(
    () => (dataset ? applyFilters(dataset.rows, filters) : []),
    [dataset, filters],
  )

  const chartData = useMemo(
    () => (dataset && spec ? buildChartData(filteredRows, spec, dataset.columns) : []),
    [dataset, spec, filteredRows],
  )

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">📊</span>
          <h1 className="text-base font-semibold">DataViz Studio</h1>
        </div>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          CSV / JSON → charts · fully offline
        </span>
      </header>

      <main className="flex min-h-0 flex-1 gap-4 p-4">
        {dataset ? (
          <>
            <aside
              className="flex w-64 shrink-0 flex-col gap-5 overflow-y-auto rounded-2xl border p-4"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
            >
              <DataSummary fileName={fileName ?? ''} dataset={dataset} filteredCount={filteredRows.length} />
              <FilterPanel
                columns={dataset.columns}
                rows={dataset.rows}
                filters={filters}
                onAdd={(f) => setFilters((prev) => [...prev, f])}
                onRemove={(id) => setFilters((prev) => prev.filter((x) => x.id !== id))}
                onClear={() => setFilters([])}
              />
            </aside>

            <section className="flex min-w-0 flex-1 flex-col gap-3">
              <div
                className="min-h-0 flex-1 rounded-2xl border p-4"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
              >
                {spec ? (
                  <div className="flex h-full flex-col">
                    {note && (
                      <p className="mb-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {note}
                      </p>
                    )}
                    <div className="min-h-0 flex-1">
                      <ChartView data={chartData} spec={spec} />
                    </div>
                  </div>
                ) : (
                  <div
                    className="flex h-full flex-col items-center justify-center text-center text-sm"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <p className="max-w-md">
                      Describe the chart you want below — e.g.{' '}
                      <span style={{ color: 'var(--text-primary)' }}>“bar chart of revenue by region”</span>,{' '}
                      <span style={{ color: 'var(--text-primary)' }}>“revenue over time as a line”</span>, or{' '}
                      <span style={{ color: 'var(--text-primary)' }}>“share of units by category as a pie”</span>.
                    </p>
                  </div>
                )}
              </div>

              <ChartRequestInput
                value={request}
                onChange={setRequest}
                onSubmit={handleSubmit}
                onAttach={handleLoad}
                attachedFileName={fileName}
                disabled={!dataset}
              />
            </section>
          </>
        ) : (
          <div className="flex w-full flex-col items-center justify-center gap-4">
            <div className="w-full max-w-xl">
              <FileDrop onLoad={handleLoad} />
              {loadError && (
                <p className="mt-3 text-center text-sm" style={{ color: '#e34948' }}>
                  {loadError}
                </p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
