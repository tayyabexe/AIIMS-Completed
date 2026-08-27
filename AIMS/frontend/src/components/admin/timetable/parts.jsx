import { cn } from '@/lib/utils';

/*
 * The composing-stone vocabulary: the few small pieces this module invents,
 * kept together so their measurements cannot drift apart across screens.
 *
 * Everything else on these screens is a shadcn primitive bound to the tokens
 * in styles/composing-stone.css. These four exist because no primitive says
 * what they say.
 */

// =====================================================================
// ROOM PLATE — the signature
// =====================================================================
/*
 * A room in a university is a physical object with a number screwed to the
 * wall beside its door. This renders one.
 *
 * WHY THIS AND NOT A LINE OF TEXT
 * -------------------------------
 * "Room-403" as plain text is a string; the eye reads it as a word and has to
 * parse it. A plate is an object — it has an edge, a face, and a stamped
 * sub-line — so the eye finds every room reference on a dense screen without
 * reading any of them. On a grid of twenty-four cells and a worklist of two
 * hundred rows, that difference is the whole ergonomics of the screen.
 *
 * INSET, NOT RAISED
 * -----------------
 * The inner shadow is the point: a plate is screwed *into* a wall, so it sits
 * flush or slightly sunk. Giving it a drop shadow would make it float like a
 * button and invite a click it does not always accept.
 *
 * The number is tabular so plates of different numbers stay the same width in
 * a column, and brass carries the sub-line because brass is what these are
 * actually made of — it is the one place in the palette that colour is
 * decorative rather than semantic, and it is confined to this component.
 */
export function RoomPlate({ room, building, type, capacity, size = 'md', className }) {
  const compact = size === 'sm';

  return (
    <span
      className={cn(
        'inline-flex flex-col items-start rounded-plate border',
        'border-plate-edge bg-plate-face',
        'shadow-[inset_0_1px_0_rgb(255_255_255/0.7),inset_0_-1px_0_rgb(28_25_23/0.05)]',
        compact ? 'px-1.5 py-0.5' : 'px-2 py-1',
        className
      )}
    >
      <span
        className={cn(
          'ig-tnum font-semibold leading-none text-ink',
          compact ? 'text-[0.72rem]' : 'text-[0.8rem]'
        )}
      >
        {room}
      </span>

      {/*
        * The stamped sub-line. Omitted entirely rather than rendered empty
        * when there is nothing to stamp — a plate with a blank second line
        * reads as missing data rather than as a plate that simply has one
        * line.
        */}
      {(building || type || capacity != null) && (
        <span
          className={cn(
            'leading-none text-plate-brass',
            compact ? 'text-[0.58rem] mt-[2px]' : 'text-[0.62rem] mt-[3px]'
          )}
        >
          {[building, type, capacity != null ? `${capacity} seats` : null]
            .filter(Boolean)
            .join(' · ')}
        </span>
      )}
    </span>
  );
}

// =====================================================================
// COMPLETION METER — discrete, because periods are discrete
// =====================================================================
/*
 * "2 of 3 placed" drawn as three ticks, two filled.
 *
 * WHY NOT A PROGRESS BAR
 * ----------------------
 * A bar at 67% implies a continuum, and a class does not have two-thirds of a
 * period — it has two periods out of three. The bar would also make 2/3 and
 * 4/6 look identical when they are different amounts of work. Discrete ticks
 * show the count *and* the total at a glance, which is the actual question:
 * "how many more do I have to place?"
 *
 * Over-placement gets its own tick colour rather than being clamped away. A
 * class with more periods on the grid than it needs is a real state — the
 * requirement was lowered after the timetable was built — and silently
 * showing it as "complete" hides a period that is still being taught.
 */
export function CompletionMeter({ placed, required, showCount = false, className }) {
  const total = Math.max(required, placed);

  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      role="img"
      aria-label={`${placed} of ${required} periods placed`}
    >
      <span className="inline-flex items-center gap-[3px]">
        {Array.from({ length: total }, (_, i) => {
          const filled = i < placed;
          const surplus = i >= required;

          return (
            <span
              key={i}
              className={cn(
                'h-[13px] w-[5px] rounded-[1.5px] border',
                surplus
                  ? 'border-stamp-void bg-stamp-void'
                  : filled
                    ? 'border-crest bg-crest'
                    : 'border-ledger-rule-firm bg-ledger-sunk'
              )}
            />
          );
        })}
      </span>

      {/*
        * A single tick reads as a stray mark, not a measure. Below about
        * three the ticks stop carrying the count on their own, so the figure
        * is spelled out beside them — the meter shows the shape of the work,
        * the number settles what it is.
        */}
      {showCount && (
        <span
          className={cn(
            'ig-tnum text-[0.7rem] font-semibold leading-none',
            placed > required ? 'text-stamp-void'
              : placed === required ? 'text-ink-tertiary' : 'text-ink-secondary'
          )}
        >
          {placed}/{required}
        </span>
      )}
    </span>
  );
}

// =====================================================================
// PROGRESS RIBBON — the summary that is also the filter
// =====================================================================
/*
 * One horizontal bar, segmented by scheduling state, replacing the row of six
 * KPI tiles that every admin screen defaults to.
 *
 * WHY ONE OBJECT INSTEAD OF SIX
 * -----------------------------
 * Six tiles show six numbers and no relationship. The single question a
 * timetabler has on opening this screen is "how much of this term is done",
 * and that is a proportion — which a segmented bar answers before any number
 * is read, because the widths *are* the answer.
 *
 * Clicking a segment filters the list to it. The count was always the thing
 * being clicked anyway: "3 unstaffed" is a question, and the list is its
 * answer, so the two are one control rather than a figure and a separate
 * dropdown that can disagree with it.
 */
export function ProgressRibbon({ segments, active, onSelect, className }) {
  const total = segments.reduce((n, s) => n + s.value, 0) || 1;

  /*
   * A state with a count of zero cannot be filtered to and has no width on
   * the bar, so a chip for it is a control that does nothing sitting beside
   * four that do. Suppressing them is what lets this live inline in the
   * command band instead of owning a 95px card: on a finished term the whole
   * summary collapses to one bar and one chip.
   */
  const present = segments.filter((s) => s.value > 0);

  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <div
        className={cn(
          'flex h-2 w-[110px] shrink-0 overflow-hidden rounded-full',
          'border border-ledger-rule bg-ledger-sunk'
        )}
      >
        {present.map((s) => (
          <button
            key={s.key}
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => onSelect(active === s.key ? '' : s.key)}
            style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.colour }}
            className={cn(
              'h-full cursor-pointer border-0 transition-opacity duration-150',
              active && active !== s.key ? 'opacity-30' : 'opacity-100',
              'hover:opacity-100'
            )}
          />
        ))}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {present.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={active === s.key}
            onClick={() => onSelect(active === s.key ? '' : s.key)}
            className={cn(
              // min-h-6: a 20px chip is under the 24px minimum target size.
              'ig-press flex min-h-6 items-center gap-1.5 rounded-control border px-1.5 py-[3px]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
              active === s.key
                ? 'border-ink/25 bg-ledger-sunk'
                : 'border-transparent hover:bg-ledger-sunk'
            )}
          >
            <span
              className="size-2 shrink-0 self-center rounded-[2px]"
              style={{ backgroundColor: s.colour }}
            />
            <span className="ig-tnum text-[0.78rem] font-bold leading-none text-ink">{s.value}</span>
            <span className="whitespace-nowrap text-[0.72rem] font-medium leading-none text-ink-tertiary">
              {s.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// STAMP — a status mark, not a pill
// =====================================================================
/*
 * Four levels of text hierarchy exist for a reason, and a status here is
 * metadata, not a headline. So this is a small stamped mark rather than the
 * saturated rounded-full chip that every dashboard reaches for: on a list of
 * two hundred rows, two hundred bright pills are the loudest thing on screen
 * and the one thing nobody needs to read first.
 */
const STAMP_TONE = {
  clear:   'border-stamp-clear/25 bg-stamp-clear-wash text-stamp-clear',
  pending: 'border-stamp-pending/25 bg-stamp-pending-wash text-stamp-pending',
  void:    'border-stamp-void/25 bg-stamp-void-wash text-stamp-void',
  quiet:   'border-ledger-rule bg-ledger-sunk text-ink-tertiary',
};

export function Stamp({ tone = 'quiet', children, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-[2px]',
        'text-[0.66rem] font-bold uppercase tracking-[0.04em] whitespace-nowrap',
        STAMP_TONE[tone] ?? STAMP_TONE.quiet,
        className
      )}
    >
      {children}
    </span>
  );
}

// =====================================================================
// SKELETONS — the wait, shaped like the answer
// =====================================================================
/*
 * A skeleton that resembles the incoming screen makes the wait feel like
 * loading; a centred spinner makes it feel like nothing is happening. These
 * two are the pieces every screen in this module waits with, kept here for
 * the same reason the rest of this file exists: so their measurements cannot
 * drift apart from the real rows they stand in for.
 *
 * The sizes are fixed rather than random. A skeleton that reshuffles on every
 * render reads as data arriving and then changing its mind.
 *
 * `ig-shimmer` carries the sweep and its own reduced-motion fallback, so
 * nothing here has to know about that.
 */
export function SkeletonLine({ w = '100%', h = 10, className, style }) {
  return (
    <span
      aria-hidden="true"
      className={cn('ig-shimmer block rounded-[5px]', className)}
      // `style` is merged rather than replaced so a caller can set the
      // `--i` stagger index without also having to restate the size.
      style={{ width: w, height: h, ...style }}
    />
  );
}

/*
 * The queue rail, before it has anything to queue.
 *
 * Drawn at the real rail's proportions — the search well, the count line, then
 * rows with a title and a subtitle — so the layout does not jump when the rows
 * replace it. `role="status"` with a label, because the shape is decorative
 * and only the fact of loading is worth announcing.
 */
export function RailSkeleton({ rows = 9, label = 'Loading…' }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex max-h-[calc(100vh-140px)] flex-col overflow-hidden rounded-card border border-ledger-rule bg-card"
    >
      <div className="shrink-0 border-b border-ledger-rule p-2">
        <SkeletonLine h={32} className="rounded-control" />
        <div className="mt-1.5 px-0.5"><SkeletonLine w="38%" h={9} /></div>
      </div>

      <ul className="divide-y divide-ledger-rule">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="ig-rise flex flex-col gap-1.5 px-3 py-3" style={{ '--i': i }}>
            <div className="flex items-center justify-between gap-2">
              {/* Names are not all one length; a column of identical bars
                  reads as a table of one repeated value. */}
              <SkeletonLine w={`${52 + ((i * 13) % 26)}%`} h={11} />
              <SkeletonLine w={38} h={11} />
            </div>
            <SkeletonLine w={`${64 + ((i * 7) % 20)}%`} h={9} />
          </li>
        ))}
      </ul>
    </div>
  );
}
