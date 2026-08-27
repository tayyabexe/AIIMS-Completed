import { useState } from 'react';
import {
  Award, CheckCircle2, AlertTriangle, Loader2, ChevronDown, ChevronRight,
} from 'lucide-react';
import { results as resultsApi } from '../../api/endpoints';
import { useAdminPage } from '../../hooks/useAdminPage';
import Modal from '../common/Modal';
import ApiErrorNotice from '../common/ApiErrorNotice';

/*
 * Publishing a semester's results.
 *
 * WHY THIS SCREEN EXISTS
 * ----------------------
 * The `results` table is read by four portals — the student's Result screen,
 * the parent's Results view, the admin's CGPA columns, and every GPA figure on
 * every dashboard and report — and until now nothing in the product could write
 * a single row into it. Teachers entered marks; marks never became results. On
 * a database built from scratch every one of those screens is permanently
 * empty, and there is no button anywhere that would change that.
 *
 * WHAT PRESSING PUBLISH ACTUALLY DOES
 * -----------------------------------
 * Two things, which are one decision (Task 10):
 *
 *   1. It runs `sp_publish_semester_results`, which has been in the database
 *      from the start and had never been called. For every student with marks
 *      in the semester it computes a credit-hour weighted GPA, then a CGPA
 *      across this semester plus every previously Published one, and upserts
 *      the row.
 *
 *   2. It RELEASES THE MARKS THEMSELVES. Every mark the teachers submitted for
 *      this semester moves from Verified to Published, which is what makes it
 *      visible on the student's Result page and in the parent portal.
 *
 * Step 2 did not used to exist, and its absence was the defect. The student's
 * read path never looked at `marks.status`, so a mark reached them the instant
 * a teacher typed it — a Draft included — and the teacher's "Publish" button
 * changed a flag nobody read. Compiling the GPA and letting the student see the
 * marks it was compiled from are the same decision, so they are now the same
 * press, made by the one person who should be making it.
 *
 * Two consequences worth knowing before pressing it:
 *
 *   - It is visible immediately, and it notifies. Students and their guardians
 *     get a notification that the result is out.
 *   - It is repeatable. Correct a mark, publish again, and the figures are
 *     recomputed rather than duplicated — `results` is UNIQUE on
 *     (student, semester) and the procedure upserts onto that.
 *
 * THE DRAFT GATE
 * --------------
 * A semester with any mark still in Draft cannot be published, and the row says
 * how many and where to go. A Draft mark is one a teacher has not finished
 * entering, and a GPA computed from half a mark sheet is worse than no GPA —
 * it is wrong in a way that looks right.
 */

const ACCENT = '#991b1b';

const card = {
  backgroundColor: '#FFFFFF', borderRadius: '14px', border: '1px solid #E2E8F0',
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};

const th = {
  textAlign: 'left', fontSize: '0.7rem', fontWeight: 800, color: '#64748B',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  padding: '0.6rem 0.85rem', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap',
};

const td = {
  fontSize: '0.85rem', color: '#0F172A', padding: '0.7rem 0.85rem',
  borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle',
};

const btn = (variant = 'ghost') => ({
  display: 'inline-flex', alignItems: 'center', gap: '5px',
  padding: variant === 'primary' ? '0.5rem 0.95rem' : '0.35rem 0.65rem',
  borderRadius: '8px', fontSize: '0.78rem', fontWeight: 700,
  ...(variant === 'primary'
    ? { border: 'none', backgroundColor: ACCENT, color: '#FFFFFF' }
    : { border: '1px solid #CBD5E1', backgroundColor: '#F8FAFC', color: '#0F172A' }),
});

const when = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
};

/** One semester's published rows, opened underneath its own line. */
function PublishedRows({ semesterId }) {
  const { data, loading, error } = useAdminPage(
    () => resultsApi.semesterResults(semesterId),
    { semesterId }, { key: 'semester-results' });

  const rows = data?.data ?? [];

  if (loading) {
    return (
      <p style={{ fontSize: '0.8rem', color: '#94A3B8', padding: '0.75rem 0.85rem', margin: 0 }}>
        Loading results…
      </p>
    );
  }

  if (error) return <ApiErrorNotice error={error} />;

  if (!rows.length) {
    return (
      <p style={{ fontSize: '0.8rem', color: '#94A3B8', padding: '0.75rem 0.85rem', margin: 0 }}>
        Nothing published for this semester yet.
      </p>
    );
  }

  return (
    <div style={{ overflowX: 'auto', padding: '0 0.85rem 0.85rem' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Registration</th>
            <th style={th}>Student</th>
            <th style={{ ...th, textAlign: 'right' }}>GPA</th>
            <th style={{ ...th, textAlign: 'right' }}>CGPA</th>
            <th style={th}>Published</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.resultId}>
              <td style={{ ...td, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem' }}>
                {r.registrationNumber}
              </td>
              <td style={td}>{r.studentName}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {r.gpa == null ? '—' : r.gpa.toFixed(2)}
              </td>
              <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {r.cgpa == null ? '—' : r.cgpa.toFixed(2)}
              </td>
              <td style={{ ...td, fontSize: '0.78rem', color: '#64748B' }}>
                {when(r.publishedAt) || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ResultPublishing() {
  const [confirming, setConfirming] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const { data, loading, error, refresh } = useAdminPage(
    () => resultsApi.publishableSemesters(),
    {}, { key: 'publishable-semesters' });

  const rows = data?.data ?? [];

  const publish = async () => {
    setPublishing(true);
    setActionError(null);

    try {
      const res = await resultsApi.publishSemester(confirming.semesterId);
      setNotice(res?.message || 'Results published.');
      setConfirming(null);
      // Re-read rather than patching the row: the counts, the timestamp and
      // whether anything is still blocking all come from the server.
      refresh();
    } catch (err) {
      setActionError(err);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div style={{ ...card, padding: '1.25rem', marginTop: '1.25rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <h3 style={{
          fontSize: '1rem', fontWeight: 800, color: '#0F172A', margin: 0,
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          fontFamily: "'Outfit', sans-serif",
        }}>
          <Award size={18} color={ACCENT} /> Publish semester results
        </h3>
        <p style={{ fontSize: '0.78rem', color: '#64748B', margin: '0.25rem 0 0', maxWidth: '68ch' }}>
          Turns the marks teachers have submitted into a GPA and CGPA for every student
          in the semester, <strong>and releases those marks to students and parents</strong>.
          Until you publish, a submitted mark is not visible to anyone outside the
          faculty. Students and guardians are notified. Publishing again after
          correcting a mark recalculates rather than duplicating.
        </p>
      </div>

      <ApiErrorNotice error={error} />
      <ApiErrorNotice error={actionError} />

      {notice && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.6rem 0.85rem', borderRadius: '8px', marginBottom: '0.85rem',
          backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0',
          color: '#065F46', fontSize: '0.82rem', fontWeight: 600,
        }}>
          <CheckCircle2 size={15} /> {notice}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th} />
              <th style={th}>Programme</th>
              <th style={th}>Semester</th>
              <th style={{ ...th, textAlign: 'right' }}>Marks</th>
              <th style={{ ...th, textAlign: 'right' }}>Students</th>
              <th style={th}>State</th>
              <th style={{ ...th, textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && !loading && (
              <tr>
                <td style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: '2rem' }} colSpan={7}>
                  No semester has any marks against it yet. A teacher must create an exam
                  and enter marks before results can be published.
                </td>
              </tr>
            )}

            {rows.map((r) => {
              const open = expanded === r.semesterId;

              return [
                <tr key={r.semesterId}>
                  <td style={{ ...td, width: '32px', paddingRight: 0 }}>
                    {r.publishedResults > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : r.semesterId)}
                        title={open ? 'Hide results' : 'Show published results'}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: '#64748B', padding: '4px', display: 'flex',
                        }}
                      >
                        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                    )}
                  </td>
                  <td style={td}>{r.program || '—'}</td>
                  <td style={td}><strong>{r.semesterLabel}</strong></td>
                  {/* The marks column now says where they stand, because the
                      admin is deciding whether to make them visible: how many
                      are waiting on them, and how many have already gone out. */}
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {r.markCount}
                    {r.draftMarks > 0 && (
                      <span style={{ color: '#B45309', fontWeight: 700 }}>
                        {' '}({r.draftMarks} draft)
                      </span>
                    )}
                    {r.draftMarks === 0 && r.awaitingRelease > 0 && (
                      <span style={{ color: '#B45309', fontWeight: 700 }}>
                        {' '}({r.awaitingRelease} to release)
                      </span>
                    )}
                    {r.draftMarks === 0 && !r.awaitingRelease && r.releasedMarks > 0 && (
                      <span style={{ color: '#065F46', fontWeight: 600 }}>
                        {' '}({r.releasedMarks} released)
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {r.studentsWithMarks}
                  </td>
                  <td style={td}>
                    {r.publishedResults > 0 ? (
                      <span style={{ fontSize: '0.78rem', color: '#065F46', fontWeight: 700 }}>
                        {r.publishedResults} published
                        <span style={{ color: '#94A3B8', fontWeight: 500 }}>
                          {when(r.lastPublishedAt) ? ` · ${when(r.lastPublishedAt)}` : ''}
                        </span>
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>Not published</span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {r.canPublish ? (
                      <button
                        type="button"
                        onClick={() => { setNotice(null); setActionError(null); setConfirming(r); }}
                        style={btn('primary')}
                      >
                        <Award size={14} />
                        {r.publishedResults > 0 ? 'Republish' : 'Publish'}
                      </button>
                    ) : (
                      /* Disabled with the reason attached, rather than offered
                         and then refused: the server would say no, and a button
                         that is guaranteed to fail is not a choice. */
                      <span
                        title={r.blockedReason}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '5px',
                          fontSize: '0.76rem', fontWeight: 700, color: '#B45309',
                          backgroundColor: '#FFFBEB', border: '1px solid #FDE68A',
                          padding: '0.35rem 0.6rem', borderRadius: '8px',
                        }}
                      >
                        <AlertTriangle size={13} /> Marks in draft
                      </span>
                    )}
                  </td>
                </tr>,

                open && (
                  <tr key={`${r.semesterId}-rows`}>
                    <td colSpan={7} style={{ padding: 0, backgroundColor: '#F8FAFC' }}>
                      <PublishedRows semesterId={r.semesterId} />
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>

      {/* ── Confirmation ── */}
      <Modal
        open={!!confirming}
        title={confirming?.publishedResults > 0 ? 'Republish these results?' : 'Publish these results?'}
        icon={Award}
        onClose={() => setConfirming(null)}
        onBackdropClose={() => setConfirming(null)}
        width="480px"
      >
        <p style={{ fontSize: '0.88rem', color: '#475569', margin: 0, lineHeight: 1.55 }}>
          <strong>{confirming?.program} · {confirming?.semesterLabel}</strong> —
          {' '}a GPA and CGPA will be calculated for
          {' '}<strong>{confirming?.studentsWithMarks}</strong> student
          {confirming?.studentsWithMarks === 1 ? '' : 's'} from
          {' '}<strong>{confirming?.markCount}</strong> mark
          {confirming?.markCount === 1 ? '' : 's'}.
        </p>

        {/* The release is stated on its own, in the confirmation, because it is
            the irreversible half of this action: a recalculated GPA can be
            recalculated again, but marks that have gone out to students and
            parents — with a notification — have gone out. */}
        {confirming?.awaitingRelease > 0 && (
          <p style={{
            fontSize: '0.82rem', color: '#92400E', margin: '0.75rem 0 0',
            lineHeight: 1.55, backgroundColor: '#FFFBEB',
            border: '1px solid #FDE68A', borderRadius: '8px', padding: '0.6rem 0.75rem',
          }}>
            <strong>{confirming.awaitingRelease} mark
            {confirming.awaitingRelease === 1 ? '' : 's'} will become visible</strong> to
            students and their parents, who will be notified. Teachers cannot change a
            released mark afterwards.
          </p>
        )}

        <p style={{ fontSize: '0.82rem', color: '#475569', margin: '0.75rem 0 0', lineHeight: 1.55 }}>
          {confirming?.publishedResults > 0
            ? `${confirming.publishedResults} result(s) already exist for this semester and will be
               recalculated from the current marks, not duplicated.`
            : 'Students and their parents can see a published result immediately.'}
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button
            type="button"
            onClick={() => setConfirming(null)}
            style={{ ...btn(), padding: '0.6rem 1.2rem' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={publish}
            disabled={publishing}
            style={{ ...btn('primary'), padding: '0.6rem 1.2rem', opacity: publishing ? 0.7 : 1 }}
          >
            {publishing
              ? <><Loader2 size={15} className="animate-spin" /> Publishing…</>
              : <><Award size={15} /> {confirming?.publishedResults > 0 ? 'Republish' : 'Publish'}</>}
          </button>
        </div>
      </Modal>
    </div>
  );
}
