import type { ColumnType, DataSet } from '../lib/types'

/**
 * Compact readout of the loaded dataset: file name, row counts (total + filtered),
 * and each column with a type badge. Presentational.
 */

const TYPE_BADGE: Record<ColumnType, string> = {
  number: '#',
  string: 'A',
  boolean: '✓',
  date: '⏱',
}

export interface DataSummaryProps {
  fileName: string
  dataset: DataSet
  filteredCount: number
}

export function DataSummary({ fileName, dataset, filteredCount }: DataSummaryProps) {
  const total = dataset.rows.length
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Data</h2>
        <span className="truncate text-xs" style={{ color: 'var(--text-secondary)' }}>
          {fileName}
        </span>
      </div>
      <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
        {filteredCount === total
          ? `${total.toLocaleString()} rows`
          : `${filteredCount.toLocaleString()} of ${total.toLocaleString()} rows (filtered)`}
      </p>
      <ul className="flex flex-col gap-1">
        {dataset.columns.map((col) => (
          <li key={col.name} className="flex items-center gap-2 text-xs">
            <span
              className="flex h-5 w-5 items-center justify-center rounded font-mono"
              style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
              title={col.type}
            >
              {TYPE_BADGE[col.type]}
            </span>
            <span className="truncate">{col.name}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
