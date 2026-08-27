import { useCallback, useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

/*
 * Column sorting, shared by every table in every portal.
 *
 * WHY ONE PLACE
 * -------------
 * There are twenty-odd tables across the admin, faculty, student and parent
 * portals, and before this exactly one of them could be sorted — the faculty
 * DataTable, which built its own. Every other table rendered rows in whatever
 * order the API happened to return them, so "who has the lowest attendance" or
 * "which fee is largest" could only be answered by reading the whole page.
 *
 * Rebuilding that per table is how twenty subtly different sorts appear: one
 * that puts blanks first, one that compares numbers as strings ("100" < "9"),
 * one that forgets to reset the page. This module is the single behaviour.
 *
 * TWO MODES, ONE LOOK
 * -------------------
 * `useSort` sorts an array in the browser. Right for a table that already holds
 * all its rows — a class roster, a timetable, a fee list for one child.
 *
 * `useRemoteSort` produces `sort`/`dir` request parameters instead. Required for
 * a PAGED table: sorting ten visible rows of two thousand reorders the page, not
 * the table, which looks like it worked and is wrong. If the API pages it, the
 * API must sort it.
 *
 * Both drive the same <SortHeader>, so the two feel identical to use.
 */

/* ------------------------------------------------------------ comparison --- */

/*
 * One comparison for every column type.
 *
 * Nulls sort last in BOTH directions rather than being treated as the smallest
 * value. "No attendance recorded" is not the lowest attendance and an unpaid
 * voucher with no date is not the oldest — floating blanks to the top of an
 * ascending sort puts them exactly where the real extremes belong.
 *
 * Numbers compare numerically; everything else compares with `localeCompare`
 * and `numeric: true`, so "Semester 2" precedes "Semester 10" instead of
 * following it the way a plain string sort would.
 */
export function compareValues(a, b) {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  if (typeof a === 'number' && typeof b === 'number') return a - b;

  if (a instanceof Date && b instanceof Date) return a - b;

  const na = typeof a === 'string' ? Number(a.replace(/[,%\s]/g, '')) : NaN;
  const nb = typeof b === 'string' ? Number(b.replace(/[,%\s]/g, '')) : NaN;
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;

  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/* -------------------------------------------------------------- client ---- */

/**
 * Sort an in-memory array.
 *
 * @param rows      the full array — every row, not a page of them
 * @param accessors optional { key: (row) => value } for columns whose sort value
 *                  is not simply `row[key]` (a formatted string, a nested field)
 * @param initial   optional { key, dir } starting order
 */
export function useSort(rows, accessors = {}, initial = null) {
  const [sort, setSort] = useState(initial);

  const toggle = useCallback((key) => {
    setSort((current) => {
      if (current?.key !== key) return { key, dir: 'asc' };
      // asc -> desc -> unsorted, so a column can always be put back to the
      // order the API returned rather than being stuck sorted forever.
      if (current.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }, []);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const read = accessors[sort.key] || ((row) => row[sort.key]);
    // Copy first: sorting in place mutates the caller's array, and a parent that
    // re-renders from the same reference then shows a different order than the
    // one its own state describes.
    return [...rows].sort((x, y) => {
      const cmp = compareValues(read(x), read(y));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  return { sorted, sort, toggle };
}

/* -------------------------------------------------------------- server ---- */

/**
 * Sorting for a table the API pages.
 *
 * Returns `params` to spread into the request alongside the other filters, and
 * calls `onChange` whenever the order changes so the caller can reset to page 1
 * — landing on page 7 of a newly-ordered table shows rows nobody asked for.
 */
export function useRemoteSort(initial = null, onChange) {
  const [sort, setSort] = useState(initial);

  const toggle = useCallback((key) => {
    setSort((current) => {
      const next = current?.key !== key
        ? { key, dir: 'asc' }
        : current.dir === 'asc'
          ? { key, dir: 'desc' }
          : null;
      onChange?.(next);
      return next;
    });
  }, [onChange]);

  const params = useMemo(
    () => (sort ? { sort: sort.key, dir: sort.dir } : {}),
    [sort],
  );

  return { sort, toggle, params };
}

/* --------------------------------------------------------------- header --- */

/*
 * A sortable column heading.
 *
 * Renders a real <button> inside the <th> so the control is reachable by
 * keyboard and announced as a control, and carries `aria-sort` on the cell
 * itself — which is what a screen reader reads to say how the table is ordered.
 *
 * The arrow is always present, greyed when the column is unsorted. Revealing it
 * only on hover hides which columns can be sorted at all, and makes the heading
 * jump as the cursor crosses it.
 */
export function SortHeader({
  label,
  sortKey,
  sort,
  onToggle,
  align = 'left',
  style = {},
  title,
}) {
  const [hover, setHover] = useState(false);
  const active = sort?.key === sortKey;
  const dir = active ? sort.dir : null;

  const Arrow = dir === 'asc' ? ChevronUp : dir === 'desc' ? ChevronDown : ChevronsUpDown;

  return (
    <th
      scope="col"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{ ...style, textAlign: align }}
    >
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title={title || `Sort by ${label}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          flexDirection: align === 'right' ? 'row-reverse' : 'row',
          background: 'none',
          border: 'none',
          padding: 0,
          margin: 0,
          font: 'inherit',
          color: 'inherit',
          letterSpacing: 'inherit',
          textTransform: 'inherit',
          cursor: 'pointer',
          opacity: active || hover ? 1 : 0.92,
        }}
      >
        {label}
        <Arrow
          size={13}
          aria-hidden="true"
          style={{
            flexShrink: 0,
            opacity: active ? 1 : hover ? 0.6 : 0.32,
            transition: 'opacity 140ms cubic-bezier(0.23, 1, 0.32, 1)',
          }}
        />
      </button>
    </th>
  );
}

export default SortHeader;
