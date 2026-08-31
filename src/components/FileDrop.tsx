import { useRef, useState } from 'react'

/**
 * Empty-state dropzone for CSV/JSON. Presentational: it reads the file's text and
 * hands `(fileName, text)` to the parent, which owns parsing and error handling.
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
      className="flex h-full min-h-64 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-colors"
      style={{
        borderColor: hover ? 'var(--primary)' : 'var(--border)',
        background: hover ? 'var(--surface-2)' : 'transparent',
      }}
    >
      <p className="text-base font-medium">Drop a CSV or JSON file to start</p>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
        or click to browse — your data never leaves the browser
      </p>
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
