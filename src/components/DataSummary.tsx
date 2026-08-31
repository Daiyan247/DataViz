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
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="dvs-label">Data</h2>
        <span className="truncate text-xs text-muted-foreground" title={fileName}>
          {fileName}
        </span>
      </div>
      <p className="dvs-hint mb-3">
        {filteredCount === total
          ? `${total.toLocaleString()} rows`
          : `${filteredCount.toLocaleString()} of ${total.toLocaleString()} rows (filtered)`}
      </p>
      <ul className="flex flex-col gap-0.5">
        {dataset.columns.map((col) => (
          <li
            key={col.name}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-muted"
          >
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border bg-muted font-mono text-[10px] text-muted-foreground"
              title={col.type}
            >
              {TYPE_BADGE[col.type]}
            </span>
            <span className="truncate font-medium">{col.name}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
