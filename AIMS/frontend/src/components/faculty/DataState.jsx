import './DataState.css';

// ---------------------------------------------------------------------------
// Shared loading / error / empty blocks for the faculty portal.
//
// FacultyDataContext has always exposed `loading` and `error`, but only the
// dashboard read them. Every other page rendered `data?.students || []` while
// the request was still in flight, so the first paint after sign-in was a
// fully-drawn screen reporting zero students, zero classes and empty tables —
// indistinguishable from a teacher who genuinely has none, and it stayed that
// way if the request failed outright.
// ---------------------------------------------------------------------------

export function DataLoading({ label = 'Loading…' }) {
  return (
    <div className="data-state" role="status" aria-live="polite">
      <span className="data-state-spinner" />
      <p className="data-state-title">{label}</p>
    </div>
  );
}

export function DataError({ message, onRetry }) {
  return (
    <div className="data-state error" role="alert">
      <svg viewBox="0 0 24 24" fill="none" className="data-state-icon">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 7.5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="16.2" r="1" fill="currentColor" />
      </svg>
      <p className="data-state-title">Could not load this page</p>
      {message && <p className="data-state-text">{message}</p>}
      {onRetry && (
        <button type="button" className="data-state-retry" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * Renders `children` only once the load has finished successfully.
 *
 * Usage inside a page that already has its own <Layout>:
 *   <DataGate loading={loading} error={error} onRetry={reload} label="Loading students…">
 *     ...page body...
 *   </DataGate>
 */
export default function DataGate({ loading, error, onRetry, label, children }) {
  if (loading) return <DataLoading label={label} />;
  if (error) return <DataError message={error} onRetry={onRetry} />;
  return children;
}
