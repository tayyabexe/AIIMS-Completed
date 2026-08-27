import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import {
  CARD, INK, TYPE, SPACE, RULE, ACCENT, RADIUS,
} from '../../../styles/adminTheme';

/*
 * The shell the three supporting panels share, and the meter they are built
 * from.
 *
 * WHY A SECOND TIER EXISTS AT ALL
 * -------------------------------
 * The dashboard asked GET /api/admin/dashboard for eighteen numbers and drew
 * four of them. `billed`, `inactive`, `distinction`, `averageCgpa` and
 * `studentsWithRecords` were all fetched on every load and thrown away.
 *
 * They were not shown because they are not headline figures — nobody opens a
 * dashboard to learn the average CGPA. But they are exactly what turns the
 * four headline figures into something you can act on: "Rs 12.4M collected" is
 * a number, "Rs 12.4M of Rs 16.8M billed, 74%" is a position. So they live one
 * tier down, at 20px instead of 32px, in components shaped for what they
 * actually are — proportions of a whole, which is what a meter is for and what
 * a fifth stat tile is not.
 */

export function Panel({ title, hint, to, linkLabel, index = 0, children }) {
  return (
    <section
      className="ad-card ad-rise"
      style={{
        ...CARD, '--i': index,
        padding: SPACE.xl,
        display: 'flex', flexDirection: 'column', gap: SPACE.lg,
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: SPACE.md,
      }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={TYPE.heading}>{title}</h2>
          {hint && <p style={{ ...TYPE.micro, marginTop: '2px' }}>{hint}</p>}
        </div>

        {to && (
          <Link
            to={to}
            className="ad-focusable"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: SPACE.xs,
              fontSize: '12px', fontWeight: 600, color: ACCENT.base,
              textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
              borderRadius: RADIUS.chip,
            }}
          >
            {linkLabel || 'Open'}
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        )}
      </div>

      {children}
    </section>
  );
}

/*
 * A segmented bar.
 *
 * Every segment is a real share of a real total, so the bar is data rather
 * than decoration sitting next to a number that has already been printed. A
 * segment below about 1.5% is widened to that, because a two-pixel sliver
 * cannot be seen or hovered — the legend beside it always carries the exact
 * figure, so the bar is allowed to round in favour of being visible.
 *
 * Segments: [{ label, value, color }]
 */
export function Meter({ segments, total, ariaLabel }) {
  const sum = total || segments.reduce((n, s) => n + (s.value || 0), 0);
  if (!sum) {
    return <div className="ad-meter" role="img" aria-label={`${ariaLabel}: nothing recorded yet`} />;
  }

  return (
    <div className="ad-meter" role="img" aria-label={ariaLabel}>
      {segments.map((segment) => {
        const share = (segment.value || 0) / sum;
        if (share <= 0) return null;
        return (
          <span
            key={segment.label}
            title={`${segment.label}: ${segment.value.toLocaleString()}`}
            style={{
              width: `${Math.max(share * 100, 1.5)}%`,
              backgroundColor: segment.color,
            }}
          />
        );
      })}
    </div>
  );
}

/*
 * A legend row: a tone marker, what it is, and how many.
 *
 * The figure is right-aligned and tabular so a stack of these reads as a
 * column that can be compared down, not as three sentences of different
 * lengths.
 */
export function LegendRow({ color, label, value, note }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: SPACE.sm,
      padding: '5px 0',
    }}>
      <span
        aria-hidden="true"
        style={{
          width: '3px', height: '11px', borderRadius: '2px',
          backgroundColor: color, flexShrink: 0, alignSelf: 'center',
        }}
      />
      <span style={{ ...TYPE.body, color: INK.secondary, flex: 1, minWidth: 0 }}>
        {label}
      </span>
      {note && <span style={TYPE.micro}>{note}</span>}
      <span style={{
        ...TYPE.body, color: INK.primary, fontWeight: 600,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
    </div>
  );
}

/* A hairline between a panel's summary and its detail. */
export const DIVIDER = {
  height: '1px',
  backgroundColor: RULE.soft,
  border: 'none',
  margin: 0,
};
