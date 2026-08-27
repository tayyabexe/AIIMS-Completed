/*
 * The editable grid both customisable screens are built on.
 *
 * Every card on the screen — the built-in panels as much as the pinned queries
 * — is an item in here. That is the whole reason a dropped chart can land
 * *between* the existing panels and push them aside, rather than being
 * confined to a strip underneath them: there is no "existing content" and
 * "new content", there is one grid.
 *
 * TWO WIDTHS, ARRANGEABLE SEPARATELY
 * ----------------------------------
 * Above 900px this is the twelve-column desktop grid. Below it, one full-width
 * column — a three-column stat tile is ~340px on a monitor and about 150px on
 * a narrow laptop window with the sidebar open, narrow enough that a figure
 * like "Rs 108.3M" wraps and the tile stops working. Both are arrangeable and
 * each is stored against its own breakpoint, so tidying up on a tablet never
 * flattens the desktop arrangement.
 *
 * HEIGHTS ARE PIXELS, NOT ROWS
 * ----------------------------
 * rowHeight is 1 and the vertical margin is 0, so an item's `h` is exactly its
 * height in pixels and the 16px gap between rows is padding inside each cell.
 * Under the library's usual rowHeight+margin arithmetic the smallest
 * expressible height step was 46px, which is why the Dashboard's tiles could
 * not be their own height and came out as long rectangles.
 *
 * CONFIGURED FOR react-grid-layout v2, WHICH IS NOT v1's API
 * ----------------------------------------------------------
 * v2 replaced the flat props every v1 example uses — cols, rowHeight, margin,
 * containerPadding, isDraggable, isResizable, isDroppable, preventCollision,
 * compactType, draggableCancel, resizeHandles, useCSSTransforms — with grouped
 * config objects: gridConfig, dragConfig, resizeConfig, dropConfig, and a
 * `compactor` function.
 *
 * Unknown props are ignored silently rather than warned about, so the first
 * version of this file looked correct, type-checked, built, and ran with EVERY
 * setting at its default: 150px rows, 10px margins, and dragging and resizing
 * enabled permanently — including outside edit mode. A browser test measuring
 * a card at 26,550px is what surfaced it.
 *
 * `verticalCompactor` is the "adjacent cards float away and make room"
 * behaviour: a card dragged onto an occupied cell pushes the occupant, and
 * compaction then closes the gap it left rather than leaving a hole.
 *
 * WHY THE GRID IS INERT UNTIL THE PENCIL IS PRESSED
 * -------------------------------------------------
 * Outside edit mode nothing drags, nothing resizes, no handles are painted and
 * no remove buttons exist. A dashboard is read far more often than it is
 * arranged, and a screen where a stray click-and-drag silently rearranges the
 * institute's figures is worse than one that has to be unlocked first.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { GridLayout, verticalCompactor } from 'react-grid-layout';
import { peekDrag, endDrag } from './dragState';
import CardMenu from './CardMenu';
import AutoHeightCell from './AutoHeightCell';
import './pinned.css';

/*
 * react-grid-layout needs a pixel width and will not measure its own
 * container. WidthProvider is the library's answer, but it listens on window
 * resize only — inside this portal the sidebar collapses and expands without
 * the window changing size at all, which would leave the grid a sidebar's
 * width too wide until the next window resize.
 *
 * A ResizeObserver on the actual element catches both.
 */
function useMeasuredWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0].contentRect.width);
      // Sub-pixel churn would re-render the grid on every scroll in some
      // browsers; only a real change counts.
      setWidth((current) => (Math.abs(current - next) > 1 ? next : current));
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

export default function CardGrid({
  cards,
  layouts,
  rules,
  editing,
  breakpoint,
  onBreakpointChange,
  renderCard,
  onLayoutChange,
  onDropCard,
  onRemoveCard,
  onResizeCard,
  onFitCard,
  onChangeVisual,
  savedById,
  droppingSize,
  onAutoHeight,
}) {

  const [wrapRef, width] = useMeasuredWidth();

  // The right-click menu: which card, and where the pointer was.
  const [menu, setMenu] = useState(null);

  const rowHeight = rules?.rowHeight ?? 1;
  const margin = rules?.margin ?? 16;
  const gap = rules?.gap ?? 16;

  const bps = rules?.breakpoints || {
    lg: { minWidth: 900, columns: 12 },
    sm: { minWidth: 0, columns: 1 },
  };

  /*
   * WHICH LAYOUT IS ON SCREEN — DECIDED HERE, NOT BY THE LIBRARY.
   * -----------------------------------------------------------
   * The palette floats over the page rather than taking room out of it, so the
   * grid is the same width whether or not it is open. That is deliberate: an
   * earlier version inset the content by the panel's width, which meant every
   * card reflowed the moment the panel opened and reflowed back when it
   * closed — you could not position anything against a layout that moved as
   * soon as you reached for the tool to position it with.
   *
   * Because the width never changes, the breakpoint is simply the width.
   */
  const decisionWidth = width;

  const active = Object.entries(bps)
    .sort((a, b) => b[1].minWidth - a[1].minWidth)
    .find(([, v]) => decisionWidth >= v.minWidth)?.[0] || 'sm';

  const cols = bps[active]?.columns ?? 12;

  // Tell the owner when the answer changes, so the drawer can say which
  // layout is being edited and edits are filed under the right breakpoint.
  useEffect(() => {
    onBreakpointChange?.(active);
  }, [active, onBreakpointChange]);

  /*
   * The cards whose height the user has chosen at the breakpoint on screen.
   * Read from the layout this component was handed rather than from RGL's own
   * output, so it reflects the saved geometry and not a drag in progress.
   */
  const sizedByUser = new Set(
    (layouts[active] || []).filter((it) => it.userSized).map((it) => it.i),
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  /*
   * Right-click opens the card menu — size, and for a pinned query the chart
   * type. Only while editing: a right-click on a dashboard someone is reading
   * should be the browser's own menu, because that is what they meant.
   */
  const onContextMenu = useCallback((event, card) => {
    if (!editing) return;
    event.preventDefault();
    setMenu({ card, x: event.clientX, y: event.clientY });
  }, [editing]);

  /*
   * A chip dropped from the strip.
   *
   * RGL gives us the cell it landed on; the payload comes from the module
   * variable the strip set on dragstart (see dragState.js for why it is not
   * dataTransfer). A drop with no payload is ignored rather than guessed at —
   * something dragged in from outside the page is not a card.
   */
  const handleDrop = useCallback((_layout, item) => {
    const payload = peekDrag();
    endDrag();
    if (!payload) return;

    const saved = savedById.get(payload.savedQueryId);
    if (!saved) return;

    onDropCard(saved, payload.visual, {
      x: item.x, y: item.y, w: payload.w, h: payload.h,
    }, breakpoint);
  }, [onDropCard, savedById, breakpoint]);

  /*
   * RGL reports the layout for whichever breakpoint is active. Passing the
   * breakpoint through means a narrow-width rearrangement is written to the
   * narrow rows and cannot overwrite the desktop ones.
   */
  const handleLayoutChange = useCallback((current) => {
    /*
     * Positions are only ever read back while the board is being arranged.
     *
     * Outside edit mode nothing can move a card except the library itself:
     * compaction closing the gap under a panel that measured shorter than its
     * seeded height, or a reflow when the window changes width. Recording
     * those wrote a saved layout for every person who merely opened the
     * screen, and stamped their board "customised" before they had touched it.
     *
     * Adding, removing and restoring cards mark the layout dirty themselves,
     * and all three happen while editing anyway.
     */
    if (!editing) return;
    onLayoutChange(current, breakpoint);
  }, [onLayoutChange, breakpoint, editing]);

  /*
   * The resize handle was released. This is the ONLY event that means a person
   * chose a height.
   *
   * `onLayoutChange` cannot tell them apart: it fires on mount, on every
   * container resize and after every content measurement, so treating a height
   * that arrives through it as a decision marked cards user-sized on load and
   * made them impossible to shrink. See applyGeometry in usePinnedSurface.
   */
  /*
   * `axis` tells the surface WHICH dimension the user actually dragged.
   *
   * It matters for measured cards. A resize marks a card `userSized`, which is
   * what stops it snapping back to the height of its contents — correct when
   * someone dragged it taller, wrong when they only widened it. Without this,
   * pulling a stat tile wider froze its height at whatever it happened to be,
   * and the only way back was "Fit to content".
   *
   * The east handle cannot change `h`, so an unchanged height is a reliable
   * signal rather than a guess.
   */
  const handleResizeStop = useCallback((_layout, oldItem, newItem) => {
    if (!newItem) return;

    const axis = oldItem && newItem.h === oldItem.h ? 'x' : 'xy';
    onResizeCard(newItem.i, newItem.w, newItem.h, breakpoint, axis);
  }, [onResizeCard, breakpoint]);

  return (
    <div ref={wrapRef} className="pin-gridwrap">
      {width > 0 && (
        <GridLayout
          className={`pin-grid${editing ? ' is-editing' : ''}`}
          layout={layouts[active] || []}
          width={width}
          gridConfig={{
            cols,
            rowHeight,
            /*
             * Zero VERTICAL margin, on purpose. The 16px gap between rows is
             * padding inside each cell instead, which makes `h` an exact pixel
             * height rather than a multiple of (rowHeight + margin).
             */
            margin: [margin, 0],
            containerPadding: [0, 0],
          }}
          compactor={verticalCompactor}
          dragConfig={{
            enabled: editing,
            /*
             * `a` is deliberately not cancelled here.
             *
             * Cancelling anchors broke dragging on exactly the cards people
             * reach for first: every stat tile is wrapped in a <Link> to the
             * screen it summarises, so the selector matched the whole tile and
             * the Dashboard's four headline cards could not be dragged at all.
             * The links are removed from the built-ins while editing instead
             * (see DashboardHome), with a stylesheet rule as a second guard.
             */
            cancel: '.pin-icon-btn, .pin-btn, button, input, select, textarea',
          }}
          /*
           * Two handles, not one.
           *
           * 'se' alone made width and height a single gesture, so widening a
           * card by one column meant nudging a corner without disturbing its
           * height — fiddly on a chart and nearly impossible on a measured stat
           * tile, whose height is not the user's to set in the first place.
           *
           * 'e' is a width-only grip down the trailing edge. It is the one
           * people reach for: how wide a panel is decides what sits beside it,
           * which is the actual arranging decision.
           */
          resizeConfig={{ enabled: editing, handles: ['e', 'se'] }}
          dropConfig={{
            enabled: editing,
            /*
             * The placeholder while something from the strip is hovering,
             * sized from the chip's own default so the outline shown during
             * the drag is the size the card will actually be.
             */
            defaultItem: {
              w: droppingSize?.w ?? 6,
              h: droppingSize?.h ?? 336,
            },
          }}
          droppingItem={{
            i: '__dropping__',
            w: droppingSize?.w ?? 6,
            h: droppingSize?.h ?? 336,
          }}
          onDrop={handleDrop}
          onLayoutChange={handleLayoutChange}
          onDragStart={closeMenu}
          onResizeStart={closeMenu}
          onResizeStop={handleResizeStop}
        >
          {cards.map((card) => {
            const body = renderCard(card, {
              editing,
              openMenu: (e) => onContextMenu(e, card),
              remove: () => onRemoveCard(card.uid),
            });

            /*
             * WHY `userSized` IS PART OF THIS AND NOT JUST `autoHeight`
             * ---------------------------------------------------------
             * A measured cell deliberately does NOT stretch what is inside it —
             * see the rule for `.pin-cell.is-measured` in pinned.css and the
             * header of AutoHeightCell. The card is as tall as the panel, so
             * forcing the panel to fill the card would make the measurement
             * describe itself.
             *
             * That is right up until the moment someone drags the card taller.
             * From then on the cell grew and the white card did not, so the
             * extra height arrived as empty space UNDER the card rather than as
             * a bigger card — the grid appeared to resize nothing but the gap.
             *
             * A height the user chose is not a height to be measured. Once
             * `userSized` is set the card leaves the measured path, the
             * `:not(.is-measured)` rules give its contents `height: 100%`, and
             * the card fills what was dragged. "Fit to content" clears the flag
             * and hands it back to the observer.
             *
             * A width-only drag never sets the flag (see handleResizeStop), so
             * widening a tile still re-measures: the supporting line unwraps,
             * the card gets shorter, and the cell follows it.
             */
            const measured = card.autoHeight === true && !sizedByUser.has(card.uid);

            return (
              <div
                key={card.uid}
                className={`pin-cell${measured ? ' is-measured' : ''}`}
                onContextMenu={(e) => onContextMenu(e, card)}
              >
                {measured ? (
                  <AutoHeightCell
                    onMeasure={(px) => onAutoHeight?.(card.uid, px + gap)}
                  >
                    {body}
                  </AutoHeightCell>
                ) : body}
              </div>
            );
          })}
        </GridLayout>
      )}

      {menu && (
        <CardMenu
          card={menu.card}
          at={{ x: menu.x, y: menu.y }}
          rules={rules}
          breakpoint={breakpoint}
          savedQuery={menu.card.savedQueryId ? savedById.get(menu.card.savedQueryId) : null}
          onResize={(w, h) => { onResizeCard(menu.card.uid, w, h, breakpoint); closeMenu(); }}
          onFit={() => { onFitCard(menu.card.uid, breakpoint); closeMenu(); }}
          onChangeVisual={(v) => { onChangeVisual(menu.card.uid, v); closeMenu(); }}
          onRemove={() => { onRemoveCard(menu.card.uid); closeMenu(); }}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
