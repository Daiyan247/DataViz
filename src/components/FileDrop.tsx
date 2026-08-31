import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Empty-state dropzone for CSV/JSON. Presentational: it reads the file's text and
 * hands `(fileName, text)` to the parent, which owns parsing and error handling.
 *
 * Deliberately not a shadcn Card: a Card is a filled surface, and this has to read
 * as an empty target — a dashed outline over the page — so it borrows the Card's
 * radius and tokens without the fill.
 */

export interface FileDropProps {
  onLoad: (fileName: string, text: string) => void
}

export function FileDrop({ onLoad }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [hover, setHover] = useState(false)

  const read = async (file: File) => {
    const text = await file.text()
    onLoad(file.name, text)
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setHover(true)
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault()
        setHover(false)
        const file = e.dataTransfer.files?.[0]
        if (file) void read(file)
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'flex h-full min-h-64 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-10 text-center transition-colors',
        hover ? 'border-primary bg-muted' : 'border-border hover:bg-muted/50',
      )}
    >
      <span className="mb-3 flex size-10 items-center justify-center rounded-lg border bg-card text-muted-foreground shadow-xs">
        <Upload className="size-4" />
      </span>
      <p className="text-sm font-medium">Drop a CSV or JSON file to start</p>
      <p className="text-sm text-muted-foreground">or click to browse — your data never leaves the browser</p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void read(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
