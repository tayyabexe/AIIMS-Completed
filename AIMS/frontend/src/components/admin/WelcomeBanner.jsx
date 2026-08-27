import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { timeOfDay } from '../../utils/datetime';
import {
  INK, TYPE, SPACE, RULE, ACCENT, SURFACE, FONT, RADIUS,
} from '../../styles/adminTheme';

/*
 * The dashboard's header strip.
 *
 * WHAT IT SAYS
 * ------------
 * Three things, and only things it can actually stand behind: who is signed
 * in, what day the figures below are true for, and when they were last read
 * from the database.
 *
 * It was a heavy crimson gradient block carrying an "AI-POWERED" capsule and a
 * waving-hand emoji, greeting every administrator as "Admin". The capsule
 * claimed nothing the screen beneath it does — the figures below are SQL
 * counts, not a model's output.
 *
 * WHAT CHANGED THIS TIME
 * ----------------------
 * The greeting used to be a tracked uppercase eyebrow — GOOD EVENING — stacked
 * above the name, which is a label style applied to a sentence. Uppercase
 * tracking is for captions that get scanned, not for the one line on the
 * screen addressed to a person. It now reads as what it is: "Good evening,
 * Tayyab", one sentence, with the hierarchy carried by weight and ink rather
 * than by shouting — the greeting at 450/tertiary, the name at 650/primary.
 *
 * And the strip gained the thing it was missing: `Read at 14:32` with a
 * refresh beside it. A dashboard left open on a desk goes stale silently, and
 * a figure with no timestamp cannot be trusted or corrected. This is the
 * cheapest honest fix — it says how old the numbers are, and it offers the one
 * control that makes them new.
 */

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

// "Wednesday, 13 August 2026" — the date the figures below describe.
const today = () => new Date().toLocaleDateString(undefined, {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});

/*
 * `actions` is rendered as the last item of the meta row, beside Refresh.
 *
 * The Customise chip used to sit on a line of its own between this header and
 * the card grid — one control alone in a full-width band, with a screen's worth
 * of gap above and below it. Both controls act on this screen as a whole, so
 * they belong in the same row; putting it here removes that empty band and
 * lifts the cards up under the greeting.
 */
export default function WelcomeBanner({ onRefresh, refreshing = false, readAt, actions = null }) {
  const { user } = useAuth();

  // `name` is derived from the email at sign-in; fall back rather than print
  // an empty greeting if a session predates it. Only the first name is used —
  // "Good evening, Tayyab Abdullah" is a form letter.
  const fullName = user?.name || 'Administrator';
  const firstName = fullName.trim().split(/\s+/)[0];

  return (
    <header style={{
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: SPACE.lg,
      paddingBottom: SPACE.lg,
      borderBottom: `1px solid ${RULE.hairline}`,
    }}>
      <h1 style={{
        fontFamily: FONT,
        fontSize: '26px',
        fontWeight: 450,
        letterSpacing: '-0.02em',
        lineHeight: 1.2,
        color: INK.tertiary,
        margin: 0,
      }}>
        {greeting()},{' '}
        <strong style={{ fontWeight: 650, color: INK.primary }}>{firstName}</strong>
      </h1>

      <div style={{
        display: 'flex', alignItems: 'center', gap: SPACE.md,
        flexWrap: 'wrap',
      }}>
        <p style={TYPE.meta}>{today()}</p>

        <span aria-hidden="true" style={{
          width: '1px', height: '14px', backgroundColor: RULE.hairline,
        }} />

        {/* The timestamp and its control read as one unit, because on their own
            neither is worth the space: a time with no way to change it is a
            complaint, and a refresh button with no time is a guess. */}
        <p style={{ ...TYPE.micro, fontVariantNumeric: 'tabular-nums' }}>
          {readAt ? `Read at ${timeOfDay(readAt)}` : 'Reading…'}
        </p>

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing || !onRefresh}
          className="ad-focusable"
          aria-label="Reload the dashboard figures"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: SPACE.xs,
            /* 8px of vertical padding on a 13px line clears a 30px control;
               the surrounding row is what carries the rest of the hit area. */
            padding: '7px 11px',
            borderRadius: RADIUS.chip,
            border: `1px solid ${RULE.hairline}`,
            backgroundColor: SURFACE.card,
            color: refreshing ? INK.muted : INK.secondary,
            fontFamily: FONT,
            fontSize: '12px',
            fontWeight: 550,
            cursor: refreshing ? 'default' : 'pointer',
          }}
          onMouseEnter={(e) => {
            if (refreshing) return;
            e.currentTarget.style.color = ACCENT.base;
            e.currentTarget.style.borderColor = ACCENT.edge;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = refreshing ? INK.muted : INK.secondary;
            e.currentTarget.style.borderColor = RULE.hairline;
          }}
        >
          {/* The only spinner on the screen, and it turns only while a request
              is genuinely in flight. */}
          <RefreshCw
            size={13}
            aria-hidden="true"
            style={refreshing ? { animation: 'spin 0.9s linear infinite' } : undefined}
          />
          Refresh
        </button>

        {actions}
      </div>
    </header>
  );
}
