import { useRef } from 'react'
import { Loader2, Paperclip, SendHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Chart-request composer: the text field on its own row (room for the attached-
 * file label above it), then a row with the file-attach (paperclip) button and
 * the send button. Presentational — the parent owns the value and reacts to
 * submit/attach. A plain block, not a Card: it's meant to sit INSIDE the
 * "Generate" card in App.tsx, not nest a card within a card.
 *
 * Stacked rather than a single wide bar because this now lives in the narrow
 * right-hand rail (generate + analysis), not a full-width bottom bar — a single
 * row of icon + input + "Chart it" label doesn't fit that width comfortably.
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
    <div className="flex flex-col gap-2">
      {attachedFileName && (
        <span className="truncate px-0.5 text-[11px] leading-tight text-muted-foreground">
          attached <span className="font-medium text-foreground">{attachedFileName}</span>
        </span>
      )}
      <Input
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
        className="h-14"
      />
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
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          title="Attach a CSV or JSON file"
          aria-label="Attach a CSV or JSON file"
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip />
        </Button>
        <Button
          type="button"
          className="flex-1"
          onClick={onSubmit}
          disabled={disabled || busy || value.trim().length === 0}
        >
          {busy ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
          {busy ? 'Charting…' : 'Chart it'}
        </Button>
      </div>
    </div>
  )
}
