import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  ReferenceLine,
} from 'recharts';
import './Charts.css';

const PALETTE = ['#d1373f', '#2a63c9', '#1f9d55', '#b6791b', '#7c3aed', '#0e7490', '#c2410c', '#5b6770'];

function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="chart-tooltip">
      {label !== undefined && <div className="chart-tooltip-label">{label}</div>}
      {payload.map((p, i) => (
        <div className="chart-tooltip-row" key={i}>
          <span className="chart-tooltip-dot" style={{ background: p.color || p.payload?.fill }} />
          <span>{p.name || p.dataKey}</span>
          <strong>{formatter ? formatter(p.value) : p.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function BarChartCard({
  title,
  subtitle,
  data,
  xKey,
  series, // [{ key, name, color }]
  height = 260,
  stacked = false,
  formatter,
  barSize = 26,
}) {
  return (
    <div className="chart-card">
      <div className="chart-card-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      <div className="chart-card-body" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }} barSize={barSize}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 11.5, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
            <YAxis tick={{ fontSize: 11.5, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip formatter={formatter} />} cursor={{ fill: 'rgba(220,38,38,0.05)' }} />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stackId={stacked ? 'a' : undefined}
                fill={s.color || PALETTE[i % PALETTE.length]}
                radius={stacked ? [0, 0, 6, 6] : [6, 6, 0, 0]}
                maxBarSize={stacked ? 40 : barSize}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function PieChartCard({
  title,
  subtitle,
  data, // [{ name, value, color? }]
  height = 260,
  formatter,
  innerRadius = 52,
  outerRadius = 86,
}) {
  return (
    <div className="chart-card">
      <div className="chart-card-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      <div className="chart-card-body" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              paddingAngle={3}
              stroke="#fff"
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.color || PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip formatter={formatter} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={9} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/*
 * `reference` draws a horizontal rule at a value that MEANS something —
 * currently the institute's 75% attendance requirement, on the Attendance
 * screen. Optional, and every existing caller omits it.
 *
 * Why a line rather than leaving the reader to compare against the axis: a
 * threshold that exists in the rules but not on the chart makes the teacher do
 * arithmetic on every point. With the rule drawn, "is this class in trouble"
 * is answered by which side of the line the series sits on — a glance rather
 * than a calculation.
 *
 * Dashed, so it never reads as a series of its own.
 */
export function LineChartCard({
  title,
  subtitle,
  data,
  xKey,
  series,
  height = 260,
  formatter,
  reference = null,
}) {
  return (
    <div className="chart-card">
      <div className="chart-card-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      <div className="chart-card-body" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 11.5, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
            <YAxis tick={{ fontSize: 11.5, fill: 'var(--text-secondary)' }} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip formatter={formatter} />} cursor={{ stroke: 'var(--border)' }} />
            {reference != null && (
              <ReferenceLine
                y={reference.value}
                stroke={reference.color || 'var(--text-muted)'}
                strokeDasharray="5 4"
                strokeWidth={1.5}
                label={reference.label ? {
                  value: reference.label,
                  position: 'insideTopRight',
                  fontSize: 11,
                  fontWeight: 600,
                  fill: reference.color || 'var(--text-muted)',
                } : undefined}
              />
            )}
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color || PALETTE[i % PALETTE.length]}
                strokeWidth={2.4}
                dot={{ r: 3, strokeWidth: 0, fill: s.color || PALETTE[i % PALETTE.length] }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export { PALETTE };
