import { useState } from 'react';
import { ShieldCheck, X, ChevronRight } from 'lucide-react';
import { admin as adminApi } from '../../api/endpoints';
import { useAdminPage, useListParams } from '../../hooks/useAdminPage';
import useScrollLock from '../../hooks/useScrollLock';
import Pagination from '../common/Pagination';
import RouteLoader from '../common/RouteLoader';
import FilterField from '../common/FilterField';
import { dayLabel, timeOfDay, fullTimestamp, relativeTime } from '../../utils/datetime';

/*
 * The audit trail.
 *
 * WHAT THIS IS
 * ------------
 * Every recorded act in the institute, newest first: who did it, what they did
 * it to, when, and from which address. It is the screen behind the dashboard's
 * activity feed — the feed shows twelve rows, this shows all of them with
 * filters.
 *
 * WHAT IT IS NOT
 * --------------
 * There is no edit and no delete, and there is no route that would allow one.
 * A record an administrator can rewrite answers no question worth asking, so
 * the absence is the feature.
 *
 * WHY THE ROWS READ AS SENTENCES
 * ------------------------------
 * The database stores `MARKS_UPDATED` plus two JSON snapshots, which is the
 * right thing to store and the wrong thing to show. `label`, `subject` and
 * `count` are composed server-side in auditService.describe(), so this screen
 * and the dashboard feed render identical wording for the same row rather than
 * each inventing its own.
 *
 * The two snapshots are still here — one click away, in the detail panel. That
 * is where "78 became 91" lives, and it is the whole reason the entry exists.
 */

// Module accents. One hue per module, used on the rail and the chip only, so
// the table stays a reading surface rather than a colour chart.
const MODULE_TONE = {
  Auth: { fg: '#B45309', bg: '#FFFBEB', bd: '#FDE68A' },
  Users: { fg: '#4338CA', bg: '#EEF2FF', bd: '#C7D2FE' },
  Provisioning: { fg: '#0E7490', bg: '#ECFEFF', bd: '#A5F3FC' },
  Students: { fg: '#1D4ED8', bg: '#EFF6FF', bd: '#BFDBFE' },
  People: { fg: '#7E22CE', bg: '#FAF5FF', bd: '#E9D5FF' },
  Fees: { fg: '#047857', bg: '#ECFDF5', bd: '#A7F3D0' },
  Examinations: { fg: '#BE123C', bg: '#FFF1F2', bd: '#FECDD3' },
  Attendance: { fg: '#C2410C', bg: '#FFF7ED', bd: '#FED7AA' },
  Academics: { fg: '#0F766E', bg: '#F0FDFA', bd: '#99F6E4' },
};

const toneFor = (module) => MODULE_TONE[module]
  || { fg: '#475569', bg: '#F8FAFC', bd: '#E2E8F0' };

const selectStyle = {
  padding: '0.55rem 0.85rem', borderRadius: '10px', border: '1px solid #E2E8F0',
  fontSize: '0.85rem', outline: 'none', backgroundColor: '#FFFFFF',
  color: '#334155', fontWeight: 500, cursor: 'pointer',
  fontFamily: "'Inter', sans-serif",
};

const dateStyle = { ...selectStyle, cursor: 'text', fontWeight: 400 };

/*
 * A snapshot, rendered as rows rather than as raw JSON.
 *
 * Keys arrive camelCased from the services that wrote them, which is readable
 * to a developer and not to anyone else, so they are spaced out here. Nested
 * objects and arrays fall back to formatted JSON — they are rare, and inventing
 * a layout for an arbitrary shape would fail more often than it helped.
 */
function Snapshot({ title, value, accent }) {
  if (!value || typeof value !== 'object' || !Object.keys(value).length) return null;

  const spaced = (key) => key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();

  return (
    <section style={{ minWidth: 0 }}>
      <h4 style={{
        margin: '0 0 0.5rem', fontSize: '0.7rem', fontWeight: 700,
        letterSpacing: '0.07em', textTransform: 'uppercase', color: accent,
      }}>
        {title}
      </h4>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.35rem 0.85rem' }}>
        {Object.entries(value).map(([key, raw]) => (
          <div key={key} style={{ display: 'contents' }}>
            <dt style={{ fontSize: '0.75rem', color: '#94A3B8', whiteSpace: 'nowrap' }}>
              {spaced(key)}
            </dt>
            <dd style={{
              margin: 0, fontSize: '0.8rem', color: '#0F172A',
              overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums',
            }}>
              {raw === null || raw === undefined || raw === ''
                ? '—'
                : typeof raw === 'object'
                  ? <pre style={{
                      margin: 0, fontSize: '0.72rem', whiteSpace: 'pre-wrap',
                      fontFamily: "'JetBrains Mono', monospace", color: '#334155',
                    }}>{JSON.stringify(raw, null, 2)}</pre>
                  : String(raw)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function AuditTrail() {
  const { params, filters, setFilter, setPage, reset } = useListParams({
    q: '',
    module: '',
    action: '',
    from: '',
    to: '',
    limit: 25,
  });

  const { data, loading, error, refresh } = useAdminPage(
    (p) => adminApi.auditLogs(p),
    params, { key: 'audit-logs', debounceMs: 300 });

  const rows = data?.rows ?? [];
  const options = data?.options ?? { modules: [], actions: [] };
  const pagination = data?.pagination ?? { page: 1, pages: 1, total: 0, limit: 25 };

  // The row whose two snapshots are open. One at a time — this is a reading
  // panel, not a comparison tool.
  const [open, setOpen] = useState(null);
  useScrollLock(!!open);

  const anyFilter = Object.entries(filters)
    .some(([key, value]) => key !== 'limit' && value);

  if (loading && !data) {
    return (
      <RouteLoader
        label="Loading the audit trail…"
        hint="Account changes, fee decisions, marks and attendance"
      />
    );
  }

  // Day headings, in the order the server sent the rows — the query is already
  // ordered newest first, so this only notices when the day changes.
  const groups = [];
  for (const row of rows) {
    const label = dayLabel(row.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* ── Title ──────────────────────────────────────────────────────── */}
      <div>
        <h2 style={{
          fontSize: '1.55rem', fontWeight: 700, color: '#0F172A',
          letterSpacing: '-0.025em', lineHeight: 1.15,
          fontFamily: "'Outfit', sans-serif", margin: 0,
          display: 'flex', alignItems: 'center', gap: '0.6rem',
        }}>
          <ShieldCheck size={22} style={{ color: '#991B1B' }} />
          Audit Trail
        </h2>
        <p style={{ fontSize: '0.85rem', color: '#64748B', margin: '0.35rem 0 0' }}>
          Every recorded act, newest first. Entries are written by the services
          that perform them and cannot be edited or removed from here.
        </p>
      </div>

      <div style={{
        backgroundColor: '#FFFFFF', borderRadius: '12px', border: '1px solid #E2E8F0',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* ── Filters ──────────────────────────────────────────────────── */}
        <div style={{
          padding: '1rem 1.25rem', borderBottom: '1px solid #E2E8F0',
          display: 'flex', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap',
        }}>
          <FilterField
            value={filters.q}
            onChange={(value) => setFilter('q', value)}
            placeholder="Search by person, student, exam, email or record reference…"
            style={{ flex: '1 1 260px' }}
          />

          {/* Both lists come from the table itself, so a filter can never offer
              a value that matches nothing. */}
          <select
            value={filters.module}
            onChange={(e) => setFilter('module', e.target.value)}
            style={selectStyle}
          >
            <option value="">All modules</option>
            {options.modules.map((m) => (
              <option key={m.value} value={m.value}>{m.value} ({m.total})</option>
            ))}
          </select>

          <select
            value={filters.action}
            onChange={(e) => setFilter('action', e.target.value)}
            style={selectStyle}
          >
            <option value="">All actions</option>
            {options.actions.map((a) => (
              <option key={a.value} value={a.value}>{a.label} ({a.total})</option>
            ))}
          </select>

          <label style={{ fontSize: '0.75rem', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            From
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilter('from', e.target.value)}
              style={dateStyle}
            />
          </label>

          <label style={{ fontSize: '0.75rem', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            To
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilter('to', e.target.value)}
              style={dateStyle}
            />
          </label>

          {anyFilter && (
            <button
              onClick={reset}
              style={{
                padding: '0.5rem 0.85rem', borderRadius: '10px',
                border: '1px solid #E2E8F0', background: '#F8FAFC',
                color: '#475569', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
              }}
            >
              Clear
            </button>
          )}
        </div>

        {error && (
          <div style={{
            margin: '1rem 1.25rem', padding: '0.85rem 1rem', borderRadius: '10px',
            backgroundColor: '#FEF2F2', border: '1px solid #FECACA',
            color: '#991B1B', fontSize: '0.85rem',
          }}>
            <strong>Could not load the audit trail.</strong> {error}{' '}
            <button
              onClick={refresh}
              style={{
                marginLeft: 8, border: '1px solid #FECACA', background: 'white',
                borderRadius: 6, padding: '2px 8px', cursor: 'pointer',
                color: '#991B1B', fontWeight: 600,
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* ── Entries ──────────────────────────────────────────────────── */}
        {rows.length === 0 ? (
          <p style={{ padding: '3rem 1.25rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.85rem' }}>
            {anyFilter
              ? 'No entries match these filters.'
              : 'Nothing has been recorded yet.'}
          </p>
        ) : (
          <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
            {groups.map((group) => (
              <section key={group.label}>
                <h3 style={{
                  margin: 0, padding: '0.85rem 1.25rem 0.5rem',
                  fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: '#94A3B8',
                  backgroundColor: '#FBFCFD', borderBottom: '1px solid #F1F5F9',
                }}>
                  {group.label}
                </h3>

                {group.rows.map((row) => {
                  const tone = toneFor(row.module);
                  const hasDetail = !!(row.before || row.after);

                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => hasDetail && setOpen(row)}
                      style={{
                        width: '100%', textAlign: 'left', border: 'none',
                        borderBottom: '1px solid #F1F5F9', background: 'transparent',
                        padding: '0.75rem 1.25rem',
                        display: 'grid',
                        gridTemplateColumns: '3.4rem 3px minmax(0, 1fr) auto',
                        gap: '0 0.9rem', alignItems: 'center',
                        cursor: hasDetail ? 'pointer' : 'default',
                        fontFamily: 'inherit',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#FBFCFD'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <time
                        dateTime={row.at}
                        title={relativeTime(row.at)}
                        style={{
                          fontSize: '0.72rem', color: '#94A3B8', fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {timeOfDay(row.at)}
                      </time>

                      <span style={{
                        alignSelf: 'stretch', backgroundColor: tone.fg,
                        borderRadius: '2px', minHeight: '2rem', opacity: 0.7,
                      }} />

                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.875rem', fontWeight: 650, color: '#0F172A' }}>
                            {row.label}
                          </span>
                          <span style={{
                            fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.04em',
                            padding: '0.1rem 0.45rem', borderRadius: '9999px',
                            color: tone.fg, backgroundColor: tone.bg,
                            border: `1px solid ${tone.bd}`,
                          }}>
                            {row.module}
                          </span>
                          {row.count > 0 && (
                            <span style={{ fontSize: '0.7rem', color: '#94A3B8' }}>
                              {row.count} records
                            </span>
                          )}
                        </div>

                        <p style={{
                          margin: '0.15rem 0 0', fontSize: '0.82rem', color: '#475569',
                          overflowWrap: 'anywhere',
                        }}>
                          {row.subject || row.entity || '—'}
                        </p>

                        {/* Who. The name where the person record has one, the
                            email otherwise — never a bare user id. */}
                        <p style={{ margin: '0.1rem 0 0', fontSize: '0.72rem', color: '#94A3B8' }}>
                          {[
                            row.actor?.name || row.actor?.email || `User ${row.actor?.userId}`,
                            row.actor?.role,
                            row.ip,
                          ].filter(Boolean).join(' · ')}
                        </p>
                      </div>

                      {hasDetail && <ChevronRight size={16} style={{ color: '#CBD5E1' }} />}
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        )}

        <div style={{ padding: '0 1.25rem' }}>
          <Pagination
            page={pagination.page}
            pages={pagination.pages}
            total={pagination.total}
            limit={pagination.limit}
            count={rows.length}
            onChange={setPage}
            // Pagination pluralises by appending "s", so "entry" would read
            // as "entrys". "record" is what these rows are anyway.
            noun="record"
            loading={loading}
          />
        </div>
      </div>

      {/* ── Detail ───────────────────────────────────────────────────────
          The two snapshots side by side. This is where an entry stops being
          "marks were updated" and becomes "78 became 91". */}
      {open && (
        <div
          onClick={() => setOpen(null)}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.55)',
            backdropFilter: 'blur(3px)', zIndex: 120,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#FFFFFF', borderRadius: '14px', width: '100%',
              maxWidth: '640px', maxHeight: '85vh', overflow: 'hidden',
              display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0',
            }}
          >
            <div style={{
              padding: '1.1rem 1.35rem', borderBottom: '1px solid #E2E8F0',
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem',
            }}>
              <div style={{ minWidth: 0 }}>
                <h3 style={{
                  margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#0F172A',
                  fontFamily: "'Outfit', sans-serif",
                }}>
                  {open.label}
                </h3>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: '#475569' }}>
                  {open.subject || open.entity || '—'}
                </p>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: '#94A3B8' }}>
                  {[
                    open.actor?.name || open.actor?.email || `User ${open.actor?.userId}`,
                    open.actor?.role,
                    fullTimestamp(open.at),
                    open.ip,
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(null)}
                aria-label="Close"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{
              padding: '1.25rem 1.35rem', overflowY: 'auto',
              display: 'grid',
              gridTemplateColumns: open.before && open.after ? '1fr 1fr' : '1fr',
              gap: '1.5rem',
            }}>
              <Snapshot title="Before" value={open.before} accent="#B45309" />
              <Snapshot title="After" value={open.after} accent="#047857" />

              {!open.before && !open.after && (
                <p style={{ fontSize: '0.82rem', color: '#94A3B8', margin: 0 }}>
                  This entry recorded no snapshot.
                </p>
              )}
            </div>

            <div style={{
              padding: '0.75rem 1.35rem', borderTop: '1px solid #E2E8F0',
              backgroundColor: '#F8FAFC', fontSize: '0.7rem', color: '#94A3B8',
              display: 'flex', justifyContent: 'space-between', gap: '1rem',
            }}>
              <span>Entry #{open.id} · {open.action}</span>
              <span>Read-only record</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
