/*
 * The six chart templates, plus a table.
 *
 * These are fixed components. The model never writes chart code, never picks a
 * colour and never emits JSX — it names one of these templates and says which
 * columns feed the axes, and the backend checks that choice against the real
 * result before it ever reaches this file.
 *
 * The point is that rendering is not a place where anything can be invented.
 * Given the same rows, this file draws the same picture every time, and the
 * numbers on screen are the numbers the database returned.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  PieChart, Pie, Cell,
  ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts';

import './ChartTemplates.css';

/*
 * One ordered palette, used by every template.
 *
 * Fixed rather than generated so a series keeps its colour between a bar chart
 * and the line chart the same question produces tomorrow.
 */
const COLORS = [
  '#2563eb', '#16a34a', '#ea580c', '#9333ea',
  '#0891b2', '#dc2626', '#ca8a04', '#4f46e5'
];

/*
 * MySQL DECIMAL columns arrive as strings through the driver, and Recharts
 * silently plots nothing for a string. Coercing here rather than in the API
 * keeps the raw value intact for the table, which should show exactly what
 * the database holds.
 */
const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const numericRows = (rows, xKey, yKeys) =>
  rows.map((row) => {
    const out = { [xKey]: row[xKey] };
    yKeys.forEach((k) => { out[k] = toNumber(row[k]); });
    return out;
  });

/* Turns snake_case column names into readable axis and legend labels. */
const label = (key) =>
  String(key).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/*
 * A one-row summary, turned on its side — but only for the chart.
 *
 * The server decides whether a result is this shape (planValidator.isMetricRow
 * flags it as render.pivot); this performs the transposition. Eight columns
 * across one row are eight labelled measures, and read that way a bar chart
 * of them is meaningful where a pie of the raw row was a single slice
 * labelled with another column's value.
 *
 * The table never calls this. It shows the row the database returned, which is
 * also what the CSV exports.
 */
export const chartRows = (render, rows, columns) => {

  if (!render?.pivot || render?.template === 'table' || !rows?.length) {
    return rows || [];
  }

  const row = rows[0];

  return (columns || [])
    .map((c) => ({ metric: label(c), value: Number(row[c]) }))
    .filter((d) => Number.isFinite(d.value));
};

/*
 * Entrance animation, and the one condition under which there is none.
 *
 * Recharts animates by default, for 1500ms, which on a dashboard of six cards
 * is six charts still moving a second and a half after the page settled. These
 * are shorter and staggered per series, so a multi-series chart resolves in
 * order rather than all at once.
 *
 * The reduced-motion check is read once at module load rather than through a
 * hook. A person who has asked their operating system for less movement does
 * not change that opinion mid-session, and a listener per chart to detect
 * something that never happens is a subscription for nothing.
 *
 * This has to be JavaScript: the media query in AIAnalytics.css cannot reach
 * an SVG animation Recharts drives from its own timer.
 */
const REDUCED_MOTION =
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animation props for series index `i`. */
const enter = (i = 0) => (REDUCED_MOTION
  ? { isAnimationActive: false }
  : {
    isAnimationActive: true,
    animationDuration: 620,
    animationBegin: i * 110,
    animationEasing: 'ease-out'
  });

const AXIS = { fontSize: 12, tick: { fill: 'currentColor', fontSize: 12 } };

/*
 * The floor on how much horizontal room one category gets.
 *
 * Below roughly this, an angled label like "BS Computer Science" starts
 * running into its neighbour, and Recharts has no notion of collision - it
 * draws them overlapping and the axis becomes a smear. Rather than shrink the
 * type until it fits, the chart grows past its container and scrolls.
 *
 * 64px is chosen against the longest labels this database actually produces
 * (programme names and section codes) at a -30 degree tilt.
 */
const MIN_BAR_SLOT = 64;

/* Past this many characters a tick is cut short; the tooltip still has all
 * of it, so nothing is lost, only the collision. */
const MAX_TICK_CHARS = 20;

/* Inside a card there is far less room, so ticks are cut shorter there. */
const MAX_TICK_CHARS_FIT = 12;

const truncate = (limit) => (value) => {
  const text = String(value ?? '');
  return text.length > limit
    ? `${text.slice(0, limit - 1)}\u2026`
    : text;
};

/*
 * The category axis, which is where the two modes visibly part company.
 *
 * Scrolling mode forces interval={0} - every category labelled, tilted, with
 * the width guaranteed by ScrollFrame. Fitting mode does the opposite: it
 * lets Recharts drop ticks that would collide, because in a card the honest
 * choice is fewer readable labels rather than all of them overlapping. The
 * dropped ones are still in the tooltip, and all of them are in the expanded
 * view.
 */
const categoryAxis = (xKey, count, fit) => (fit
  ? {
    dataKey: xKey,
    ...AXIS,
    tickFormatter: truncate(MAX_TICK_CHARS_FIT),
    tickLine: false,
    minTickGap: 6,
    height: 22
  }
  : {
    dataKey: xKey,
    ...AXIS,
    interval: 0,
    tickFormatter: truncate(MAX_TICK_CHARS),
    angle: count > 6 ? -30 : 0,
    textAnchor: count > 6 ? 'end' : 'middle',
    height: count > 6 ? 86 : 30
  });

/*
 * Which edges have content beyond them.
 *
 * Needed because the scrollbar is hidden: without this the reader has no way
 * to tell a chart that ends from a chart that is merely cut off, which is the
 * same "incomplete looks complete" failure the rest of this service is built
 * to avoid.
 *
 * Measured rather than inferred from the row count, because whether a chart
 * overflows depends on the width of the card it landed in - the same twelve
 * bars fit the canvas and overflow a pinned card.
 */
const useOverflow = (count) => {

  const ref = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {

    const el = ref.current;
    if (!el) return undefined;

    const measure = () => {
      const slack = el.scrollWidth - el.clientWidth;
      setEdges({
        left: el.scrollLeft > 1,
        right: slack > 1 && el.scrollLeft < slack - 1
      });
    };

    measure();
    el.addEventListener('scroll', measure, { passive: true });

    /*
     * A resize observer as well as the scroll listener, because the card is
     * draggable and resizable on the pinned boards - the same chart can stop
     * overflowing without anybody scrolling it.
     */
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(measure);

    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);

    return () => {
      el.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [count]);

  return [ref, edges];
};

/*
 * A frame that grows wider than its container rather than compressing.
 *
 * Used by the two category templates. Line, area and scatter keep the plain
 * Frame: their x axis is a continuous sequence, Recharts thins those ticks
 * automatically, and stretching a trend line horizontally changes how steep
 * it looks - which would make the shape of the chart a function of how many
 * points it happens to have.
 */
const ScrollFrame = ({ count, height = 380, children }) => {

  const [ref, edges] = useOverflow(count);
  const minWidth = count * MIN_BAR_SLOT;

  return (
    <div
      className="ct-scroll"
      data-fade-left={edges.left ? '' : undefined}
      data-fade-right={edges.right ? '' : undefined}
    >
      <div className="ct-scrollx" ref={ref}>
        <div style={{ minWidth: `${minWidth}px`, width: '100%', height }}>
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

/*
 * THE TWO PLACES A CHART LIVES, AND WHY THEY DIFFER
 * ------------------------------------------------
 * `fit` is false on the Ask the Data canvas and true inside a pinned card,
 * and it is the only thing that separates them.
 *
 * The canvas is a full-width result area with nothing wrapping it, so a wide
 * chart can grow past the viewport and scroll sideways - 64px of room per
 * category, every label drawn.
 *
 * A pinned card cannot do that. It is a small box on a grid the user resizes,
 * and a chart that overflows it produces nested scroll areas: the card body
 * scrolling one way and the chart the other, inside a tile that is itself
 * draggable. That is the arrangement this prop exists to make impossible.
 *
 * With `fit`, the chart is always EXACTLY the size of its card. Nothing
 * overflows, so nothing scrolls, so nothing can be broken by resizing. What is
 * given up is seeing every label at once, and that is what the expand button
 * on the card returns - the same chart, in a dialog, with room.
 */
const Frame = ({ children, height = 380, fit = false }) => (
  <div style={{ width: '100%', height: fit ? '100%' : height }}>
    <ResponsiveContainer width="100%" height="100%">
      {children}
    </ResponsiveContainer>
  </div>
);

const Grid = () => <CartesianGrid strokeDasharray="3 3" opacity={0.25} />;

const Frills = ({ yKeys }) => (
  <>
    <Tooltip />
    {yKeys.length > 1 ? <Legend /> : null}
  </>
);

/*
 * Picks the frame that matches the surface. See the note on Frame above.
 */
const CategoryFrame = ({ count, fit, children }) => (fit
  ? <Frame fit>{children}</Frame>
  : <ScrollFrame count={count}>{children}</ScrollFrame>);

// ------------------------------------------------------------------ 1. bar

const BarTemplate = ({ rows, xKey, yKeys, fit }) => (
  <CategoryFrame count={rows.length} fit={fit}>
    <BarChart data={numericRows(rows, xKey, yKeys)} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
      <Grid />
      <XAxis {...categoryAxis(xKey, rows.length, fit)} />
      <YAxis {...AXIS} width={fit ? 38 : 56} />
      <Frills yKeys={yKeys} />
      {yKeys.map((k, i) => (
        <Bar key={k} dataKey={k} name={label(k)} fill={COLORS[i % COLORS.length]}
             maxBarSize={72} radius={[4, 4, 0, 0]} {...enter(i)} />
      ))}
    </BarChart>
  </CategoryFrame>
);

// ----------------------------------------------------------------- 2. line

const LineTemplate = ({ rows, xKey, yKeys, fit }) => (
  <Frame fit={fit}>
    <LineChart data={numericRows(rows, xKey, yKeys)} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
      <Grid />
      <XAxis dataKey={xKey} {...AXIS} />
      <YAxis {...AXIS} />
      <Frills yKeys={yKeys} />
      {yKeys.map((k, i) => (
        <Line key={k} type="monotone" dataKey={k} name={label(k)}
              stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={rows.length <= 40}
              {...enter(i)} />
      ))}
    </LineChart>
  </Frame>
);

// ----------------------------------------------------------------- 3. area

const AreaTemplate = ({ rows, xKey, yKeys, fit }) => (
  <Frame fit={fit}>
    <AreaChart data={numericRows(rows, xKey, yKeys)} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
      <Grid />
      <XAxis dataKey={xKey} {...AXIS} />
      <YAxis {...AXIS} />
      <Frills yKeys={yKeys} />
      {yKeys.map((k, i) => (
        <Area key={k} type="monotone" dataKey={k} name={label(k)}
              stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]}
              fillOpacity={0.22} strokeWidth={2} {...enter(i)} />
      ))}
    </AreaChart>
  </Frame>
);

// ------------------------------------------------------------------ 4. pie

/*
 * One series only. The backend enforces that, because a ring whose slices come
 * from two different measures is a picture of nothing.
 */
const PieTemplate = ({ rows, xKey, yKeys, fit }) => {
  const key = yKeys[0];
  const data = numericRows(rows, xKey, [key]).filter((d) => d[key] !== null);

  return (
    <Frame fit={fit}>
      <PieChart>
        <Tooltip />
        <Legend />
        <Pie data={data} dataKey={key} nameKey={xKey} outerRadius="75%"
             label={(d) => d[xKey]} {...enter(0)}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
      </PieChart>
    </Frame>
  );
};

// ---------------------------------------------------------- 5. stacked bar

const StackedBarTemplate = ({ rows, xKey, yKeys, fit }) => (
  <CategoryFrame count={rows.length} fit={fit}>
    <BarChart data={numericRows(rows, xKey, yKeys)} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
      <Grid />
      <XAxis {...categoryAxis(xKey, rows.length, fit)} />
      <YAxis {...AXIS} width={fit ? 38 : 56} />
      <Tooltip />
      <Legend />
      {yKeys.map((k, i) => (
        <Bar key={k} dataKey={k} name={label(k)} stackId="a"
             maxBarSize={72} fill={COLORS[i % COLORS.length]} {...enter(i)} />
      ))}
    </BarChart>
  </CategoryFrame>
);

// -------------------------------------------------------------- 6. scatter

const ScatterTemplate = ({ rows, xKey, yKeys, fit }) => {
  const key = yKeys[0];
  const data = numericRows(rows, xKey, [key])
    .map((d) => ({ x: toNumber(d[xKey]), y: d[key] }))
    .filter((d) => d.x !== null && d.y !== null);

  return (
    <Frame fit={fit}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
        <Grid />
        <XAxis type="number" dataKey="x" name={label(xKey)} {...AXIS} />
        <YAxis type="number" dataKey="y" name={label(key)} {...AXIS} />
        <Tooltip cursor={{ strokeDasharray: '3 3' }} />
        <Scatter data={data} fill={COLORS[0]} {...enter(0)} />
      </ScatterChart>
    </Frame>
  );
};

// ----------------------------------------------------------------- 7. table

/*
 * Paged in the browser rather than by the server.
 *
 * Every row is already here — that is the point of the rewrite — so paging is
 * purely about how many DOM nodes exist at once. The count shown is the true
 * count, not the page size.
 */
const TableTemplate = ({ rows, columns, page, pageSize }) => {

  const start = page * pageSize;
  const slice = rows.slice(start, start + pageSize);

  return (
    <div className="aa-tablewrap">
      <table className="aa-table">
        <thead>
          <tr>
            <th className="aa-rownum">#</th>
            {columns.map((c) => <th key={c}>{label(c)}</th>)}
          </tr>
        </thead>
        <tbody>
          {slice.map((row, i) => (
            <tr key={start + i}>
              <td className="aa-rownum">{start + i + 1}</td>
              {columns.map((c) => (
                <td key={c}>
                  {row[c] === null || row[c] === undefined || row[c] === ''
                    ? <span className="aa-null">—</span>
                    : String(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/*
 * The registry the canvas renders through.
 *
 * A template name that is not a key here cannot render, which is why the
 * backend validates against the same closed list before responding.
 */
export const TEMPLATES = {
  bar: BarTemplate,
  line: LineTemplate,
  area: AreaTemplate,
  pie: PieTemplate,
  stacked_bar: StackedBarTemplate,
  scatter: ScatterTemplate,
  table: TableTemplate
};

export { label, COLORS };
