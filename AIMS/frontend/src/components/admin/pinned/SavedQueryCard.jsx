/*
 * One pinned card: a saved query, re-run, drawn.
 *
 * WHAT HAPPENS WHEN THIS MOUNTS
 * -----------------------------
 * It POSTs to /saved/:id/run and the server replays the stored plan against
 * the live database. No language model is involved and none of the rows here
 * has passed through one — this renders through the same ChartTemplates
 * registry the Ask the Data canvas uses, from the same response envelope.
 *
 * So a card is never a picture of yesterday's numbers. It costs one query per
 * card per page load, which is the price of a dashboard that is true.
 *
 * WHY THIS IS MEMOISED
 * --------------------
 * It sits inside a grid whose parent re-renders on every drag frame. Without
 * the memo below, dragging a neighbouring card would re-run this one's query
 * several times a second.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Trash2, MoreHorizontal, AlertTriangle, Maximize2 } from 'lucide-react';
import { saved as savedApi } from '../../../api/analytics';
import { enqueue } from './runQueue';
import { TEMPLATES, chartRows } from '../../common/ChartTemplates';
import { visualLabel } from './visuals';
import ChartExpandDialog from './ChartExpandDialog';
import useLiveRefresh from '../../../hooks/useLiveRefresh';
import { LIVE } from '../../../api/queryClient';

// The table template pages in the browser. Smaller than the canvas's 100,
// because a card is a card and scrolling 100 rows inside one is not reading.
const CARD_PAGE_SIZE = 25;

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : n);

function SavedQueryCardBase({
  savedQuery,
  visual,
  editing,
  onRemove,
  onOpenMenu,
}) {

  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const abortRef = useRef(null);

  // One automatic retry per card, reset whenever the query or template changes.
  const retriedRef = useRef(false);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setError('');
    setPage(0);

    try {
      /*
       * Queued, and given longer than a page fetch gets.
       *
       * Six cards mounting at once used to fire six database queries into a
       * six-connection browser limit and a single-process API, and the ones at
       * the back of the queue hit the client's 30s abort before they were even
       * sent — every card reported a timeout on load and then worked when its
       * refresh button was pressed. See runQueue.js.
       */
      const data = await enqueue(
        () => savedApi.run(savedQuery.id, visual, {
          signal: controller.signal,
          timeout: 60000,
        }),
        () => controller.signal.aborted,
      );

      // The card was replaced or unmounted while this was queued.
      if (controller.signal.aborted) return;

      setResult(data.result);

      /*
       * A saved query that no longer runs says so on the card rather than
       * disappearing. The usual cause is a schema change under a generated
       * statement, and the owner is the only person who can decide whether to
       * delete it or ask the question again — so they are told.
       */
      if (data.result?.status !== 'ok') {
        setError(data.result?.message || 'That saved query could not be run.');
      }
    } catch (e) {
      if (e.name === 'AbortError' || controller.signal.aborted) return;

      /*
       * One silent retry, and only for a timeout or a network blip — never for
       * a refusal or a broken query, which will fail again the same way and
       * would only cost the user a second wait to be told so twice.
       *
       * `status === 0` is the client's marker for "never got an answer" (see
       * api/client.js): the request was aborted on time or the connection
       * failed. Both are worth one more attempt, by which point the load
       * stampede that caused them has passed.
       */
      if (e.status === 0 && !retriedRef.current) {
        retriedRef.current = true;
        setTimeout(() => { if (!controller.signal.aborted) run(); }, 400);
        return;
      }

      setError(e.message || 'That card could not be loaded.');
      setResult(null);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [savedQuery.id, visual]);

  useEffect(() => {
    retriedRef.current = false;
    run();
    return () => abortRef.current?.abort();
  }, [run]);

  /*
   * A pinned card is a standing question, so it should keep answering it. It
   * ran once on mount and then held that answer until the card's own refresh
   * button was pressed — a board of six cards pinned in the morning was still
   * showing the morning's counts at close of business.
   *
   * On the slow analytics beat, not the 30-second one the record screens use:
   * each of these is arbitrary generated SQL over the whole institute, run
   * through the queue in runQueue.js. Never while the tab is hidden, and never
   * on top of a run already in flight.
   */
  useLiveRefresh(() => { if (!busy) run(); }, LIVE.analytics);

  const rows = result?.rows || [];
  const columns = result?.columns || [];
  const render = result?.render || { template: 'none' };
  const Template = TEMPLATES[render.template];

  const pageCount = Math.max(1, Math.ceil(rows.length / CARD_PAGE_SIZE));
  const isTable = render.template === 'table';

  return (
    <div className="pin-card">

      {expanded && (
        <ChartExpandDialog
          title={savedQuery.name}
          result={result}
          onClose={() => setExpanded(false)}
        />
      )}

      <div className="pin-card-head">
        <div style={{ minWidth: 0 }}>
          <h3 className="pin-card-title">{savedQuery.name}</h3>
          <p className="pin-card-sub">
            {busy ? 'Running…' : (
              <>
                {fmt(result?.total_rows ?? 0)}
                {result?.total_rows === 1 ? ' row' : ' rows'}
                {' · '}
                {/*
                  * The template ACTUALLY drawn, which is not always the one
                  * asked for: the server downgrades a chart to a table when
                  * today's rows will not carry it. Showing the requested one
                  * here would make the card lie about itself.
                  */}
                {visualLabel(render.template)}
              </>
            )}
          </p>
        </div>

        <div className="pin-card-tools">
          {/*
            * Shown only for a chart with something in it. A card draws in fit
            * mode, which can drop colliding category labels; this is where
            * they come back. A table needs no such escape hatch - it already
            * pages through every row in place.
            */}
          {!isTable && rows.length > 0 && !busy && !error && (
            <button
              type="button" className="pin-icon-btn"
              onClick={() => setExpanded(true)}
              title="Open this chart at full size"
            >
              <Maximize2 size={13} />
            </button>
          )}

          <button
            type="button" className="pin-icon-btn" onClick={run}
            title="Re-run this query" disabled={busy}
          >
            <RefreshCw size={13} className={busy ? 'pin-spin' : undefined} />
          </button>

          {editing && (
            <>
              <button
                type="button" className="pin-icon-btn"
                onClick={(e) => onOpenMenu(e)}
                title="Size and chart type"
              >
                <MoreHorizontal size={15} />
              </button>
              <button
                type="button" className="pin-icon-btn is-danger"
                onClick={onRemove} title="Remove this card"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {busy ? (
        <div className="pin-card-state">Running the query…</div>

      ) : error ? (
        <div className="pin-card-state is-error" role="alert">
          <AlertTriangle size={18} style={{ color: '#D97706' }} />
          <strong>This card could not be run</strong>
          <span style={{ maxWidth: '22rem' }}>{error}</span>
        </div>

      ) : rows.length === 0 ? (
        <div className="pin-card-state">
          <strong>No rows</strong>
          <span>The query ran and matched nothing.</span>
        </div>

      ) : Template ? (
        <div
          /*
           * `is-chart` turns the body's scrolling off entirely. A chart in fit
           * mode is exactly the size of this box, so any overflow here would
           * be a bug rather than content - and letting it scroll is what
           * produced a 380px chart hanging 254px below its own card, with a
           * scrollbar inside a draggable tile to reach the rest of it.
           *
           * A table keeps the scrolling: its rows genuinely do not fit, and
           * paging through them in place is the point.
           */
          className={isTable ? 'pin-card-body' : 'pin-card-body is-chart'}
          onDoubleClick={!isTable && rows.length ? () => setExpanded(true) : undefined}
        >
          <Template
            fit
            /* Transposed for the chart when the result is a one-row summary;
               the table below still gets the row as the database returned it.
               Shared with the canvas so a pinned card and the question that
               made it cannot draw different pictures. */
            rows={chartRows(render, rows, columns)}
            columns={columns}
            xKey={render.xKey}
            yKeys={render.yKeys || []}
            page={page}
            pageSize={CARD_PAGE_SIZE}
          />

          {isTable && pageCount > 1 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '0.5rem', padding: '0.5rem 0.25rem 0', fontSize: '0.72rem',
              color: '#64748B',
            }}>
              <button
                type="button" className="pin-btn" style={{ padding: '0.25rem 0.6rem' }}
                disabled={page === 0} onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span>Page {page + 1} of {fmt(pageCount)}</span>
              <button
                type="button" className="pin-btn" style={{ padding: '0.25rem 0.6rem' }}
                disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>

      ) : (
        <div className="pin-card-state">
          <strong>Nothing to draw</strong>
          <span>No renderer for “{render.template}”.</span>
        </div>
      )}
    </div>
  );
}

/*
 * Re-render only when something this card actually shows has changed.
 *
 * `onOpenMenu` and `onRemove` are recreated by the grid on every render and
 * are deliberately excluded — comparing them would defeat the memo entirely,
 * and both are called, never rendered.
 */
export default memo(SavedQueryCardBase, (prev, next) => (
  prev.savedQuery.id === next.savedQuery.id
  && prev.savedQuery.name === next.savedQuery.name
  && prev.visual === next.visual
  && prev.editing === next.editing
));
