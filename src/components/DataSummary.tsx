import { Badge } from '@/components/ui/badge'
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
  const filtered = filteredCount !== total
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Data</h2>
        <span className="truncate text-xs text-muted-foreground" title={fileName}>
          {fileName}
        </span>
      </div>
      {/* A filtered count is a state worth noticing, so it gets a Badge rather than
          more grey text; the unfiltered count stays quiet. */}
      <div className="mb-3">
        {filtered ? (
          <Badge variant="secondary">
            {filteredCount.toLocaleString()} of {total.toLocaleString()} rows
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">{total.toLocaleString()} rows</span>
        )}
      </div>
      <ul className="flex flex-col gap-0.5">
        {dataset.columns.map((col) => (
          <li
            key={col.name}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-muted"
          >
            <span
              className="flex size-5 shrink-0 items-center justify-center rounded border bg-muted font-mono text-[10px] text-muted-foreground"
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
