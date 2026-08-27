/*
 * The admin dashboard's design tokens.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every colour, size and radius on the dashboard used to be a hex literal
 * typed into whichever component needed it. The same slate grey appeared as
 * '#94A3B8' in five files and '#94a3b8' in two more, the card border was
 * '#E2E8F0' in some places and '1px solid #E2E8F0' in others, and there was no
 * way to retune the screen without a find-and-replace across it.
 *
 * Nothing exported here is a raw colour. Each token is a reference to a CSS
 * custom property declared in index.css under `.aims-dash`, which is what
 * makes the screen themeable: `body.dark-mode` redefines the same twenty
 * variables and every component follows without knowing dark mode exists.
 * (The portal's inline-style dark mode otherwise works by matching literal
 * '#FFFFFF' in a style attribute — a rule that cannot reach text colour, which
 * is why inline-styled screens go dark-on-dark. Variables sidestep it.)
 *
 * THE DIRECTION
 * -------------
 * A registrar's ledger. The person opening this screen runs an institute
 * office: they want to know whether the roll is healthy, whether the money is
 * in, who has fallen below the attendance bar, and what has happened since
 * they last looked. That is a record-keeping job, not a marketing surface, so
 * the screen is built like a well-kept book — warm paper, ink, ruled lines,
 * and exactly one crimson, the colour of the institute's seal, spent only
 * where something is an action or needs attention.
 *
 * The canvas is deliberately warm (#F7F6F4, paper) rather than the cool
 * #F8FAFC it was. Against a warm ground, white cards read as sheets laid on a
 * desk instead of as lighter rectangles on a slightly darker one, and the
 * crimson stops looking like an alert and starts looking like ink.
 *
 * ONE HUE, LIGHTNESS ONLY
 * -----------------------
 * Surfaces never change hue — canvas, card and inset track are the same warm
 * neutral at three lightnesses. Different hues for different surfaces is what
 * splits a screen into unrelated zones.
 *
 * DEPTH: BORDERS, COMMITTED
 * -------------------------
 * One strategy, not a mix. Structure is carried by hairline rules; the only
 * shadow on the screen is the two-layer lift an interactive tile gets on
 * hover, and it exists to say "this is clickable", not to add dimension.
 */

// ---------------------------------------------------------------------------
// Surfaces — one hue, three lightnesses.
// ---------------------------------------------------------------------------
export const SURFACE = {
  canvas: 'var(--ad-canvas)',  // the page behind everything: paper
  card: 'var(--ad-card)',      // a sheet on the desk
  inset: 'var(--ad-inset)',    // the empty part of a meter track — recessed
  hover: 'var(--ad-hover)',    // a row under the cursor
};

// ---------------------------------------------------------------------------
// Ink — four levels of text, which is the minimum for a readable hierarchy.
// Two levels is what makes a screen look flat.
// ---------------------------------------------------------------------------
export const INK = {
  primary: 'var(--ad-ink)',         // figures and headings
  secondary: 'var(--ad-ink-2)',     // body copy in the feed
  tertiary: 'var(--ad-ink-3)',      // supporting lines, labels
  muted: 'var(--ad-ink-4)',         // timestamps, metadata
};

// ---------------------------------------------------------------------------
// Rules. Low-opacity ink rather than a solid grey, so an edge blends with
// whatever it sits on instead of drawing a hard line across it.
// ---------------------------------------------------------------------------
export const RULE = {
  hairline: 'var(--ad-rule)',        // the default card edge and divider
  soft: 'var(--ad-rule-soft)',       // separating rows inside a card
  strong: 'var(--ad-rule-strong)',   // an edge under the cursor
};

// ---------------------------------------------------------------------------
// The single accent: the institute's seal. Spent on actions and on the one
// figure that needs attention — never on decoration, and never more than a few
// percent of the screen.
// ---------------------------------------------------------------------------
export const ACCENT = {
  base: 'var(--ad-accent)',
  hover: 'var(--ad-accent-hover)',
  wash: 'var(--ad-accent-wash)',   // the tint behind a selected filter chip
  edge: 'var(--ad-accent-edge)',
};

// ---------------------------------------------------------------------------
// Tone — what a supporting figure MEANS, not how it is decorated. Four states
// and no more, because a fifth colour stops being read as a status.
// ---------------------------------------------------------------------------
export const TONE = {
  positive: 'var(--ad-positive)',  // teal, not the usual green: it sits with
  warning: 'var(--ad-warning)',    // the warm neutrals instead of vibrating
  critical: 'var(--ad-critical)',  // against them
  neutral: 'var(--ad-ink-4)',
};

// The tone of a row in the activity feed, by what kind of thing happened.
// Quiet on purpose: the feed is a reading surface, and eight competing colours
// make it a decorative one.
export const ACTIVITY_TONE = {
  audit: 'var(--ad-t-audit)',
  payment: 'var(--ad-t-payment)',
  result: 'var(--ad-t-result)',
  enrolment: 'var(--ad-t-enrolment)',
  announcement: 'var(--ad-t-announcement)',
};

// ---------------------------------------------------------------------------
// Type. One family — Inter — and hierarchy built from weight and colour as
// much as from size. Three tiers at a single size (600/primary, 500/tertiary,
// 450/muted) separate more cleanly than two regular weights two points apart,
// and dropping Outfit from this screen is one less font file to download.
//
// The scale is a 1.25 ratio off a 13px body, rounded to whole pixels:
//   11 · 13 · 15 · 17 · 20 · 26 · 32
// ---------------------------------------------------------------------------
export const FONT = "'Inter', system-ui, -apple-system, sans-serif";

export const TYPE = {
  // A tile's label. Uppercase and tracked so it reads as a caption rather than
  // as a short sentence sitting above the figure.
  label: {
    fontFamily: FONT,
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: INK.tertiary,
    margin: 0,
  },
  // The hero figure on a KPI tile. Negative tracking because type this size
  // looks loose at default spacing — the optical correction is what separates
  // a designed figure from a document one.
  figure: {
    fontFamily: FONT,
    fontSize: '32px',
    fontWeight: 650,
    letterSpacing: '-0.03em',
    lineHeight: 1.05,
    color: INK.primary,
    fontVariantNumeric: 'tabular-nums',
    margin: 0,
  },
  // A figure on a supporting panel — deliberately a tier below the KPI row, so
  // the eye lands on the KPIs first.
  figureSm: {
    fontFamily: FONT,
    fontSize: '20px',
    fontWeight: 650,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
    color: INK.primary,
    fontVariantNumeric: 'tabular-nums',
    margin: 0,
  },
  heading: {
    fontFamily: FONT,
    fontSize: '15px',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: INK.primary,
    margin: 0,
  },
  body: {
    fontFamily: FONT,
    fontSize: '13px',
    fontWeight: 450,
    lineHeight: 1.45,
    color: INK.secondary,
    margin: 0,
  },
  meta: {
    fontFamily: FONT,
    fontSize: '12px',
    fontWeight: 450,
    color: INK.tertiary,
    margin: 0,
  },
  micro: {
    fontFamily: FONT,
    fontSize: '11px',
    fontWeight: 500,
    color: INK.muted,
    margin: 0,
  },
};

// ---------------------------------------------------------------------------
// Spacing — a 4px base, used in multiples. Density is a decision: 20px card
// padding is workbench-tight without being cramped, and it is the same number
// on every card so the grid reads as one system.
// ---------------------------------------------------------------------------
export const SPACE = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',   // card padding
  xxl: '28px',  // between groups
};

// Nested radii follow outer = inner + padding, so a control inside a card does
// not carry the same corner as the card itself.
export const RADIUS = {
  chip: '6px',
  control: '8px',
  card: '12px',
  panel: '14px',
};

// Motion. Everything here is short and ease-out — a dashboard is opened many
// times a day, and animation that can be watched rather than felt makes a
// screen someone uses constantly feel slow. Only transform and opacity are
// ever animated, and `prefers-reduced-motion` drops the movement (see
// index.css).
export const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';
export const DURATION = {
  hover: '140ms',
  enter: '220ms',
};

// The shell every card on the dashboard shares. Hover, focus and the entrance
// stagger are carried by the `.ad-card` class in index.css rather than by JS
// mouse handlers, so a card also responds to the keyboard.
export const CARD = {
  backgroundColor: SURFACE.card,
  border: `1px solid ${RULE.hairline}`,
  borderRadius: RADIUS.card,
  boxSizing: 'border-box',
};
