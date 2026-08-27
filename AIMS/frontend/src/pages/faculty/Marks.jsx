import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDraft, useOnlineStatus } from '../../hooks/useDraft';
import DraftNotice from '../../components/common/DraftNotice';
import { Save, Send, Download, Plus, AlertTriangle } from 'lucide-react';
import Layout from '../../components/faculty/Layout.jsx';
import DataTable from '../../components/faculty/DataTable.jsx';
import Modal from '../../components/faculty/Modal.jsx';
import FilterBar, { FilterSelect, FilterInput } from '../../components/faculty/FilterBar.jsx';
import { useToast } from '../../components/faculty/Toast.jsx';
import DataGate from '../../components/faculty/DataState.jsx';
import { useAuth } from '../../context/FacultyAuthContext.jsx';
import { faculty as facultyApi } from '../../api/endpoints';
import { useFacultyClasses, useFacultyExams } from '../../hooks/useFacultyLookups';
import { fmtDateShort } from '../../utils/helpers.js';
import { exportCSV, exportExcel, exportPDF, EXPORT_FORMATS } from '../../utils/exporters.js';
import './Marks.css';

// Marks are entered per exam, per section — the shape the `marks` table has
// (one row per exam_id + student_id). The screen previously read a `marks`
// collection the loader always left empty, and its buttons only raised toasts.

// Assignments are created and managed on the Assignments screen, which writes a
// real exam_type='Assignment' row. The New Exam dialog here is for graded
// exams only, so 'Assignment' is deliberately absent — that is the single
// creation path for assignments. Assignment rows still APPEAR in the exam
// selector below (loaded from the DB) so their marks can be entered here.
const EXAM_TYPES = ['Quiz', 'Mid-Term', 'Final', 'Practical', 'Viva'];

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const gradeTone = (letter) => {
  if (!letter || letter === '—') return 'neutral';
  if (letter.startsWith('A')) return 'success';
  if (letter.startsWith('B')) return 'info';
  if (letter.startsWith('C') || letter.startsWith('D')) return 'warning';
  return 'danger';
};

/*
 * INPUT VALIDATION FOR A SINGLE MARK (Task: rubbish marks were accepted)
 * ----------------------------------------------------------------------
 * The cell is `<input type="number" min={0} max={total}>`, and every one of
 * those three attributes is advisory only. `min`/`max` are enforced by the
 * browser at FORM SUBMIT time — this grid is not inside a <form> and never
 * submits — and `type="number"` accepts "-12", "1e3" and "999" quite happily
 * while typing. So a teacher could enter -5 or 240 out of 50, watch the Result
 * column compute -10% / 480% and a grade off the bottom or top of the scale,
 * and press Save. The server did reject it (0..total_marks is checked in
 * facultyAcademicsService.saveMarks), but it rejected the WHOLE SHEET with one
 * toast — forty correct marks thrown out because of one typo, and no
 * indication of which row was at fault.
 *
 * This validates each cell as it is typed. It returns the message shown under
 * that row's input, or null when the value is fine. A blank cell is not an
 * error: blank means "not marked yet", which is a legitimate state on a sheet
 * being filled in over several sittings.
 */
const markError = (value, total) => {
  if (value === '' || value === null || value === undefined) return null;

  const text = String(value).trim();
  if (text === '') return null;

  const numeric = Number(text);

  // Catches "12abc", "--3", "1e", and the lone "-" or "." a browser leaves in
  // the field mid-typing — all of which Number() turns into NaN.
  if (!Number.isFinite(numeric)) return 'Numbers only';

  if (numeric < 0) return 'Cannot be negative';

  if (total && numeric > total) return `Cannot exceed ${total}`;

  /*
   * The exam total is a whole number and marks are entered in halves
   * (`step="0.5"` on the input), so a third decimal place is a typo — a
   * slipped keystroke on 38.5 giving 38.55 — not a real score. Rejecting it
   * here keeps what is stored equal to what is read back, since the column is
   * DECIMAL(5,2) and would silently round anything finer.
   */
  if (Math.round(numeric * 100) !== numeric * 100) return 'At most 2 decimal places';

  return null;
};

export default function Marks() {
  const showToast = useToast();
  const { can } = useAuth();

  /*
   * The exam list, from the shared lookup. Creating an exam invalidates the
   * same key, so the new one appears in the dropdown without this screen
   * keeping its own copy in step.
   */
  const {
    data: exams,
    loading: examsLoading,
    error: examsError,
    refresh: loadExams,
  } = useFacultyExams();

  /*
   * The teacher's own classes, for the New Exam dialog's subject list.
   *
   * Separate from the exams above because it answers a different question:
   * `exams` is what has already been set, `classes` is what this teacher is
   * allowed to set one against. The dialog needs the second — see
   * `subjectOptions` below for what happened when it used the first.
   *
   * Not gated on in the loading guard. A slow classes request must not hold up
   * the marks table, which does not depend on it; the dialog is the only thing
   * that reads it, and it is not open yet.
   */
  const { data: classes } = useFacultyClasses();

  const [examId, setExamId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [query, setQuery] = useState('');
  const [exporting, setExporting] = useState('');

  const [sheet, setSheet] = useState(null);
  const [sheetState, setSheetState] = useState({ loading: false, error: null });

  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  // The student_id currently being published on its own, so only that row's
  // button shows a pending state rather than the whole sheet locking up.
  const [publishingId, setPublishingId] = useState(null);

  const online = useOnlineStatus();

  /*
   * Unsaved marks survive a crash, a refresh or a flat battery.
   *
   * `draft` holds every mark typed but not yet sent to the server. It was
   * ordinary React state, so closing the tab halfway through a sheet of forty
   * students threw all of it away — the most expensive loss in this system,
   * because it is an hour of typing that exists nowhere else.
   *
   * This is NOT the same as the "Save Draft" button: that sends marks to the
   * server with status='Draft'. This protects the work BEFORE it is sent.
   *
   * The key carries the exam and the section, so marks typed for one class can
   * never reappear on another.
   */
  const draftKey = `faculty.marks.${examId || 'none'}.${sectionId || 'none'}`;

  const marksDraft = useDraft(draftKey, draft, {
    enabled: !!examId && !!sectionId,
    isEmpty: (value) => !value || Object.keys(value).length === 0,
    /*
     * Restored by hand below, not automatically: loadSheet() calls setDraft({})
     * on every run, including the first, so an auto-restore would be wiped a
     * moment after it happened.
     */
    autoRestore: false,
  });

  // Applies a restored sheet once the saved marks have loaded, once per
  // exam+section, so re-renders cannot re-apply it over live typing.
  const appliedDraftKey = useRef(null);

  useEffect(() => {
    if (!sheet || appliedDraftKey.current === draftKey) return;

    /*
     * Marked applied only when a draft is actually applied. `restoredDraft`
     * arrives one render after the sheet, so claiming the work was done on the
     * sheet's own pass could drop the draft entirely — the same defect that was
     * reproduced on the attendance register beside this.
     */
    const saved = marksDraft.restoredDraft;
    if (!saved?.value || !Object.keys(saved.value).length) return;

    appliedDraftKey.current = draftKey;
    setDraft(saved.value);
  }, [sheet, draftKey, marksDraft.restoredDraft]);

  const [creating, setCreating] = useState(false);
  const [newExam, setNewExam] = useState({
    exam_name: '',
    exam_type: 'Quiz',
    subject_id: '',
    exam_date: todayIso(),
    total_marks: 10,
  });

  /*
   * The New Exam dialog keeps what was typed if it is closed by accident.
   *
   * This is a different loss from the marks grid above. The grid is protected
   * because it is an hour of typing; this dialog is protected because it is
   * easy to dismiss — it closes on Cancel, on Escape and on a backdrop click,
   * and every one of those threw away the exam name, the subject and the date
   * with no warning. Verified before this change with Playwright: text typed
   * into it wrote no draft key and did not survive a reload.
   *
   * `enabled: creating` matters for more than saving. The hook applies a
   * restore when it flips true, so the draft is offered when the dialog is
   * opened rather than on page mount, where there is nothing on screen to
   * restore into.
   */
  const examDraft = useDraft('faculty.exam.new', newExam, {
    enabled: creating,
    onRestore: setNewExam,
    /*
     * exam_type, exam_date and total_marks all carry defaults, so an untouched
     * dialog is not an empty object. Only the two fields a person must supply
     * decide whether this counts as work worth keeping — they are also the two
     * the Create button is disabled on.
     */
    isEmpty: (value) => !value?.exam_name?.trim() && !value?.subject_id,
  });

  /*
   * Default to the first exam once the list is known — unless the URL names one.
   *
   * The Assignments screen links here as `/faculty/marks?exam=<id>` so a
   * teacher grading an assignment lands straight on that assignment's sheet
   * (an assignment IS an exam_type='Assignment' row, and marks are entered
   * here). If that id is one of the teacher's exams it wins once; otherwise we
   * fall back to the first. `prev ||` is kept: the list can be refreshed
   * underneath the teacher — creating an exam does exactly that — and
   * re-selecting would move them off the sheet they are typing into.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (!exams.length) return;
    const wanted = searchParams.get('exam');
    const wantedExists = wanted && exams.some((e) => String(e.exam_id) === String(wanted));
    if (wantedExists) {
      setExamId(String(wanted));
      // Consume the param so a later manual pick is not overridden on re-render.
      const next = new URLSearchParams(searchParams);
      next.delete('exam');
      setSearchParams(next, { replace: true });
      return;
    }
    setExamId((prev) => prev || String(exams[0].exam_id));
  }, [exams, searchParams, setSearchParams]);

  const selectedExam = useMemo(
    () => exams.find((e) => String(e.exam_id) === String(examId)) || null,
    [exams, examId],
  );

  // An exam belongs to a subject, and the subject may be taught to more than
  // one section, so the section list follows the chosen exam.
  useEffect(() => {
    if (!selectedExam) return;
    const sections = selectedExam.sections || [];
    setSectionId((prev) => (
      sections.some((s) => String(s.section_id) === String(prev))
        ? prev
        : (sections[0] ? String(sections[0].section_id) : '')
    ));
  }, [selectedExam]);

  const loadSheet = useCallback(async () => {
    if (!examId || !sectionId) {
      setSheet(null);
      return;
    }
    setSheetState({ loading: true, error: null });
    setDraft({});
    try {
      const res = await facultyApi.marksSheet({ exam_id: examId, section_id: sectionId });
      setSheet(res?.data || null);
      setSheetState({ loading: false, error: null });
    } catch (err) {
      setSheet(null);
      setSheetState({ loading: false, error: err.message || 'Could not load the marks sheet.' });
    }
  }, [examId, sectionId]);

  useEffect(() => { loadSheet(); }, [loadSheet]);

  const rows = useMemo(() => {
    const records = sheet?.records || [];
    const q = query.trim().toLowerCase();

    return records
      .filter((r) => !q
        || r.full_name.toLowerCase().includes(q)
        || String(r.registration_number).toLowerCase().includes(q))
      .map((r) => {
        const pending = draft[r.student_id];
        const value = pending !== undefined ? pending : r.obtained_marks;
        const total = sheet?.exam?.total_marks || 0;
        const numeric = value === '' || value === null || value === undefined ? null : Number(value);
        const error = markError(value, total);
        return {
          ...r,
          value: value === null || value === undefined ? '' : value,
          error,
          /*
           * No percentage and no grade for a value that is out of range. The
           * old code computed one regardless, so -5 out of 50 was presented as
           * "-10%" with an F beside it — a confident, precise reading of a
           * number that cannot exist. A cell in error shows its error instead.
           */
          livePercentage: error || numeric === null || !total
            ? null
            : Math.round((numeric / total) * 1000) / 10,
          dirty: pending !== undefined && String(pending) !== String(r.obtained_marks ?? ''),
        };
      });
  }, [sheet, draft, query]);

  const dirtyCount = useMemo(
    () => rows.filter((r) => r.dirty).length,
    [rows],
  );

  /*
   * Counted over the WHOLE sheet, not `rows`, because `rows` is filtered by the
   * search box. A bad mark that has been searched out of view is still a bad
   * mark, and the save buttons must stay disabled while it exists — otherwise
   * typing 240, then searching for another student, hands back a Save button
   * that produces a server rejection for a row nobody can see.
   */
  const invalidRows = useMemo(() => {
    const total = sheet?.exam?.total_marks || 0;
    return (sheet?.records || [])
      .map((r) => {
        const pending = draft[r.student_id];
        const value = pending !== undefined ? pending : r.obtained_marks;
        return { name: r.full_name, error: markError(value, total) };
      })
      .filter((r) => r.error);
  }, [sheet, draft]);

  const invalidCount = invalidRows.length;

  /*
   * How many marks on this sheet are at each stage. The per-row badge already
   * says where one student stands; this says where the SHEET stands, which is
   * the question a teacher actually has when they come back to it — "did I
   * finish submitting this class, or did I stop halfway?"
   */
  const statusCounts = useMemo(() => {
    const counts = { Draft: 0, Verified: 0, Published: 0 };
    (sheet?.records || []).forEach((r) => {
      if (r.status && counts[r.status] !== undefined) counts[r.status] += 1;
    });
    return counts;
  }, [sheet]);

  /*
   * The receipt for the last completed save, kept on screen until the sheet is
   * touched again.
   *
   * A toast was the only confirmation this screen gave, and a toast is gone in
   * under three seconds — look away to the next paper script and there is no
   * longer anything anywhere saying whether the sheet was saved. This strip
   * stays: what happened, to how many marks, and at what time. It is cleared
   * when the exam or section changes, because it would then be describing a
   * different sheet.
   */
  const [lastSave, setLastSave] = useState(null);

  useEffect(() => { setLastSave(null); }, [examId, sectionId]);

  const setMark = (studentId, value) => {
    setDraft((prev) => ({ ...prev, [studentId]: value }));
  };

  const submit = async (status) => {
    if (!sheet) return;

    /*
     * Nothing leaves this screen while a cell is out of range.
     *
     * The buttons are already disabled on `invalidCount`, so this is the
     * belt-and-braces path — a keyboard activation racing the re-render, or a
     * future caller. It names the students rather than saying "some marks are
     * invalid", because on a sheet of forty the useful part of that sentence is
     * which row to go and look at.
     */
    if (invalidCount) {
      const names = invalidRows.slice(0, 3).map((r) => r.name).join(', ');
      showToast(
        `Fix ${invalidCount} invalid mark${invalidCount === 1 ? '' : 's'} first — ${names}`
        + `${invalidCount > 3 ? ` and ${invalidCount - 3} more` : ''}.`,
        'error',
      );
      return;
    }

    const records = (sheet.records || [])
      .map((r) => {
        const pending = draft[r.student_id];
        const value = pending !== undefined ? pending : r.obtained_marks;
        return { student_id: r.student_id, obtained_marks: value };
      })
      .filter((r) => r.obtained_marks !== null
        && r.obtained_marks !== undefined
        && r.obtained_marks !== '');

    if (!records.length) {
      showToast('Nothing to save — no marks have been entered.', 'info');
      return;
    }

    setSaving(true);
    try {
      const res = await facultyApi.saveMarks({
        exam_id: Number(examId),
        section_id: Number(sectionId),
        status,
        records,
      });
      showToast(res?.message || 'Marks saved.');

      /*
       * The receipt is built from what the SERVER said it did, not from what
       * was sent. created + updated is the number of rows that actually
       * changed, and lockedCount is the rows it refused because an
       * administrator had already released them — a save that took 38 of 40 is
       * a different event from one that took all 40, and the teacher is the
       * person who needs to know which one just happened.
       */
      const result = res?.data || {};
      setLastSave({
        status: result.status || status,
        count: (result.created || 0) + (result.updated || 0),
        locked: result.lockedCount || 0,
        at: new Date(),
      });

      // The local copy is only discarded once the server has the marks.
      marksDraft.clear();
      await Promise.all([loadSheet(), loadExams()]);
    } catch (err) {
      setLastSave(null);
      showToast(err.message || 'Could not save marks.', 'error');
    } finally {
      setSaving(false);
    }
  };

  /*
   * Submit one student's mark for approval, without touching anyone else's.
   *
   * WHAT "SUBMIT" MEANS HERE, AND WHY IT IS NOT "PUBLISH" (Task 10)
   * ---------------------------------------------------------------
   * This was a Publish button that published nothing. The student's Result page
   * ignored `marks.status` altogether and showed a mark from the moment it was
   * saved — a Draft included — so pressing Publish flipped a flag nobody
   * outside this screen read. Verified with Playwright: a mark saved as Draft
   * was on the student's page seconds later.
   *
   * It now moves the mark to Verified: submitted, and waiting on an
   * administrator. The administrator releases it — along with the semester GPA
   * computed from it — on the admin Result Publishing screen. A teacher may
   * revise a submitted mark right up until that release; afterwards this screen
   * leaves the row alone and says so, rather than silently pulling a published
   * result back off a student's page.
   *
   * WHY THIS REUSES `POST /api/faculty/marks` RATHER THAN A NEW ENDPOINT
   * -------------------------------------------------------------------
   * That endpoint already takes a `records` array and a status, and
   * facultyAcademicsService.saveMarks loops over exactly the records it is
   * given — every other student's row is left alone. A one-element array is
   * therefore a single-student publish with no server change, and it goes
   * through the same ownership check, the same 0..total_marks validation and
   * the same transaction as the bulk button.
   *
   * WHY THE LOCAL DRAFT IS NOT CLEARED WHOLESALE
   * --------------------------------------------
   * `submit()` calls `marksDraft.clear()` because it has just sent every
   * pending mark. Here only one was sent, so clearing the whole draft would
   * throw away the unsaved typing for the other thirty-nine students — the
   * exact loss useDraft exists to prevent. Only this student's pending edit is
   * dropped, and the mirror follows `draft` on its own.
   */
  const publishOne = async (row) => {
    if (!sheet) return;

    const value = row.value;

    if (value === '' || value === null || value === undefined) {
      showToast('Enter a mark for this student first.', 'info');
      return;
    }

    // Same rule as the sheet-wide save, applied to the one row being sent.
    const invalid = markError(value, sheet?.exam?.total_marks);
    if (invalid) {
      showToast(`${row.full_name}: ${invalid.toLowerCase()}.`, 'error');
      return;
    }

    setPublishingId(row.student_id);

    try {
      const res = await facultyApi.saveMarks({
        exam_id: Number(examId),
        section_id: Number(sectionId),
        status: 'Verified',
        records: [{ student_id: row.student_id, obtained_marks: value }],
      });

      showToast(res?.message || `${row.full_name}'s mark submitted for approval.`);

      setLastSave({
        status: 'Verified',
        count: 1,
        locked: res?.data?.lockedCount || 0,
        at: new Date(),
        who: row.full_name,
      });

      setDraft((prev) => {
        if (prev[row.student_id] === undefined) return prev;
        const next = { ...prev };
        delete next[row.student_id];
        return next;
      });

      await Promise.all([loadSheet(), loadExams()]);
    } catch (err) {
      showToast(err.message || 'Could not submit this mark.', 'error');
    } finally {
      setPublishingId(null);
    }
  };

  const handleCreateExam = async () => {
    try {
      const res = await facultyApi.createExam({
        ...newExam,
        total_marks: Number(newExam.total_marks),
      });
      showToast('Exam created.');
      // After the server has accepted it, not before — a failed create must
      // leave the typing where it was.
      examDraft.clear();
      setNewExam({
        exam_name: '',
        exam_type: 'Quiz',
        subject_id: '',
        exam_date: todayIso(),
        total_marks: 10,
      });
      setCreating(false);
      await loadExams();
      if (res?.data?.exam_id) setExamId(String(res.data.exam_id));
    } catch (err) {
      showToast(err.message || 'Could not create the exam.', 'error');
    }
  };

  const handleExport = (format) => {
    if (!sheet) return;
    setExporting(format);

    const headers = [
      'Roll Number', 'Student Name', 'Obtained', 'Total', 'Percentage', 'Grade', 'Status',
    ];
    const exportRows = (sheet.records || []).map((r) => [
      r.registration_number,
      r.full_name,
      r.obtained_marks ?? 'Not entered',
      sheet.exam.total_marks,
      r.percentage != null ? `${r.percentage}%` : '—',
      r.grade ? r.grade.letter : '—',
      r.status || 'Not entered',
    ]);

    const base = `marks_${sheet.exam.exam_name.replace(/\s+/g, '_')}_${sheet.class.section_name}.`;
    const subtitle = `${sheet.class.subject_code} ${sheet.class.subject_name} · Section `
      + `${sheet.class.section_name} · ${sheet.exam.exam_type}: ${sheet.exam.exam_name} · `
      + `${fmtDateShort(sheet.exam.exam_date)} · out of ${sheet.exam.total_marks}`;

    setTimeout(() => {
      if (format === 'csv') exportCSV(`${base}csv`, headers, exportRows);
      if (format === 'xlsx') exportExcel(`${base}xlsx`, 'Marks', headers, exportRows);
      if (format === 'pdf') {
        exportPDF(`${base}pdf`, { title: 'Marks Sheet', subtitle, headers, rows: exportRows });
      }
      setExporting('');
      showToast(`Marks exported as ${format.toUpperCase()}`);
    }, 200);
  };

  /*
   * The subjects a new exam may be created against.
   *
   * WHY THIS READS `classes` AND NOT `exams`
   * ----------------------------------------
   * It used to fold the list out of `exams`, which made the dropdown offer
   * only subjects that ALREADY had an exam. That is circular, and on a fresh
   * account it is a deadlock: a teacher with no exams got an empty dropdown,
   * could not pick a subject, so could not create the exam that would have put
   * a subject in the dropdown. The screen even said "No exams exist for your
   * subjects yet. Create one to start entering marks." directly above a form
   * that made creating one impossible.
   *
   * `GET /api/faculty/classes` is the right source and always was — it is the
   * same list `facultyAcademicsService.createExam` validates the submitted
   * `subject_id` against, so anything offered here is something the server will
   * accept, and nothing the server would accept is missing.
   *
   * Deduped by subject_id: an exam belongs to a subject, not to a section (the
   * `exams` row has no section column), so a teacher taking one subject for two
   * sections must see it once, not twice.
   */
  const subjectOptions = useMemo(() => {
    const map = new Map();

    classes.forEach((c) => {
      if (!map.has(c.subject_id)) {
        map.set(c.subject_id, `${c.subject_code} — ${c.subject_name}`);
      }
    });

    return [...map.entries()].map(([value, label]) => ({ value, label }));
  }, [classes]);

  if (examsLoading || examsError) {
    return (
      <Layout title="Marks">
        <DataGate
          loading={examsLoading}
          error={examsError}
          onRetry={loadExams}
          label="Loading your exams…"
        />
      </Layout>
    );
  }

  return (
    <Layout title="Marks">
      <div className="marks-top-row">
        <div className="marks-heading">
          <h2>Marks</h2>
          <p>
            {selectedExam
              ? `${selectedExam.subject_code} · ${selectedExam.exam_type}: ${selectedExam.exam_name} · out of ${selectedExam.total_marks}`
              : 'Choose an exam to enter marks against'}
          </p>
        </div>
        <div className="attendance-export-group">
          {can('manage_marks') && (
            <button className="btn btn-outline" onClick={() => setCreating(true)}>
              <Plus size={14} /> New Exam
            </button>
          )}
          {can('export_reports') && EXPORT_FORMATS.map(({ label, format }) => (
            <button
              key={format}
              className="btn btn-outline"
              disabled={exporting === format || !sheet}
              onClick={() => handleExport(format)}
            >
              <Download size={14} /> {exporting === format ? 'Exporting…' : `Export ${label}`}
            </button>
          ))}
        </div>
      </div>

      {exams.length === 0 ? (
        <div className="empty-state">
          No exams exist for your subjects yet. Create one to start entering marks.
        </div>
      ) : (
        <>
          <FilterBar resetActive={!!query} onReset={() => setQuery('')}>
            <FilterSelect
              label="Exam"
              value={examId}
              onChange={(e) => setExamId(e.target.value)}
              options={exams.map((e) => ({
                value: String(e.exam_id),
                label: `${e.subject_code} · ${e.exam_type}: ${e.exam_name} (${fmtDateShort(e.exam_date)})`,
              }))}
            />
            <FilterSelect
              label="Section"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              options={(selectedExam?.sections || []).map((s) => ({
                value: String(s.section_id),
                label: `Section ${s.section_name} · ${s.student_count} students`,
              }))}
            />
            <FilterInput
              label="Search"
              placeholder="Student or roll number"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </FilterBar>

          {sheet && (
            <div className="marks-summary">
              <div className="marks-summary-item"><span>Students</span><strong>{sheet.summary.students}</strong></div>
              <div className="marks-summary-item"><span>Entered</span><strong>{sheet.summary.entered}</strong></div>
              <div className="marks-summary-item"><span>Pending</span><strong style={{ color: 'var(--warning-text)' }}>{sheet.summary.pending}</strong></div>
              <div className="marks-summary-item"><span>Average</span><strong style={{ color: 'var(--info-text)' }}>{sheet.summary.average ?? '—'}</strong></div>
              <div className="marks-summary-item"><span>Highest</span><strong style={{ color: 'var(--success-text)' }}>{sheet.summary.highest ?? '—'}</strong></div>
              <div className="marks-summary-item"><span>Lowest</span><strong style={{ color: 'var(--danger-text)' }}>{sheet.summary.lowest ?? '—'}</strong></div>
              <div className="marks-summary-item"><span>Pass Rate</span><strong style={{ color: 'var(--success-text)' }}>{sheet.summary.pass_rate != null ? `${sheet.summary.pass_rate}%` : '—'}</strong></div>
            </div>
          )}

          {/*
            * WHERE THE SHEET STANDS (Task: "how do I know these are saved?")
            * ---------------------------------------------------------------
            * The seven tiles above describe the MARKS — how many, how high, how
            * many passed. None of them answers the question a teacher has when
            * they reopen a sheet: how far through the process is this class?
            *
            * These three do, and they are the same three states the per-row
            * badge shows, counted:
            *
            *   Saved as draft — on the server, yours alone. Survives logout and
            *                    a different machine; no student, parent or
            *                    administrator can see it. This is the resting
            *                    state for a sheet still being marked.
            *   Submitted      — handed to the examination office. Still not on
            *                    the student's screen. You may still revise it.
            *   Released       — an administrator has published the result. The
            *                    student and their parent can see the mark, and
            *                    this screen will no longer overwrite it.
            *
            * A sheet is finished when Submitted + Released equals Entered.
            */}
          {sheet && (
            <div className="marks-progress" aria-label="Where this sheet stands">
              <div className="marks-progress-item">
                <span className="badge badge-neutral">Draft</span>
                <strong>{statusCounts.Draft}</strong>
                <em>Saved on the server. Not visible to students.</em>
              </div>
              <div className="marks-progress-item">
                <span className="badge badge-warning">Submitted</span>
                <strong>{statusCounts.Verified}</strong>
                <em>Sent for approval. Awaiting an administrator.</em>
              </div>
              <div className="marks-progress-item">
                <span className="badge badge-success">Released</span>
                <strong>{statusCounts.Published}</strong>
                <em>Published by an administrator. Students can see these.</em>
              </div>
              <div className="marks-progress-item">
                <span className="badge badge-warning">Unsaved</span>
                <strong>{dirtyCount}</strong>
                <em>Typed here, not yet sent to the server.</em>
              </div>
            </div>
          )}

          <DataGate
            loading={sheetState.loading}
            error={sheetState.error}
            onRetry={loadSheet}
            label="Loading marks sheet…"
          >
            <DataTable
              columns={[
                /*
                 * WHAT THIS TABLE DROPPED, AND WHY
                 * --------------------------------
                 * It had eight columns: Student (with a photograph), Roll
                 * Number, Marks, Total, Percentage, Grade, Status, Entered By.
                 * Three of them earned nothing on a sheet you are typing into.
                 *
                 *  - the AVATAR. A marks sheet is entered against a roll
                 *    number, not a face, and thirty-two-pixel portraits down
                 *    the left edge are the loudest thing on a screen whose
                 *    subject is numbers. (It was also unstyled here:
                 *    `.student-cell` is defined in Students.css, which this
                 *    route never loads.)
                 *
                 *  - TOTAL. The same figure repeated on every row. It belongs
                 *    to the exam, is already in the heading above, and is now
                 *    the suffix beside each input, where it is what the number
                 *    being typed is measured against.
                 *
                 *  - ROLL NUMBER as its own column. It identifies the same
                 *    person as the name beside it, so it sits under the name
                 *    instead of taking a column to repeat the identity.
                 *
                 *  - ENTERED BY. On a sheet a teacher is filling in, it is
                 *    their own name forty times. It is kept on the status
                 *    badge's tooltip, which is where it is wanted — when a
                 *    mark is queried and the question is who put it there.
                 *
                 * Percentage and Grade merge into one Result cell: they are
                 * two readings of the single number to their left.
                 */
                {
                  key: 'full_name',
                  label: 'Student',
                  render: (r) => (
                    <div className="marks-student">
                      <span className="marks-student-name">{r.full_name}</span>
                      <span className="marks-student-reg">{r.registration_number}</span>
                    </div>
                  ),
                },
                {
                  key: 'obtained_marks',
                  label: 'Marks',
                  align: 'center',
                  width: 150,
                  render: (r) => (can('manage_marks') ? (
                    <div className="marks-entry-cell">
                      <div className="marks-entry">
                        <input
                          className={`marks-input${r.error ? ' marks-input-invalid' : ''}`}
                          type="number"
                          min={0}
                          max={sheet?.exam?.total_marks}
                          step="0.5"
                          placeholder="—"
                          aria-label={`Marks for ${r.full_name}, out of ${sheet?.exam?.total_marks ?? ''}`}
                          /* The browser exposes the error to a screen reader
                             only if the field says it is invalid and points at
                             the text that explains why. The red border alone
                             reaches nobody who cannot see it. */
                          aria-invalid={r.error ? 'true' : undefined}
                          aria-describedby={r.error ? `mark-error-${r.student_id}` : undefined}
                          value={r.value}
                          /*
                           * `type="number"` accepts "e", "E", "+" and "-" as
                           * legal characters mid-number (1e3 is a number, and
                           * so is -5). Blocking them at the keystroke is the
                           * difference between a mark that cannot be typed and
                           * one that is typed, computed against, and only
                           * caught at the bottom of the screen. Everything
                           * else — arrows, Tab, paste, the numeric keypad — is
                           * untouched, and a pasted bad value is still caught
                           * by markError below.
                           */
                          onKeyDown={(e) => {
                            if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
                          }}
                          onChange={(e) => setMark(r.student_id, e.target.value)}
                        />
                        {/* The denominator, next to the number it bounds, rather
                            than in a column of its own repeating one value. */}
                        <span className="marks-entry-total">
                          / {sheet?.exam?.total_marks ?? '—'}
                        </span>
                      </div>
                      {r.error && (
                        <span className="marks-input-error" id={`mark-error-${r.student_id}`}>
                          {r.error}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="marks-readonly">
                      {r.obtained_marks ?? '—'}
                      <span className="marks-entry-total">
                        / {sheet?.exam?.total_marks ?? '—'}
                      </span>
                    </span>
                  )),
                },
                {
                  key: 'livePercentage',
                  label: 'Result',
                  align: 'center',
                  width: 140,
                  render: (r) => {
                    // An out-of-range value has no percentage and no grade, so
                    // the cell says why it is blank rather than showing a dash
                    // that looks like "not entered yet".
                    if (r.error) {
                      return <span className="badge badge-danger">Invalid</span>;
                    }

                    if (r.livePercentage == null) {
                      return <span className="marks-muted">—</span>;
                    }

                    const letter = r.grade ? r.grade.letter : '—';

                    return (
                      <div className="marks-result">
                        <span className="marks-result-pct">{r.livePercentage}%</span>
                        <span className={`badge badge-${gradeTone(letter)}`}>{letter}</span>
                      </div>
                    );
                  },
                },
                {
                  key: 'status',
                  label: 'Status',
                  width: 130,
                  render: (r) => {
                    if (r.error) {
                      return (
                        <span className="badge badge-danger" title={r.error}>
                          Fix this mark
                        </span>
                      );
                    }

                    if (r.dirty) {
                      return (
                        <span
                          className="badge badge-warning"
                          title="Typed but not sent to the server yet. Press Save Draft or Submit for Approval."
                        >
                          Unsaved
                        </span>
                      );
                    }

                    if (!r.status) {
                      return <span className="marks-muted">Not entered</span>;
                    }

                    /*
                     * The three statuses now mean three different things to the
                     * student, so the badge distinguishes them (Task 10):
                     *
                     *   Draft     — yours alone. Nobody else can see it.
                     *   Submitted — sent for approval, still not visible to the
                     *               student. Shown as "Submitted" rather than
                     *               the raw "Verified", because what a teacher
                     *               needs to know is that they have handed it
                     *               over, not what the enum calls that state.
                     *   Released  — an administrator has published it; the
                     *               student and their parent can see it, and
                     *               this screen will no longer overwrite it.
                     */
                    const STATUS_LABEL = {
                      Draft: { text: 'Draft', tone: 'neutral', hint: 'Saved. Not visible to the student.' },
                      Verified: { text: 'Submitted', tone: 'warning', hint: 'Awaiting approval. Not visible to the student yet.' },
                      Published: { text: 'Released', tone: 'success', hint: 'Released by an administrator — visible to the student.' },
                    };

                    const badge = STATUS_LABEL[r.status]
                      || { text: r.status, tone: 'neutral', hint: undefined };

                    return (
                      <span
                        className={`badge badge-${badge.tone}`}
                        /* Where "Entered By" went. Free on hover, and off the
                           grid the other 99% of the time. */
                        title={[
                          badge.hint,
                          r.entered_by_name ? `Entered by ${r.entered_by_name}` : null,
                        ].filter(Boolean).join(' ')}
                      >
                        {badge.text}
                      </span>
                    );
                  },
                },
                ...(can('manage_marks') ? [{
                  key: 'publish',
                  label: '',
                  align: 'center',
                  width: 120,
                  render: (r) => {
                    const hasMark = r.value !== '' && r.value !== null && r.value !== undefined
                      && !r.error;
                    const busy = publishingId === r.student_id;

                    // Released marks are an administrator's to change now. The
                    // button is disabled rather than removed so the row still
                    // explains itself instead of just losing a control.
                    const released = r.status === 'Published';

                    return (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        /* Disabled when there is nothing to send, or when the
                           mark has already gone out to the student. */
                        disabled={!hasMark || saving || busy || released}
                        title={released
                          ? 'Already released to the student. Contact the examination office to change it.'
                          : r.error
                            ? `${r.error} — correct this mark before submitting it.`
                            : hasMark
                              ? 'Send this mark for approval. The student sees it once an administrator releases it.'
                              : 'Enter a mark for this student first'}
                        onClick={() => publishOne(r)}
                      >
                        {busy ? '…' : released ? 'Released' : 'Submit'}
                      </button>
                    );
                  },
                }] : []),
              ]}
              rows={rows}
              rowKey={(r) => r.student_id}
              searchable={false}
              emptyMessage="No students are assigned to this section."
            />
          </DataGate>

          {can('manage_marks') && (
            <div className="marks-footer">
              {/*
                * THE RECEIPT (Task: "Save Draft doesn't tell me anything")
                * --------------------------------------------------------
                * The only confirmation this screen gave was a toast, and a
                * toast is gone in 2.6 seconds — long before a teacher has
                * looked up from the next paper script. Nothing else on the
                * page changed in a way that read as "that worked".
                *
                * This says what happened, to how many marks, and when, and it
                * stays there until the sheet is saved again or the exam is
                * changed. It is written from the server's own reply, so it is
                * a statement about the database rather than about the button
                * having been pressed.
                */}
              {lastSave && (
                <div className={`marks-receipt marks-receipt-${lastSave.status === 'Verified' ? 'submitted' : 'draft'}`}>
                  {lastSave.status === 'Verified'
                    ? <Send size={15} />
                    : <Save size={15} />}
                  <span>
                    <strong>
                      {lastSave.status === 'Verified'
                        ? `${lastSave.count} mark${lastSave.count === 1 ? '' : 's'} submitted for approval`
                        : `${lastSave.count} mark${lastSave.count === 1 ? '' : 's'} saved as a draft`}
                      {lastSave.who ? ` — ${lastSave.who}` : ''}
                    </strong>
                    {' at '}
                    {lastSave.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {'. '}
                    {lastSave.status === 'Verified'
                      ? 'Waiting on an administrator to release them — students cannot see them yet.'
                      : 'Stored on the server, visible only to you. Submit for approval when the sheet is complete.'}
                    {lastSave.locked
                      ? ` ${lastSave.locked} already-released mark${lastSave.locked === 1 ? ' was' : 's were'} left unchanged.`
                      : ''}
                  </span>
                </div>
              )}

              {/* Named and counted, so the reason the buttons are dead is on
                  screen beside them rather than only in a tooltip. */}
              {invalidCount > 0 && (
                <div className="marks-invalid-notice" role="alert">
                  <AlertTriangle size={15} />
                  <span>
                    <strong>
                      {invalidCount} mark{invalidCount === 1 ? '' : 's'} out of range
                    </strong>
                    {' — '}
                    {invalidRows.slice(0, 4).map((r) => r.name).join(', ')}
                    {invalidCount > 4 ? ` and ${invalidCount - 4} more` : ''}
                    . Marks must be between 0 and {sheet?.exam?.total_marks ?? '—'}.
                  </span>
                </div>
              )}

              <div className="marks-actions">
                <DraftNotice draft={marksDraft} online={online} onDiscard={() => setDraft({})} compact />
                <button
                  className="btn btn-outline"
                  disabled={saving || invalidCount > 0}
                  title={invalidCount
                    ? `Fix ${invalidCount} out-of-range mark${invalidCount === 1 ? '' : 's'} first.`
                    : 'Save these marks on the server as a draft. Only you can see them.'}
                  onClick={() => submit('Draft')}
                >
                  <Save size={16} />{' '}
                  {saving ? 'Saving…' : dirtyCount ? `Save Draft (${dirtyCount} changed)` : 'Save Draft'}
                </button>
                {/* "Submit for Approval", not "Publish Marks": this hands the
                    sheet to the examination office, it does not put it on the
                    students' screens. An administrator does that when the
                    semester result is published. */}
                <button
                  className="btn btn-primary"
                  disabled={saving || invalidCount > 0}
                  onClick={() => submit('Verified')}
                  title={invalidCount
                    ? `Fix ${invalidCount} out-of-range mark${invalidCount === 1 ? '' : 's'} first.`
                    : 'Send these marks to the examination office. Students see them once an administrator releases the semester result.'}
                >
                  <Send size={16} /> Submit for Approval
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal mounts only while open — it has no `open` prop of its own and
          locks body scroll on mount. */}
      {creating && (
      <Modal
        title="New Exam"
        onClose={() => setCreating(false)}
        footer={(
          <>
            <button className="btn btn-outline" onClick={() => setCreating(false)}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={!newExam.exam_name || !newExam.subject_id}
              onClick={handleCreateExam}
            >
              Create
            </button>
          </>
        )}
      >
        {/*
          * WHY THIS IS NOT `.filters-row`
          * ------------------------------
          * It was. `.filters-row` is the horizontal filter bar shared by My
          * Classes, Students, Announcements and the rest, and it sets
          * `align-items: flex-end` to bottom-align controls of different
          * heights along a row. This dialog borrowed it and flipped the
          * direction to `column` with an inline style — which left
          * `flex-end` meaning RIGHT-align, so every field collapsed to its own
          * content width and stacked ragged against the right edge of the
          * modal. `.filter-field` also has `min-width: 190px` and no `width`,
          * and its controls never get `width: 100%`, so the date and number
          * inputs came out narrow and the selects came out as wide as their
          * longest option.
          *
          * `.modal-field` and `.modal-row-2` in Modal.css are the primitives
          * for exactly this and already stretch their controls to the field.
          * Announcements, Assignments, Profile and Users all use them; this
          * dialog was the only one that did not.
          */}
        <div className="modal-form">
          <DraftNotice
            draft={examDraft}
            online={online}
            onDiscard={() => setNewExam({
              exam_name: '',
              exam_type: 'Quiz',
              subject_id: '',
              exam_date: todayIso(),
              total_marks: 10,
            })}
            compact
          />

          <div className="modal-field">
            <label htmlFor="exam-subject">Subject</label>
            <select
              id="exam-subject"
              value={newExam.subject_id}
              onChange={(e) => setNewExam({ ...newExam, subject_id: e.target.value })}
            >
              <option value="">Select a subject</option>
              {subjectOptions.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          <div className="modal-field">
            <label htmlFor="exam-type">Type</label>
            <select
              id="exam-type"
              value={newExam.exam_type}
              onChange={(e) => setNewExam({ ...newExam, exam_type: e.target.value })}
            >
              {EXAM_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>

          <div className="modal-field">
            <label htmlFor="exam-name">Name</label>
            <input
              id="exam-name"
              value={newExam.exam_name}
              placeholder="e.g. Quiz 2 — Binary Trees"
              onChange={(e) => setNewExam({ ...newExam, exam_name: e.target.value })}
            />
          </div>

          {/* Paired because both hold a short value. Given a full row each they
              produced two mostly-empty fields and pushed Create below the fold
              on a laptop. */}
          <div className="modal-row-2">
            <div className="modal-field">
              <label htmlFor="exam-date">Date</label>
              <input
                id="exam-date"
                type="date"
                value={newExam.exam_date}
                onChange={(e) => setNewExam({ ...newExam, exam_date: e.target.value })}
              />
            </div>

            <div className="modal-field">
              <label htmlFor="exam-total">Total Marks</label>
              <input
                id="exam-total"
                type="number"
                min={1}
                value={newExam.total_marks}
                onChange={(e) => setNewExam({ ...newExam, total_marks: e.target.value })}
              />
            </div>
          </div>
        </div>
      </Modal>
      )}
    </Layout>
  );
}
