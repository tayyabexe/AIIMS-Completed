import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { admin as adminApi } from '../../api/endpoints';
import { useAdminPage } from '../../hooks/useAdminPage';
import { relativeTime, timeOfDay, dayLabel } from '../../utils/datetime';
import {
  CARD, INK, TYPE, SPACE, RULE, ACCENT, ACTIVITY_TONE, RADIUS, SURFACE,
} from '../../styles/adminTheme';

/*
 * The admin dashboard's activity feed.
 *
 * WHAT IT SHOWS
 * -------------
 * GET /api/admin/activity, which merges two things:
 *
 *   - ACTS, from the audit trail. A named person did something: a teacher
 *     updated a section's marks, an accounts officer approved a payment, an
 *     administrator reissued somebody's password.
 *   - EVENTS. A result was published, a fee cleared, a student was enrolled,
 *     an announcement went out.
 *
 * WHY IT IS SHORTER THAN IT WAS
 * -----------------------------
 * The card had no height of its own. It asked for twelve rows and then grew to
 * whatever those twelve rows needed — each one three stacked lines plus a day
 * heading — so it ran to roughly 700px and became the tallest thing on the
 * dashboard by a wide margin. A summary card that is taller than everything it
 * summarises has stopped being a summary; it had turned the dashboard into a
 * scroll, with the figures people came for pushed off the top of the screen.
 *
 * Three changes, and none of them throw information away:
 *
 *   1. THE ROW IS TWO LINES, NOT FOUR. What happened, then who and what it was
 *      about on one clamped line. `meta` — the actor's role, the payment
 *      method, the record count — moves into the row's tooltip, where it is
 *      still reachable but is no longer the third line of forty rows.
 *   2. THE CARD OWNS ITS HEIGHT. The list scrolls inside a fixed region rather
 *      than pushing the page down, so the feed sits beside the panels instead
 *      of dwarfing them, and the dashboard is one screen again.
 *   3. IT FETCHES MORE AND SHOWS LESS. Forty rows instead of twelve — because
 *      a filter over a twelve-row window is not a filter. The scroll region
 *      means the extra rows cost height nothing.
 *
 * WHY THE FILTER IS ON THE CLIENT
 * -------------------------------
 * `GET /api/admin/activity` takes a limit and nothing else — its five sources
 * are five separate queries merged in JavaScript, so a `type` parameter would
 * mean rewriting the endpoint. Over a forty-row window that is not worth it,
 * and filtering what is already in hand is instant where a round trip is not.
 *
 * The consequence is stated rather than hidden: the chips count what is in the
 * window, the card says so, and the whole record is one click away at /audit.
 */

// The order chips appear in, and the label each type gets. Derived from the
// `type` field the API already sets on every row.
const KINDS = [
  { type: 'audit', label: 'Actions' },
  { type: 'payment', label: 'Payments' },
  { type: 'result', label: 'Results' },
  { type: 'enrolment', label: 'Enrolments' },
  { type: 'announcement', label: 'Notices' },
];

const WINDOW = 40;

export default function RecentActivity() {
  const { data, loading, error, refresh } = useAdminPage(
    (p) => adminApi.activity(p),
    { limit: WINDOW }, { key: 'activity' });

  const [kind, setKind] = useState('all');

  const items = useMemo(() => data?.activity ?? [], [data]);

  // How many of each kind are in the window. Computed over the unfiltered
  // list, so a chip's count does not change when that chip is selected.
  const counts = useMemo(() => {
    const tally = {};
    for (const item of items) tally[item.type] = (tally[item.type] || 0) + 1;
    return tally;
  }, [items]);

  const visible = useMemo(
    () => (kind === 'all' ? items : items.filter((item) => item.type === kind)),
    [items, kind],
  );

  /*
   * Grouped into days in render order. The feed already arrives sorted newest
   * first, so this only has to notice when the day changes rather than sort
   * anything itself.
   */
  const groups = useMemo(() => {
    const out = [];
    for (const item of visible) {
      const label = dayLabel(item.at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(item);
      else out.push({ label, items: [item] });
    }
    return out;
  }, [visible]);

  // Only offer a chip for a kind that is actually in the window. A filter that
  // is guaranteed to return nothing is worse than no filter.
  const chips = KINDS.filter((k) => counts[k.type] > 0);

  return (
    <section
      className="ad-card ad-rise"
      style={{
        ...CARD, '--i': 7,
        display: 'flex', flexDirection: 'column',
        /* The cap, and the reason the card stopped being the tallest thing on
           the page. 26rem holds about fourteen rows — a working window onto a
           record whose full extent lives at /audit, which is what a dashboard
           card should be. Beyond this the list scrolls; the page does not. */
        maxHeight: '26rem',
        overflow: 'hidden',
      }}
    >
      <div style={{
        padding: `${SPACE.xl} ${SPACE.xl} ${SPACE.md}`,
        display: 'flex', flexDirection: 'column', gap: SPACE.md,
        borderBottom: `1px solid ${RULE.hairline}`,
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          gap: SPACE.md,
        }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={TYPE.heading}>Recent activity</h2>
            <p style={{ ...TYPE.micro, marginTop: '2px' }}>
              The last {WINDOW} records, across every module
            </p>
          </div>

          {/* The card is a window; this is the way to the whole record. */}
          <Link
            to="/audit"
            className="ad-focusable"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: SPACE.xs,
              fontSize: '12px', fontWeight: 600, color: ACCENT.base,
              textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
              borderRadius: RADIUS.chip,
            }}
          >
            Audit trail
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>

        {chips.length > 1 && (
          <div
            role="group"
            aria-label="Filter activity by kind"
            style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}
          >
            <Chip
              selected={kind === 'all'}
              onSelect={() => setKind('all')}
              label="All"
              count={items.length}
            />
            {chips.map((k) => (
              <Chip
                key={k.type}
                selected={kind === k.type}
                onSelect={() => setKind(k.type)}
                label={k.label}
                count={counts[k.type]}
                dot={ACTIVITY_TONE[k.type]}
              />
            ))}
          </div>
        )}
      </div>

      <Body
        loading={loading && !data}
        error={error}
        onRetry={refresh}
        groups={groups}
        empty={!items.length}
        filtered={kind !== 'all'}
        onClearFilter={() => setKind('all')}
      />
    </section>
  );
}

/*
 * A filter chip carrying its own count.
 *
 * The count is what makes the chip worth its space: "Payments 6" tells you
 * there were six before you click, so the chips double as a breakdown of the
 * window and a chip is never a guess that turns out to be empty.
 */
function Chip({ selected, onSelect, label, count, dot }) {
  return (
    <button
      type="button"
      className="ad-chip ad-focusable"
      aria-pressed={selected}
      onClick={onSelect}
    >
      {dot && (
        <span
          aria-hidden="true"
          style={{
            width: '3px', height: '10px', borderRadius: '2px',
            backgroundColor: dot, flexShrink: 0,
          }}
        />
      )}
      {label}
      <span style={{
        fontVariantNumeric: 'tabular-nums',
        color: selected ? ACCENT.base : INK.muted,
        fontWeight: 500,
      }}>
        {count}
      </span>
    </button>
  );
}

function Body({ loading, error, onRetry, groups, empty, filtered, onClearFilter }) {
  const note = (text, action) => (
    <div style={{
      padding: `${SPACE.xxl} ${SPACE.xl}`, textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.md,
    }}>
      <p style={{ ...TYPE.meta, textWrap: 'pretty' }}>{text}</p>
      {action}
    </div>
  );

  const button = (label, onClick) => (
    <button
      type="button"
      onClick={onClick}
      className="ad-chip ad-focusable"
    >
      {label}
    </button>
  );

  if (loading) return note('Loading activity…');

  if (error) {
    return note(`Could not load recent activity: ${error}`, button('Retry', onRetry));
  }

  if (empty) return note('Nothing has been recorded yet.');

  if (!groups.length) {
    // Only reachable with a filter on — an empty unfiltered list is caught
    // above — so the way out is offered rather than described.
    return note('Nothing of that kind in this window.', button('Show all', onClearFilter));
  }

  return (
    <div className="ad-scroll" style={{ flex: 1, minHeight: 0 }}>
      {groups.map((group) => (
        <section key={group.label}>
          {/* Sticky, so the day a row belongs to is still on screen after
              scrolling past its heading. */}
          <h3 style={{
            ...TYPE.label,
            position: 'sticky', top: 0, zIndex: 1,
            padding: `${SPACE.md} ${SPACE.xl} ${SPACE.xs}`,
            backgroundColor: SURFACE.card,
            color: INK.muted,
          }}>
            {group.label}
          </h3>

          {group.items.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </section>
      ))}
    </div>
  );
}

/*
 * One line per record: when · what happened · who and what it was about · the
 * detail.
 *
 * The row was four stacked lines — time, title, message, meta — which is what
 * made twelve of them 700px tall. Stacking is the right shape for a narrow
 * column and the wrong one here: the card runs the full width of the content
 * area, so the four parts fit across it with room to spare, and reading down a
 * column of times, then a column of actions, is faster than reading forty
 * three-line blocks.
 *
 * The clock time rather than "20 minutes ago" — a time column can be read
 * down, and it does not drift on a tab left open. The relative form is in the
 * tooltip, where it costs nothing.
 */
function Row({ item }) {
  return (
    <article
      className="ad-row"
      title={relativeTime(item.at) || undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: '2.75rem 3px minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: `0 ${SPACE.md}`,
        padding: `7px ${SPACE.xl}`,
      }}
    >
      <time
        dateTime={item.at}
        style={{ ...TYPE.micro, fontVariantNumeric: 'tabular-nums' }}
      >
        {timeOfDay(item.at)}
      </time>

      {/* A hairline rule in the row's tone, instead of an icon tile per row.
          Forty pastel squares down a card is what made this screen read as
          decoration rather than as a record. */}
      <span
        aria-hidden="true"
        style={{
          alignSelf: 'stretch',
          backgroundColor: ACTIVITY_TONE[item.type] || INK.muted,
          borderRadius: '2px',
        }}
      />

      {/* Title and subject on one line. Weight separates them — 600 for what
          happened, 450 for whom it happened to — so no divider is needed and
          the pair truncates as a single string when the window is narrow. */}
      <p style={{
        ...TYPE.body,
        color: INK.tertiary,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        <span style={{ fontWeight: 600, color: INK.primary }}>{item.title}</span>
        {item.message ? <span aria-hidden="true">{'  ·  '}</span> : null}
        {item.message}
      </p>

      {/* The role, the payment method, the record count. Dropped below 720px
          rather than wrapped — it is the least important part of the row, and
          a wrapping fourth column is what turns a one-line row back into a
          three-line one. */}
      <span className="ad-row__meta" style={{ ...TYPE.micro, whiteSpace: 'nowrap' }}>
        {item.meta}
      </span>
    </article>
  );
}
