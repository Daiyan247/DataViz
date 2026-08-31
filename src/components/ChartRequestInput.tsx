import { useRef } from 'react'
import { Loader2, Paperclip, SendHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'

/**
 * Chat-style composer: a file-attach (paperclip) button, a text field for the
 * chart request, and a send button. Presentational — the parent owns the value
 * and reacts to submit/attach.
 *
 * Built as a shadcn Card holding a borderless Input, so the whole bar reads as one
 * control rather than a field sitting inside a box.
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
    <Card className="flex-row items-center gap-2 p-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title="Attach a CSV or JSON file"
        aria-label="Attach a CSV or JSON file"
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip />
      </Button>
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
          <span className="truncate px-3 text-[11px] leading-tight text-muted-foreground">
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
          className="border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
      </div>

      <Button
        type="button"
        size="lg"
        onClick={onSubmit}
        disabled={disabled || busy || value.trim().length === 0}
      >
        {busy ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
        {busy ? 'Charting…' : 'Chart it'}
      </Button>
    </Card>
  )
}
