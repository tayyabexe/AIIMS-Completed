/*
 * The AI Analytics canvas.
 *
 * A question field and one output area. Whatever the answer is — a list, a
 * single number, a chart — it lands in the same canvas, rendered by a fixed
 * template chosen server-side.
 *
 * What is deliberately absent: any model-written narrative about the data.
 * The old assistant replied in prose, which is how a 1,175-row result came to
 * be described as "200 students, all with 0 PKR paid". Here the count is the
 * length of the array beside it, and the table below is the whole array.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
import { analytics } from '../../api/analytics';
import { TEMPLATES, label, chartRows } from '../../components/common/ChartTemplates';
import SaveQueryDialog from '../../components/admin/pinned/SaveQueryDialog';
import { useAuth } from '../../context/AuthContext';
import './AIAnalytics.css';

const PAGE_SIZE = 100;

/*
 * Why a chart the planner asked for was not drawn.
 *
 * Shown rather than swallowed. A user who asked for a pie and got a table is
 * owed the reason, and "too many points to plot" is a fact about their data
 * worth knowing.
 */
const DEGRADED = {
  columns_missing: 'The requested columns were not in the result, so this is shown as a table.',
  no_plottable_columns: 'No numeric column to plot, so this is shown as a table.',
  too_many_points: 'Too many rows to chart legibly — every row is listed below.',
  too_many_slices: 'Too many categories for a pie chart, so this is shown as bars.',
  metric_row: 'These are separate totals rather than parts of one whole, so they are shown as bars.'
};

/*
 * The waiting state, shaped like the thing being waited for.
 *
 * A centred "Running the query…" told the user nothing except that the page
 * had not frozen. This shows the silhouette of a result — a title, a row of
 * columns, an axis, a footer — so the wait reads as an answer assembling
 * rather than as an absence.
 *
 * The bar heights are a fixed list, not random. A skeleton that reshuffles
 * every render looks like data arriving and then changing, which is precisely
 * the impression this service exists to avoid giving.
 */
const SKELETON_BARS = [52, 78, 41, 90, 63, 34, 71, 48, 84, 57];

const Skeleton = () => (
  <div className="aa-skeleton" role="status" aria-live="polite">
    <div className="aa-sk-head">
      <div className="aa-sk-line" style={{ width: '38%' }} />
      <div className="aa-sk-line" style={{ width: '15%' }} />
    </div>

    <div className="aa-sk-bars" aria-hidden="true">
      {SKELETON_BARS.map((h, i) => (
        <span key={i} style={{ height: `${h}%`, animationDelay: `${i * 90}ms` }} />
      ))}
    </div>

    <div className="aa-sk-foot" aria-hidden="true">
      <div className="aa-sk-line" style={{ width: '22%' }} />
      <div className="aa-sk-line" style={{ width: '14%' }} />
      <div className="aa-sk-line" style={{ width: '18%' }} />
    </div>

    <p className="aa-sk-note">
      Planning the query, then reading the rows straight from the database.
    </p>
  </div>
);

/*
 * The switcher's buttons, in a deliberate order: the comparison shapes first,
 * then the distribution and relationship ones, with the table last as the
 * always-available fallback.
 */
const SWITCHER = [
  ['bar', 'Bar'],
  ['line', 'Line'],
  ['area', 'Area'],
  ['pie', 'Pie'],
  ['stacked_bar', 'Stacked'],
  ['scatter', 'Scatter'],
  ['table', 'Table']
];

/*
 * Opening prompts, per portal.
 *
 * These are not decoration - they teach the shape of a question that works,
 * and the wrong set actively misleads. A teacher offered "List the fee
 * defaulter students" is being shown a question their catalogue will refuse,
 * and the refusal reads as the feature being broken rather than as the chip
 * being wrong.
 *
 * The teacher set is phrased with "my" throughout, because that is the word
 * the planner resolves against their own roster.
 */
const SUGGESTIONS = {
  admin: [
    'List the fee defaulter students',
    'Student count per program as a chart',
    'Attendance percentage by program',
    'Results distribution for the current semester',
    'Teacher workload report'
  ],
  teacher: [
    'Average attendance per subject for my classes',
    'Which of my subjects has the lowest average marks?',
    'My students below 75% attendance',
    'Marks distribution for my sections as a chart',
    'How many students do I teach?'
  ]
};

/* Numbers with separators; everything else untouched. */
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : n);

export default function AIAnalytics() {

  const { user } = useAuth();

  /*
   * Saving is an admin capability, matching the endpoint behind it.
   *
   * A teacher can ask anything they could ask before — the canvas is
   * unchanged for them — but the two screens a saved card can be pinned to are
   * admin-portal modules a teacher never reaches, so offering them a Save
   * button would be offering a shelf with nowhere to put the thing.
   */
  const isTeacher = user?.roleId === 3;

  /*
   * Teachers pin too, onto their own board.
   *
   * This used to be admins only, and the reason given was that a teacher's
   * saved card would have nowhere to be dropped - true while the only two
   * boards were admin-portal screens. The faculty portal now has
   * `faculty_insights`, so the shelf exists.
   *
   * The gate that actually matters is on the server: /saved and /layout accept
   * these three roles, and SURFACES_BY_SCOPE decides which board each of them
   * may arrange. This line only decides whether to draw the button.
   */
  const canSave = user?.roleId === 1 || user?.roleId === 2 || isTeacher;

  const suggestions = isTeacher ? SUGGESTIONS.teacher : SUGGESTIONS.admin;

  const [saving, setSaving] = useState(false);
  // The name of the query most recently saved, for the confirmation line.
  const [justSaved, setJustSaved] = useState('');

  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);

  /*
   * A template the user picked, overriding the planner's choice.
   *
   * Every row is already in the browser, so switching costs nothing — no
   * request, no model call. Cleared on each new question so the next answer
   * starts from whatever the planner thought best rather than inheriting a
   * choice made about different data.
   */
  const [override, setOverride] = useState(null);

  const abortRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async (text) => {

    const q = String(text ?? question).trim();
    if (!q || busy) return;

    // A second question supersedes the first rather than racing it.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setError('');
    setPage(0);
    setOverride(null);
    setJustSaved('');

    try {
      const data = await analytics.ask(q, { signal: controller.signal });
      setResult(data.result);

      if (data.result?.status !== 'ok') {
        setError(data.result?.message || 'That question could not be answered.');
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      setError(e.message || 'The analytics service could not be reached.');
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e) => { e.preventDefault(); run(); };

  const rows = result?.rows || [];
  const columns = result?.columns || [];
  const planned = result?.render || { template: 'none' };
  const options = result?.options || {};
  const axes = result?.axes || { xKey: '', yKeys: [] };

  /*
   * The planner's pick is the default; an override replaces it.
   *
   * When overriding, the axes come from `axes` — the server's derivation from
   * the real data — because the planner's xKey/yKeys are blank whenever it
   * chose a table, and a bar chart needs them.
   */
  const render = override
    ? { ...planned, template: override, xKey: axes.xKey, yKeys: axes.yKeys, pivot: axes.pivot }
    : planned;

  const Template = TEMPLATES[render.template];

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  /*
   * Charts get every row; only the table pages. Recharts is given the full
   * series because a chart of page one of six would be a different chart.
   */
  const isTable = render.template === 'table';

  /*
   * A one-row summary, turned on its side for the chart and only for the
   * chart.
   *
   * The server flags this shape (planValidator.isMetricRow); the transposition
   * happens here because the table below must still show the row the database
   * returned, and the CSV must still export it. Eight columns across one row
   * become eight labelled bars; the same eight stay one row underneath.
   */
  const plotted = useMemo(
    () => chartRows(render, rows, columns),
    [render, rows, columns]
  );

  const templateProps = useMemo(() => ({
    rows: plotted,
    columns,
    xKey: render.xKey,
    yKeys: render.yKeys || [],
    page,
    pageSize: PAGE_SIZE
  }), [plotted, columns, render.xKey, render.yKeys, page]);

  const downloadCsv = () => {
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      columns.join(','),
      ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))
    ].join('\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(render.title || 'analytics').replace(/\W+/g, '_').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    /*
     * The faculty portal gets its own palette through this one class. The
     * layout, the markup and every rule below are shared; only the colour
     * tokens differ, and they all live in AIAnalytics.css. See the header of
     * that file for why the theme is declared beside the component rather
     * than beside the page that imports it.
     */
    <div className={isTeacher ? 'aa aa--faculty' : 'aa'}>

      <section className="aa-hero">
        <div className="aa-hero-inner">

          <header className="aa-head">
            {/*
              * The scope note, promoted out of the paragraph nobody read.
              *
              * For a teacher this changes how every figure on the page should
              * be taken — the answers describe their roster, not the
              * institute — so it is the first thing on the page rather than
              * the third sentence of a caveat.
              */}
            <p className="aa-eyebrow">
              {isTeacher ? (
                <>
                  <ShieldCheck size={13} aria-hidden="true" />
                  Answered about your classes only
                </>
              ) : (
                <>
                  <span className="aa-eyebrow-dot" aria-hidden="true" />
                  Live from the database
                </>
              )}
            </p>

            <h1>{isTeacher ? 'Ask the Data' : 'AI Analytics'}</h1>

            <p className="aa-lede">
              Ask in plain language. The question becomes a database query, and
              the rows come back as a table or a chart — never summarised, never
              rewritten by a language model.
            </p>
          </header>

          <form className="aa-ask" onSubmit={onSubmit}>
            <input
              ref={inputRef}
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={isTeacher
                ? 'e.g. average attendance per subject for my classes'
                : 'e.g. how many students are enrolled in each batch'}
              maxLength={500}
              disabled={busy}
              aria-label="Ask a question about the data"
            />
            <button type="submit" disabled={busy || !question.trim()}>
              {busy ? 'Working…' : <>Ask <ArrowRight size={15} aria-hidden="true" /></>}
            </button>
          </form>

          {/*
            * The chips stay after an answer instead of disappearing.
            *
            * They used to be hidden as soon as a result arrived, which removed
            * the fastest way to ask the next question at exactly the moment
            * somebody had just learned what this page does.
            */}
          {/*
            * Always rendered, disabled while a query runs.
            *
            * Hiding them during the wait shortened the hero by a row, so the
            * skeleton below it jumped upward the instant you pressed Ask and
            * jumped back when the rows landed. A page that moves while you are
            * waiting for it reads as unstable, and the fix is simply to stop
            * removing things from the layout.
            */}
          <div className="aa-suggest" aria-busy={busy}>
            {suggestions.map((s, i) => (
              <button
                key={s}
                type="button"
                style={{ '--i': i }}
                disabled={busy}
                onClick={() => { setQuestion(s); run(s); }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </section>

      {busy && <Skeleton />}

      {error && !busy && (
        <div className="aa-error" role="alert">{error}</div>
      )}

      {result?.status === 'ok' && !busy && (
        <section className="aa-canvas" aria-live="polite">

          <div className="aa-canvas-head">
            <div>
              <h2>{render.title || label(question)}</h2>

              {/*
                * Shown only when the model actually changed the wording, so a
                * correctly typed question does not get a pointless caption —
                * and a rewritten one is never passed off as what was asked.
                */}
              {result.corrected_question
                && result.corrected_question.toLowerCase() !== result.question.toLowerCase() && (
                <p className="aa-corrected">
                  Interpreted as: <em>{result.corrected_question}</em>
                </p>
              )}
            </div>

            <div className="aa-meta">
              <span className="aa-count">
                <strong>{fmt(result.total_rows)}</strong>
                {result.total_rows === 1 ? ' row' : ' rows'}
              </span>
              {rows.length > 0 && canSave && (
                <button
                  type="button"
                  className="aa-csv"
                  onClick={() => setSaving(true)}
                  title="Keep this query so you can pin it to your Dashboard or AI Insights"
                >
                  <Bookmark size={13} style={{ verticalAlign: '-2px', marginRight: '0.3rem' }} />
                  Save query
                </button>
              )}
              {rows.length > 0 && (
                <button type="button" className="aa-csv" onClick={downloadCsv}>
                  Download CSV
                </button>
              )}
            </div>
          </div>

          {/*
            * A ceiling was hit. Stated with the true total from a separate
            * COUNT, never with the length of the truncated array — that
            * substitution is precisely the bug this rewrite exists to remove.
            */}
          {result.truncated && (
            <div className="aa-warn">
              Showing the first {fmt(result.row_count)} of {fmt(result.total_rows)} rows.
            </div>
          )}

          {/*
            * Only meaningful when the planner's own choice is on screen. Once
            * the user has picked a template themselves, an explanation of why
            * a different one was rejected is just noise.
            */}
          {!override && render.degraded && DEGRADED[render.degraded] && (
            <div className="aa-note">{DEGRADED[render.degraded]}</div>
          )}

          {/*
            * The chart switcher.
            *
            * Every row is already in the browser, so this is instant and costs
            * nothing — no request, no model call. A template the data cannot
            * support is disabled and carries the reason as its tooltip, which
            * is more honest than letting someone click it and get a blank
            * canvas.
            */}
          {rows.length > 0 && (
            <div className="aa-switch" role="group" aria-label="Chart type">
              {SWITCHER.map(([key, text]) => {
                const state = key === 'table' ? true : options[key];
                const ok = state === true;
                const active = render.template === key;

                return (
                  <button
                    key={key}
                    type="button"
                    className={active ? 'is-active' : ''}
                    disabled={!ok}
                    title={ok
                      ? `Show as ${text.toLowerCase()}`
                      : String(state || 'Not available for this result')}
                    aria-pressed={active}
                    onClick={() => setOverride(key)}
                  >
                    {text}
                  </button>
                );
              })}

              {override && override !== planned.template && (
                <button type="button" className="aa-reset" onClick={() => setOverride(null)}>
                  Reset
                </button>
              )}
            </div>
          )}

          {/*
            * Says where the thing went. A saved query is useful somewhere
            * else, and a confirmation that does not name the destination
            * leaves the user hunting for it.
            */}
          {justSaved && (
            <div className="aa-note" role="status">
              <Sparkles size={13} style={{ verticalAlign: '-2px', marginRight: '0.35rem' }} />
              Saved as <strong>{justSaved}</strong>. Open the Dashboard or AI
              Insights, press Customise, and drag it onto the grid.
            </div>
          )}

          {rows.length === 0 ? (
            <div className="aa-empty">
              The query ran and matched no rows.
            </div>
          ) : Template ? (
            <>
              <Template {...templateProps} />

              {isTable && pageCount > 1 && (
                <div className="aa-pager">
                  <button type="button" disabled={page === 0}
                          onClick={() => setPage((p) => p - 1)}>Previous</button>
                  <span>Page {page + 1} of {fmt(pageCount)}</span>
                  <button type="button" disabled={page >= pageCount - 1}
                          onClick={() => setPage((p) => p + 1)}>Next</button>
                </div>
              )}
            </>
          ) : (
            <div className="aa-empty">No renderer for “{render.template}”.</div>
          )}

          <details className="aa-source">
            <summary>How this was answered</summary>
            <dl>
              <dt>Source</dt>
              <dd>
                {result.source?.kind === 'tool'
                  ? <>Curated tool <code>{result.source.name}</code></>
                  : 'Generated SQL'}
              </dd>
              {result.source?.kind === 'sql' && (
                <>
                  <dt>Query</dt>
                  <dd><pre>{result.source.sql}</pre></dd>
                </>
              )}
              <dt>Chart</dt>
              <dd>{render.template}</dd>
              <dt>Time</dt>
              <dd>{fmt(result.timing_ms)} ms</dd>
              <dt>Planner tokens</dt>
              <dd>{fmt(result.planner_tokens)}</dd>
            </dl>
          </details>

        </section>
      )}

      {saving && result?.status === 'ok' && (
        <SaveQueryDialog
          /*
           * The result is passed with the template CURRENTLY on screen, not
           * the one the planner picked. If the user flipped it to a pie, a pie
           * is what they mean to save.
           */
          result={{ ...result, render }}
          question={question}
          /*
           * The boards this account can actually pin to, and whether they take
           * tables. The dialog is shared between the portals and named the
           * admin's two screens for everyone, so a teacher was told to drag
           * the chip onto "AI Insights" — a screen they cannot open — and that
           * "the Dashboard takes charts only", which is untrue of theirs.
           * See SURFACES_BY_SCOPE in backend config/dashboardCards.js.
           */
          boards={isTeacher
            ? { names: 'Dashboard or Ask the Data', tablesAnywhere: true }
            : { names: 'Dashboard or AI Insights', tablesAnywhere: false }}
          onClose={() => setSaving(false)}
          onSaved={(entry) => setJustSaved(entry.name)}
        />
      )}
    </div>
  );
}
