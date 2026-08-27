import { AlertTriangle, Ban } from 'lucide-react';

/*
 * An API failure, shown the way the API actually described it.
 *
 * WHY `blockedBy` GETS ITS OWN TREATMENT
 * -------------------------------------
 * The structure and people endpoints refuse a delete with 409 and a `blockedBy`
 * array naming everything standing in the way — "340 students", "3 programmes",
 * "14 timetable slots". That array is the entire value of the response: it is
 * the difference between "could not delete this" and "move these 340 students
 * first". The screens that collapsed it into a generic message left the admin
 * with nothing to do next, which is how a refused delete gets retried four
 * times.
 *
 * So a refusal is drawn as what it is — a list of obstacles, with the server's
 * own sentence above it — and never flattened into a one-line error.
 */
export default function ApiErrorNotice({ error, onDismiss }) {
  if (!error) return null;

  // An ApiError from api/client.js carries the parsed body on `.data`; a plain
  // string is accepted too, for the screens that keep their own message state.
  const message = typeof error === 'string' ? error : error.message;
  const blockedBy = typeof error === 'string' ? null : error?.data?.blockedBy;
  const refused = Array.isArray(blockedBy) && blockedBy.length > 0;

  return (
    <div style={{
      padding: '0.85rem 1rem', borderRadius: '10px',
      backgroundColor: refused ? '#FFFBEB' : '#FEF2F2',
      border: `1px solid ${refused ? '#FDE68A' : '#FECACA'}`,
      color: refused ? '#92400E' : '#991B1B',
      fontSize: '0.875rem',
      display: 'flex', gap: '0.65rem', alignItems: 'flex-start',
    }}>
      {refused ? <Ban size={17} style={{ flexShrink: 0, marginTop: '1px' }} />
        : <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: '1px' }} />}

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: 600 }}>{message}</p>

        {refused && (
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', fontWeight: 500 }}>
            {blockedBy.map((item) => (
              <li key={item} style={{ marginBottom: '2px' }}>{item}</li>
            ))}
          </ul>
        )}
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'inherit',
            opacity: 0.7, fontWeight: 700, fontSize: '0.75rem', flexShrink: 0,
          }}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
