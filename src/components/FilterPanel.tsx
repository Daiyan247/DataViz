import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium">Filters</h2>
        {filters.length > 0 && (
          <Button type="button" variant="link" size="xs" onClick={onClear} className="text-muted-foreground">
            Clear all
          </Button>
        )}
      </div>

      {filters.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <li key={f.id}>
              <Badge variant="secondary" className="gap-1 pr-1">
                <span className="truncate">
                  <span className="font-medium">{f.column}</span>{' '}
                  <span className="text-muted-foreground">{OP_LABELS[f.op]}</span> {String(f.value)}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(f.id)}
                  aria-label={`Remove filter on ${f.column}`}
                  className="rounded-sm opacity-60 transition-opacity hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <Select
          value={column}
          onValueChange={(next: string | null) => {
            if (next == null) return
            setColumn(next)
            const col = columns.find((c) => c.name === next)
            if (col) setOp(OPS_BY_TYPE[col.type][0].op)
          }}
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue placeholder="Column" />
          </SelectTrigger>
          <SelectContent>
            {columns.map((c) => (
              <SelectItem key={c.name} value={c.name}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex gap-2">
          <Select value={op} onValueChange={(next: string | null) => next && setOp(next as FilterOp)}>
            <SelectTrigger size="sm" className="w-auto shrink-0">
              {/* Show the operator's LABEL ("is", "≥"), not its raw value ("eq",
                  "gte") — the native <select> showed the option text, and
                  Base UI's Value renders the value unless told otherwise. */}
              <SelectValue placeholder="is">
                {(v: string | null) => ops.find((o) => o.op === v)?.label ?? v}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ops.map((o) => (
                <SelectItem key={o.op} value={o.op}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {suggestions.length > 0 ? (
            <Select value={value} onValueChange={(next: string | null) => setValue(next ?? '')}>
              <SelectTrigger size="sm" className="min-w-0 flex-1">
                <SelectValue placeholder="choose…" />
              </SelectTrigger>
              <SelectContent>
                {suggestions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              type={selected?.type === 'number' ? 'number' : 'text'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="value"
              className="h-8 min-w-0 flex-1"
            />
          )}
        </div>

        <Button type="button" size="sm" onClick={add} disabled={value.trim() === ''} className="w-full">
          <Plus />
          Add filter
        </Button>
      </div>
    </div>
  )
}
