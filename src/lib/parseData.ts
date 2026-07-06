import type { Cell, Column, ColumnType, DataSet, Row } from './types'

/**
 * Parsing & type inference for CSV and JSON input. Pure and fully unit-tested —
 * no DOM, no file APIs. The component layer reads the file text and hands it here.
 */

const NUMBER_RE = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/
const BOOL_RE = /^(true|false)$/i
// ISO-ish date: YYYY-MM or YYYY-MM-DD (optionally with a time), or M/D/YYYY.
const DATE_RE = /^(\d{4}-\d{2}(?:-\d{2})?(?:[ T]\d{2}:\d{2}(?::\d{2})?)?|\d{1,2}\/\d{1,2}\/\d{2,4})$/

/**
 * Split CSV text into a header row + string cells. Quote-aware: handles quoted
 * fields containing commas, escaped `""` quotes, and CRLF/CR/LF line endings.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false
  let sawAny = false

  const pushField = () => {
    record.push(field)
    field = ''
  }
  const pushRecord = () => {
    pushField()
    rows.push(record)
    record = []
  }

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
      sawAny = true
      continue
    }
    if (c === ',') {
      pushField()
      sawAny = true
      continue
    }
    if (c === '\r') {
      if (text[i + 1] === '\n') i++
      pushRecord()
      sawAny = false
      continue
    }
    if (c === '\n') {
      pushRecord()
      sawAny = false
      continue
    }
    field += c
    sawAny = true
  }
  // Flush the trailing record unless the file ended on a clean newline.
  if (sawAny || field.length > 0 || record.length > 0) pushRecord()

  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0].trim() === ''))
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim())
  return { headers, rows: nonEmpty }
}

/** Best-effort type for a single raw string. Blank → null-ish (`string`). */
function classify(raw: string): ColumnType {
  const v = raw.trim()
  if (v === '') return 'string'
  if (BOOL_RE.test(v)) return 'boolean'
  if (NUMBER_RE.test(v)) return 'number'
  if (DATE_RE.test(v)) return 'date'
  return 'string'
}

/**
 * Infer one type per column by scanning all non-blank values. A column is
 * `number`/`boolean`/`date` only if EVERY non-blank value matches; otherwise
 * it falls back to `string`.
 */
export function inferColumnTypes(headers: string[], rows: string[][]): Column[] {
  return headers.map((name, col) => {
    let type: ColumnType | null = null
    let allBlank = true
    for (const row of rows) {
      const raw = (row[col] ?? '').trim()
      if (raw === '') continue
      allBlank = false
      const t = classify(raw)
      if (type === null) type = t
      else if (type !== t) return { name, type: 'string' as const }
    }
    return { name, type: allBlank ? 'string' : (type ?? 'string') }
  })
}

/** Coerce a raw string to a typed cell. Blank → `null`. */
export function coerceValue(raw: string | undefined, type: ColumnType): Cell {
  const v = (raw ?? '').trim()
  if (v === '') return null
  switch (type) {
    case 'number':
      return Number(v.replace(/,/g, ''))
    case 'boolean':
      return /^true$/i.test(v)
    case 'date':
      return v // kept as the original string; ISO dates sort naturally
    default:
      return v
  }
}

/** Build a typed DataSet from parsed CSV. */
export function buildDataSetFromCsv(text: string): DataSet {
  const { headers, rows } = parseCsv(text)
  const columns = inferColumnTypes(headers, rows)
  const outRows: Row[] = rows.map((raw) => {
    const row: Row = {}
    columns.forEach((c, i) => {
      row[c.name] = coerceValue(raw[i], c.type)
    })
    return row
  })
  return { columns, rows: outRows }
}

function jsTypeOf(value: unknown): ColumnType {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return classify(value)
  return 'string'
}

/**
 * Build a typed DataSet from JSON. Accepts an array of flat objects, or an
 * object with a `data`/`rows`/`records` array. Column order follows first
 * appearance across all records (so sparse objects still contribute keys).
 */
export function buildDataSetFromJson(text: string): DataSet {
  const parsed = JSON.parse(text) as unknown
  let records: unknown[]
  if (Array.isArray(parsed)) {
    records = parsed
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    const arr = obj.data ?? obj.rows ?? obj.records
    if (!Array.isArray(arr)) {
      throw new Error('JSON must be an array of objects, or have a data/rows/records array.')
    }
    records = arr
  } else {
    throw new Error('JSON must be an array of objects.')
  }

  const order: string[] = []
  const seen = new Set<string>()
  const typeVotes = new Map<string, Set<ColumnType>>()

  for (const rec of records) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue
    for (const [k, val] of Object.entries(rec as Record<string, unknown>)) {
      if (!seen.has(k)) {
        seen.add(k)
        order.push(k)
      }
      if (val === null || val === undefined) continue
      const votes = typeVotes.get(k) ?? new Set<ColumnType>()
      votes.add(jsTypeOf(val))
      typeVotes.set(k, votes)
    }
  }

  const columns: Column[] = order.map((name) => {
    const votes = typeVotes.get(name)
    const type: ColumnType = votes && votes.size === 1 ? [...votes][0] : 'string'
    return { name, type }
  })

  const rows: Row[] = records
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r))
    .map((rec) => {
      const row: Row = {}
      for (const c of columns) {
        const val = rec[c.name]
        if (val === null || val === undefined) row[c.name] = null
        else if (typeof val === 'object') row[c.name] = JSON.stringify(val)
        else if (c.type === 'number' && typeof val !== 'number') row[c.name] = Number(val)
        else row[c.name] = val as Cell
      }
      return row
    })

  return { columns, rows }
}

export type DataFormat = 'csv' | 'json'

/** Pick a parser by filename extension, falling back to content sniffing. */
export function detectFormat(fileName: string, text: string): DataFormat {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.csv')) return 'csv'
  const trimmed = text.trimStart()
  return trimmed.startsWith('[') || trimmed.startsWith('{') ? 'json' : 'csv'
}

/** Top-level entry: parse a file's text into a typed DataSet. */
export function parseDataFile(fileName: string, text: string): DataSet {
  return detectFormat(fileName, text) === 'json'
    ? buildDataSetFromJson(text)
    : buildDataSetFromCsv(text)
}
