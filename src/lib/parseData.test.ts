import { describe, expect, it } from 'vitest'
import {
  buildDataSetFromCsv,
  buildDataSetFromJson,
  coerceValue,
  detectFormat,
  inferColumnTypes,
  parseCsv,
  parseDataFile,
} from './parseData'

describe('parseCsv', () => {
  it('splits headers and rows', () => {
    const { headers, rows } = parseCsv('a,b,c\n1,2,3\n4,5,6')
    expect(headers).toEqual(['a', 'b', 'c'])
    expect(rows).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6'],
    ])
  })

  it('is quote-aware for commas and escaped quotes', () => {
    const { headers, rows } = parseCsv('name,note\n"Smith, Jr.","he said ""hi"""')
    expect(headers).toEqual(['name', 'note'])
    expect(rows).toEqual([['Smith, Jr.', 'he said "hi"']])
  })

  it('handles CRLF line endings and a trailing newline', () => {
    const { rows } = parseCsv('a,b\r\n1,2\r\n')
    expect(rows).toEqual([['1', '2']])
  })

  it('supports quoted fields containing newlines', () => {
    const { rows } = parseCsv('a,b\n"line1\nline2",x')
    expect(rows).toEqual([['line1\nline2', 'x']])
  })
})

describe('inferColumnTypes', () => {
  it('classifies number, boolean, date and string columns', () => {
    const cols = inferColumnTypes(
      ['n', 'flag', 'when', 'label'],
      [
        ['1', 'true', '2024-01-01', 'apple'],
        ['2.5', 'false', '2024-02-01', 'pear'],
      ],
    )
    expect(cols).toEqual([
      { name: 'n', type: 'number' },
      { name: 'flag', type: 'boolean' },
      { name: 'when', type: 'date' },
      { name: 'label', type: 'string' },
    ])
  })

  it('falls back to string on mixed values', () => {
    const cols = inferColumnTypes(['x'], [['1'], ['abc']])
    expect(cols[0].type).toBe('string')
  })

  it('ignores blanks when inferring', () => {
    const cols = inferColumnTypes(['x'], [['1'], [''], ['2']])
    expect(cols[0].type).toBe('number')
  })
})

describe('coerceValue', () => {
  it('coerces by column type, blank → null', () => {
    expect(coerceValue('42', 'number')).toBe(42)
    expect(coerceValue('1,200', 'number')).toBe(1200)
    expect(coerceValue('true', 'boolean')).toBe(true)
    expect(coerceValue('', 'number')).toBeNull()
    expect(coerceValue('2024-01-01', 'date')).toBe('2024-01-01')
  })
})

describe('buildDataSetFromCsv', () => {
  it('produces typed rows', () => {
    const ds = buildDataSetFromCsv('region,revenue\nWest,100\nEast,\n')
    expect(ds.columns).toEqual([
      { name: 'region', type: 'string' },
      { name: 'revenue', type: 'number' },
    ])
    expect(ds.rows).toEqual([
      { region: 'West', revenue: 100 },
      { region: 'East', revenue: null },
    ])
  })
})

describe('buildDataSetFromJson', () => {
  it('parses an array of objects', () => {
    const ds = buildDataSetFromJson('[{"a":1,"b":"x"},{"a":2,"b":"y"}]')
    expect(ds.columns).toEqual([
      { name: 'a', type: 'number' },
      { name: 'b', type: 'string' },
    ])
    expect(ds.rows).toEqual([
      { a: 1, b: 'x' },
      { a: 2, b: 'y' },
    ])
  })

  it('accepts a wrapped { data: [...] } shape and sparse keys', () => {
    const ds = buildDataSetFromJson('{"data":[{"a":1},{"a":2,"b":"z"}]}')
    expect(ds.columns.map((c) => c.name)).toEqual(['a', 'b'])
    expect(ds.rows[0]).toEqual({ a: 1, b: null })
  })

  it('throws on a non-array, non-wrapped payload', () => {
    expect(() => buildDataSetFromJson('{"foo":1}')).toThrow()
  })
})

describe('detectFormat / parseDataFile', () => {
  it('detects by extension', () => {
    expect(detectFormat('x.json', '')).toBe('json')
    expect(detectFormat('x.csv', '')).toBe('csv')
  })

  it('sniffs content when extension is unknown', () => {
    expect(detectFormat('data.txt', '[{"a":1}]')).toBe('json')
    expect(detectFormat('data.txt', 'a,b\n1,2')).toBe('csv')
  })

  it('parseDataFile dispatches to the right parser', () => {
    expect(parseDataFile('x.csv', 'a\n1').rows).toEqual([{ a: 1 }])
    expect(parseDataFile('x.json', '[{"a":1}]').rows).toEqual([{ a: 1 }])
  })
})
