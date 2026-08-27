/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  Skeleton — the loading placeholders for the student and parent portals
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS REPLACES
 * ------------------
 * Every route said it was busy in one of two ways: a red ring spinning in the
 * middle of an empty page, or a line of grey text — "Loading your attendance
 * record…", "Loading your courses…", "Loading your timetable…". Fourteen
 * screens, fourteen sentences, and in every case a blank field where the page
 * was about to be.
 *
 * A skeleton is better for a reason that has nothing to do with looking modern:
 * it OCCUPIES THE SPACE. The page is already the right shape before the data
 * lands, so nothing jumps when it does, and the shape itself says what is
 * coming — four stat tiles, a week grid, a table of ten rows. A spinner says
 * only "wait", and says it identically on every screen in the product.
 *
 * HOW TO USE IT
 * -------------
 * Two layers. `<Skeleton>` is one grey block; the named presets below compose
 * those into the shapes this product actually renders. Reach for a preset
 * first — a screen whose skeleton is hand-built from bare blocks will drift
 * away from the layout it is standing in for the first time that layout
 * changes.
 *
 *     if (loading) return <SkeletonStatRow count={4} />;
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * A `delay` prop. The hold-at-zero is in the CSS (`.aims-sk-region`), so every
 * skeleton in the product gets the same 140ms grace before it becomes visible
 * and a fast response never flashes one. Putting it in JavaScript would mean
 * each caller choosing a number, and they would not agree.
 *
 * The shimmer, the shapes, the stagger and the reduced-motion handling all live
 * in styles/skeletons.css.
 */

/**
 * One placeholder block.
 *
 * @param {string|number} [w]      width  (number = px)
 * @param {string|number} [h]      height (number = px)
 * @param {string} [variant]  'text' | 'title' | 'chip' | 'circle' | 'card'
 * @param {string} [radius]   overrides the variant's corner
 */
export function Skeleton({
  w = '100%',
  h,
  variant = 'text',
  radius,
  className = '',
  style = {},
}) {
  return (
    <span
      className={`aims-sk aims-sk--${variant} ${className}`.trim()}
      style={{
        width: typeof w === 'number' ? `${w}px` : w,
        ...(h !== undefined ? { height: typeof h === 'number' ? `${h}px` : h } : null),
        ...(radius ? { borderRadius: radius } : null),
        ...style,
      }}
    />
  );
}

/**
 * The wrapper every skeleton screen should sit in.
 *
 * It carries the delayed fade (so a fast request shows nothing) and, more
 * importantly, `aria-busy` plus one piece of live text. Without that a screen
 * reader is read a page of empty spans and told nothing at all — the visual
 * placeholders are `aria-hidden` decoration and carry no meaning on their own.
 */
export function SkeletonRegion({ label = 'Loading', children, style = {}, className = '' }) {
  return (
    <div
      className={`aims-sk-region ${className}`.trim()}
      style={style}
      aria-busy="true"
      aria-live="polite"
    >
      {/* Announced once. Visually hidden rather than display:none, which would
          take it out of the accessibility tree along with the rest. */}
      <span style={{
        position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
        overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
      }}>
        {label}
      </span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ presets ═════ */

const CARD = {
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: '16px',
  padding: '1.1rem 1.25rem',
};

/** A run of KPI tiles — the four across the top of nearly every screen here. */
export function SkeletonStatRow({ count = 4, style = {} }) {
  return (
    <div
      className="aims-stagger"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(190px, 1fr))`,
        gap: '1rem',
        ...style,
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ ...CARD, display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <Skeleton variant="circle" w={38} h={38} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '7px' }}>
            <Skeleton variant="title" w="55%" />
            <Skeleton variant="text" w="80%" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A table.
 *
 * The column widths are uneven on purpose. A grid of identical grey bars reads
 * as a loading graphic; columns of different widths read as a table that has
 * not filled in yet, which is what it is.
 */
export function SkeletonTable({ rows = 8, cols = 5, head = true, style = {} }) {
  const widths = ['22%', '30%', '16%', '18%', '14%', '20%', '12%'];

  return (
    <div style={{ ...CARD, padding: 0, overflow: 'hidden', ...style }}>
      {head && (
        <div style={{
          display: 'flex', gap: '1.25rem', padding: '0.9rem 1.25rem',
          borderBottom: '1px solid #E2E8F0', background: '#F8FAFC',
        }}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} variant="text" w={widths[c % widths.length]} h={10} />
          ))}
        </div>
      )}

      <div className="aims-stagger">
        {Array.from({ length: rows }, (_, r) => (
          <div
            key={r}
            style={{
              display: 'flex', alignItems: 'center', gap: '1.25rem',
              padding: '0.95rem 1.25rem',
              borderBottom: r === rows - 1 ? 'none' : '1px solid #F1F5F9',
            }}
          >
            {Array.from({ length: cols }, (_, c) => (
              <Skeleton key={c} variant="text" w={widths[c % widths.length]} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A grid of content cards — courses, documents, fee vouchers. */
export function SkeletonCardGrid({ count = 6, minWidth = 260, lines = 3, style = {} }) {
  return (
    <div
      className="aims-stagger"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
        gap: '1rem',
        ...style,
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
            <Skeleton variant="card" w={40} h={40} radius="12px" />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <Skeleton variant="title" w="70%" />
              <Skeleton variant="text" w="45%" />
            </div>
          </div>
          {Array.from({ length: lines }, (_, l) => (
            <Skeleton
              key={l}
              variant="text"
              className={l === lines - 1 ? 'aims-sk--last' : ''}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A vertical list of rows — notifications, announcements, payment history. */
export function SkeletonList({ rows = 5, avatar = true, style = {} }) {
  return (
    <div className="aims-stagger" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', ...style }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ ...CARD, display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
          {avatar && <Skeleton variant="card" w={40} h={40} radius="12px" />}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Skeleton variant="title" w={`${45 + ((i * 13) % 30)}%`} />
            <Skeleton variant="text" />
            <Skeleton variant="text" className="aims-sk--last" />
          </div>
          <Skeleton variant="chip" w={64} />
        </div>
      ))}
    </div>
  );
}

/**
 * A chart panel.
 *
 * Drawn as bars of varying height rather than one grey rectangle, because a
 * rectangle says "a picture is coming" and this says "a chart is coming" — and
 * the heights stop it reading as a broken image.
 */
export function SkeletonChart({ height = 220, bars = 9, style = {} }) {
  // Fixed pattern, not Math.random: a skeleton that redraws at different
  // heights on every render flickers on any state change while loading.
  const pattern = [52, 78, 41, 88, 63, 95, 47, 71, 58, 84, 39, 67];

  return (
    <div style={{ ...CARD, ...style }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '1.1rem' }}>
        <Skeleton variant="title" w={150} />
        <Skeleton variant="text" w={210} />
      </div>
      <div style={{
        height, display: 'flex', alignItems: 'flex-end',
        gap: '10px', padding: '0 2px',
      }}>
        {Array.from({ length: bars }, (_, i) => (
          <Skeleton
            key={i}
            w="100%"
            h={`${pattern[i % pattern.length]}%`}
            radius="6px 6px 3px 3px"
          />
        ))}
      </div>
    </div>
  );
}

/** The banner at the top of a profile or a dashboard: portrait, name, chips. */
export function SkeletonHero({ height = 132, chips = 3, style = {} }) {
  return (
    <div
      style={{
        background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '20px',
        padding: '1.5rem 1.75rem', minHeight: height,
        display: 'flex', alignItems: 'center', gap: '1.25rem', ...style,
      }}
    >
      <Skeleton variant="circle" w={72} h={72} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
        <Skeleton variant="title" w={230} h={22} />
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {Array.from({ length: chips }, (_, i) => (
            <Skeleton key={i} variant="chip" w={90 + ((i * 27) % 50)} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A week timetable: day columns of slot blocks. */
export function SkeletonTimetable({ days = 5, slots = 5, style = {} }) {
  return (
    <div style={{ ...CARD, ...style }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days}, 1fr)`, gap: '0.75rem' }}>
        {Array.from({ length: days }, (_, d) => (
          <div key={d} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <Skeleton variant="text" w="60%" h={11} style={{ margin: '0 auto 0.35rem' }} />
            {Array.from({ length: slots }, (_, s) => (
              <Skeleton
                key={s}
                variant="card"
                h={(d + s) % 4 === 0 ? 44 : 62}
                radius="10px"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The whole-page fallback, for a lazily loaded route that has not arrived yet.
 *
 * Deliberately generic — at this point the router knows which URL is loading
 * but the component that would know its shape has not been fetched, so a hero
 * plus stat tiles plus a table is the honest guess, and it is the shape most of
 * these screens actually are.
 */
export function SkeletonPage({ label = 'Loading page' }) {
  return (
    <SkeletonRegion label={label} style={{ padding: '1.5rem 2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <SkeletonHero style={{ marginBottom: '1.25rem' }} />
      <SkeletonStatRow count={4} style={{ marginBottom: '1.25rem' }} />
      <SkeletonTable rows={6} cols={5} />
    </SkeletonRegion>
  );
}

export default Skeleton;
