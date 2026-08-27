import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import {
  CARD, INK, TONE, TYPE, SPACE, RADIUS, ACCENT,
} from '../../styles/adminTheme';

/*
 * A dashboard figure.
 *
 * A stat tile has three jobs: name the measure, state it, and qualify it. That
 * is the whole component — label, figure, and one supporting line.
 *
 * HIERARCHY
 * ---------
 * The figure wins, and it wins on three levers at once rather than on size
 * alone: 32px against the label's 11px, weight 650 against 600, and primary
 * ink against tertiary. Squint at the row and only the four numbers survive,
 * which is the point — everything else on the tile is there to tell you what
 * the number is once you have already found it.
 *
 * WHERE THE COLOUR GOES
 * ---------------------
 * Nowhere, unless something needs attention.
 *
 * The tile used to end with a coloured dot on every supporting line, including
 * the ones whose tone was 'neutral' — a grey dot that meant "no meaning", drawn
 * anyway. A status colour that appears on all four tiles is not a status.
 *
 * So: a tile at `positive` or `neutral` is entirely ink and paper. A tile at
 * `warning` or `critical` gets its supporting line in that tone and a short
 * rule down its left edge, which is the one thing on the row that reads at a
 * glance from across a desk. If everything is healthy the KPI row is
 * monochrome — and that itself is the report.
 *
 * `tone` describes the SUPPORTING LINE, not the figure: 'positive' for a
 * healthy qualifier, 'warning' where it wants attention, 'critical' where it
 * needs it, and 'neutral' — the default — where the line is context rather
 * than a judgement, which is the honest answer for most figures.
 */

const NEEDS_ATTENTION = new Set(['warning', 'critical']);

export default function StatCard({
  title,
  value,
  meta,
  tone = 'neutral',
  to,
  onClick,
  /* Position in the row, for the 40ms entrance stagger. */
  index = 0,
}) {
  const interactive = !!(to || onClick);
  const flagged = NEEDS_ATTENTION.has(tone);

  const card = (
    <div
      className={`ad-card ad-rise${onClick && !to ? ' ad-card--interactive' : ''}`}
      style={{ ...CARD, '--i': index, height: '100%', position: 'relative', overflow: 'hidden' }}
      onClick={onClick}
    >
      {/* The ledger rule. Only drawn when the tile is asking for something —
          see the note above on why it is not on all four. */}
      {flagged && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', left: 0, top: SPACE.xl, bottom: SPACE.xl,
            width: '3px', borderRadius: '0 3px 3px 0',
            backgroundColor: TONE[tone],
          }}
        />
      )}

      <div style={{
        padding: `${SPACE.xl} ${SPACE.xl} ${SPACE.lg}`,
        display: 'flex', flexDirection: 'column', gap: SPACE.md,
        height: '100%',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm,
        }}>
          <p style={TYPE.label}>{title}</p>

          {/* Says the tile goes somewhere without spending a word on it. It
              stays muted until the card is hovered — an arrow at full contrast
              on four tiles competes with the figures. */}
          {to && (
            <ArrowUpRight
              size={14}
              aria-hidden="true"
              style={{ color: INK.muted, flexShrink: 0 }}
            />
          )}
        </div>

        {/* Tabular figures so the four tiles line up down the row and a number
            that ticks up does not shuffle the digits beside it. */}
        <p style={TYPE.figure}>{value}</p>

        {meta && (
          <p style={{
            ...TYPE.meta,
            color: flagged ? TONE[tone] : INK.tertiary,
            fontWeight: flagged ? 500 : 450,
            marginTop: 'auto',
            textWrap: 'pretty',
          }}>
            {meta}
          </p>
        )}
      </div>
    </div>
  );

  if (!to) return card;

  return (
    <Link
      to={to}
      className="ad-card--link"
      style={{ borderRadius: RADIUS.card, color: ACCENT.base }}
    >
      {card}
    </Link>
  );
}
