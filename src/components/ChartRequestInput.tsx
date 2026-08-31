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
  busy?: boolean
  placeholder?: string
  attachedFileName?: string | null
}

export function ChartRequestInput({
  value,
  onChange,
  onSubmit,
  onAttach,
  disabled,
  busy,
  placeholder,
  attachedFileName,
}: ChartRequestInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const attach = async (file: File) => {
    const text = await file.text()
    onAttach(file.name, text)
  }

  return (
    <div className="dvs-card flex items-center gap-2 p-2">
      <button
        type="button"
        title="Attach a CSV or JSON file"
        aria-label="Attach a CSV or JSON file"
        onClick={() => inputRef.current?.click()}
        className="dvs-btn dvs-btn-ghost dvs-btn-icon text-base"
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

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        {attachedFileName && (
          <span className="truncate px-1 text-[11px] leading-tight text-muted-foreground">
            attached: <span className="font-medium text-foreground">{attachedFileName}</span>
          </span>
        )}
        <input
          type="text"
          value={value}
          disabled={disabled}
          placeholder={placeholder ?? 'e.g. "bar chart of revenue by region"'}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !busy) {
              e.preventDefault()
              onSubmit()
            }
          }}
          className="w-full bg-transparent px-1 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || busy || value.trim().length === 0}
        className="dvs-btn dvs-btn-primary dvs-btn-md"
      >
        {busy ? 'Charting…' : 'Chart it'}
      </button>
    </div>
  )
}
