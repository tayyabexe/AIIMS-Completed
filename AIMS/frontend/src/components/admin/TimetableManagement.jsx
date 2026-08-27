import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarRange, CalendarPlus, DoorOpen, Layers,
  Search, Plus, Play, Lock, CheckCircle2, BookMarked, ArrowRight,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  terms as termsApi,
  offerings as offeringsApi,
  scheduling as schedulingApi,
  sections as sectionsApi,
  semesters as semestersApi,
} from '../../api/endpoints';
import { useAdminPage } from '../../hooks/useAdminPage';
import { STALE } from '../../api/queryClient';
import useDraft, { useOnlineStatus } from '../../hooks/useDraft';
import ApiErrorNotice from '../common/ApiErrorNotice';
import DraftNotice from '../common/DraftNotice';
import PlacementGrid from './timetable/PlacementGrid';
import {
  RoomPlate, CompletionMeter, ProgressRibbon, Stamp, SkeletonLine, RailSkeleton,
} from './timetable/parts';

/*
 * Timetable management.
 *
 * WHAT THIS SCREEN IS FOR, AND WHY IT DID NOT EXIST BEFORE
 * -------------------------------------------------------
 * The portal could edit timetable *rows* — a subject, a section, a teacher, a
 * room and a period: five independent fields with nothing tying them
 * together. Nothing in the schema said who taught a course, so nothing on
 * screen could either. CS-101 for section A could name one teacher on Monday
 * and another on Wednesday, and no screen would call that wrong.
 *
 * `course_offerings` fixed that underneath. A class is now one row — this
 * section studies this subject with this teacher, this term — and a timetable
 * row is one weekly *meeting* of it. This screen is that model made visible:
 *
 *   1. pick a term            (the year; `semesters` is the curriculum stage)
 *   2. build the classes      (one call per section, not one per subject)
 *   3. staff them             (from the qualified shortlist, with load shown)
 *   4. place them on the grid (from what is actually free)
 *   5. enrol the cohort       (the section's students, in one action)
 *
 * WHY THE QUEUE IS A RAIL AND THE GRID DOMINATES
 * ----------------------------------------------
 * The default for a screen like this is a 50/50 two-pane, which says the list
 * and the detail are peers. They are not. The grid *is* the work — it is
 * where the decision is made and where the constraints live — and the list is
 * only the queue feeding it. A 340px rail against a dominant board says that
 * relationship out loud, and gives the twenty-four cells the width they need
 * to stay legible.
 *
 * WHY A RIBBON AND NOT SIX TILES
 * ------------------------------
 * The one question on opening this screen is "how much of this term is done",
 * and that is a proportion. Six KPI boxes give six numbers and no
 * relationship; a segmented bar answers it before a single figure is read,
 * and doubles as the filter, because the count was always the thing being
 * clicked anyway.
 */

const hhmm = (t) => String(t || '').slice(0, 5);

/*
 * The five states a class can be in, in the order they need attention. The
 * server sorts by exactly this order; the tones here mirror it so the queue
 * reads as a gradient from "do something" to "done".
 */
const STATE = {
  unstaffed:      { label: 'No teacher',    tone: 'void',    colour: 'var(--stamp-void)' },
  unscheduled:    { label: 'Not placed',    tone: 'pending', colour: 'var(--stamp-pending)' },
  partial:        { label: 'Partly placed', tone: 'pending', colour: 'var(--plate-brass)' },
  over_scheduled: { label: 'Over-placed',   tone: 'void',    colour: 'var(--crest-deep)' },
  complete:       { label: 'Complete',      tone: 'clear',   colour: 'var(--stamp-clear)' },
};

const TERM_TONE = { Planned: 'pending', Active: 'clear', Closed: 'quiet' };

export default function TimetableManagement() {
  const [termId, setTermId] = useState(null);
  const [tab, setTab] = useState('classes');
  const [stateFilter, setStateFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const termsQuery = useAdminPage(() => termsApi.list(), {}, { key: 'terms', staleTime: STALE.reference });
  const allTerms = termsQuery.data?.data ?? [];

  /*
   * The term defaults to whichever the server calls current — Active, else
   * the nearest Planned — rather than to the first in the list. An admin
   * opening this screen almost always means "now", and picking index 0 would
   * land them on whatever happens to sort first.
   */
  const activeTerm = useMemo(() => {
    if (termId) return allTerms.find((t) => t.term_id === termId) ?? null;
    return allTerms.find((t) => t.status === 'Active')
      ?? allTerms.find((t) => t.status === 'Planned')
      ?? allTerms[0]
      ?? null;
  }, [allTerms, termId]);

  const effectiveTermId = activeTerm?.term_id ?? null;

  const statusQuery = useAdminPage(
    (params) => schedulingApi.status(params),
    { term_id: effectiveTermId }, { key: 'scheduling-status', enabled: !!effectiveTermId });

  const status = statusQuery.data?.data ?? null;

  const rows = useMemo(() => {
    let list = status?.offerings ?? [];

    if (stateFilter) list = list.filter((o) => o.scheduling_state === stateFilter);

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((o) =>
        [o.subject_code, o.subject_name, o.section_name, o.batch_name, o.teacher_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }

    return list;
  }, [status, stateFilter, search]);

  const refreshAll = () => {
    statusQuery.refresh();
    termsQuery.refresh();
  };

  const run = async (fn, successMessage) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const result = await fn();
      setDialog(null);
      refreshAll();
      if (successMessage) setNotice(result?.message ?? successMessage);
      /*
       * Reports success to the caller. Every existing call site ignores this,
       * so nothing changes for them — it exists so a dialog holding a draft can
       * clear it ONLY when the row really reached the server. Without it the
       * dialog cannot tell a rejected save from an accepted one, because this
       * helper swallows the error into `actionError`.
       */
      return true;
    } catch (e) {
      setActionError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };

  /*
   * The wait, shaped like the screen it becomes - band, rail, board - so
   * nothing moves when the term lands. See parts.jsx for why this is not a
   * spinner.
   */
  if (termsQuery.loading && !allTerms.length) return <TimetableSkeleton />;

  if (termsQuery.error) return <ApiErrorNotice error={termsQuery.error} />;

  /*
   * No terms at all. Every other panel here is scoped to a term, so there is
   * nothing truthful to draw — and a screen of empty tables would suggest the
   * classes are missing rather than that the calendar is.
   */
  if (!activeTerm) {
    return (
      <>
        <div className="ig-rise flex flex-col items-center gap-3 rounded-card border border-dashed border-ledger-rule-firm bg-ledger px-8 py-14 text-center">
          <CalendarRange className="size-8 text-ink-muted" strokeWidth={1.5} />
          <h3 className="text-[1rem] font-bold tracking-[-0.01em] text-ink">
            No academic terms yet
          </h3>
          <p className="max-w-[46ch] text-pretty text-[0.85rem] text-ink-tertiary">
            A term is the year classes run in — &ldquo;Fall 2026&rdquo;. Semesters are the
            curriculum stages inside a programme, and cannot say when something is taught.
          </p>
          <Button onClick={() => setDialog('term')} className="ig-press mt-1">
            <CalendarPlus className="size-4" strokeWidth={2} />
            Create the first term
          </Button>
        </div>

        <TermDialog
          open={dialog === 'term'}
          busy={busy}
          onOpenChange={(o) => setDialog(o ? 'term' : null)}
          onSubmit={(payload) => run(() => termsApi.create(payload), 'Term created.')}
        />
      </>
    );
  }

  const selectedRow = status?.offerings?.find((o) => o.offering_id === selected) ?? null;

  const segments = status ? [
    { key: 'unstaffed',   label: 'no teacher',    value: status.summary.unstaffed,      colour: STATE.unstaffed.colour },
    { key: 'unscheduled', label: 'not placed',    value: status.summary.unscheduled,    colour: STATE.unscheduled.colour },
    { key: 'partial',     label: 'partly placed', value: status.summary.partial,        colour: STATE.partial.colour },
    { key: 'over_scheduled', label: 'over-placed', value: status.summary.over_scheduled, colour: STATE.over_scheduled.colour },
    { key: 'complete',    label: 'complete',      value: status.summary.complete,       colour: STATE.complete.colour },
  ] : [];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-3">

        {/* =========================================== the command band
          *
          * One band, not three stacked ones. The term header, the progress
          * card and the tab row were 215px of chrome before the first
          * decision could be made — on a 950px viewport that pushed the
          * grid, which is the actual work, past the halfway line. Everything
          * that only ever gets *read* or *switched* now shares one 48px row,
          * and it sticks, so scrolling a long queue never costs the term you
          * are editing or the counts you are editing it against.
          */}
        <div className="ig-band sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-ledger-rule px-3 py-2 shadow-[var(--lift)]">

          {/* ---------------------------------------------- which term */}
          <div className="flex min-w-0 items-center gap-2">
            <CalendarRange className="size-4 shrink-0 text-crest" strokeWidth={2} />

            <Select
              value={String(effectiveTermId ?? '')}
              onValueChange={(v) => { setTermId(Number(v)); setSelected(null); }}
            >
              <SelectTrigger
                aria-label="Academic term"
                className="h-8 w-[150px] rounded-control border-ledger-rule-firm bg-ledger-sunk text-[0.82rem] font-semibold"
              >
                {/*
                  * The term name only. Rendering the class count here as well
                  * truncated the name itself to "Fall 2026 - 40 clas" - the
                  * one thing the control exists to show. The count is context
                  * for choosing between terms, so it lives in the menu.
                  */}
                <span className="truncate">{activeTerm.term_name}</span>
              </SelectTrigger>
              <SelectContent>
                {allTerms.map((t) => (
                  <SelectItem key={t.term_id} value={String(t.term_id)}>
                    {t.term_name}
                    <span className="ig-tnum ml-1 text-ink-tertiary">
                      · {t.offering_count} class{t.offering_count === 1 ? '' : 'es'}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Stamp tone={TERM_TONE[activeTerm.status]}>{activeTerm.status}</Stamp>

            {/*
              * The dates are orientation, not a decision, so they are the
              * first thing the band gives up when it runs out of width.
              */}
            <span className="ig-tnum hidden whitespace-nowrap text-[0.72rem] text-ink-tertiary 2xl:inline">
              {activeTerm.start_date} → {activeTerm.end_date}
            </span>
          </div>

          {/* ------------------------- how much is done, and the filter */}
          {status && status.summary.total > 0 && (
            <>
              <BandRule />
              <ProgressRibbon segments={segments} active={stateFilter} onSelect={setStateFilter} />
              <span className="ig-tnum hidden whitespace-nowrap text-[0.72rem] text-ink-tertiary xl:inline">
                <span className="font-bold text-ink-secondary">{status.summary.sessions_placed}</span>
                {'/'}
                {status.summary.sessions_required} periods
              </span>
            </>
          )}

          {/* ------------------------ what to look at, and what to do */}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="h-8 rounded-control bg-ledger-sunk p-[3px]">
                <TabsTrigger value="classes" className="h-full rounded-[4px] px-2.5 text-[0.78rem]">
                  <Layers className="size-3.5" strokeWidth={2} /> Classes
                </TabsTrigger>
                <TabsTrigger value="rooms" className="h-full rounded-[4px] px-2.5 text-[0.78rem]">
                  <DoorOpen className="size-3.5" strokeWidth={2} /> Rooms
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <BandRule />

            {/*
              * Solid only while the term is empty.
              *
              * As a permanent near-black pill this was the loudest object on
              * the screen - it beat the grid on the squint test, and the grid
              * is the focal point. Once a term has classes, building more is
              * an occasional act and the band should recede behind the work;
              * on an empty term it is the only thing to do, and it leads.
              */}
            <Button
              size="sm"
              variant={status?.summary.total ? 'outline' : 'default'}
              className="ig-press h-8"
              onClick={() => setDialog('build')}
            >
              <Layers className="size-3.5" strokeWidth={2} /> Build classes
            </Button>

            {/*
              * The term lifecycle. These are used once or twice a *year* and
              * were spending ~230px of a band that the everyday work needs,
              * so they carry an icon and a tooltip rather than a label. The
              * accessible name is on the button, not only in the tooltip.
              */}
            <BandAction label="New academic term" icon={CalendarPlus} onClick={() => setDialog('term')} />

            {activeTerm.status === 'Planned' && (
              <BandAction
                label={`Activate ${activeTerm.term_name}`}
                icon={Play}
                disabled={busy}
                onClick={() => run(
                  () => termsApi.setStatus(activeTerm.term_id, 'Active'),
                  `${activeTerm.term_name} is now active.`
                )}
              />
            )}

            {activeTerm.status === 'Active' && (
              <BandAction
                label={`Close ${activeTerm.term_name}`}
                icon={Lock}
                tone="void"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(
                    `Close ${activeTerm.term_name}?\n\n`
                    + 'Its classes become Completed, its enrolments become Completed, and '
                    + 'its timetable becomes read-only as the record of what was taught. '
                    + 'This cannot be undone from the portal.'
                  )) return;

                  run(
                    () => termsApi.setStatus(activeTerm.term_id, 'Closed'),
                    `${activeTerm.term_name} is closed.`
                  );
                }}
              />
            )}
          </div>
        </div>

        {actionError && (
          <div className="ig-rise">
            <ApiErrorNotice error={actionError} onDismiss={() => setActionError(null)} />
          </div>
        )}

        {notice && (
          <div className="ig-rise flex items-start justify-between gap-4 rounded-card border border-stamp-clear/25 bg-stamp-clear-wash px-4 py-2.5">
            <p className="flex items-start gap-2 text-[0.84rem] text-stamp-clear">
              <CheckCircle2 className="mt-px size-4 shrink-0" strokeWidth={2} />
              {notice}
            </p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="ig-press shrink-0 rounded-control px-1 text-[0.76rem] font-semibold text-stamp-clear/80 hover:text-stamp-clear"
            >
              Dismiss
            </button>
          </div>
        )}

        {tab === 'rooms' ? (
          <RoomOccupancy termId={effectiveTermId} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
            {/*
              * 320px rail against a dominant board. The grid is the work; the
              * queue only feeds it, and the proportion says so.
              */}
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
                    placeholder="Subject, section, teacher…"
                    aria-label="Filter classes"
                    className="h-8 w-full rounded-control border border-ledger-rule-firm bg-ledger-sunk pl-8 pr-2 text-[0.8rem] text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </div>

                {/*
                  * The rail's own count. With a filter on the ribbon and a
                  * search box here, "which of the 40 am I looking at" is
                  * otherwise a question the screen refuses to answer.
                  */}
                <p className="ig-tnum mt-1.5 flex items-center justify-between px-0.5 text-[0.7rem] text-ink-tertiary">
                  <span>
                    {rows.length === status?.summary.total
                      ? `${rows.length} class${rows.length === 1 ? '' : 'es'}`
                      : `${rows.length} of ${status?.summary.total ?? 0}`}
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

              {statusQuery.error && (
                <div className="p-2"><ApiErrorNotice error={statusQuery.error} /></div>
              )}

              <ul className="min-h-0 flex-1 divide-y divide-ledger-rule overflow-y-auto">
                {rows.map((o, i) => {
                  const state = STATE[o.scheduling_state] ?? STATE.complete;
                  const isSelected = o.offering_id === selected;
                  /*
                   * A complete class gets no stamp at all. The spec's own rule
                   * — two hundred bright pills are the loudest thing on screen
                   * and the one nobody needs first — is exactly what a term
                   * that is 40/40 done was doing: forty identical COMPLETE
                   * marks, and no way to spot the one row that is not. Absence
                   * is the "done" signal; a stamp means "this needs you".
                   */
                  const needsAttention = o.scheduling_state !== 'complete';

                  return (
                    /* Capped at twelve — past that the last row waits on an
                       animation rather than on data. */
                    <li key={o.offering_id} className="ig-rise" style={{ '--i': Math.min(i, 12) }}>
                      <button
                        type="button"
                        onClick={() => setSelected(o.offering_id)}
                        aria-current={isSelected ? 'true' : undefined}
                        className={cn(
                          'ig-press flex w-full flex-col gap-1 px-3 py-2 text-left',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40',
                          isSelected
                            ? 'bg-crest-wash shadow-[inset_3px_0_0_var(--crest)]'
                            : 'hover:bg-ledger-sunk'
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="ig-tnum truncate text-[0.84rem] font-bold text-ink">
                            {o.subject_code}
                          </span>
                          <CompletionMeter
                            placed={o.placed_sessions}
                            required={o.sessions_per_week}
                            showCount
                            className="shrink-0"
                          />
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[0.73rem] text-ink-tertiary">
                            {o.section_name}
                            <span className="text-ink-muted"> · </span>
                            {o.teacher_name || <span className="font-medium text-stamp-void">no teacher</span>}
                          </span>

                          {needsAttention
                            ? <Stamp tone={state.tone} className="shrink-0">{state.label}</Stamp>
                            : (
                              <span className="ig-tnum shrink-0 text-[0.7rem] text-ink-muted">
                                {o.section_headcount}
                              </span>
                            )}
                        </div>
                      </button>
                    </li>
                  );
                })}

                {statusQuery.loading && !rows.length && (
                  <li className="px-3 py-3">
                    <SkeletonLine h={11} />
                    <span className="mt-1.5 block"><SkeletonLine w="70%" h={9} /></span>
                  </li>
                )}

                {!rows.length && !statusQuery.loading && (
                  <li className="px-4 py-10 text-center text-[0.82rem] text-ink-tertiary">
                    {status?.summary.total
                      ? 'No class matches that filter.'
                      : 'This term has no classes yet — start with “Build classes”.'}
                  </li>
                )}
              </ul>
            </aside>

            <PlacementGrid
              offeringId={selected}
              offering={selectedRow}
              busy={busy}
              onChanged={refreshAll}
              onStaff={() => setDialog('staff')}
              onEnrol={() => run(
                () => offeringsApi.enrol(selectedRow.offering_id),
                'Cohort enrolled.'
              )}
            />
          </div>
        )}

        {/* ========================================================= dialogs */}
        <TermDialog
          open={dialog === 'term'}
          busy={busy}
          onOpenChange={(o) => setDialog(o ? 'term' : null)}
          onSubmit={(payload) => run(() => termsApi.create(payload), 'Term created.')}
        />

        <BuildClassesDialog
          open={dialog === 'build'}
          busy={busy}
          termName={activeTerm.term_name}
          onOpenChange={(o) => setDialog(o ? 'build' : null)}
          onSubmit={(payload) => run(
            () => offeringsApi.createForSection({ ...payload, term_id: effectiveTermId })
          )}
        />

        <StaffDialog
          open={dialog === 'staff'}
          busy={busy}
          offeringId={selected}
          onOpenChange={(o) => setDialog(o ? 'staff' : null)}
          onSubmit={(teacherId) => run(
            () => offeringsApi.assignTeacher(selected, teacherId),
            'Teacher assigned.'
          )}
        />
      </div>
    </TooltipProvider>
  );
}

// ================================================== the command band

/*
 * The whole screen before the term is known.
 *
 * Drawn at the real proportions, and printing no figures: a skeleton showing
 * "0/0 periods" while it waits is indistinguishable from an answer, and it is
 * the answer the eye reads first.
 */
function TimetableSkeleton() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading timetable management">
      <div className="ig-band flex items-center gap-3 rounded-card border border-ledger-rule px-3 py-2 shadow-[var(--lift)]">
        <SkeletonLine w={150} h={14} className="rounded-control" />
        <SkeletonLine w={66} h={14} />
        <SkeletonLine w={110} h={8} className="rounded-full" />
        <span className="ml-auto flex items-center gap-1.5">
          <SkeletonLine w={132} h={26} className="rounded-control" />
          <SkeletonLine w={104} h={26} className="rounded-control" />
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
        <RailSkeleton label="Loading classes" />

        {/* The board: a header strip, then the six-day grid it becomes. */}
        <div className="flex flex-col gap-3 rounded-card border border-ledger-rule bg-card p-3 shadow-[var(--lift)]">
          <div>
            <SkeletonLine w={230} h={15} />
            <span className="mt-2 block"><SkeletonLine w={360} h={9} /></span>
          </div>

          <div className="grid grid-cols-6 gap-2">
            {Array.from({ length: 24 }, (_, i) => (
              <SkeletonLine
                key={i}
                h={60}
                className="ig-rise rounded-cell"
                /* Down the columns, the way the grid is read. */
                style={{ '--i': i % 6 }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/*
 * A hairline between groups in the band. Cheaper than a gap wide enough to
 * separate them on its own, which is what pushed the band to three rows.
 */
const BandRule = () => (
  <span aria-hidden="true" className="hidden h-5 w-px shrink-0 bg-ledger-rule-firm sm:block" />
);

/*
 * A band action that carries an icon instead of a label.
 *
 * Reserved for the term lifecycle — creating, activating and closing — which
 * happens once or twice a year. `aria-label` carries the name on the button
 * itself, not only in the tooltip, so it is announced without hover.
 */
const BandAction = ({ label, icon: Icon, tone, ...props }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={label}
        className={cn(
          'ig-press',
          tone === 'void'
            && 'border-stamp-void/30 text-stamp-void hover:bg-stamp-void-wash hover:text-stamp-void'
        )}
        {...props}
      >
        <Icon className="size-3.5" strokeWidth={2} />
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

// ================================================================ dialogs

const EMPTY_TERM = { term_code: '', term_name: '', start_date: '', end_date: '' };

function TermDialog({ open, busy, onOpenChange, onSubmit }) {
  const [form, setForm] = useState(EMPTY_TERM);
  const online = useOnlineStatus();

  /*
   * A half-entered term survives the dialog being dismissed or the page being
   * refreshed.
   *
   * Four fields, two of them dates copied off an academic calendar. The dialog
   * closes on Cancel, on Escape and on an outside click, and all three used to
   * discard the lot silently.
   *
   * Keyed on `open` rather than on mount: this component stays mounted with
   * `open={false}`, so a mount-time restore would fire against a dialog nobody
   * can see, and the saving side would overwrite a good draft with the empty
   * form sitting behind it.
   */
  const draft = useDraft('admin.term.new', form, {
    enabled: open,
    onRestore: setForm,
    isEmpty: (value) => !value?.term_code?.trim()
      && !value?.term_name?.trim()
      && !value?.start_date
      && !value?.end_date,
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    // `run` resolves true only when the term was actually created.
    const created = await onSubmit(form);
    if (created) {
      draft.clear();
      setForm(EMPTY_TERM);
    }
  };

  const field =
    'h-9 w-full rounded-control border border-ledger-rule-firm bg-ledger-sunk px-2.5 text-[0.85rem] text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-sheet border-ledger-rule bg-card">
        <DialogHeader>
          <DialogTitle className="text-[1rem] font-bold tracking-[-0.01em] text-ink">
            New academic term
          </DialogTitle>
          <DialogDescription className="text-pretty text-[0.82rem] text-ink-tertiary">
            A term is a year, not a curriculum stage. It starts Planned, so its classes can be
            built and its timetable drafted before anybody is enrolled.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <DraftNotice draft={draft} online={online} onDiscard={() => setForm(EMPTY_TERM)} compact />
          <Field label="Code">
            <input className={field} value={form.term_code} onChange={set('term_code')} placeholder="SPRING-2027" />
          </Field>
          <Field label="Name">
            <input className={field} value={form.term_name} onChange={set('term_name')} placeholder="Spring 2027" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts">
              <input type="date" className={field} value={form.start_date} onChange={set('start_date')} />
            </Field>
            <Field label="Ends">
              <input type="date" className={field} value={form.end_date} onChange={set('end_date')} />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="ig-press" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="ig-press" disabled={busy} onClick={submit}>
            <Plus className="size-4" strokeWidth={2} /> Create term
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/*
 * Creating every class a section needs for one curriculum semester.
 *
 * This is how a term is actually built. Doing it subject by subject is twenty
 * identical decisions per section, and the twenty-first is the one that gets
 * forgotten — a class nobody notices is missing until a student asks why it
 * is not on their timetable. Subjects that already have a class are skipped,
 * so running it again after adding one to the curriculum is safe.
 */
function BuildClassesDialog({ open, busy, termName, onOpenChange, onSubmit }) {
  const [sectionId, setSectionId] = useState('');
  const [semesterId, setSemesterId] = useState('');

  const sectionsQuery = useAdminPage(() => sectionsApi.list(), {}, { key: 'sections', staleTime: STALE.reference, enabled: open });
  /*
   * include_archived=1 on purpose.
   *
   * `semesters.is_archived` marks a curriculum stage the current cohorts have
   * already passed, and the list endpoint hides those by default. For eleven
   * of the forty stages — including Semester 1-3 of BSCS, DS and EE — that
   * made this picker open at "Semester 4" and look as though the early
   * semesters did not exist. They do, and they are exactly what a retake or a
   * catch-up class is built against, so they are asked for explicitly and
   * marked "past" in the list rather than dropped from it.
   */
  const semestersQuery = useAdminPage(
    () => semestersApi.list({ include_archived: 1 }),
    {}, { key: 'semesters-all', staleTime: STALE.reference, enabled: open });

  const sectionList = sectionsQuery.data?.data ?? [];
  const semesterList = semestersQuery.data?.data ?? [];

  const section = sectionList.find((x) => String(x.id ?? x.section_id) === sectionId) ?? null;

  /*
   * Only the chosen section's own programme.
   *
   * The list is one row per (programme, semester) — 40 of them — and the
   * server refuses any semester whose programme differs from the section's
   * batch. Offering all 40 meant 32 choices that could only ever produce an
   * error, shown as eight identical runs of "Semester 1..8" with nothing to
   * tell them apart, because the label carried no programme. Scoping to the
   * section answers it instead of asking it: one programme, its eight stages.
   *
   * Archived stages are kept — see the include_archived note on the query.
   */
  const stages = useMemo(() => {
    if (!section) return [];

    const programId = section.programId ?? section.program_id;

    return semesterList
      .filter((x) => (x.programId ?? x.program_id) === programId)
      .sort((a, b) => (a.number ?? a.semester_number) - (b.number ?? b.semester_number));
  }, [semesterList, section]);

  const stage = stages.find((x) => String(x.id ?? x.semester_id) === semesterId) ?? null;

  // Changing the section can strand a semester from the previous programme.
  const chooseSection = (v) => { setSectionId(v); setSemesterId(''); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-sheet border-ledger-rule bg-card">
        <DialogHeader>
          <DialogTitle className="text-[1rem] font-bold tracking-[-0.01em] text-ink">
            Build a section&rsquo;s classes
          </DialogTitle>
          <DialogDescription className="text-pretty text-[0.82rem] text-ink-tertiary">
            Creates one class in <strong className="font-semibold text-ink-secondary">{termName}</strong>{' '}
            for every subject in the chosen curriculum semester. Subjects the section already has
            are skipped, and the classes start unstaffed.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <Field label="Section">
            <Select value={sectionId} onValueChange={chooseSection}>
              <SelectTrigger className="h-9 w-full rounded-control border-ledger-rule-firm bg-ledger-sunk">
                <SelectValue placeholder="Choose a section…" />
              </SelectTrigger>
              <SelectContent>
                {sectionList.map((x) => (
                  <SelectItem key={x.id ?? x.section_id} value={String(x.id ?? x.section_id)}>
                    {x.name ?? x.section_name}
                    <span className="ml-1.5 text-ink-tertiary">
                      {x.batch ?? x.batch_name} · {x.program ?? x.program_name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Curriculum semester"
            hint={section
              ? `The eight stages of ${section.program ?? section.program_name}. A stage from another programme is refused by the server, so only this one's are offered.`
              : 'Pick a section first — the stages shown are its programme’s.'}
          >
            <Select
              value={semesterId}
              onValueChange={setSemesterId}
              disabled={!section}
            >
              <SelectTrigger className="h-9 w-full rounded-control border-ledger-rule-firm bg-ledger-sunk disabled:opacity-60">
                <SelectValue placeholder={section ? 'Choose a semester…' : 'Choose a section first'} />
              </SelectTrigger>
              <SelectContent>
                {stages.map((x) => (
                  <SelectItem key={x.id ?? x.semester_id} value={String(x.id ?? x.semester_id)}>
                    Semester {x.number ?? x.semester_number}
                    <span className="ig-tnum ml-1.5 text-ink-tertiary">
                      {x.subjectCount ?? 0} subject{(x.subjectCount ?? 0) === 1 ? '' : 's'}
                      {x.isArchived ? ' · past' : ''}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/*
            * What the button is about to do, in the numbers it will do it in.
            * "Create the classes" gave no idea whether that meant three rows
            * or thirty until after it had happened.
            */}
          {stage && (
            <p className="rounded-cell border border-ledger-rule bg-ledger-sunk px-2.5 py-2 text-[0.78rem] text-ink-secondary">
              Creates up to{' '}
              <span className="ig-tnum font-bold text-ink">{stage.subjectCount ?? 0}</span>{' '}
              class{(stage.subjectCount ?? 0) === 1 ? '' : 'es'} for{' '}
              <span className="font-semibold text-ink">{section.name ?? section.section_name}</span>
              {' '}— one per subject in semester {stage.number ?? stage.semester_number}.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="ig-press" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            className="ig-press"
            disabled={busy || !sectionId || !semesterId}
            onClick={() => onSubmit({ section_id: Number(sectionId), semester_id: Number(semesterId) })}
          >
            <Plus className="size-4" strokeWidth={2} /> Create the classes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/*
 * Choosing who teaches a class.
 *
 * `teacher_subjects` records who is *qualified* to teach a subject; the
 * offering records who *does*. So the qualified are listed first and
 * flagged, but nobody is hidden — staffing rules bend at the start of a term,
 * and a screen that refuses the only available lecturer because a lookup
 * table is out of date is a screen that gets worked around.
 *
 * Each teacher's current load is shown, because "who is qualified" and "who
 * has room in their week" is otherwise the same decision made twice.
 */
function StaffDialog({ open, busy, offeringId, onOpenChange, onSubmit }) {
  const navigate = useNavigate();
  const { data, loading, error } = useAdminPage(
    () => offeringsApi.eligibleTeachers(offeringId),
    { offeringId }, { key: 'eligible-teachers', enabled: open && !!offeringId });

  const teachers = data?.data?.teachers ?? [];
  // The class being staffed, returned alongside the shortlist.
  const target = data?.data?.offering ?? null;
  const qualified = teachers.filter((t) => t.is_qualified);
  const others = teachers.filter((t) => !t.is_qualified);

  const Row = ({ t }) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => onSubmit(t.teacher_id)}
      className="ig-lift ig-press flex w-full items-start justify-between gap-3 rounded-cell border border-ledger-rule bg-ledger-raised px-2.5 py-2 text-left hover:border-crest-edge hover:bg-crest-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-wait disabled:opacity-60"
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="truncate text-[0.84rem] font-semibold text-ink">{t.name}</span>
          {/*
            * Somebody already taking this same subject for another section is
            * the obvious pick and was previously indistinguishable from
            * anyone else on the list.
            */}
          {t.teaches_this_subject && (
            <Stamp tone="clear">already teaches it</Stamp>
          )}
        </span>

        {(t.designation || t.specialization) && (
          <span className="mt-0.5 block truncate text-[0.72rem] text-ink-tertiary">
            {[t.designation, t.specialization].filter(Boolean).join(' · ')}
          </span>
        )}

        {/*
          * What they already hold this term. A load of "3 classes" says how
          * busy somebody is but never whether they are the right person.
          */}
        {t.teaching_now?.length > 0 && (
          <span className="ig-tnum mt-1 block truncate text-[0.7rem] text-ink-muted">
            Teaching: {t.teaching_now.join(' · ')}
          </span>
        )}
      </span>

      <span className="ig-tnum shrink-0 text-right text-[0.7rem] text-ink-tertiary">
        {t.classes_this_term} class{t.classes_this_term === 1 ? '' : 'es'}
        <span className="block">{t.periods_this_week} period{t.periods_this_week === 1 ? '' : 's'}</span>
      </span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-sheet border-ledger-rule bg-card">
        <DialogHeader>
          {/*
            * Name the class being staffed. "Assign a teacher" alone left the
            * admin choosing a lecturer for a subject the dialog never
            * mentioned - the section, the subject and the batch were all
            * behind the overlay.
            */}
          <DialogTitle className="ig-tnum text-[1rem] font-bold tracking-[-0.01em] text-ink">
            {target
              ? <>
                  {target.subject?.subject_code}
                  <span className="ml-1.5 font-medium text-ink-secondary">
                    {target.subject?.subject_name}
                  </span>
                </>
              : 'Assign a teacher'}
          </DialogTitle>
          <DialogDescription className="text-pretty text-[0.82rem] text-ink-tertiary">
            {target && (
              <span className="mb-1 block font-medium text-ink-secondary">
                Section {target.section?.section_name}
                {target.section?.batch_name ? ` · ${target.section.batch_name}` : ''}
              </span>
            )}
            Anyone can be assigned. The ones recorded as qualified for this subject are
            listed first.
          </DialogDescription>
        </DialogHeader>

        {loading && <p className="py-4 text-[0.84rem] text-ink-tertiary">Loading faculty…</p>}
        {error && <ApiErrorNotice error={error} />}

        {!loading && !error && (
          <div className="flex max-h-[52vh] flex-col gap-1.5 overflow-y-auto">
            {qualified.length > 0 ? (
              <>
                <GroupLabel>Recorded as qualified · {qualified.length}</GroupLabel>
                {qualified.map((t) => <Row key={t.teacher_id} t={t} />)}
              </>
            ) : (
              /*
                * An empty shortlist is not "nobody is qualified" - it is "the
                * registry has nothing for this subject", and this dialog is
                * the exact moment somebody finds that out. Every name below is
                * about to be picked on a hunch, and next term the same hunch
                * gets made again, because nothing here writes it down.
                *
                * So the empty state points at the screen that fixes it rather
                * than leaving a silent gap where the group would be.
                */
              <div className="rounded-cell border border-dashed border-ledger-rule-firm bg-ledger px-3 py-2.5">
                <p className="text-pretty text-[0.78rem] leading-snug text-ink-tertiary">
                  <span className="font-semibold text-ink-secondary">
                    Nobody is recorded as qualified for {target?.subject?.subject_code ?? 'this subject'}.
                  </span>{' '}
                  Anyone below can still be assigned - but the shortlist stays
                  empty for every section and every term until somebody is
                  recorded.
                </p>
                <button
                  type="button"
                  onClick={() => { onOpenChange(false); navigate('/qualifications'); }}
                  className="ig-press mt-1.5 inline-flex items-center gap-1 rounded-control text-[0.76rem] font-semibold text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <BookMarked className="size-3.5" strokeWidth={2} />
                  Open the qualification registry
                  <ArrowRight className="size-3.5" strokeWidth={2} />
                </button>
              </div>
            )}
            <GroupLabel>Other faculty · {others.length}</GroupLabel>
            {others.map((t) => <Row key={t.teacher_id} t={t} />)}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const Field = ({ label, hint, children }) => (
  <div>
    <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-[0.05em] text-ink-secondary">
      {label}
    </label>
    {children}
    {hint && <p className="mt-1 text-pretty text-[0.7rem] text-ink-muted">{hint}</p>}
  </div>
);

const GroupLabel = ({ children }) => (
  <p className="ig-tnum mt-1.5 text-[0.66rem] font-bold uppercase tracking-[0.05em] text-ink-muted">
    {children}
  </p>
);

/*
 * The estate's week.
 *
 * Answers "is Room-401 free on Wednesday afternoon" without opening a class
 * first and — more usefully — shows which rooms stand empty while the
 * timetabler fights over the others. Utilisation is the column that turns an
 * over-subscribed estate from a feeling into a fact.
 */
function RoomOccupancy({ termId }) {
  const { data, loading, error } = useAdminPage(
    (params) => schedulingApi.rooms(params),
    { term_id: termId }, { key: 'scheduling-rooms', enabled: !!termId });

  const result = data?.data ?? null;

  /*
   * Grouped by building, because a building is how an estate is actually
   * organised and how a room is actually found - "is there anything free in
   * the CS block on Wednesday" is the question, and a flat alphabetical list
   * of thirty-one rooms cannot answer it. Within a building the busiest
   * lead, so the rooms under pressure are the ones read first.
   */
  const buildings = useMemo(() => {
    if (!result) return [];

    const byBuilding = new Map();
    for (const room of result.rooms) {
      const key = room.building || 'Unassigned';
      if (!byBuilding.has(key)) byBuilding.set(key, []);
      byBuilding.get(key).push(room);
    }

    return [...byBuilding.entries()]
      .map(([name, rooms]) => ({
        name,
        rooms: [...rooms].sort(
          (a, b) => b.utilisation_percent - a.utilisation_percent
            || a.room_name.localeCompare(b.room_name)
        ),
        inUse: rooms.filter((r) => r.periods_used > 0).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [result]);

  /*
   * Shaped like the estate it becomes: a building heading, then its rooms as
   * rows of six days. Same reasoning as the other skeletons in this module -
   * see parts.jsx.
   */
  if (loading && !result) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label="Loading room occupancy">
        {Array.from({ length: 3 }, (_, b) => (
          <div
            key={b}
            className="ig-rise rounded-card border border-ledger-rule bg-card p-3 shadow-[var(--lift)]"
            style={{ '--i': b }}
          >
            <SkeletonLine w={`${16 + b * 6}%`} h={12} />
            <div className="mt-3 flex flex-col gap-2">
              {Array.from({ length: 4 }, (_, r) => (
                <div key={r} className="flex items-center gap-2">
                  <SkeletonLine w={130} h={26} className="rounded-plate" />
                  <span className="grid flex-1 grid-cols-6 gap-1.5">
                    {Array.from({ length: 6 }, (_, d) => (
                      <SkeletonLine key={d} h={18} className="rounded-[5px]" />
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (error) return <ApiErrorNotice error={error} />;
  if (!result) return null;

  const days = result.rooms[0]?.days ?? [];
  const slotCount = days.reduce((n, d) => n + d.slots.length, 0);
  const inUse = result.rooms.filter((r) => r.periods_used > 0).length;

  return (
    <div className="overflow-hidden rounded-card border border-ledger-rule bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-ledger-rule px-3 py-2">
        <h2 className="text-[0.8rem] font-bold tracking-[-0.01em] text-ink">The estate this week</h2>
        <p className="ig-tnum text-[0.74rem] text-ink-tertiary">
          <span className="font-bold text-ink">{inUse}</span> of{' '}
          <span className="font-bold text-ink">{result.rooms.length}</span> rooms in use ·{' '}
          {result.periods_per_week} periods a week
        </p>
      </div>

      <div className="overflow-x-auto p-2">
        {/*
          * table-fixed with an explicit colgroup. Left to itself the browser
          * sized the room column to the widest plate and then handed it every
          * spare pixel - 630px of column behind a 130px plate, while the
          * twenty-four period cells were crushed into the last 300px. The
          * period cells are the data; they get the width.
          */}
        <table className="w-full min-w-[880px] table-fixed border-collapse">
          <colgroup>
            <col className="w-[168px]" />
            <col className="w-[76px]" />
            {days.map((d) => d.slots.map((sl) => (
              <col key={`${d.day}-${sl.slot_number}`} />
            )))}
          </colgroup>

          <thead>
            <tr>
              <th className="px-2 pb-1.5 text-left text-[0.68rem] font-bold uppercase tracking-[0.06em] text-ink-tertiary">
                Room
              </th>
              <th className="px-2 pb-1.5 text-left text-[0.68rem] font-bold uppercase tracking-[0.06em] text-ink-tertiary">
                Use
              </th>
              {days.map((d) => (
                <th
                  key={d.day}
                  colSpan={d.slots.length}
                  className="border-l border-ledger-rule-firm px-1 pb-1.5 text-center text-[0.68rem] font-bold uppercase tracking-[0.06em] text-ink-tertiary"
                >
                  {d.day.slice(0, 3)}
                </th>
              ))}
            </tr>
          </thead>

          {buildings.map((b) => (
            <tbody key={b.name}>
              <tr>
                <th
                  colSpan={2 + slotCount}
                  scope="colgroup"
                  className="border-y border-ledger-rule bg-ledger-sunk px-2 py-1 text-left text-[0.68rem] font-bold uppercase tracking-[0.05em] text-ink-secondary"
                >
                  {b.name}
                  <span className="ig-tnum ml-2 font-medium normal-case tracking-normal text-ink-tertiary">
                    {b.rooms.length} room{b.rooms.length === 1 ? '' : 's'}
                    {b.inUse > 0 && `, ${b.inUse} in use`}
                  </span>
                </th>
              </tr>

              {b.rooms.map((room) => (
                <tr key={room.classroom_id} className="border-t border-ledger-rule">
                  <td className="px-2 py-1.5">
                    <RoomPlate
                      room={room.room_name}
                      type={room.room_type}
                      capacity={room.capacity}
                      size="sm"
                    />
                  </td>

                  <td className="ig-tnum whitespace-nowrap px-2 py-1.5 text-[0.75rem]">
                    <span
                      className={cn(
                        'font-bold',
                        room.utilisation_percent === 0 ? 'text-ink-muted'
                          : room.utilisation_percent > 75 ? 'text-crest' : 'text-ink-secondary'
                      )}
                    >
                      {room.utilisation_percent}%
                    </span>
                    <span className="block text-[0.68rem] text-ink-muted">
                      {room.periods_used}/{result.periods_per_week}
                    </span>
                  </td>

                  {/*
                    * The trigger clones onto the inner div, not the <td>.
                    * Radix spreads button-ish props onto whatever it wraps,
                    * and a `type` attribute on a table cell is invalid HTML
                    * that React warns about on every render.
                    */}
                  {room.days.map((d) => d.slots.map((sl, i) => (
                    <td
                      key={`${d.day}-${sl.slot_number}`}
                      className={cn(
                        'p-[2px] align-middle',
                        i === 0 && 'border-l border-ledger-rule-firm'
                      )}
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            tabIndex={0}
                            role="img"
                            aria-label={`${d.day} ${hhmm(sl.start_time)}: ${
                              sl.booking
                                ? `${sl.booking.subject_code}, section ${sl.booking.section_name}`
                                : 'free'
                            }`}
                            className={cn(
                              'h-6 rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                              sl.booking ? 'bg-crest' : 'ig-hatch bg-ledger-sunk'
                            )}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {d.day} {hhmm(sl.start_time)} —{' '}
                          {sl.booking
                            ? `${sl.booking.subject_code}, section ${sl.booking.section_name}`
                            : 'free'}
                        </TooltipContent>
                      </Tooltip>
                    </td>
                  )))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
