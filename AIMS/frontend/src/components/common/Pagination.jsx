import { useEffect, useMemo, useRef, useState } from 'react';

/*
 * The admin portal's pagination bar.
 *
 * WHY IT IS SHARED
 * ----------------
 * Six screens had six pagination controls, written separately and behaving
 * differently. Students drew a five-number window with chevron buttons;
 * Fee Management drew EVERY page number, which is 201 buttons at 10 rows a page
 * over 2,013 students; Examination drew another variant of the same; Parents
 * had prev/next only; Attendance had a count with no controls at all. They also
 * disagreed about the row-count sentence — some said "Showing 1–10 of 2,013",
 * some said "Page 1 of 202", one said both.
 *
 * WHAT IT DRAWS
 * -------------
 *     Prev  (1) (2) [3] … (10)  Next        Page [ 3 ⌃⌄ ]  Go
 *
 * The number window is capped, with an ellipsis and the last page always
 * reachable, so the control is the same width at page 3 of 10 as at page 3 of
 * 202. The "Page N / Go" box beside it is what makes a large table navigable at
 * all: without it, reaching page 150 means 150 clicks.
 *
 * The jump box is a controlled input that is NOT applied on every keystroke.
 * Typing "1" on the way to "150" would otherwise fetch page 1, then 15, then
 * 150 — three requests and two flashes of the wrong rows. It applies on Go, on
 * Enter, and on the stepper arrows.
 *
 * EVERYTHING HERE IS DERIVED, NOT ASSUMED
 * ---------------------------------------
 * The bar used to compute its summary purely from `page × limit`, which is only
 * true while the page is full. A screen showing 0 rows out of a 2,001-row table
 * still read "26–50 of 2,001" and still drew a full row of page buttons, so the
 * control claimed 25 rows the table was not showing. `count` — how many rows the
 * caller actually rendered — is now what the summary counts, the page total is
 * re-derived from `total`/`limit` rather than trusted blindly, and a page that
 * has fallen past the end of the data says so and offers the way back.
 */

const ACCENT = '#991b1b';

/**
 * The page numbers to draw, with `null` standing for an ellipsis.
 *
 * The first page is always shown, the last page is always shown, and a window
 * around the current page sits between them. Gaps of exactly one page render as
 * that page rather than as an ellipsis, because "… 5 …" is wider than "4 5 6"
 * and tells you less.
 *
 * `span` widens on small page counts: at 12 pages there is room to show more of
 * them than at 200, and a control that always draws exactly three numbers wastes
 * the space it has.
 */
function pageWindow(page, pages, span = 1) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);

  const out = [1];
  const from = Math.max(2, page - span);
  const to = Math.min(pages - 1, page + span);

  if (from > 2) out.push(from === 3 ? 2 : null);

  for (let i = from; i <= to; i += 1) out.push(i);

  if (to < pages - 1) out.push(to === pages - 2 ? pages - 1 : null);

  out.push(pages);
  return out;
}

/**
 * @param page      current page, 1-based
 * @param pages     total pages, as reported by the API (re-derived if absent)
 * @param total     total rows matching the filters, for the summary line
 * @param limit     rows per page
 * @param count     rows the caller is actually rendering right now; when it is
 *                  not given the page is assumed full, which is the old
 *                  behaviour and is only right while it is
 * @param onChange  (page) => void
 * @param noun      what is being listed, e.g. "student" — pluralised here
 * @param loading   dims the control while a page is in flight
 */
export default function Pagination({
  page = 1,
  pages,
  total = 0,
  limit = 10,
  count,
  onChange,
  noun = 'record',
  loading = false,
}) {
  const [jump, setJump] = useState(String(page));

  // Set while the pointer is down on Go, so the input's own blur handler does
  // not reset the box out from under the click. See the Go button below.
  const applying = useRef(false);

  const safeLimit = Number(limit) > 0 ? Number(limit) : 10;
  const safeTotal = Math.max(Number(total) || 0, 0);

  /*
   * How many pages there really are.
   *
   * `pages` comes from the API and is used when it agrees with the row count,
   * but a screen that has not refetched yet can hold a stale envelope — a filter
   * that narrows 2,001 parents to 12 leaves `pages: 81` in state for one render.
   * Deriving it from the total that the same envelope reports keeps the buttons
   * and the summary from describing two different tables.
   */
  const pageCount = useMemo(() => {
    const derived = Math.max(Math.ceil(safeTotal / safeLimit), 1);
    const reported = Number(pages);
    return Number.isInteger(reported) && reported > 0
      ? Math.min(reported, derived)
      : derived;
  }, [pages, safeTotal, safeLimit]);

  const safePage = Math.min(Math.max(Number(page) || 1, 1), pageCount);

  // Follows the real page when it changes elsewhere — a filter reset sends the
  // table back to page 1, and the box must not keep claiming page 7.
  useEffect(() => { setJump(String(safePage)); }, [safePage]);

  const clamp = (n) => Math.min(Math.max(Number(n) || 1, 1), pageCount);

  const go = (n) => {
    const target = clamp(n);
    setJump(String(target));
    if (target !== safePage) onChange?.(target);
  };

  const applyJump = () => go(jump);

  /*
   * The summary numbers.
   *
   * `count` is what the table is showing. Where it is known, the range ends at
   * the last row that exists rather than at page × limit — the difference is the
   * whole of the "26–50 of 2,001 with nothing on screen" complaint, and it is
   * also what makes the last page of a table read "1,996–2,001" instead of
   * "1,996–2,020".
   */
  const rowsHere = Number.isInteger(count)
    ? Math.max(count, 0)
    : Math.max(Math.min(safePage * safeLimit, safeTotal) - (safePage - 1) * safeLimit, 0);

  const from = rowsHere === 0 ? 0 : (safePage - 1) * safeLimit + 1;
  const to = rowsHere === 0 ? 0 : from + rowsHere - 1;

  // A page with nothing on it while the table has rows somewhere: the filters
  // narrowed the result and left the page number behind it.
  const strandedPage = rowsHere === 0 && safeTotal > 0;

  const atFirst = safePage <= 1;
  const atLast = safePage >= pageCount;

  // More numbers when there is room for them; the control keeps one width.
  const span = pageCount <= 12 ? 2 : 1;

  const edgeButton = (disabled) => ({
    background: 'none',
    border: 'none',
    padding: '0.35rem 0.5rem',
    fontSize: '0.85rem',
    fontWeight: 600,
    color: disabled ? '#CBD5E1' : '#475569',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: "'Inter', sans-serif",
  });

  const numberButton = (active) => ({
    width: '34px',
    height: '34px',
    borderRadius: '9999px',
    border: active ? 'none' : '1px solid #E2E8F0',
    backgroundColor: active ? ACCENT : '#FFFFFF',
    color: active ? '#FFFFFF' : '#334155',
    fontWeight: active ? 800 : 600,
    fontSize: '0.85rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background-color 0.15s, color 0.15s',
    flexShrink: 0,
  });

  // A single page is not worth a control, but the row count still is: without
  // it a short table gives no clue whether it is showing everything.
  const showControls = pageCount > 1;

  const summary = () => {
    if (safeTotal === 0) return `No ${noun}s`;

    if (strandedPage) {
      return (
        <>
          Nothing on page {safePage.toLocaleString()} —{' '}
          <strong style={{ color: '#0F172A' }}>{safeTotal.toLocaleString()}</strong>{' '}
          {noun}{safeTotal === 1 ? '' : 's'} in total
        </>
      );
    }

    // One page, showing all of it: a range adds nothing over the count itself.
    if (!showControls) {
      return `All ${safeTotal.toLocaleString()} ${noun}${safeTotal === 1 ? '' : 's'}`;
    }

    return (
      <>
        {from.toLocaleString()}–{to.toLocaleString()} of{' '}
        <strong style={{ color: '#0F172A' }}>{safeTotal.toLocaleString()}</strong>{' '}
        {noun}{safeTotal === 1 ? '' : 's'}
      </>
    );
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: '1rem',
      backgroundColor: '#FFFFFF',
      border: '1px solid #E2E8F0',
      borderRadius: '16px',
      padding: '0.65rem 1rem',
      boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
      opacity: loading ? 0.65 : 1,
      transition: 'opacity 0.15s',
    }}>
      {/* Left: prev / numbers / next */}
      {showControls ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => go(safePage - 1)} disabled={atFirst} style={edgeButton(atFirst)}>
            Prev
          </button>

          {pageWindow(safePage, pageCount, span).map((n, i) => (
            n === null ? (
              // Not a button: there is no single page it would take you to.
              <span
                key={`gap-${i}`}
                style={{ color: '#94A3B8', fontWeight: 700, padding: '0 2px', userSelect: 'none' }}
              >
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                onClick={() => go(n)}
                aria-current={n === safePage ? 'page' : undefined}
                style={numberButton(n === safePage)}
                onMouseEnter={(e) => { if (n !== safePage) e.currentTarget.style.backgroundColor = '#F1F5F9'; }}
                onMouseLeave={(e) => { if (n !== safePage) e.currentTarget.style.backgroundColor = '#FFFFFF'; }}
              >
                {n}
              </button>
            )
          ))}

          <button type="button" onClick={() => go(safePage + 1)} disabled={atLast} style={edgeButton(atLast)}>
            Next
          </button>
        </div>
      ) : (
        <span style={{ fontSize: '0.8rem', color: '#64748B', fontWeight: 500 }}>
          {summary()}
        </span>
      )}

      {/* Right: the row count, and the jump box */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
        {showControls && (
          <span style={{
            fontSize: '0.78rem',
            color: strandedPage ? '#B45309' : '#64748B',
            fontWeight: strandedPage ? 700 : 500,
            whiteSpace: 'nowrap',
          }}>
            {summary()}
          </span>
        )}

        {/* The way back from a page the data no longer reaches. Without it the
            only exit is the number buttons, which is exactly what the reader has
            just discovered does not work here. */}
        {strandedPage && (
          <button
            type="button"
            onClick={() => go(1)}
            style={{
              border: '1px solid #FCD34D', backgroundColor: '#FFFBEB', color: '#92400E',
              borderRadius: '9999px', padding: '0.3rem 0.8rem',
              fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
              fontFamily: "'Inter', sans-serif",
            }}
          >
            Back to page 1
          </button>
        )}

        {showControls && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', color: '#475569', fontWeight: 600 }}>Page</span>

            <input
              type="number"
              min={1}
              max={pageCount}
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              /* The stepper arrows fire onChange, not a key event, so they are
                 applied here — a click on ⌃ should move the table, not just the
                 number in the box. Typing is applied on Enter or Go instead. */
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); applyJump(); }
                if (e.key === 'ArrowUp') { e.preventDefault(); go(safePage + 1); }
                if (e.key === 'ArrowDown') { e.preventDefault(); go(safePage - 1); }
              }}
              /*
               * Leaving the box abandons what was typed — EXCEPT when the thing
               * being clicked is Go.
               *
               * This is why the Go button did nothing. Blur fires before click,
               * so typing 42 and pressing Go reset the box to the current page
               * first, and the handler that ran a moment later read the page it
               * was already on and concluded there was nowhere to go. Every
               * click on Go was a no-op unless the box happened to be untouched.
               */
              onBlur={() => { if (!applying.current) setJump(String(safePage)); }}
              style={{
                width: '76px',
                padding: '0.4rem 0.5rem 0.4rem 0.85rem',
                borderRadius: '9999px',
                border: '1px solid #E2E8F0',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#0F172A',
                textAlign: 'left',
                outline: 'none',
                fontFamily: "'Inter', sans-serif",
              }}
            />

            <button
              type="button"
              /* Raised before the input's blur handler runs, and lowered after
                 the click has been applied. */
              onMouseDown={() => { applying.current = true; }}
              onClick={() => { applyJump(); applying.current = false; }}
              /* A pointer that goes down on Go and up somewhere else never fires
                 onClick, so the flag has to be cleared here too or the next blur
                 would keep a stale number in the box. */
              onMouseUp={() => { applying.current = false; }}
              style={{
                backgroundColor: ACCENT,
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '9999px',
                padding: '0.45rem 1.1rem',
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: "'Inter', sans-serif",
              }}
            >
              Go
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
