import { useMemo, useState } from 'react'
import type { Cell, Column, Filter, FilterOp, Row } from '../lib/types'
import { distinctValues } from '../lib/filterRows'

/**
 * Build and manage row filters. Presentational: the parent holds the filter list
 * and re-derives the chart when it changes. Available operators adapt to the
 * selected column's type, and equality on low-cardinality columns offers a picker.
 */

const OPS_BY_TYPE: Record<Column['type'], Array<{ op: FilterOp; label: string }>> = {
  number: [
    { op: 'eq', label: '=' },
    { op: 'neq', label: '≠' },
    { op: 'gt', label: '>' },
    { op: 'gte', label: '≥' },
    { op: 'lt', label: '<' },
    { op: 'lte', label: '≤' },
  ],
  date: [
    { op: 'eq', label: 'on' },
    { op: 'gte', label: 'from' },
    { op: 'lte', label: 'until' },
  ],
  string: [
    { op: 'eq', label: 'is' },
    { op: 'neq', label: 'is not' },
    { op: 'contains', label: 'contains' },
  ],
  boolean: [
    { op: 'eq', label: 'is' },
    { op: 'neq', label: 'is not' },
  ],
}

const OP_LABELS: Record<FilterOp, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  contains: '∋',
}

export interface FilterPanelProps {
  columns: Column[]
  rows: Row[]
  filters: Filter[]
  onAdd: (filter: Filter) => void
  onRemove: (id: string) => void
  onClear: () => void
}

let filterSeq = 0

export function FilterPanel({ columns, rows, filters, onAdd, onRemove, onClear }: FilterPanelProps) {
  const [column, setColumn] = useState(columns[0]?.name ?? '')
  const [op, setOp] = useState<FilterOp>('eq')
  const [value, setValue] = useState('')

  const selected = columns.find((c) => c.name === column) ?? columns[0]
  const ops = selected ? OPS_BY_TYPE[selected.type] : []

  const suggestions = useMemo(() => {
    if (!selected || selected.type === 'number' || selected.type === 'date') return []
    const values = distinctValues(rows, selected.name)
    return values.length <= 50 ? values : []
  }, [rows, selected])

  const add = () => {
    if (!selected || value.trim() === '') return
    const coerced: Cell = selected.type === 'number' ? Number(value) : value
    onAdd({ id: `f${filterSeq++}`, column: selected.name, op, value: coerced })
    setValue('')
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="dvs-label">Filters</h2>
        {filters.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      {filters.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1">
          {filters.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted px-2 py-1 text-xs"
            >
              <span className="truncate">
                <span className="font-medium">{f.column}</span>{' '}
                <span className="text-muted-foreground">{OP_LABELS[f.op]}</span>{' '}
                <span className="font-medium">{String(f.value)}</span>
              </span>
              <button
                type="button"
                onClick={() => onRemove(f.id)}
                className="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                aria-label="remove filter"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <select
          value={column}
          onChange={(e) => {
            setColumn(e.target.value)
            const next = columns.find((c) => c.name === e.target.value)
            if (next) setOp(OPS_BY_TYPE[next.type][0].op)
          }}
          className="dvs-select h-8 text-xs"
        >
          {columns.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>

        <div className="flex gap-2">
          <select
            value={op}
            onChange={(e) => setOp(e.target.value as FilterOp)}
            className="dvs-select h-8 w-auto text-xs"
          >
            {ops.map((o) => (
              <option key={o.op} value={o.op}>
                {o.label}
              </option>
            ))}
          </select>

          {suggestions.length > 0 ? (
            <select
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="dvs-select h-8 min-w-0 flex-1 text-xs"
            >
              <option value="">choose…</option>
              {suggestions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={selected?.type === 'number' ? 'number' : 'text'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="value"
              className="dvs-input h-8 min-w-0 flex-1 text-xs"
            />
          )}
        </div>

        <button
          type="button"
          onClick={add}
          disabled={value.trim() === ''}
          className="dvs-btn dvs-btn-primary dvs-btn-sm w-full"
        >
          Add filter
        </button>
      </div>
    </div>
  )
}
