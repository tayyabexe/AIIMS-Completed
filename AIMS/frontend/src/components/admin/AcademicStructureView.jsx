import { useMemo, useState } from 'react';
import {
  Building2, GraduationCap, Layers, Users2, DoorOpen, CalendarRange, BookMarked,
  Plus, Pencil, Trash2, Archive, ArchiveRestore, Save, AlertTriangle,
} from 'lucide-react';
import {
  academics as academicsApi,
  departments as departmentsApi,
  programs as programsApi,
  batches as batchesApi,
  sections as sectionsApi,
  classrooms as classroomsApi,
  semesters as semestersApi,
  subjects as subjectsApi,
} from '../../api/endpoints';
import { useAdminPage } from '../../hooks/useAdminPage';
import { STALE } from '../../api/queryClient';
import FilterField from '../common/FilterField';
import Modal from '../common/Modal';
import DraftNotice from '../common/DraftNotice';
import ApiErrorNotice from '../common/ApiErrorNotice';
import useDraft, { useOnlineStatus } from '../../hooks/useDraft';
import RouteLoader from '../common/RouteLoader';

/*
 * The academic structure: departments, programmes, batches, sections, ROOMS and
 * semesters.
 *
 * WHY THESE SIX LIVE ON ONE SCREEN
 * --------------------------------
 * They are one tree. A programme belongs to a department, a batch to a
 * programme, a section to a batch; semesters are numbered within a programme and
 * rooms are what the timetable puts a section into. Editing any of them without
 * seeing the others is how a batch ends up under the wrong programme. Before
 * this screen existed there was no way to add a department or a room from the
 * portal at all, and semesters were read-only.
 *
 * "ROOMS", NOT "CLASSES"
 * ----------------------
 * The table is `classrooms` and it is the umbrella for every teaching space —
 * labs and lecture halls are both rooms. A *section* is the cohort
 * (BSCS-2022-CS-4A). Calling rooms "classes" conflates a place with a group of
 * people, and the timetable joins to both.
 *
 * ONE REQUEST, ONE SNAPSHOT
 * -------------------------
 * Everything is read from GET /api/academics/overview. Six separate requests
 * would not just be slower — they could disagree, because a write landing
 * between two of them leaves the batch count on one tab describing a different
 * moment from the section list on the next.
 *
 * DELETES ARE EXPECTED TO BE REFUSED
 * ----------------------------------
 * Every one of these rows is pointed at by others, so the server answers a
 * delete with 409 and a `blockedBy` array naming each obstacle — "340 students",
 * "3 programmes", "14 timetable slots". That list is the whole point of the
 * response and is rendered verbatim by ApiErrorNotice: "could not delete" with
 * the reasons stripped out leaves the admin nothing to do next.
 *
 * The counts on every row exist so that is foreseeable rather than discovered.
 */

const ACCENT = '#991b1b';

const card = {
  backgroundColor: '#FFFFFF', borderRadius: '14px', border: '1px solid #E2E8F0',
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};

const label = {
  fontSize: '0.75rem', fontWeight: 700, color: '#334155',
  display: 'block', marginBottom: '4px',
};

const input = {
  width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px',
  border: '1px solid #CBD5E1', fontSize: '0.875rem', outline: 'none',
  boxSizing: 'border-box', backgroundColor: '#FFFFFF', fontFamily: "'Inter', sans-serif",
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
  padding: variant === 'primary' ? '0.6rem 1.1rem' : '0.35rem 0.65rem',
  borderRadius: '8px', cursor: 'pointer',
  fontSize: variant === 'primary' ? '0.85rem' : '0.78rem', fontWeight: 700,
  transition: 'all 0.15s',
  ...(variant === 'primary'
    ? { border: 'none', backgroundColor: ACCENT, color: '#FFFFFF' }
    : variant === 'danger'
      ? { border: '1px solid #FCA5A5', backgroundColor: '#FEF2F2', color: '#DC2626' }
      : { border: '1px solid #CBD5E1', backgroundColor: '#F8FAFC', color: '#0F172A' }),
});

/*
 * The room-type vocabulary, mirroring backend/src/config/roomTypes.js.
 *
 * Both the room ("this is a lab") and the subject ("this needs a lab") are
 * drawn from the same list, because the scheduler compares them with plain
 * equality — a typo on either side does not fail, it just silently produces a
 * subject no room can host.
 */
const ROOM_TYPE_CHOICES = [
  { value: 'Lecture', text: 'Lecture room' },
  { value: 'Lab', text: 'Laboratory' },
  { value: 'Auditorium', text: 'Auditorium' },
  { value: 'Seminar', text: 'Seminar room' },
];

/*
 * How often a subject meets is NOT a field on this form.
 *
 * It is derived from credit_hours by the server — a period on this grid is 90
 * minutes, so one credit hour of weekly contact costs two thirds of a period —
 * and the derived number comes back on the row for display. The rule is stated
 * once, on the subject; a second place to enter it is a second place for it to
 * be wrong. See deriveSessionsPerWeek in backend/src/services/subjectService.js.
 */

/** A count that is zero is worth seeing as zero — it is what makes a row safe to delete. */
const Count = ({ n, word, tone = '#475569' }) => (
  <span style={{
    fontSize: '0.78rem', fontWeight: 600,
    color: Number(n) > 0 ? tone : '#CBD5E1',
    whiteSpace: 'nowrap',
  }}>
    {n} {word}{Number(n) === 1 ? '' : 's'}
  </span>
);

/*
 * The six resources, described rather than written out six times.
 *
 * What differs between them is only: which API, which columns, which fields the
 * form asks for, and which parent it hangs off. Everything else — the table, the
 * search, the create/edit dialog, the delete confirmation and the 409 handling —
 * is identical, and writing it six times is how six screens end up behaving six
 * ways.
 */
const RESOURCES = {
  departments: {
    label: 'Departments',
    singular: 'Department',
    icon: Building2,
    api: departmentsApi,
    // A department is the top of the tree, so there is nothing to hang it off.
    columns: (row) => [
      { key: 'name', node: <strong>{row.name}</strong> },
      { key: 'head', node: row.headName || <span style={{ color: '#CBD5E1' }}>No head assigned</span> },
      { key: 'counts', node: (
        <span style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
          <Count n={row.programCount} word="programme" />
          <Count n={row.employeeCount} word="employee" />
          <Count n={row.studentCount} word="student" />
        </span>
      ) },
    ],
    head: ['Department', 'Head', 'In use by'],
    fields: [
      { name: 'department_name', label: 'Department name', required: true },
      {
        name: 'head_employee_id',
        label: 'Head employee id (optional)',
        type: 'number',
        // Deliberately an id rather than a picker: `employees` has no admin list
        // endpoint yet, and inventing one here would mean shipping a dropdown of
        // every member of staff loaded on a screen that does not need it.
        hint: 'Leave blank for none. This is the employee_id from the staff record.',
      },
    ],
    toForm: (row) => ({
      department_name: row?.name ?? '',
      head_employee_id: row?.headEmployeeId ?? '',
    }),
  },

  programs: {
    label: 'Programmes',
    singular: 'Programme',
    icon: GraduationCap,
    api: programsApi,
    head: ['Programme', 'Department', 'Length', 'In use by'],
    columns: (row) => [
      { key: 'name', node: <strong>{row.name}</strong> },
      { key: 'dept', node: row.department || '—' },
      { key: 'len', node: `${row.durationSemesters} semesters` },
      { key: 'counts', node: (
        <span style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
          <Count n={row.batchCount} word="batch" />
          <Count n={row.semesterCount} word="semester" />
          <Count n={row.studentCount} word="student" />
        </span>
      ) },
    ],
    fields: [
      { name: 'program_name', label: 'Programme name', required: true },
      { name: 'department_id', label: 'Department', required: true, options: 'departments' },
      {
        name: 'duration_semesters',
        label: 'Length in semesters',
        type: 'number',
        required: true,
        hint: 'Shortening this is refused while semesters numbered above it still exist.',
      },
    ],
    toForm: (row) => ({
      program_name: row?.name ?? '',
      department_id: row?.departmentId ?? '',
      duration_semesters: row?.durationSemesters ?? 8,
    }),
  },

  batches: {
    label: 'Batches',
    singular: 'Batch',
    icon: Layers,
    api: batchesApi,
    head: ['Batch', 'Programme', 'Years', 'Currently in', 'In use by'],
    columns: (row) => [
      { key: 'name', node: <strong>{row.name}</strong> },
      { key: 'prog', node: row.program || '—' },
      { key: 'years', node: `${row.startYear ?? '—'} – ${row.endYear ?? '—'}` },
      {
        key: 'sem',
        // A batch has no semester column: its students carry it, so a cohort
        // that has split shows every semester it is spread across.
        node: row.currentSemesters?.length
          ? row.currentSemesters
            .map((s) => `Sem ${s.semesterNumber} (${s.studentCount})`)
            .join(', ')
          : <span style={{ color: '#CBD5E1' }}>—</span>,
      },
      { key: 'counts', node: (
        <span style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
          <Count n={row.sectionCount} word="section" />
          <Count n={row.studentCount} word="student" />
        </span>
      ) },
    ],
    fields: [
      { name: 'batch_name', label: 'Batch name', required: true, hint: 'e.g. BSCS-2022' },
      { name: 'program_id', label: 'Programme', required: true, options: 'programs' },
      { name: 'start_year', label: 'Start year', type: 'number', required: true },
      { name: 'end_year', label: 'End year', type: 'number', required: true },
    ],
    toForm: (row) => ({
      batch_name: row?.name ?? '',
      program_id: row?.programId ?? '',
      start_year: row?.startYear ?? new Date().getFullYear(),
      end_year: row?.endYear ?? new Date().getFullYear() + 4,
    }),
  },

  sections: {
    label: 'Sections',
    singular: 'Section',
    icon: Users2,
    api: sectionsApi,
    head: ['Section', 'Batch', 'Programme', 'Occupancy', 'In use by'],
    columns: (row) => [
      { key: 'name', node: <strong>{row.label || row.name}</strong> },
      { key: 'batch', node: row.batch || '—' },
      { key: 'prog', node: row.program || '—' },
      {
        key: 'cap',
        // Over-capacity is the fact this screen exists to surface: nothing else
        // in the portal ever compared a section's roll against the number the
        // room and timetable were planned around.
        node: row.capacity == null
          ? <span style={{ color: '#CBD5E1' }}>No capacity set</span>
          : (
            <span style={{
              fontWeight: 700, fontSize: '0.8rem',
              color: row.overCapacity ? '#DC2626' : '#059669',
            }}>
              {row.studentCount} / {row.capacity}
              {row.overCapacity
                ? ' — over capacity'
                : ` — ${row.seatsLeft} free`}
            </span>
          ),
      },
      { key: 'counts', node: <Count n={row.timetableCount} word="timetable slot" /> },
    ],
    fields: [
      { name: 'section_name', label: 'Section name', required: true, hint: 'e.g. CS-4A' },
      { name: 'batch_id', label: 'Batch', required: true, options: 'batches' },
      {
        name: 'capacity',
        label: 'Capacity',
        type: 'number',
        hint: 'Lowering it below the students already in the section is refused.',
      },
    ],
    toForm: (row) => ({
      section_name: row?.name ?? '',
      batch_id: row?.batchId ?? '',
      capacity: row?.capacity ?? '',
    }),
  },

  classrooms: {
    label: 'Rooms',
    singular: 'Room',
    icon: DoorOpen,
    api: classroomsApi,
    head: ['Room', 'Building', 'Type', 'Seats', 'In use by'],
    columns: (row) => [
      { key: 'name', node: <strong>{row.name}</strong> },
      { key: 'building', node: row.building || '—' },
      {
        key: 'type',
        /*
         * Worth a column of its own: the scheduler matches this against the
         * subject's required room type as a hard equality, so the type is what
         * decides which classes a room can ever host. A estate of nothing but
         * Lecture rooms — which is what the column's default quietly produces —
         * cannot run a single lab.
         */
        node: (
          <span style={{
            fontSize: '0.72rem', fontWeight: 800, color: '#3730A3',
            backgroundColor: '#EEF2FF', padding: '2px 8px', borderRadius: '6px',
          }}>
            {row.roomType || 'Lecture'}
          </span>
        ),
      },
      { key: 'cap', node: `${row.capacity} seats` },
      {
        key: 'counts',
        // Weekly bookings: the one number that says whether a room is actually
        // in service or just on the list.
        node: <Count n={row.timetableCount} word="weekly booking" />,
      },
    ],
    fields: [
      { name: 'room_name', label: 'Room name', required: true, hint: 'Labs and halls are rooms too.' },
      { name: 'building', label: 'Building', required: true },
      {
        name: 'room_type',
        label: 'Room type',
        required: true,
        // Every room is something — the column is NOT NULL — so there is no
        // blank option here, unlike a subject's optional requirement.
        choices: ROOM_TYPE_CHOICES,
        hint: 'A subject that requires a type can only be placed in a room of that exact type.',
      },
      { name: 'capacity', label: 'Seats', type: 'number', required: true },
    ],
    toForm: (row) => ({
      room_name: row?.name ?? '',
      building: row?.building ?? '',
      // A new room starts as a lecture room, matching the column's default, so
      // the required select is never blank.
      room_type: row?.roomType ?? 'Lecture',
      capacity: row?.capacity ?? '',
    }),
  },

  semesters: {
    label: 'Semesters',
    singular: 'Semester',
    icon: CalendarRange,
    api: semestersApi,
    head: ['Semester', 'Programme', 'Dates', 'State', 'In use by'],
    columns: (row) => [
      { key: 'num', node: <strong>{row.label}</strong> },
      { key: 'prog', node: row.program || '—' },
      {
        key: 'dates',
        node: `${String(row.startDate || '').slice(0, 10) || '—'} → ${String(row.endDate || '').slice(0, 10) || '—'}`,
      },
      {
        key: 'state',
        node: row.isArchived
          ? <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#92400E', backgroundColor: '#FEF3C7', padding: '2px 8px', borderRadius: '6px' }}>Archived</span>
          : <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#065F46', backgroundColor: '#D1FAE5', padding: '2px 8px', borderRadius: '6px' }}>Open</span>,
      },
      { key: 'counts', node: (
        <span style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
          <Count n={row.subjectCount} word="subject" />
          <Count n={row.enrollmentCount} word="enrolment" />
          <Count n={row.voucherCount} word="voucher" />
          <Count n={row.studentCount} word="student in it" />
        </span>
      ) },
    ],
    fields: [
      { name: 'program_id', label: 'Programme', required: true, options: 'programs' },
      {
        name: 'semester_number',
        label: 'Semester number',
        type: 'number',
        required: true,
        hint: 'Cannot exceed the length of the programme.',
      },
      { name: 'start_date', label: 'Start date', type: 'date', required: true },
      { name: 'end_date', label: 'End date', type: 'date', required: true },
    ],
    toForm: (row) => ({
      program_id: row?.programId ?? '',
      semester_number: row?.number ?? '',
      start_date: String(row?.startDate || '').slice(0, 10),
      end_date: String(row?.endDate || '').slice(0, 10),
    }),
  },
  /*
   * SUBJECTS — the curriculum.
   *
   * This tab is why a database could not be built from scratch through the
   * portal. POST /api/subjects has always existed and has always been guarded
   * like every other admin write, but nothing called it: every `subjectsApi`
   * reference in the front end was `.list()`, feeding dropdowns. So on an empty
   * database the curriculum was unreachable, and without subjects there are no
   * course offerings, no timetable, no attendance and no marks — the whole
   * academic cycle stopped at the third step.
   *
   * It belongs on this screen rather than its own, because a subject hangs off
   * a semester exactly as a section hangs off a batch. It is the same tree.
   */
  subjects: {
    label: 'Subjects',
    singular: 'Subject',
    icon: BookMarked,
    api: subjectsApi,
    head: ['Code', 'Subject', 'Programme · Semester', 'Credit', 'Room needed', 'In use by'],
    columns: (row) => [
      {
        key: 'code',
        node: <strong style={{ fontFamily: "'JetBrains Mono', monospace" }}>{row.code}</strong>,
      },
      { key: 'name', node: row.name },
      {
        key: 'sem',
        node: row.semesterLabel
          ? <span>{row.program || '—'} · {row.semesterLabel}</span>
          : <span style={{ color: '#CBD5E1' }}>No semester</span>,
      },
      {
        key: 'credit',
        // Credit hours and how often it meets, together — the second is derived
        // from the first, and showing them apart invites someone to "correct"
        // one of them.
        node: (
          <span style={{ whiteSpace: 'nowrap' }}>
            <strong>{row.creditHours}</strong> CH
            <span style={{ color: '#94A3B8', fontSize: '0.78rem' }}>
              {' '}· meets {row.sessionsPerWeek}&times;/wk
            </span>
          </span>
        ),
      },
      {
        key: 'room',
        node: row.requiredRoomType
          ? (
            <span style={{
              fontSize: '0.72rem', fontWeight: 800, color: '#3730A3',
              backgroundColor: '#EEF2FF', padding: '2px 8px', borderRadius: '6px',
            }}>
              {row.requiredRoomType}
            </span>
          )
          : <span style={{ color: '#CBD5E1', fontSize: '0.8rem' }}>Any room</span>,
      },
      {
        key: 'counts',
        node: (
          <span style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
            <Count n={row.offeringCount} word="class" />
            <Count n={row.enrollmentCount} word="enrolment" />
          </span>
        ),
      },
    ],
    fields: [
      { name: 'subject_code', label: 'Subject code', required: true, hint: 'e.g. CS-101. Must be unique.' },
      { name: 'subject_name', label: 'Subject name', required: true, hint: 'Must also be unique.' },
      { name: 'semester_id', label: 'Semester', required: true, options: 'semesters' },
      {
        name: 'credit_hours',
        label: 'Credit hours',
        type: 'number',
        required: true,
        hint: 'How often the class meets follows from this: 1–2 CH once a week, 3 CH twice, 4 CH three times.',
      },
      {
        name: 'required_room_type',
        label: 'Room required',
        nullable: true,
        choices: [
          { value: '', text: 'Any room will do' },
          ...ROOM_TYPE_CHOICES,
        ],
        hint: 'Matched exactly. Choosing Lab means only rooms typed Lab can host it.',
      },
    ],
    toForm: (row) => ({
      subject_code: row?.code ?? '',
      subject_name: row?.name ?? '',
      semester_id: row?.semesterId ?? '',
      credit_hours: row?.creditHours ?? '',
      required_room_type: row?.requiredRoomType ?? '',
    }),
  },
};

const TAB_ORDER = [
  'departments', 'programs', 'batches', 'sections', 'classrooms', 'semesters', 'subjects',
];

export default function AcademicStructureView() {
  const [tab, setTab] = useState('departments');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);  // null | { row } | { row: null } for new
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [pageError, setPageError] = useState(null);

  const { data, loading, error, refresh } = useAdminPage(() => academicsApi.overview(), {}, { key: 'academics-overview', staleTime: STALE.reference });

  const resource = RESOURCES[tab];
  const totals = data?.totals ?? {};

  const online = useOnlineStatus();

  /*
   * A half-filled department, programme, batch, section, room, semester or
   * subject survives a refresh.
   *
   * This screen is one dialog reused for seven different resources, so the key
   * has to carry the tab as well as the record. Without the tab, a draft
   * started on "subjects" would be offered back on "departments", where its
   * fields do not exist — the dialog would restore keys the form never renders
   * and silently post them.
   *
   * The record id is carried on an edit, per the announcements precedent, so a
   * draft for programme 3 can never load onto programme 4.
   */
  const draftKey = editing?.row
    ? `admin.academic.${tab}.${editing.row.id}`
    : `admin.academic.${tab}.new`;

  const draft = useDraft(draftKey, form, {
    enabled: !!editing,
    onRestore: setForm,
    /*
     * `resource.toForm(null)` seeds defaults for some resources, so an
     * untouched form is not an empty object. A draft is only worth keeping
     * once at least one field holds a non-blank value.
     */
    isEmpty: (value) => !value || !Object.values(value).some(
      (v) => v !== '' && v !== null && v !== undefined,
    ),
  });

  /*
   * The rows for the open tab, filtered here rather than on the server.
   *
   * Unusually for this portal, that is the right call: the whole structure is
   * already in memory — four departments, six programmes, six batches, eight
   * sections, five rooms, forty semesters — because it arrived as one overview
   * response. Round-tripping a substring match over forty rows would be slower
   * and could disagree with the counts drawn beside them.
   */
  const rows = useMemo(() => {
    const all = data?.[tab] ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;

    return all.filter((row) => Object.values(row)
      .filter((v) => typeof v === 'string' || typeof v === 'number')
      .some((v) => String(v).toLowerCase().includes(q)));
  }, [data, tab, search]);

  // Parent dropdowns are fed from the same snapshot, so a form can only ever
  // offer a parent that exists in the tree currently on screen.
  const optionsFor = (kind) => {
    const list = data?.[kind] ?? [];
    return list.map((r) => ({
      value: r.id,
      /*
       * Semesters carry no `name` — they are `label` ("Semester 3") plus the
       * programme they belong to. Reading `.name` gave every one of them a
       * blank option, and a programme's eight stages are indistinguishable
       * from each other without the programme named beside them anyway, since
       * five programmes each have a "Semester 3".
       */
      text: kind === 'semesters'
        ? [r.label, r.program].filter(Boolean).join(' · ') + (r.isArchived ? ' · past' : '')
        : kind === 'sections'
          ? (r.label || r.name)
          : r.name,
    }));
  };

  const openCreate = () => {
    setForm(resource.toForm(null));
    setFormError(null);
    setEditing({ row: null });
  };

  const openEdit = (row) => {
    setForm(resource.toForm(row));
    setFormError(null);
    setEditing({ row });
  };

  const closeForm = () => { setEditing(null); setFormError(null); };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    /*
     * Empty strings are dropped rather than sent: the API treats an explicit
     * null as "clear this" and an absent key as "leave it alone", and posting ''
     * for an untouched optional number is neither.
     *
     * The exception is a field marked `nullable`, where blank IS the answer —
     * "this room has no type". Dropping the key there would make a type
     * impossible to remove once set, because every edit would silently carry
     * the old value forward.
     */
    const nullable = new Set(
      resource.fields.filter((f) => f.nullable).map((f) => f.name),
    );

    /*
     * Compared on the TRIMMED value, so a box holding only spaces counts as
     * blank. It is not a hypothetical: the API client edge-trims the payload on
     * its way out, so "   " left in an optional number field would reach this
     * filter as non-empty, survive it, and then be sent as "" — the exact
     * value the filter exists to keep out.
     */
    const blank = (v) => v === '' || (typeof v === 'string' && v.trim() === '');

    const payload = Object.fromEntries(
      Object.entries(form)
        .filter(([k, v]) => v !== undefined && (!blank(v) || nullable.has(k)))
        .map(([k, v]) => [k, blank(v) ? null : v]),
    );

    try {
      if (editing.row) await resource.api.update(editing.row.id, payload);
      else await resource.api.create(payload);
      // Cleared only once the row exists on the server; a rejected save keeps
      // the draft so nothing typed is lost to a validation error.
      draft.clear();
      closeForm();
      refresh();
    } catch (err) {
      setFormError(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const target = confirmDelete;
    setPageError(null);

    try {
      await resource.api.remove(target.id);
      setConfirmDelete(null);
      refresh();
    } catch (err) {
      // A 409 with blockedBy is the expected answer here, not a malfunction, so
      // the dialog closes and the obstacle list is shown on the page where there
      // is room for it.
      setConfirmDelete(null);
      setPageError(err);
    }
  };

  /*
   * Archiving a semester.
   *
   * Offered beside the delete, and listed first in the dialog, because it is
   * almost always what is meant: `semesters` has no is_deleted column, so a
   * delete there is a real DELETE and the server refuses it while any subject,
   * enrolment, voucher or enrolled student still points at the term. Archiving
   * closes it reversibly and hides it from every dropdown in the portal.
   */
  const toggleArchive = async (row) => {
    setPageError(null);
    try {
      await semestersApi.update(row.id, { is_archived: row.isArchived ? 0 : 1 });
      refresh();
    } catch (err) {
      setPageError(err);
    }
  };

  if (loading && !data) {
    return (
      <RouteLoader
        label="Loading the academic structure…"
        hint="Departments, programmes, batches, sections, rooms and semesters with live counts"
      />
    );
  }

  if (error && !data) {
    return <ApiErrorNotice error={error} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header */}
      <div>
        <h2 style={{
          fontSize: '1.65rem', fontWeight: 800, color: '#0F172A', margin: 0,
          letterSpacing: '-0.02em', fontFamily: "'Outfit', sans-serif",
        }}>
          Academic Structure
        </h2>
        <p style={{ fontSize: '0.82rem', color: '#64748B', margin: '4px 0 0' }}>
          {totals.departments} departments · {totals.programs} programmes ·{' '}
          {totals.batches} batches · {totals.sections} sections ·{' '}
          {totals.classrooms} rooms · {totals.semesters} semesters ·{' '}
          {totals.subjects} subjects
        </p>
      </div>

      {/* Institute-wide tiles. `unsectionedStudents` is here rather than on the
          Students screen because this is the only screen that can fix it: a
          student with no section is invisible on every section-shaped view in
          the portal. */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.85rem',
      }}>
        {[
          ['Students', totals.students, `${totals.activeStudents} active`],
          ['Teachers', totals.teachers, 'on the faculty'],
          ['Sections', totals.sections, `across ${totals.batches} batches`],
          ['Unplaced students', totals.unsectionedStudents, 'no section at all', totals.unsectionedStudents > 0],
        ].map(([title, value, hint, warn]) => (
          <div key={title} style={{ ...card, padding: '1rem 1.1rem' }}>
            <p style={{
              fontSize: '0.7rem', fontWeight: 700, color: '#64748B', margin: 0,
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              {title}
            </p>
            <p style={{
              fontSize: '1.6rem', fontWeight: 800, margin: '2px 0 0',
              color: warn ? '#DC2626' : '#0F172A', fontFamily: "'Outfit', sans-serif",
            }}>
              {Number(value ?? 0).toLocaleString()}
            </p>
            <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: 0 }}>{hint}</p>
          </div>
        ))}
      </div>

      <ApiErrorNotice error={pageError} onDismiss={() => setPageError(null)} />

      {/* Tabs */}
      <div style={{ ...card, padding: '1.1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', borderBottom: '1px solid #E2E8F0', paddingBottom: '0.85rem' }}>
          {TAB_ORDER.map((key) => {
            const r = RESOURCES[key];
            const Icon = r.icon;
            const active = key === tab;
            return (
              <button
                key={key}
                onClick={() => { setTab(key); setSearch(''); setPageError(null); }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '0.45rem 0.85rem', borderRadius: '9px', cursor: 'pointer',
                  fontSize: '0.82rem', fontWeight: 700,
                  border: `1px solid ${active ? ACCENT : '#E2E8F0'}`,
                  backgroundColor: active ? '#FEF2F2' : '#FFFFFF',
                  color: active ? ACCENT : '#475569',
                }}
              >
                <Icon size={15} />
                {r.label}
                <span style={{ fontWeight: 600, opacity: 0.65 }}>
                  {(data?.[key] ?? []).length}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
          <FilterField
            value={search}
            onChange={setSearch}
            placeholder={`Filter ${resource.label.toLowerCase()} by any column shown in the table below…`}
            style={{ flex: '1 1 260px' }}
          />
          <button type="button" onClick={openCreate} style={btn('primary')}>
            <Plus size={16} /> Add {resource.singular.toLowerCase()}
          </button>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {resource.head.map((h) => <th key={h} style={th}>{h}</th>)}
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={resource.head.length + 1} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: '2.5rem' }}>
                    {search
                      ? `No ${resource.label.toLowerCase()} match “${search}”.`
                      : `No ${resource.label.toLowerCase()} yet.`}
                  </td>
                </tr>
              ) : rows.map((row) => (
                <tr key={row.id}>
                  {resource.columns(row).map((c) => <td key={c.key} style={td}>{c.node}</td>)}
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {tab === 'semesters' && (
                      <button
                        type="button"
                        onClick={() => toggleArchive(row)}
                        title={row.isArchived ? 'Reopen this semester' : 'Archive this semester'}
                        style={{ ...btn(), marginRight: '6px' }}
                      >
                        {row.isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                        {row.isArchived ? 'Reopen' : 'Archive'}
                      </button>
                    )}
                    <button type="button" onClick={() => openEdit(row)} style={{ ...btn(), marginRight: '6px' }}>
                      <Pencil size={14} color={ACCENT} /> Edit
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(row)} style={btn('danger')}>
                      <Trash2 size={14} /> Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Create / edit ── */}
      <Modal
        open={!!editing}
        title={`${editing?.row ? 'Edit' : 'Add'} ${resource.singular.toLowerCase()}`}
        icon={editing?.row ? Pencil : Plus}
        onClose={closeForm}
      >
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <ApiErrorNotice error={formError} />
          <DraftNotice
            draft={draft}
            online={online}
            onDiscard={() => setForm(resource.toForm(editing?.row ?? null))}
            compact
          />

          {resource.fields.map((field) => (
            <div key={field.name}>
              <label style={label}>
                {field.label}{field.required ? ' *' : ''}
              </label>

              {(field.options || field.choices) ? (
                <select
                  value={form[field.name] ?? ''}
                  onChange={(e) => setForm({ ...form, [field.name]: e.target.value })}
                  required={field.required}
                  style={input}
                >
                  {/* `choices` carries its own empty option when blank is a real
                      answer (a room with no type recorded), so it is not given
                      the generic "Choose…" prompt that reads as "not yet
                      answered". */}
                  {!field.choices && <option value="">Choose…</option>}
                  {(field.choices
                    ? field.choices
                    : optionsFor(field.options)
                  ).map((o) => (
                    <option key={o.value} value={o.value}>{o.text}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type || 'text'}
                  value={form[field.name] ?? ''}
                  onChange={(e) => setForm({ ...form, [field.name]: e.target.value })}
                  required={field.required}
                  style={input}
                />
              )}

              {field.hint && (
                <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: '4px 0 0' }}>{field.hint}</p>
              )}
            </div>
          ))}
        </form>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button type="button" onClick={closeForm} style={{ ...btn(), padding: '0.6rem 1.2rem' }}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving} style={{ ...btn('primary'), opacity: saving ? 0.7 : 1 }}>
            <Save size={16} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Modal>

      {/* ── Delete confirmation ── */}
      <Modal
        open={!!confirmDelete}
        title={`Delete this ${resource.singular.toLowerCase()}?`}
        icon={AlertTriangle}
        onClose={() => setConfirmDelete(null)}
        onBackdropClose={() => setConfirmDelete(null)}
        width="460px"
      >
        <p style={{ fontSize: '0.88rem', color: '#475569', margin: 0, lineHeight: 1.55 }}>
          <strong>{confirmDelete?.label || confirmDelete?.name}</strong> will be removed.
          {' '}
          {tab === 'semesters'
            /* Said plainly here because it is the one tab where the word means
               something different: `semesters` has no soft-delete column. */
            ? 'A semester is deleted outright — this table has no undo. Archive it instead if you only want it closed.'
            : 'It is soft-deleted, so the row is kept in the database and hidden from the portal.'}
        </p>
        <p style={{ fontSize: '0.8rem', color: '#94A3B8', margin: '0.6rem 0 0' }}>
          If anything still points at it, the server will refuse and tell you what.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button type="button" onClick={() => setConfirmDelete(null)} style={{ ...btn(), padding: '0.6rem 1.2rem' }}>
            Cancel
          </button>
          <button type="button" onClick={remove} style={{ ...btn('primary'), backgroundColor: '#DC2626' }}>
            <Trash2 size={16} /> Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
