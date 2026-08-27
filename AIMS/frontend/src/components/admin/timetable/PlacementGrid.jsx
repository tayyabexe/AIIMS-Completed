import { useState } from 'react';
import {
  Trash2, Plus, AlertTriangle, ChevronDown, PanelsTopLeft, UserPlus, Users2,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { offerings as offeringsApi, scheduling as schedulingApi } from '../../../api/endpoints';
import { useAdminPage } from '../../../hooks/useAdminPage';
import ApiErrorNotice from '../../common/ApiErrorNotice';
import { RoomPlate, CompletionMeter, SkeletonLine } from './parts';

/*
 * Where one class can go, and putting it there.
 *
 * WHY THE WHOLE WEEK IS DRAWN, NOT A FORM
 * ---------------------------------------
 * Placing a class means choosing a day, a period and a room, and three
 * different things can make that choice illegal — the section is already in a
 * class, the teacher is already teaching, or no room of the right kind and
 * size is free. A form that takes those three values and answers "409, the
 * room is booked" makes the admin guess repeatedly against constraints they
 * cannot see.
 *
 * So the server computes the entire answer up front — GET
 * /api/offerings/:id/placement returns every day, every period, and for each
 * one either the reasons it is blocked or the rooms that would actually work
 * — and this draws it. Nothing clickable here can fail for a reason the
 * screen already knew about.
 *
 * WHY BLOCKED CELLS ARE HATCHED, NOT JUST GREY
 * --------------------------------------------
 * On a grid of twenty-four, "slightly greyer than its neighbours" is not a
 * signal that survives a squint or a red-green deficiency. A struck-through
 * entry is how this was marked on paper, and the texture reads before the hue
 * does — so the state is legible without relying on colour at all.
 *
 * WHY A BLOCKED CELL STILL SAYS WHY
 * ---------------------------------
 * The moment a timetabler most needs an explanation is when the grid comes
 * back with nothing open, because the fix is upstream: a bigger room, a
 * different teacher, a smaller class. A grid of silently-greyed cells points
 * at none of that. Every blocked cell carries the server's own reason, and
 * the rooms excluded for this class *in every period* are listed once above
 * the grid rather than repeated twenty-four times inside it.
 */

const DAY_SHORT = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed',
  Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat',
};

// "08:30:00" -> "08:30". The seconds are always zero — every row sits on the
// period grid — and printing them adds four columns of noise.
const hhmm = (t) => String(t || '').slice(0, 5);

/*
 * A cell is exactly one of four things, and each offers a different action.
 * Classified in one place so the colour, the texture and the click handler
 * cannot drift apart.
 */
const cellKind = (cell) => {
  if (cell.own_session) return 'mine';
  if (cell.available) return 'open';
  if (cell.blockers.some((b) => b.type === 'no_room')) return 'no-room';
  return 'busy';
};

export default function PlacementGrid({
  offeringId, offering, busy: parentBusy, onChanged, onStaff, onEnrol,
}) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [picking, setPicking] = useState(null);
  const [showExcluded, setShowExcluded] = useState(false);

  const { data, loading, error, refresh } = useAdminPage(
    () => offeringsApi.placement(offeringId),
    { offeringId }, { key: 'offering-placement', enabled: !!offeringId });

  const result = data?.data ?? null;

  // Every action ends the same way: clear the error, reload the grid, and tell
  // the parent so its worklist counts move too. Written once so a new action
  // cannot forget the third part.
  const run = async (fn) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      setPicking(null);
      refresh();
      onChanged?.();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  };

  if (!offeringId) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-card border border-dashed border-ledger-rule-firm bg-ledger px-8 text-center">
        <PanelsTopLeft className="size-6 text-ink-muted" strokeWidth={1.5} />
        <p className="text-[0.88rem] font-semibold text-ink-secondary">No class selected</p>
        <p className="max-w-[36ch] text-pretty text-[0.8rem] text-ink-tertiary">
          Pick one from the queue and this becomes its week &mdash; every period it
          could go in, and why the rest are shut.
        </p>
      </div>
    );
  }

  /*
   * Shaped like the week it becomes — a header strip and twenty-four cells —
   * rather than one line of grey text in a 260px box. See parts.jsx.
   */
  if (loading && !result) {
    return (
      <div
        className="flex flex-col gap-3"
        role="status"
        aria-label="Working out where this class can go"
      >
        <div className="rounded-card border border-ledger-rule bg-card px-3 py-2.5">
          <SkeletonLine w={240} h={15} />
          <span className="mt-2 block"><SkeletonLine w={330} h={9} /></span>
        </div>
        <div className="grid grid-cols-6 gap-2 rounded-card border border-ledger-rule bg-card p-3">
          {Array.from({ length: 24 }, (_, i) => (
            <SkeletonLine
              key={i}
              h={60}
              className="ig-rise rounded-cell"
              style={{ '--i': i % 6 }}
            />
          ))}
        </div>
      </div>
    );
  }

  /*
   * A 422 here is not a failure to load — it is the answer. An unstaffed class
   * or a closed term genuinely has no placement grid, and the server's own
   * sentence says which, and what to do about it.
   *
   * BUT THE SENTENCE IS NOT ENOUGH ON ITS OWN.
   *
   * This used to return the notice and nothing else, which took the header
   * down with it — and the header is where "Assign teacher" lives. So the one
   * error whose fix is a single click ("this class has no teacher assigned, so
   * it cannot be scheduled yet") replaced the button that performs it, and
   * left the class it was about unnamed. Building a term's classes creates
   * them all unstaffed, so that is the FIRST thing a timetabler meets after
   * "Build classes", and it was a dead end.
   *
   * The identity and the action come from the queue row this panel was opened
   * from, which already carries both, so they are drawable without the request
   * that just refused.
   */
  if (error) {
    return (
      <div className="flex flex-col gap-3">
        {offering && (
          <header className="rounded-card border border-ledger-rule bg-card px-3 py-2.5">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <h2 className="ig-tnum text-[1rem] font-bold leading-tight tracking-[-0.01em] text-ink">
                    {offering.subject_code}
                  </h2>
                  <p className="truncate text-[0.84rem] font-medium text-ink-secondary">
                    {offering.subject_name}
                  </p>
                </div>
                <p className="mt-0.5 text-[0.74rem] text-ink-tertiary">
                  Section {offering.section_name} &middot; {offering.batch_name} &middot;{' '}
                  {offering.teacher_name
                    || <span className="font-semibold text-stamp-void">unstaffed</span>}
                </p>
              </div>

              {onStaff && (
                <Button variant="outline" size="sm" className="ig-press h-8 shrink-0" onClick={onStaff}>
                  <UserPlus className="size-3.5" strokeWidth={2} />
                  {offering.teacher_name ? 'Change teacher' : 'Assign teacher'}
                </Button>
              )}
            </div>
          </header>
        )}

        <ApiErrorNotice error={error} />
      </div>
    );
  }

  if (!result) return null;

  const o = result.offering;
  const slots = result.days[0]?.slots ?? [];

  return (
    <div className="flex flex-col gap-3">

      {/* ====================================== the class, and its actions
        *
        * One card, not three. This panel used to stack an action bar, a
        * detail header and a full-width "N of M rooms fit" disclosure - 180px
        * of chrome above a grid that is the only thing here anyone came for.
        * They are all facts about the same class, so they read as one block:
        * identity and the two things you can do to it on the first line,
        * every figure on the second.
        */}
      <header className="rounded-card border border-ledger-rule bg-card px-3 py-2.5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h2 className="ig-tnum text-[1rem] font-bold leading-tight tracking-[-0.01em] text-ink">
                {o.subject_code}
              </h2>
              <p className="truncate text-[0.84rem] font-medium text-ink-secondary">
                {o.subject_name}
              </p>
            </div>
            <p className="mt-0.5 text-[0.74rem] text-ink-tertiary">
              Section {o.section_name} &middot; {o.batch_name} &middot;{' '}
              {o.teacher_name || <span className="font-semibold text-stamp-void">unstaffed</span>}
            </p>
          </div>

          {onStaff && (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <Button variant="outline" size="sm" className="ig-press h-8" onClick={onStaff}>
                <UserPlus className="size-3.5" strokeWidth={2} />
                {o.teacher_name ? 'Change teacher' : 'Assign teacher'}
              </Button>

              {offering && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="ig-press h-8"
                      disabled={parentBusy}
                      onClick={onEnrol}
                    >
                      <Users2 className="size-3.5" strokeWidth={2} />
                      Enrol section
                      <span className="ig-tnum ml-0.5 font-normal text-ink-tertiary">
                        {offering.enrolled_count}/{offering.section_headcount}
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[20rem] text-pretty">
                    Puts every active student in section {o.section_name} into this class.
                    Students already enrolled are left alone, so it is safe to run again.
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
        </div>

        {/*
          * Every figure on one rule-separated strip rather than a four-column
          * <dl> block. These are read together - "405 students, needs a lab,
          * 2 rooms fit" is one thought - and stacking them as labelled tiles
          * made a 90px band out of six short facts.
          */}
        <dl className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-ledger-rule pt-2">
          <Fact label="Class size" value={o.class_size} />
          <FactRule />
          <Fact
            label="Placed"
            value={
              <CompletionMeter
                placed={o.placed_sessions}
                required={o.sessions_per_week}
                showCount
              />
            }
          />
          <FactRule />
          <Fact label="Needs" value={o.required_room_type || 'any room'} />
          <FactRule />
          <Fact
            label="Open periods"
            value={`${result.summary.open_periods}/${result.summary.total_periods}`}
          />

          {/*
            * Rooms that are out for this class in every period. When the grid
            * comes back with nothing open, this is the reason - so it sits
            * with the other figures rather than in a full-width banner, and
            * still opens to name each one.
            */}
          {/*
            * No FactRule ahead of this one. The strip wraps, and a rule that
            * lands at the end of a wrapped line is a separator separating
            * nothing. The chip carries its own border, so it reads as a
            * distinct object without one.
            */}
          {result.excluded_rooms.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowExcluded((v) => !v)}
                aria-expanded={showExcluded}
                className="ig-press flex items-center gap-1.5 rounded-control border border-stamp-pending/30 bg-stamp-pending-wash px-2 py-1 text-[0.72rem] font-semibold text-stamp-pending focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <AlertTriangle className="size-3.5 shrink-0" strokeWidth={2} />
                <span className="ig-tnum">
                  {result.summary.eligible_rooms}/{result.summary.total_rooms}
                </span>
                rooms fit
                <ChevronDown
                  className={cn(
                    'size-3.5 shrink-0 transition-transform duration-200',
                    showExcluded && 'rotate-180'
                  )}
                  strokeWidth={2}
                />
              </button>
            </>
          )}
        </dl>

        {showExcluded && result.excluded_rooms.length > 0 && (
          <ul className="mt-2 grid gap-1 rounded-cell bg-stamp-pending-wash px-2.5 py-2 sm:grid-cols-2">
            {result.excluded_rooms.map((r) => (
              <li key={r.classroom_id} className="text-[0.73rem] text-stamp-pending">
                {r.reasons.join('; ')}
              </li>
            ))}
          </ul>
        )}
      </header>

      {actionError && <ApiErrorNotice error={actionError} onDismiss={() => setActionError(null)} />}

      {/* ==================================================== the grid */}
      <div className="overflow-x-auto rounded-card border border-ledger-rule bg-card p-2">
        {/*
          * table-fixed. Left to auto layout the browser sized each day to its
          * own contents, so the one day holding a placed class came out 209px
          * wide against Monday's 89px - a week drawn as six unequal days,
          * which is the one thing a week grid must not be.
          */}
        <table className="w-full min-w-[720px] table-fixed border-separate border-spacing-1">
          <colgroup>
            <col className="w-[62px]" />
            {result.days.map((d) => <col key={d.day} />)}
          </colgroup>
          <thead>
            <tr>
              <th />
              {result.days.map((d) => (
                <th
                  key={d.day}
                  scope="col"
                  className="pb-1 text-[0.68rem] font-bold uppercase tracking-[0.06em] text-ink-tertiary"
                >
                  {DAY_SHORT[d.day] ?? d.day}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {slots.map((slot) => (
              <tr key={slot.slot_number}>
                <th
                  scope="row"
                  className="ig-tnum whitespace-nowrap pr-1.5 text-right align-middle text-[0.68rem] font-semibold text-ink-secondary"
                >
                  {hhmm(slot.start_time)}
                  <span className="block font-normal text-ink-muted">{hhmm(slot.end_time)}</span>
                </th>

                {result.days.map((d) => {
                  const cell = d.slots.find((s) => s.slot_number === slot.slot_number);

                  return (
                    <td key={d.day} className="p-0 align-top">
                      <Cell
                        cell={cell}
                        kind={cellKind(cell)}
                        day={d.day}
                        busy={busy}
                        onPlace={() => setPicking({ day: d.day, cell })}
                        onRemove={() => run(() => schedulingApi.removeSession(cell.own_session.timetable_id))}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <Legend />
      </div>

      {/* ============================================= the room picker */}
      <Dialog open={!!picking} onOpenChange={(open) => !open && setPicking(null)}>
        <DialogContent className="max-w-lg gap-3 rounded-sheet border-ledger-rule bg-card">
          {picking && (
            <>
              <DialogHeader className="gap-1">
                {/*
                  * The class first, the period second.
                  *
                  * This dialog used to open on "Wednesday 08:30-10:00" and a
                  * list of rooms, which is the one thing the user already
                  * knows - they just clicked that cell. What it never said was
                  * *what is going into the room*: the subject, the section and
                  * who teaches it. Picking a room for an unnamed class is the
                  * step where a timetable goes quietly wrong.
                  */}
                <DialogTitle className="ig-tnum text-[0.98rem] font-bold tracking-[-0.01em] text-ink">
                  {o.subject_code}
                  <span className="ml-1.5 font-medium text-ink-secondary">{o.subject_name}</span>
                </DialogTitle>
                <DialogDescription className="text-[0.8rem] text-ink-tertiary">
                  Section {o.section_name} · {o.batch_name}
                  {o.teacher_name ? ` · ${o.teacher_name}` : ''}
                </DialogDescription>

                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-cell border border-ledger-rule bg-ledger-sunk px-2.5 py-1.5 text-[0.78rem] text-ink-secondary">
                  <span className="ig-tnum font-bold text-ink">
                    {picking.day} · {hhmm(picking.cell.start_time)}–{hhmm(picking.cell.end_time)}
                  </span>
                  <span className="text-ink-muted">·</span>
                  <span className="ig-tnum">
                    {picking.cell.available_rooms.length} room
                    {picking.cell.available_rooms.length === 1 ? '' : 's'} free and big enough for{' '}
                    {o.class_size}
                  </span>
                </p>
              </DialogHeader>

              <div className="flex max-h-[52vh] flex-col gap-1.5 overflow-y-auto">
                {picking.cell.available_rooms.map((room) => (
                  <button
                    key={room.classroom_id}
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => offeringsApi.placeSession(offeringId, {
                      day_of_week: picking.day,
                      slot_number: picking.cell.slot_number,
                      classroom_id: room.classroom_id,
                    }))}
                    className="ig-press flex items-center justify-between gap-3 rounded-cell border border-ledger-rule bg-ledger-raised px-2.5 py-2 text-left hover:border-crest-edge hover:bg-crest-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-wait disabled:opacity-60"
                  >
                    <RoomPlate
                      room={room.room_name}
                      building={room.building}
                      type={room.room_type}
                      capacity={room.capacity}
                    />
                    <Plus className="size-4 shrink-0 text-ink-tertiary" strokeWidth={2} />
                  </button>
                ))}

                {/*
                  * Rooms that would fit this class but are taken right now.
                  * Shown because "the room you wanted is holding CS-201" is
                  * what decides whether to move this class or that one —
                  * information a picker listing only free rooms throws away.
                  */}
                {picking.cell.occupied_rooms.length > 0 && (
                  <>
                    <p className="mt-2 text-[0.66rem] font-bold uppercase tracking-[0.05em] text-ink-muted">
                      Would fit, but taken this period
                    </p>
                    {picking.cell.occupied_rooms.map((room) => (
                      <div
                        key={room.classroom_id}
                        className="flex items-center justify-between gap-3 rounded-cell bg-ledger-sunk px-2.5 py-1.5"
                      >
                        <RoomPlate room={room.room_name} type={room.room_type} size="sm" />
                        <span className="ig-tnum text-[0.72rem] text-ink-tertiary">
                          {room.occupied_by.subject_code} · {room.occupied_by.section_name}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ------------------------------------------------------------- pieces

const Fact = ({ label, value }) => (
  <div className="flex items-center gap-1.5">
    <dt className="whitespace-nowrap text-[0.68rem] font-bold uppercase tracking-[0.05em] text-ink-muted">
      {label}
    </dt>
    <dd className="ig-tnum flex items-center whitespace-nowrap text-[0.8rem] font-bold text-ink">
      {value}
    </dd>
  </div>
);

const FactRule = () => (
  <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-ledger-rule-firm" />
);

function Cell({ cell, kind, day, busy, onPlace, onRemove }) {
  const base =
    'flex h-[60px] w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-cell border px-0.5 text-center';

  if (kind === 'mine') {
    /*
     * The room is the content; removing is a corner control.
     *
     * Stacked vertically the plate and a full-width "Remove" needed 62px in a
     * 60px cell, so the label was sliced in half by the cell's own overflow.
     * Absolutely positioning it also stops a long room name from ever pushing
     * it out again.
     */
    const canUnplace = cell.own_session.can_unplace !== false;
    const taught = cell.own_session.attendance_count || 0;

    return (
      <div
        className={cn(base, 'relative border-crest bg-crest-wash')}
        aria-label={`${day}: this class meets in ${cell.own_session.room_name}`}
      >
        <RoomPlate room={cell.own_session.room_name} type={cell.own_session.room_type} size="sm" />

        <Tooltip>
          <TooltipTrigger asChild>
            {/*
              * Kept mounted and focusable even when it cannot act, because a
              * control that vanishes gives the user nothing to ask. Disabled
              * carries the reason in the tooltip instead.
              */}
            <button
              type="button"
              disabled={busy || !canUnplace}
              onClick={onRemove}
              aria-label={
                canUnplace
                  ? `Remove this period in ${cell.own_session.room_name}`
                  : `Cannot remove: ${taught} attendance records`
              }
              className={cn(
                'ig-press absolute right-1 top-1 inline-flex size-6 items-center justify-center rounded-[4px]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                canUnplace
                  ? 'text-ink-tertiary hover:bg-crest/10 hover:text-crest-deep'
                  : 'cursor-not-allowed text-ink-muted opacity-60'
              )}
            >
              <Trash2 className="size-3" strokeWidth={2} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[18rem] text-pretty">
            {canUnplace
              ? 'Remove this period from the grid.'
              : `This period has ${taught} attendance record(s) against it, so it `
                + 'cannot be removed — deleting it would delete them too. Cancel '
                + 'the offering instead, which keeps both.'}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  if (kind === 'open') {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onPlace}
        aria-label={`${day} ${hhmm(cell.start_time)}: free, ${cell.available_rooms.length} rooms available`}
        className={cn(
          base,
          'ig-press border-dashed border-stamp-clear/35 bg-stamp-clear-wash text-stamp-clear',
          'hover:border-solid hover:border-crest hover:bg-crest-wash hover:text-crest-deep',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          'disabled:cursor-wait'
        )}
      >
        <Plus className="size-3.5" strokeWidth={2} />
        <span className="ig-tnum text-[0.68rem] font-bold">
          {cell.available_rooms.length} free
        </span>
      </button>
    );
  }

  /*
   * Blocked. The tooltip carries the server's full sentences — the cell has
   * room for one short line, and truncating the explanation into it would
   * lose the half that names what is actually in the way.
   */
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          className={cn(
            base,
            'ig-hatch cursor-help border-ledger-rule bg-ledger-sunk text-ink-tertiary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
          )}
        >
          <span className="ig-tnum rounded-[3px] bg-ledger-raised/85 px-1 text-[0.66rem] font-semibold">
            {kind === 'no-room'
              ? 'no room'
              : cell.blockers[0]?.conflict?.subject_code || 'busy'}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[16rem] text-pretty">
        {cell.blockers.map((b) => b.message).join(' ')}
      </TooltipContent>
    </Tooltip>
  );
}

const LEGEND = [
  ['Meets here', 'border-crest bg-crest-wash'],
  ['Free', 'border-dashed border-stamp-clear/35 bg-stamp-clear-wash'],
  ['No room fits', 'ig-hatch border-ledger-rule bg-ledger-sunk'],
  ['Section or teacher busy', 'ig-hatch border-ledger-rule bg-ledger-sunk'],
];

const Legend = () => (
  <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 pb-0.5 pt-2">
    {LEGEND.map(([text, classes]) => (
      <span key={text} className="inline-flex items-center gap-1.5 text-[0.7rem] text-ink-tertiary">
        <span className={cn('size-3 rounded-[3px] border', classes)} />
        {text}
      </span>
    ))}
  </div>
);
