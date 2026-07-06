import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import type { ChartDatum, ChartSpec } from '../lib/types'
import { chrome, seriesColor } from '../lib/palette'
import { useIsDark } from './useIsDark'

/**
 * Presentational chart renderer. Given plot-ready data + a spec, draws the right
 * Recharts chart using the validated palette. Single-measure charts (bar/line/
 * area/scatter) use one hue and no legend; pie slices are distinct identities and
 * get a legend. All chrome (grid, axes, tooltip) is theme-aware and recessive.
 */

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const full = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

export interface ChartViewProps {
  data: ChartDatum[]
  spec: ChartSpec
}

export function ChartView({ data, spec }: ChartViewProps) {
  const dark = useIsDark()
  const c = chrome(dark)

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm" style={{ color: c.tick }}>
        No data to plot for this request.
      </div>
    )
  }

  const axisProps = {
    stroke: c.axis,
    tick: { fill: c.tick, fontSize: 12 },
    tickLine: false,
  }
  const tooltipStyle = {
    background: c.surface,
    border: `1px solid ${c.axis}`,
    borderRadius: 8,
    color: c.label,
    fontSize: 12,
  }
  const grid = <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
  const measure = seriesColor(0, dark)

  switch (spec.type) {
    case 'line':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 24, bottom: 8, left: 8 }}>
            {grid}
            <XAxis dataKey="name" {...axisProps} />
            <YAxis tickFormatter={(v) => compact.format(Number(v))} {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => full.format(Number(v))} />
            <Line
              type="monotone"
              dataKey="value"
              name={spec.y}
              stroke={measure}
              strokeWidth={2}
              dot={{ r: 3, fill: measure }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )

    case 'area':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 12, right: 24, bottom: 8, left: 8 }}>
            <defs>
              <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={measure} stopOpacity={0.35} />
                <stop offset="100%" stopColor={measure} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            {grid}
            <XAxis dataKey="name" {...axisProps} />
            <YAxis tickFormatter={(v) => compact.format(Number(v))} {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => full.format(Number(v))} />
            <Area
              type="monotone"
              dataKey="value"
              name={spec.y}
              stroke={measure}
              strokeWidth={2}
              fill="url(#fill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      )

    case 'pie':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => full.format(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 12, color: c.tick }} />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="45%"
              outerRadius="75%"
              paddingAngle={2}
              stroke={c.surface}
              strokeWidth={2}
            >
              {data.map((d, i) => (
                <Cell key={String(d.name)} fill={seriesColor(i, dark)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      )

    case 'scatter':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 24, bottom: 16, left: 8 }}>
            {grid}
            <XAxis
              type="number"
              dataKey="name"
              name={spec.x}
              {...axisProps}
              tickFormatter={(v) => compact.format(Number(v))}
            />
            <YAxis
              type="number"
              dataKey="value"
              name={spec.y}
              {...axisProps}
              tickFormatter={(v) => compact.format(Number(v))}
            />
            <ZAxis range={[60, 60]} />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ stroke: c.axis }}
              formatter={(v) => full.format(Number(v))}
            />
            <Scatter data={data} fill={measure} />
          </ScatterChart>
        </ResponsiveContainer>
      )

    default:
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 12, right: 24, bottom: 8, left: 8 }}>
            {grid}
            <XAxis dataKey="name" {...axisProps} interval={0} angle={data.length > 6 ? -25 : 0} textAnchor={data.length > 6 ? 'end' : 'middle'} height={data.length > 6 ? 56 : 30} />
            <YAxis tickFormatter={(v) => compact.format(Number(v))} {...axisProps} />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ fill: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}
              formatter={(v) => full.format(Number(v))}
            />
            <Bar dataKey="value" name={spec.y} fill={measure} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )
  }
}
