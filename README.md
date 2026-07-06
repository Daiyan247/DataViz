# DataViz Studio

A fully-offline, in-browser tool for turning **CSV or JSON** data into charts. Attach a data file in
the chat, describe the chart you want in plain English, and it renders — then filter the data down to
visualize only the parts you care about. Nothing leaves your machine.

## What it does

- **Attach data** — drag/drop or the 📎 button in the composer. CSV (quote-aware) and JSON (array of
  objects, or `{ "data": [...] }`) are both supported. Column types (number / string / boolean / date)
  are inferred automatically.
- **Describe the chart** — type a request like:
  - `bar chart of revenue by region`
  - `revenue over time as a line`
  - `share of units by category as a pie`
  - `scatter of revenue vs units`
  - `count of orders by region`, `average revenue by category`
  A deterministic keyword parser (no LLM, no network) maps your words to a chart type + x/y fields +
  aggregation.
- **Filter** — add filters (per column, type-aware operators) and the chart re-renders on the filtered
  rows only. The source data is never mutated.

## Sample data

`sample-data/` has two practical datasets, each in **both** CSV and JSON so you can test either path:

| File | Rows | Columns | Good for |
| --- | --- | --- | --- |
| `sales.csv` / `sales.json` | 96 | month, region, category, product, units, unit_price, discount, revenue | bar / pie / grouped comparisons |
| `weather.csv` / `weather.json` | 90 | date, city, temp_c, humidity, precip_mm, wind_kph, condition | line / area / scatter time series |

Try: load `sales.json` → `revenue by region` → add a filter `category is Laptops`. Or load
`weather.csv` → `temp_c over time as a line` → filter `city is Seattle`.

## Architecture

Modular and testable, mirroring a clean layering ethos:

- **`src/lib/*` — pure, unit-tested logic** (no React, no Recharts, no DOM):
  - `parseData.ts` — CSV/JSON parsing, type inference, value coercion
  - `parseChartRequest.ts` — natural-language request → `ChartSpec`
  - `filterRows.ts` — AND-combined, type-aware row filtering
  - `buildChartData.ts` — group-by + aggregate → plot-ready `{ name, value }[]`
  - `palette.ts` — validated, colorblind-safe series colors (fixed order, never cycled)
  - `types.ts` — shared DTOs
- **`src/components/*` — presentational** (props only): `FileDrop`, `ChartRequestInput`,
  `FilterPanel`, `DataSummary`, `ChartView` (Recharts).
- **`src/App.tsx` — wiring**: owns state and connects data → filters → spec → chart.

Data flows one way: file → `parseData` → filters → `parseChartRequest` → `buildChartData` →
`ChartView`. Every transform in `lib/` is a pure function with tests.

## Commands

```bash
npm install
npm run dev         # dev server (localhost:5173)
npm run build       # typecheck + production build
npm test            # unit tests (Vitest)
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
```

## Stack

Vite + React 19 + TypeScript + Tailwind v4 + Recharts 3 + Vitest.
