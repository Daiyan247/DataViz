import { useRef } from 'react'

/**
 * Chat-style composer: a file-attach (paperclip) button, a text field for the
 * chart request, and a send button. Presentational — the parent owns the value
 * and reacts to submit/attach.
 */

export interface ChartRequestInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onAttach: (fileName: string, text: string) => void
  disabled?: boolean
  placeholder?: string
  attachedFileName?: string | null
}

export function ChartRequestInput({
  value,
  onChange,
  onSubmit,
  onAttach,
  disabled,
  placeholder,
  attachedFileName,
}: ChartRequestInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const attach = async (file: File) => {
    const text = await file.text()
    onAttach(file.name, text)
  }

  return (
    <div
      className="flex items-center gap-2 rounded-2xl border px-3 py-2"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
    >
      <button
        type="button"
        title="Attach a CSV or JSON file"
        onClick={() => inputRef.current?.click()}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg transition-colors hover:opacity-70"
        style={{ background: 'var(--surface-2)' }}
      >
        📎
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void attach(file)
          e.target.value = ''
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {attachedFileName && (
          <span className="truncate text-xs" style={{ color: 'var(--text-secondary)' }}>
            attached: {attachedFileName}
          </span>
        )}
        <input
          type="text"
          value={value}
          disabled={disabled}
          placeholder={placeholder ?? 'e.g. "bar chart of revenue by region"'}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSubmit()
            }
          }}
          className="w-full bg-transparent text-sm outline-none"
          style={{ color: 'var(--text-primary)' }}
        />
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || value.trim().length === 0}
        className="flex h-9 shrink-0 items-center rounded-full px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
        style={{ background: 'var(--accent)' }}
      >
        Chart it
      </button>
    </div>
  )
}
