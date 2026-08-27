# AIMS — interface design system

Established on the **Ask the Data** page (`pages/admin/AIAnalytics.css`,
`.aa--faculty`) and now carried by the two admin screens built on the shadcn
layer: **Timetable Management**
(`AIMS/frontend/src/components/admin/TimetableManagement.jsx`) and the
**Qualification registry**
(`AIMS/frontend/src/components/admin/TeacherQualifications.jsx`).

Scope note: this direction governs **Ask the Data, the timetable module and the
qualification registry**. The rest of the admin portal is inline-styled with a
`#991b1b` accent and has not been migrated. Do not half-convert a screen —
either it is in this system or it is not.

---

## Direction — "indigo glass"

**What replaced what.** These screens were first built in *composing stone* —
warm ledger paper, a maroon crest, brass room plates, named for the timetable
office this software replaces. That direction was coherent, and it was an
island. The page a registrar is most likely to have open beside the timetable
is Ask the Data, and the two looked like different products. A house style only
one module speaks is not a house style.

So the palette moved and the vocabulary did not. Every token was named for the
job it does in the domain — the substrate, the ink, the institution's accent,
the status stamps — never for its hue, which is why the move was one stylesheet
rather than two thousand lines of JSX. A crest is whatever colour the
institution's crest is.

**Who it is for.** A registrar in August, before term starts, with a printout
and three department heads emailing about room clashes. They will spend three
hours in these screens, not three minutes, repeating the same action hundreds
of times.

**What it must feel like.** A workbench, not a brochure. Dense, factual, fast —
with one frosted, lit surface at the top of it. The light is texture; the work
underneath it is flat, gridded and quiet.

---

## Palette

Source of truth: `AIMS/frontend/src/styles/indigo-glass.css`.

Tokens are **domain-named** (`--ledger`, `--plate-brass`, `--crest`, `--ink`),
never `--gray-700`. Someone reading only the variables should be able to guess
what the product is.

**60/30/10.** `--ledger` + `--ledger-rule` carry the substrate (~60%), the
`--ink` family carries text and structure (~30%), `--crest` is held to the last
~10%.

**The crest rule — the single most important constraint here.** The accent
(`#4338CA`) means exactly two things and nothing else:

> "this class" and "this period is booked"
> — on the registry screen: "this teacher" and "this is recorded"

`--primary` is deliberately mapped to `--ink`, **not** the crest, so registry
components' default buttons, active tabs and focus rings do not spend the
accent. The moment indigo also means "primary button", a booked period stops
being findable on a grid of twenty-four.

**One gain from the move, worth stating.** Under maroon, `--stamp-void`
(`#A33A3A`) and the crest (`#991B1B`) were close enough to be confusable on a
0.66rem stamp. Against indigo, rose (`#BE123C`) is unambiguous.

Brass (`--plate-brass`) is confined to `RoomPlate` and is the one place colour
is decorative rather than semantic. It stays **warm on a cool page on purpose**
— warm-on-cool is what makes a plate read as a physical object screwed to a
wall rather than as another panel.

---

## Depth, spacing, radius, motion

- **Depth: borders-first.** A dense technical tool; twenty-four shadowed cells
  is soup. Three shadows exist (`--lift`, `--lift-md`, `--lift-sheet`) and only
  things that genuinely float use them: the command band, popovers, dialogs.
- **Glass is opt-in.** `--glass` / `--glass-blur` resolve to a solid white and
  `0px` unless `@supports (backdrop-filter)` says otherwise. A translucent
  panel over a browser that cannot blur is just a washed-out panel with poor
  text contrast.
- **Spacing base: 4px.** Steps at 4 / 8 / 12 / 16 / 24 / 32.
- **Radius scale:** plate 3 · control 9 · cell 10 · card 12 · sheet 18 · pill.
  Concentric — a child inside a `rounded-card` with 8px padding gets ~4px less.
- **Motion:** `--ease-out` (`cubic-bezier(0.32, 0.72, 0, 1)`, shared with Ask
  the Data), `--t-fast` 140ms, `--t-slow` 260ms. Never ease-in: it delays the
  first frame, which is the one the user is watching.

### The motion vocabulary

| Class | What it is | Where |
|---|---|---|
| `.ig-band` | The frosted command band, with two blurred discs drifting behind it on long mismatched cycles so the loop is never visible. Transform-only. | The sticky band on both screens |
| `.ig-rise` | An entrance. `--i` on the element multiplies a 28ms delay, so a rail arrives as a sequence. | Rail rows, notices, panels, skeleton groups |
| `.ig-press` | `scale(0.96)` on press. Below ~0.95 a control looks squashed rather than pressed. | Every button |
| `.ig-lift` | 1px rise + shadow on hover. One pixel, not four: a card that jumps is charming twice and tiring by the twentieth row. | Staffing rows |
| `.ig-mark` | A tick that lands (scale 0.4 → 1, 200ms) rather than appearing. | The qualification checkbox |
| `.ig-pulse` | A slow opacity/scale pulse, for "live". | Reserved |
| `.ig-shimmer` | The skeleton sweep — a moving *background*, not a moving element, so nothing is laid out twice per frame. | Skeletons |

**Cap the stagger.** Callers pass `Math.min(i, 12)`. Past a dozen rows the last
one is waiting on an animation instead of on data, which is the opposite of the
intended impression.

**Reduced motion is one blanket block** at the end of the stylesheet. Nothing
above conveys information that is not also conveyed statically, so it is a
removal rather than a set of gentler alternatives. Colour and opacity still
change on press and hover — they are feedback, not decoration.

---

## Loading

**A skeleton, shaped like the answer — never a spinner, never a figure.**

A skeleton that resembles the incoming screen makes the wait feel like loading;
a centred spinner makes it feel like nothing is happening. `SkeletonLine` and
`RailSkeleton` live in `timetable/parts.jsx` so their measurements cannot drift
from the real rows they stand in for; each screen composes its own board
skeleton from them.

Two rules:

- **Print no figures.** A skeleton showing `0 of 0` or `0/0 periods` is
  indistinguishable from an answer, and it is the answer the eye reads first.
  (This is the same failure `RouteLoader` was written to fix — see its header.)
- **Fixed sizes, not random.** A skeleton that reshuffles on every render reads
  as data arriving and then changing its mind. Row widths vary by index
  (`52 + ((i * 13) % 26)`) so a column of identical bars does not read as one
  repeated value, but they are stable across renders.

A **refetch** does not go back to a skeleton. The previous rows stay and the
control dims; replacing a populated table with a skeleton on every keystroke is
its own kind of unusable.

---

## Hierarchy rules held here

- **One focal point per view.** On the timetable screen it is the grid, on the
  registry it is the curriculum tree — not the queue. Expressed structurally: a
  **320–340px rail** against a dominant board, never a 50/50 two-pane. The
  proportion states that the queue serves the board.
- **The band is 48px and stays 48px.** Ask the Data's hero is 34px of padding
  around one question box, which is right for a page with one thing to do.
  These screens *collapsed* exactly that kind of chrome to get the grid from
  y=530 to y≈270. So they take the glass and the drifting light and put it
  behind the band, at the height the work needs. **Do not grow this into a
  hero.**
- **Weight and colour before size.** Three tiers at nearly one size:
  value `600/--ink` · label `500/--ink-secondary` · meta `400/--ink-tertiary`.
- **Four text levels exist and all four are used**: `--ink`, `--ink-secondary`,
  `--ink-tertiary`, `--ink-muted`. Two levels means the hierarchy is too flat.
- **Never colour alone.** Blocked cells carry `.ig-hatch` (a diagonal
  strike-through, from how this was marked on paper) so state survives a squint
  and a red-green deficiency.
- **Tabular numerals on every dynamic figure** via `.ig-tnum`.
- **Absence is the "done" signal.** No status pill on every row. A complete
  class gets no stamp; a teacher with subjects recorded gets no stamp. A stamp
  means "this needs you".

---

## Component patterns

Signature and shared pieces live in
`AIMS/frontend/src/components/admin/timetable/parts.jsx`.

- **`RoomPlate`** — *the signature*. A room is a physical object with a number
  screwed to a wall. Brass sub-line, `--r-plate` (3px), **inset** shadow
  (`inset 0 1px 0 rgb(255 255 255/0.7)`), never a drop shadow — a plate is
  screwed in, not floating. Sizes: `sm` and `md`. Use it for *every* room
  reference; that is what lets the eye find rooms on a dense screen without
  reading them.
- **`CompletionMeter`** — discrete ticks (5×13px, 3px gap), not a progress bar.
  Periods are countable; a bar at 67% implies a continuum and makes 2/3 and 4/6
  look identical. Surplus ticks are `--stamp-void`, never clamped away.
- **`ProgressRibbon`** — one segmented 10px bar that is simultaneously the
  summary and the filter, replacing a row of KPI tiles. Zero-valued segments
  are suppressed: a chip that cannot be filtered to is a control that does
  nothing sitting beside four that do.
- **`Stamp`** — a small bordered mark (0.66rem, uppercase, 0.04em tracking),
  **not** a saturated rounded-full pill. On 200 rows, 200 bright pills are the
  loudest thing on screen and the one nobody needs first.
- **`SkeletonLine` / `RailSkeleton`** — see **Loading** above.
- **Grid cell** — 60px tall, `--r-cell`. Four kinds, classified in one place by
  `cellKind()`: `mine` (crest border + wash), `open` (dashed, stamp-clear),
  `no-room` / `busy` (both hatched). Colour, texture and click handler must not
  drift apart.
- **The qualification toggle** — `role="checkbox"` with `aria-checked` on a
  real `<button>`, so Space toggles it and a screen reader announces it. The
  mark carries the crest because on a tree of forty rows the ticks are what the
  eye is counting — the same job the crest does on the grid.

---

## Never offer a control that is guaranteed to fail

Three places now do this, and they should all keep doing it:

- **PlacementGrid's `Remove`** — `attendance.timetable_id` is `ON DELETE
  CASCADE`, so the server refuses (422) any period that has been taught. The
  control stays mounted and focusable, **disabled, with the reason in a
  tooltip**.
- **The qualification toggle** — the server refuses to revoke a qualification
  the teacher is currently teaching against, so a subject with
  `teaching_now > 0` is disabled with the reason in a tooltip. A disabled
  button fires no pointer events, so the `TooltipTrigger` must wrap it —
  otherwise the one row that needs an explanation is the one row whose tooltip
  never opens.
- **The corollary, which is easier to get wrong:** *do not let an error take
  away the control that fixes it.* An unstaffed class 422s the placement grid
  with "assign a teacher first", and returning only that notice removed the
  **Assign teacher** button and the class's own name along with it. The
  identity and the action are drawn from the queue row the panel was opened
  from, above the notice.

---

## Layering

**One scale for the whole app**, in `indigo-glass.css`:

`--z-chrome` 100 · `--z-chrome-raised` 900 · `--z-chrome-menu` 1200 ·
`--z-overlay` 2000

The legacy chrome picked its numbers independently (header/sidebar 100,
assistant FAB 900, pinned panel 950–970, account menu 1200) and every shadcn
overlay ships `z-50`. 50 < 100, so every tooltip, select and dialog in these
modules painted *underneath* the chrome.

> **Adding an overlay? Use `--z-overlay`.** A portalled overlay is summoned *by*
> the chrome it has to cover, so it must outrank all of it. Never invent a
> number.

---

## CSS mechanics that will bite

- **Global resets must live in `@layer base`.** Unlayered CSS beats **every**
  rule in a cascade layer regardless of specificity, and Tailwind v4 emits
  utilities into `@layer utilities` — so an unlayered `* { margin: 0 }` makes
  every `px-4`/`py-3` in the app compute to `0px`. Both offenders are fixed;
  do not add a third.
- **`indigo-glass.css` is deliberately unlayered**, which is why `.ig-band`
  sets its own background and the element carries **no `bg-*` utility**. Two
  sources for one background is how they drift apart.
- **`@import` must precede every rule**, so the palette sits directly under
  `@import "tailwindcss"` in `index.css`.

---

## Component layer

shadcn/ui, `new-york` style, **JSX not TSX**, at `@/components/ui/*`.

- `components.json` · `@/` alias in both `vite.config.js` and `jsconfig.json`
- `cn()` in `@/lib/utils`
- deps: `radix-ui` (unified), `class-variance-authority`, `clsx`,
  `tailwind-merge`, `tw-animate-css`
- Registry components bind to the shadcn semantic names, which
  `indigo-glass.css` maps onto the palette above. **Never** let the CLI write
  its own `:root` block — it would overwrite the mapping and land imported
  components in a different world from the screen they sit on.

**21st.dev is not usable without credentials.** Its registry answers
`npx shadcn add https://21st.dev/r/...` with `[Authentication required]`.
Components came from the canonical shadcn registry instead. Revisit if a
`REGISTRY_TOKEN` is provided.

---

## Use what exists

Before hand-rolling: native HTML → a Radix primitive from `@/components/ui` →
only then bespoke. `Tooltip` needs an explicit `TooltipProvider` (it does not
self-provide). `TooltipTrigger asChild` must not clone onto a `<td>` — Radix
spreads button props and `type` on a table cell is invalid HTML.
