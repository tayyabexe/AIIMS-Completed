import { useEffect, useMemo, useState } from 'react';
import {
  BookMarked, Search, Save, Check, ChevronRight, Lock,
  CheckCircle2, Undo2, ArrowRight,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  teacherSubjects as registryApi,
  subjects as subjectsApi,
  semesters as semestersApi,
} from '../../api/endpoints';
import { useAdminPage } from '../../hooks/useAdminPage';
import { STALE } from '../../api/queryClient';
import useDraft, { useOnlineStatus } from '../../hooks/useDraft';
import ApiErrorNotice from '../common/ApiErrorNotice';
import DraftNotice from '../common/DraftNotice';
import { ProgressRibbon, Stamp, SkeletonLine, RailSkeleton } from './timetable/parts';

/*
 * The qualification registry — which subjects each teacher may teach.
 *
 * WHY THIS SCREEN EXISTS
 * ----------------------
 * `teacher_subjects` has been in the schema since the beginning and had
 * endpoints since the beginning, but **no screen in the portal ever called
 * them** — grepped, zero references. So the only rows in it were whatever the
 * provisioning service happened to insert when an account was created, and a
 * teacher hired afterwards had none.
 *
 * That is not a cosmetic gap. This table is what sorts the "Recorded as
 * qualified" shortlist in the timetable module's staffing dialog. A teacher
 * with no rows is filed under "everyone else" for every class in the
 * institute, permanently, with nothing anywhere able to correct it. Three of
 * the twenty-four teachers here are in exactly that state.
 *
 * WHAT A QUALIFICATION IS, AND IS NOT
 * -----------------------------------
 *   qualification  "Dr Anwar MAY teach CS-501"                teacher_subjects
 *   assignment     "Dr Anwar TEACHES CS-501 to CS-5A,
 *                   Fall 2026"                                course_offerings
 *
 * The first is a standing fact about a person — no term, no section, and since
 * migration `…140000` no batch either. Competence to teach Computer Networks
 * does not expire when a new intake arrives.
 *
 * THE SHAPE OF THE SCREEN
 * -----------------------
 * A 340px queue rail of teachers against a dominant board, the same
 * proportion the timetable screen uses and for the same reason: the list
 * serves the editor, and the widths say so.
 *
 * The rail sorts **teachers with nothing recorded first**, stamped. That is
 * the work — finding three of twenty-four by eye is precisely the sort of
 * thing that gets skipped — and it follows the system's rule that absence is
 * the "done" signal, so the other twenty-one carry no stamp at all.
 *
 * The board is the selected teacher's curriculum tree: programme → semester →
 * subjects. Two hundred subjects as a flat checkbox list is not a usable
 * control; the grouping is what makes it one. Programmes are collapsed by
 * default, with the teacher's own department's programmes opened, because a
 * Software Engineering lecturer should not have to scroll past BBA to reach
 * their own curriculum.
 *
 * THE LOOK
 * --------
 * Indigo glass — the direction the Ask the Data page established, now shared
 * with the timetable module. See styles/indigo-glass.css and
 * .interface-design/system.md. The command band is the frosted panel with
 * light drifting behind it; rows arrive in sequence; the wait is a skeleton
 * shaped like the screen rather than a spinner.
 *
 * ONE SAVE, NOT ONE REQUEST PER TICK
 * ----------------------------------
 * Ticking five boxes fires nothing. `setForTeacher` replaces the whole set in
 * one transaction, which is what makes a half-applied set impossible — and a
 * half-applied set is the realistic failure here, because the server refuses
 * to remove a qualification the teacher is currently teaching against. Five
 * separate requests would land four and refuse the fifth, leaving the registry
 * in a state nobody chose and the screen unable to say which half applied.
 */

/* The registry has exactly two states and they are the whole summary. */
const SEGMENTS = {
  unrecorded: { label: 'not recorded', colour: 'var(--stamp-void)' },
  recorded:   { label: 'recorded',     colour: 'var(--stamp-clear)' },
};

export default function TeacherQualifications() {
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);

  /*
   * The whole registry in one request — twenty-four people with their subjects
   * nested inside them.
   *
   * The server also implements `q` and `unqualified_only`, and this screen
   * deliberately does not use them. Both filters would narrow the *response*,
   * and the response is also where the summary comes from: filtering to the
   * unrecorded server-side would make the ribbon report "3 of 3" and the
   * screen would lose the one number it exists to move. The timetable screen
   * has the same shape for the same reason — one unfiltered fetch, filtered in
   * the client. The search below reproduces the server's `q` exactly,
   * including matching on subject code, because the subjects are already here.
   */
  const registryQuery = useAdminPage(() => registryApi.list(), {}, { key: 'qualification-registry' });

  /*
   * The curriculum, assembled from the two endpoints that own its halves:
   * subjects carry a semester_id and nothing else, semesters carry the
   * programme and the stage number.
   *
   * `include_archived=1` is not optional. Eleven of the forty stages are
   * archived — the early semesters of every programme — and they hold
   * fifty-five real subjects that people are qualified to teach. Hiding them
   * would silently remove a quarter of the catalogue from a screen whose whole
   * job is to record the catalogue.
   */
  const catalogueQuery = useAdminPage(
    () => Promise.all([
      subjectsApi.list(),
      semestersApi.list({ include_archived: 1 }),
    ]).then(([subjectRes, semesterRes]) => ({ subjectRes, semesterRes })),
    {}, { key: 'subject-catalogue', staleTime: STALE.reference });

  const teachers = useMemo(() => {
    const list = registryQuery.data?.data ?? [];
    /*
     * Unrecorded first, then by name inside each group. The server orders by
     * name alone; this is the sort that makes the screen's purpose visible on
     * opening it.
     */
    return [...list].sort((a, b) => {
      const aEmpty = a.subjects.length === 0;
      const bEmpty = b.subjects.length === 0;
      if (aEmpty !== bEmpty) return aEmpty ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [registryQuery.data]);

  const catalogue = useMemo(() => {
    const subjectRows = catalogueQuery.data?.subjectRes?.data ?? [];
    const semesterRows = catalogueQuery.data?.semesterRes?.data ?? [];
    if (!subjectRows.length || !semesterRows.length) return [];

    const byStage = new Map();
    for (const s of subjectRows) {
      const list = byStage.get(s.semester_id) || [];
      list.push(s);
      byStage.set(s.semester_id, list);
    }

    const byProgramme = new Map();
    for (const stage of semesterRows) {
      const subjects = (byStage.get(stage.semesterId) || [])
        .slice()
        .sort((a, b) => String(a.subject_code).localeCompare(String(b.subject_code)));

      // A stage with no subjects is a row that can never be ticked. Dropping
      // it keeps the tree to things that are actually decisions.
      if (!subjects.length) continue;

      const key = stage.programId;
      if (!byProgramme.has(key)) {
        byProgramme.set(key, {
          program_id: stage.programId,
          program_name: stage.program || 'Unassigned programme',
          department_id: stage.departmentId ?? null,
          department_name: stage.department || null,
          stages: [],
          total: 0,
        });
      }

      const programme = byProgramme.get(key);
      programme.stages.push({
        semester_id: stage.semesterId,
        number: stage.number,
        archived: stage.isArchived,
        subjects,
      });
      programme.total += subjects.length;
    }

    const programmes = [...byProgramme.values()];
    for (const p of programmes) p.stages.sort((a, b) => a.number - b.number);
    return programmes.sort((a, b) => a.program_name.localeCompare(b.program_name));
  }, [catalogueQuery.data]);

  const teacher = useMemo(
    () => teachers.find((t) => t.teacher_id === selected) ?? null,
    [teachers, selected],
  );

  /* What the database currently holds for this teacher. */
  const recorded = useMemo(() => {
    const map = new Map();
    for (const s of teacher?.subjects ?? []) map.set(s.subject_id, s);
    return map;
  }, [teacher]);

  /*
   * The ticked set. `null` means "unedited", and is deliberately not seeded
   * from `recorded` on selection: keeping the two distinct is what lets the
   * screen tell an unsaved change from a saved one without diffing on every
   * render, and what makes a refresh after saving reset the editor for free.
   */
  const ticked = useMemo(
    () => draft ?? new Set(recorded.keys()),
    [draft, recorded],
  );

  const added = useMemo(
    () => [...ticked].filter((id) => !recorded.has(id)),
    [ticked, recorded],
  );
  const removed = useMemo(
    () => [...recorded.keys()].filter((id) => !ticked.has(id)),
    [ticked, recorded],
  );
  const dirty = added.length > 0 || removed.length > 0;

  const online = useOnlineStatus();

  /*
   * An unsaved set of ticks survives a refresh.
   *
   * Nothing is typed here, but the loss is the same kind: working through a
   * catalogue of programmes and stages to decide what one teacher is qualified
   * to take is a series of judgements, and the screen already treats abandoning
   * it as serious enough to warrant a confirm() when another teacher is picked.
   * That guard does not fire on a refresh, a crash, or a discarded tab, which
   * is what this covers.
   *
   * Persisted as an ARRAY. `ticked` is a Set, and JSON.stringify turns a Set
   * into `{}` — the draft would round-trip as an empty object and silently
   * untick everything on restore.
   *
   * Only the EDITED set is written, never the baseline: `draft` is null until
   * something is toggled, so opening a teacher and reading their record leaves
   * nothing behind.
   */
  const draftKey = `admin.qualifications.${selected ?? 'none'}`;

  const tickDraft = useDraft(
    draftKey,
    draft ? [...draft] : null,
    {
      enabled: !!selected,
      onRestore: (value) => {
        if (Array.isArray(value)) setDraft(new Set(value));
      },
      isEmpty: (value) => !Array.isArray(value),
    },
  );

  /*
   * Opening a teacher opens their own department's programmes.
   *
   * Five collapsed headers is an honest but unhelpful first frame — the
   * registrar's next click is always the same one. Programmes where they
   * already hold something are opened too, so an existing record is never
   * hidden behind a chevron, and the first programme is the fallback so the
   * board is never blank.
   */
  useEffect(() => {
    if (!teacher || !catalogue.length) return;

    const held = new Set((teacher.subjects ?? []).map((s) => s.program_id));
    const next = new Set(
      catalogue
        .filter((p) => held.has(p.program_id)
          || (teacher.department_id != null && p.department_id === teacher.department_id))
        .map((p) => p.program_id),
    );

    if (!next.size) next.add(catalogue[0].program_id);
    setOpen(next);
  }, [teacher, catalogue]);

  /* Selecting somebody else abandons an unsaved edit; say so before it goes. */
  const selectTeacher = (id) => {
    if (id === selected) return;
    if (dirty && !window.confirm(
      `${teacher.name} has unsaved changes (${changeSummary(added, removed)}). `
      + 'Leaving now discards them.',
    )) return;

    // The confirm() above has already been answered, so this is a deliberate
    // discard — the stored draft must go with the in-memory one, or it would be
    // offered straight back when this teacher is next opened.
    tickDraft.clear();
    setSelected(id);
    setDraft(null);
    setActionError(null);
    setNotice(null);
  };

  const toggle = (subjectId) => {
    setDraft(() => {
      const next = new Set(ticked);
      if (next.has(subjectId)) next.delete(subjectId);
      else next.add(subjectId);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setActionError(null);
    setNotice(null);

    try {
      const result = await registryApi.setForTeacher(teacher.teacher_id, [...ticked]);
      // Back to "unedited" — the refreshed rows become the new baseline.
      tickDraft.clear();
      setDraft(null);
      registryQuery.refresh();
      setNotice(result?.message ?? 'Qualifications saved.');
    } catch (error) {
      setActionError(error);
    } finally {
      setBusy(false);
    }
  };

  const rows = useMemo(() => {
    let list = teachers;

    if (stateFilter === 'unrecorded') list = list.filter((t) => !t.subjects.length);
    if (stateFilter === 'recorded') list = list.filter((t) => t.subjects.length > 0);

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((t) => [
        t.name, t.specialization, t.employee_code, t.designation, t.department_name,
        ...t.subjects.flatMap((s) => [s.subject_code, s.subject_name]),
      ].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
    }

    return list;
  }, [teachers, stateFilter, search]);

  const unrecordedCount = teachers.filter((t) => !t.subjects.length).length;
  const totalRecorded = teachers.reduce((n, t) => n + t.subjects.length, 0);

  /*
   * The next person with nothing recorded, so working through the backlog is
   * one click rather than a hunt back up a list that has just re-sorted
   * underneath the save.
   */
  const nextUnrecorded = teachers.find(
    (t) => !t.subjects.length && t.teacher_id !== selected,
  ) ?? null;

  /*
   * The wait, shaped like the screen it becomes: a band, a rail of rows, a
   * board. A centred spinner here would have said "something is happening"
   * and nothing else; this says what is coming and where it will be, so the
   * eye is already in the right place when the rows land.
   */
  if (registryQuery.loading && !teachers.length) {
    return <RegistrySkeleton />;
  }

  if (registryQuery.error) return <ApiErrorNotice error={registryQuery.error} />;

  const segments = [
    { key: 'unrecorded', ...SEGMENTS.unrecorded, value: unrecordedCount },
    { key: 'recorded', ...SEGMENTS.recorded, value: teachers.length - unrecordedCount },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-3">

        {/* =========================================== the command band
          *
          * The same 48px sticky band as the timetable screen. It holds what is
          * only ever read or switched — how much of the registry is done, and
          * the filter that is the same question asked the other way round.
          */}
        {/*
          * `ig-band` supplies the frosted background and the two drifting
          * discs behind it, so this element carries no bg-* utility of its
          * own - the stylesheet rule is unlayered and would win anyway, and
          * two sources for one background is how they drift apart.
          */}
        <div className="ig-band sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-ledger-rule px-3 py-2 shadow-[var(--lift)]">
          <div className="flex min-w-0 items-center gap-2">
            <BookMarked className="size-4 shrink-0 text-crest" strokeWidth={2} />
            <h2 className="whitespace-nowrap text-[0.86rem] font-bold tracking-[-0.01em] text-ink">
              Qualification registry
            </h2>
          </div>

          {teachers.length > 0 && (
            <>
              <BandRule />
              <ProgressRibbon segments={segments} active={stateFilter} onSelect={setStateFilter} />
              <span className="ig-tnum hidden whitespace-nowrap text-[0.72rem] text-ink-tertiary xl:inline">
                <span className="font-bold text-ink-secondary">{totalRecorded}</span>
                {' qualification'}{totalRecorded === 1 ? '' : 's'} recorded
              </span>
            </>
          )}

          {/*
            * What this registry is for, stated where it is edited. Without it
            * the screen is a grid of tick boxes whose consequence — the
            * staffing shortlist on another screen entirely — is invisible.
            */}
          <p className="ml-auto hidden max-w-[38ch] text-pretty text-right text-[0.72rem] leading-snug text-ink-muted 2xl:block">
            This is what sorts the shortlist when a class is staffed on the
            timetable. It is not a permission — anyone can still be assigned.
          </p>
        </div>

        {actionError && (
          <div className="ig-rise">
            <ApiErrorNotice error={actionError} onDismiss={() => setActionError(null)} />
          </div>
        )}

        {selected && (
          <DraftNotice
            draft={tickDraft}
            online={online}
            onDiscard={() => setDraft(null)}
            compact
          />
        )}

        {notice && (
          <div className="ig-rise flex items-start justify-between gap-4 rounded-card border border-stamp-clear/25 bg-stamp-clear-wash px-4 py-2.5">
            <p className="flex items-start gap-2 text-[0.84rem] text-stamp-clear">
              <CheckCircle2 className="mt-px size-4 shrink-0" strokeWidth={2} />
              {notice}
            </p>

            <div className="flex shrink-0 items-center gap-3">
              {nextUnrecorded && (
                <button
                  type="button"
                  onClick={() => selectTeacher(nextUnrecorded.teacher_id)}
                  className="ig-press flex items-center gap-1 rounded-control px-1 text-[0.76rem] font-semibold text-stamp-clear hover:underline"
                >
                  Next unrecorded: {nextUnrecorded.name}
                  <ArrowRight className="size-3.5" strokeWidth={2} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="ig-press shrink-0 rounded-control px-1 text-[0.76rem] font-semibold text-stamp-clear/80 hover:text-stamp-clear"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-[340px_minmax(0,1fr)]">

          {/* ================================================ the queue rail */}
          <aside className="flex max-h-[calc(100vh-140px)] flex-col self-start overflow-hidden rounded-card border border-ledger-rule bg-card">
            <div className="shrink-0 border-b border-ledger-rule p-2">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted"
                  strokeWidth={2}
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, specialization, subject code…"
                  aria-label="Filter faculty"
                  className="h-8 w-full rounded-control border border-ledger-rule-firm bg-ledger-sunk pl-8 pr-2 text-[0.8rem] text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </div>

              <p className="ig-tnum mt-1.5 flex items-center justify-between px-0.5 text-[0.7rem] text-ink-tertiary">
                <span>
                  {rows.length === teachers.length
                    ? `${rows.length} teacher${rows.length === 1 ? '' : 's'}`
                    : `${rows.length} of ${teachers.length}`}
                </span>
                {(stateFilter || search) && (
                  <button
                    type="button"
                    onClick={() => { setStateFilter(''); setSearch(''); }}
                    className="ig-press rounded-control px-1 font-semibold text-ink-secondary hover:text-ink"
                  >
                    Clear
                  </button>
                )}
              </p>
            </div>

            <ul className="min-h-0 flex-1 divide-y divide-ledger-rule overflow-y-auto">
              {rows.map((t, i) => {
                const isSelected = t.teacher_id === selected;
                const empty = t.subjects.length === 0;

                return (
                  /*
                    * Rows arrive in sequence, capped at twelve. Past that the
                    * last row would be waiting on an animation rather than on
                    * data, which is the opposite of the intended impression.
                    */
                  <li key={t.teacher_id} className="ig-rise" style={{ '--i': Math.min(i, 12) }}>
                    <button
                      type="button"
                      onClick={() => selectTeacher(t.teacher_id)}
                      aria-current={isSelected ? 'true' : undefined}
                      className={cn(
                        'ig-press flex w-full flex-col gap-1 px-3 py-2 text-left',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40',
                        isSelected
                          ? 'bg-crest-wash shadow-[inset_3px_0_0_var(--crest)]'
                          : 'hover:bg-ledger-sunk',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[0.84rem] font-bold text-ink">{t.name}</span>

                        {/*
                          * A teacher who has subjects recorded gets no stamp —
                          * they are done. The count alone says how many, and
                          * absence says the row needs nothing.
                          */}
                        {empty
                          ? <Stamp tone="void" className="shrink-0">not recorded</Stamp>
                          : (
                            <span className="ig-tnum shrink-0 text-[0.7rem] font-semibold text-ink-secondary">
                              {t.subjects.length}
                            </span>
                          )}
                      </div>

                      <span className="truncate text-[0.73rem] text-ink-tertiary">
                        {[t.designation, t.specialization].filter(Boolean).join(' · ')
                          || t.department_name
                          || 'Faculty'}
                      </span>
                    </button>
                  </li>
                );
              })}

              {!rows.length && (
                <li className="px-4 py-10 text-center text-[0.82rem] text-ink-tertiary">
                  {teachers.length
                    ? 'No teacher matches that filter.'
                    : 'No faculty on record.'}
                </li>
              )}
            </ul>
          </aside>

          {/* ==================================================== the board */}
          {!teacher ? (
            <NothingSelected
              unrecorded={unrecordedCount}
              total={teachers.length}
              onPick={() => {
                const first = teachers.find((t) => !t.subjects.length) ?? teachers[0];
                if (first) selectTeacher(first.teacher_id);
              }}
            />
          ) : (
            <section className="ig-rise flex max-h-[calc(100vh-140px)] flex-col overflow-hidden rounded-card border border-ledger-rule bg-card shadow-[var(--lift)]">

              {/* ------------------------------------------ who, and one save */}
              <header className="shrink-0 border-b border-ledger-rule px-3 py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-[1rem] font-bold tracking-[-0.01em] text-ink">
                      {teacher.name}
                    </h3>
                    <p className="mt-0.5 truncate text-[0.76rem] text-ink-tertiary">
                      {[teacher.designation, teacher.specialization, teacher.department_name]
                        .filter(Boolean).join(' · ')}
                      {teacher.employee_code && (
                        <span className="ig-tnum text-ink-muted"> · {teacher.employee_code}</span>
                      )}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {/*
                      * The pending change, spelled out. A Save button that is
                      * merely enabled says something changed; it does not say
                      * what, and on a tree where most of it is scrolled out of
                      * sight that is the difference between saving and hoping.
                      */}
                    <span className="ig-tnum text-[0.74rem] text-ink-tertiary">
                      {dirty
                        ? <span className="font-semibold text-stamp-pending">{changeSummary(added, removed)}</span>
                        : <>{ticked.size} subject{ticked.size === 1 ? '' : 's'}</>}
                    </span>

                    {dirty && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ig-press h-8"
                        disabled={busy}
                        onClick={() => setDraft(null)}
                      >
                        <Undo2 className="size-3.5" strokeWidth={2} /> Revert
                      </Button>
                    )}

                    <Button
                      size="sm"
                      className="ig-press h-8"
                      disabled={!dirty || busy}
                      onClick={save}
                    >
                      <Save className="size-3.5" strokeWidth={2} />
                      {busy ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </div>
              </header>

              {catalogueQuery.error && (
                <div className="p-3"><ApiErrorNotice error={catalogueQuery.error} /></div>
              )}

              {catalogueQuery.loading && !catalogue.length && <CatalogueSkeleton />}

              {/* -------------------------------- programme → semester → subject */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {catalogue.map((programme) => {
                  const isOpen = open.has(programme.program_id);
                  const heldHere = programme.stages.reduce(
                    (n, stage) => n + stage.subjects.filter((s) => ticked.has(s.subject_id)).length,
                    0,
                  );

                  return (
                    <div key={programme.program_id} className="border-b border-ledger-rule last:border-b-0">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setOpen((prev) => {
                          const next = new Set(prev);
                          if (next.has(programme.program_id)) next.delete(programme.program_id);
                          else next.add(programme.program_id);
                          return next;
                        })}
                        className={cn(
                          'ig-press flex w-full items-center gap-2 px-3 py-2 text-left',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40',
                          isOpen ? 'bg-ledger-sunk' : 'hover:bg-ledger-sunk',
                        )}
                      >
                        <ChevronRight
                          className={cn(
                            'size-3.5 shrink-0 text-ink-tertiary transition-transform duration-150',
                            isOpen && 'rotate-90',
                          )}
                          strokeWidth={2.5}
                        />
                        <span className="truncate text-[0.82rem] font-bold text-ink">
                          {programme.program_name}
                        </span>

                        {/*
                          * The count is the reason to open a programme, so it
                          * is on the closed header. Zero is drawn muted rather
                          * than suppressed — "nothing here" is the answer on a
                          * screen about what is missing.
                          */}
                        <span
                          className={cn(
                            'ig-tnum ml-auto shrink-0 text-[0.72rem]',
                            heldHere ? 'font-semibold text-ink-secondary' : 'text-ink-muted',
                          )}
                        >
                          {heldHere} of {programme.total}
                        </span>
                      </button>

                      {isOpen && programme.stages.map((stage) => {
                        const heldInStage = stage.subjects.filter((s) => ticked.has(s.subject_id)).length;

                        return (
                          <div key={stage.semester_id} className="border-t border-ledger-rule">
                            <div className="flex items-center gap-2 px-3 py-1.5 pl-8">
                              <span className="ig-tnum text-[0.7rem] font-bold uppercase tracking-[0.05em] text-ink-secondary">
                                Semester {stage.number}
                              </span>
                              {/*
                                * An archived stage is still a real subject
                                * somebody teaches; it is marked, not hidden.
                                * Same treatment the semester picker gives it.
                                */}
                              {stage.archived && (
                                <span className="text-[0.68rem] text-ink-muted">· past</span>
                              )}
                              <span
                                className={cn(
                                  'ig-tnum ml-auto text-[0.7rem]',
                                  heldInStage ? 'font-semibold text-ink-secondary' : 'text-ink-muted',
                                )}
                              >
                                {heldInStage} of {stage.subjects.length}
                              </span>
                            </div>

                            <ul className="pb-1.5 pl-6 pr-2">
                              {stage.subjects.map((subject) => (
                                <SubjectToggle
                                  key={subject.subject_id}
                                  subject={subject}
                                  teacherName={teacher.name}
                                  on={ticked.has(subject.subject_id)}
                                  changed={added.includes(subject.subject_id)
                                    || removed.includes(subject.subject_id)}
                                  held={recorded.get(subject.subject_id) ?? null}
                                  onToggle={() => toggle(subject.subject_id)}
                                />
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

/* "+3 / −1", the shortest honest description of a pending save. */
function changeSummary(added, removed) {
  return [
    added.length ? `+${added.length}` : null,
    removed.length ? `−${removed.length}` : null,
  ].filter(Boolean).join(' / ');
}

// =====================================================================
// ONE SUBJECT
// =====================================================================
/*
 * A tick box that is a real one — `role="checkbox"` with `aria-checked`, so
 * Space toggles it and a screen reader announces its state. The custom mark
 * exists because the crest carries it: on a scrolling tree of forty rows, the
 * ticks are what the eye is counting, and that is the same job the crest does
 * on the timetable grid ("this period is booked"). Everything else on the row
 * stays in the ink family.
 *
 * A subject the teacher is CURRENTLY TEACHING cannot be unticked, because the
 * server refuses it — the registry is not allowed to contradict the timetable.
 * So the control is disabled with the reason in a tooltip rather than left
 * clickable, exactly as PlacementGrid handles a period that has attendance
 * against it. Offering a control that is guaranteed to fail is worse than
 * offering none.
 */
function SubjectToggle({ subject, teacherName, on, changed, held, onToggle }) {
  const teaching = Number(held?.teaching_now) || 0;
  const locked = on && teaching > 0;

  const row = (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={locked}
      onClick={locked ? undefined : onToggle}
      className={cn(
        'ig-press flex w-full items-center gap-2.5 rounded-cell px-2 py-1.5 text-left',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40',
        locked ? 'cursor-not-allowed' : 'hover:bg-ledger-sunk',
        // An unsaved change is marked on the row itself. The header says how
        // many changed; this says which, without scrolling back to find out.
        changed && 'bg-stamp-pending-wash shadow-[inset_2px_0_0_var(--stamp-pending)]',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-[15px] shrink-0 items-center justify-center rounded-[3px] border',
          on
            ? 'border-crest bg-crest text-white'
            : 'border-ledger-rule-firm bg-ledger-sunk',
          locked && 'opacity-70',
        )}
      >
        {on && <Check className="ig-mark size-[11px]" strokeWidth={3} />}
      </span>

      <span className="ig-tnum shrink-0 text-[0.76rem] font-bold text-ink">
        {subject.subject_code}
      </span>

      <span className="truncate text-[0.76rem] text-ink-secondary">
        {subject.subject_name}
      </span>

      {locked && <Lock className="size-3 shrink-0 text-ink-tertiary" strokeWidth={2} />}

      <span className="ig-tnum ml-auto shrink-0 text-[0.7rem] text-ink-muted">
        {subject.credit_hours} CH
      </span>
    </button>
  );

  if (!locked) return <li>{row}</li>;

  return (
    <li>
      {/*
        * A disabled button fires no pointer events, so the trigger is the
        * wrapper — otherwise the one row that needs an explanation is the one
        * row whose tooltip never opens.
        */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block">{row}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[22rem] text-pretty">
          {teacherName} is teaching {subject.subject_code} to {teaching} class
          {teaching === 1 ? '' : 'es'} right now, so this cannot be removed —
          the registry would contradict the timetable. Reassign the class on the
          Timetable screen first.
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

// =====================================================================
// NOTHING SELECTED
// =====================================================================
/*
 * The board before a teacher is chosen. It names the outstanding work and
 * offers the first piece of it, rather than saying "select a teacher" — which
 * is a restatement of the empty state, not a way out of it.
 */
function NothingSelected({ unrecorded, total, onPick }) {
  return (
    <div className="ig-rise flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-ledger-rule-firm bg-ledger px-8 py-16 text-center">
      <BookMarked className="size-8 text-ink-muted" strokeWidth={1.5} />

      <h3 className="text-[1rem] font-bold tracking-[-0.01em] text-ink">
        {unrecorded
          ? <>
              <span className="ig-tnum">{unrecorded}</span> of{' '}
              <span className="ig-tnum">{total}</span> teachers have nothing recorded
            </>
          : 'Every teacher has subjects recorded'}
      </h3>

      <p className="max-w-[52ch] text-pretty text-[0.85rem] text-ink-tertiary">
        {unrecorded
          ? 'Until a teacher has subjects here, every class in the institute files '
            + 'them under “everyone else” when it looks for staff. They are listed '
            + 'first in the rail.'
          : 'Pick anybody in the rail to review or change what they are recorded for.'}
      </p>

      {unrecorded > 0 && (
        <Button className="ig-press mt-1" onClick={onPick}>
          <ArrowRight className="size-4" strokeWidth={2} />
          Start with the first
        </Button>
      )}
    </div>
  );
}

// =====================================================================
// THE WAIT
// =====================================================================
/*
 * The whole screen, before it knows anything: the band, the rail, the board.
 *
 * Drawn at the real proportions so nothing moves when the data lands. The one
 * thing it does NOT do is print figures — a skeleton showing "0 of 0" while it
 * waits is indistinguishable from an answer, and it is the answer the eye
 * reads first.
 */
function RegistrySkeleton() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading the qualification registry">
      <div className="ig-band flex items-center gap-3 rounded-card border border-ledger-rule px-3 py-2 shadow-[var(--lift)]">
        <SkeletonLine w={148} h={14} />
        <BandRule />
        <SkeletonLine w={110} h={8} className="rounded-full" />
        <SkeletonLine w={86} h={10} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[340px_minmax(0,1fr)]">
        <RailSkeleton label="Loading faculty" />

        <div className="flex max-h-[calc(100vh-140px)] flex-col overflow-hidden rounded-card border border-ledger-rule bg-card shadow-[var(--lift)]">
          <div className="shrink-0 border-b border-ledger-rule px-3 py-2.5">
            <SkeletonLine w={190} h={15} />
            <div className="mt-1.5"><SkeletonLine w={300} h={9} /></div>
          </div>
          <CatalogueSkeleton />
        </div>
      </div>
    </div>
  );
}

/*
 * The curriculum tree, before it arrives: five collapsed programme headers,
 * one of them open onto a stage of subjects. That is what the board looks like
 * a second later, so the shape is a promise the screen keeps.
 */
function CatalogueSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="ig-rise border-b border-ledger-rule" style={{ '--i': i }}>
          <div className="flex items-center gap-2 px-3 py-2.5">
            <SkeletonLine w={12} h={12} className="rounded-[3px]" />
            <SkeletonLine w={`${28 + ((i * 11) % 18)}%`} h={11} />
            <span className="ml-auto"><SkeletonLine w={54} h={9} /></span>
          </div>

          {i === 4 && (
            <div className="border-t border-ledger-rule pb-2">
              <div className="flex items-center gap-2 px-3 py-1.5 pl-8">
                <SkeletonLine w={92} h={9} />
                <span className="ml-auto"><SkeletonLine w={42} h={9} /></span>
              </div>
              {Array.from({ length: 5 }, (_, j) => (
                <div key={j} className="flex items-center gap-2.5 py-1.5 pl-8 pr-4">
                  <SkeletonLine w={15} h={15} className="rounded-[3px]" />
                  <SkeletonLine w={52} h={10} />
                  <SkeletonLine w={`${34 + ((j * 17) % 30)}%`} h={10} />
                  <span className="ml-auto"><SkeletonLine w={30} h={9} /></span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const BandRule = () => (
  <span aria-hidden="true" className="hidden h-5 w-px shrink-0 bg-ledger-rule-firm sm:block" />
);
