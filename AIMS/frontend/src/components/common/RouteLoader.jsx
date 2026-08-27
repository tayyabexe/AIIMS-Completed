/*
 * The admin portal's loading state for a whole screen.
 *
 * WHAT WAS WRONG
 * --------------
 * Every module drew its own. They shared one shape and one flaw: a small
 * "Loading attendance…" strip was pushed in ABOVE the screen's real layout,
 * which kept rendering underneath it from `data ?? {}` defaults. So while a
 * page loaded, the admin was shown a complete, confident screen reporting
 * 0 students, 0% attendance, Rs. 0 collected and "Showing 0 of 0" — with a
 * loading line above it. Those zeros are indistinguishable from a real answer,
 * and they are the answer the eye reads first, because they are laid out as
 * figures and the notice is one line of grey text.
 *
 * A screen that does not know its numbers yet must not print numbers. This
 * component is returned INSTEAD of the layout on a first load, so nothing is
 * claimed until something is known. Once data has arrived, a refetch (changing
 * a filter, turning a page) does not come back here — the previous rows stay on
 * screen and the control dims, because replacing a populated table with a
 * spinner on every keystroke is its own kind of unusable.
 *
 * It is deliberately larger than the strips it replaces: it stands in for a
 * whole route, so it occupies roughly the height of one, and the eye does not
 * have to hunt for a 22px spinner in a page of white space.
 */

export default function RouteLoader({ label = 'Loading…', hint }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.15rem',
        backgroundColor: '#FFFFFF',
        border: '1px solid #E2E8F0',
        borderRadius: '20px',
        padding: '3rem 2rem',
        boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
        textAlign: 'center',
      }}
    >
      {/* Two rings: a static track and a spinning arc, so the animation reads
          as progress rather than as a flickering partial circle. */}
      <div style={{ position: 'relative', width: '64px', height: '64px' }}>
        <div style={{
          position: 'absolute', inset: 0,
          border: '5px solid #F1F5F9',
          borderRadius: '50%',
        }} />
        <div style={{
          position: 'absolute', inset: 0,
          border: '5px solid transparent',
          borderTopColor: '#991b1b',
          borderRightColor: '#991b1b',
          borderRadius: '50%',
          animation: 'aims-route-spin 0.9s cubic-bezier(0.5, 0.15, 0.4, 0.9) infinite',
        }} />
      </div>

      <div>
        <p style={{
          fontSize: '1.05rem', fontWeight: 700, color: '#0F172A', margin: 0,
          fontFamily: "'Outfit', sans-serif", letterSpacing: '-0.01em',
        }}>
          {label}
        </p>
        {hint && (
          <p style={{ fontSize: '0.85rem', color: '#94A3B8', margin: '6px 0 0' }}>
            {hint}
          </p>
        )}
      </div>

      {/* Scoped by name so it cannot collide with the `spin` keyframes several
          screens define inline for their own small button spinners. */}
      <style>{`
        @keyframes aims-route-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
