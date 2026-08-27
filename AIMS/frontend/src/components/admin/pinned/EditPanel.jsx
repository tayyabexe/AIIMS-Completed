/*
 * The arrange panel: one button closed, a drawer on the right open.
 *
 * THERE IS NO SCRIM, AND THAT IS THE POINT
 * ----------------------------------------
 * The first version dimmed the page behind a full-viewport overlay, the way a
 * modal does. It made the feature completely unusable and a browser test
 * caught it immediately: the overlay sat on top of the grid, so every card
 * beneath it stopped receiving pointer events. Nothing could be dragged,
 * resized, right-clicked, or removed — while the panel whose entire purpose is
 * dragging things onto that grid was open.
 *
 * This is a working surface, not a modal. The page stays live underneath, and
 * the drawer is dismissed by Done, by its close button, or by Escape.
 *
 * WHY A DRAWER AND NOT AN INLINE BAR
 * ----------------------------------
 * The saved-query strip used to sit above the grid, which meant that dropping
 * a card near the bottom of a long screen — AI Insights runs to three or four
 * screenfuls — required dragging from a shelf that had scrolled out of view.
 * It cannot be dragged from somewhere you cannot see.
 *
 * Pinned to the right it stays reachable for the whole drag, at any scroll
 * position. The grid narrows by the drawer's width while it is open, which is
 * not a side effect to apologise for: the cards reflow live, so you are
 * arranging against the width you will actually get.
 *
 * WHY IT LOOKS LIKE THE REST OF THE DASHBOARD
 * -------------------------------------------
 * The first version of this was indigo and purple, with gradient buttons, on a
 * screen whose design system documents ONE accent — the institute's crimson
 * seal — and warm paper surfaces. Two design languages on one screen is what
 * made it read as bolted on. Everything here now draws from styles/adminTheme:
 * the same surfaces, the same four ink levels, the same hairline rules, the
 * same single accent, and the `ad-chip` / `ad-focusable` primitives the portal
 * already ships. Arranging should feel like moving sheets on the same desk,
 * not like opening a different application.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SlidersHorizontal, RotateCcw, Plus, Check, X, LayoutGrid, Columns2, GripHorizontal,
} from 'lucide-react';
import SavedQueryStrip from './SavedQueryStrip';

/*
 * How much room the open drawer takes.
 *
 * Exported because the grid needs it: the page is narrowed by this much while
 * arranging, and the grid has to add it back before deciding which layout it
 * is showing — otherwise opening the drawer on a desktop would shrink the
 * content past the narrow threshold and start silently editing the stacked
 * layout instead of the wide one.
 */
export const DRAWER_WIDTH = 292;

/*
 * Where the palette was left last time.
 *
 * Kept in localStorage rather than on the account: it is a property of the
 * screen you are sitting at — which corner is free depends on the window in
 * front of you — not of who you are, and it would be odd for a position
 * dragged on a laptop to follow you to a monitor.
 */
const POS_KEY = 'aims.pinned.palette';

const readPos = () => {
  try {
    const raw = localStorage.getItem(POS_KEY);
    const p = raw ? JSON.parse(raw) : null;
    return p && Number.isFinite(p.left) && Number.isFinite(p.top) ? p : null;
  } catch {
    return null;
  }
};

/*
 * Keeps the palette on screen.
 *
 * Applied when it is dropped AND on every window resize, because a position
 * that was perfectly good on a wide monitor puts it entirely off the side of a
 * smaller window — and a floating panel you cannot reach is a panel you cannot
 * close. A margin of its own width is left visible so it can always be grabbed
 * back.
 */
const clampPos = (pos, el) => {
  const w = el?.offsetWidth || DRAWER_WIDTH;
  const h = el?.offsetHeight || 240;
  const pad = 8;

  return {
    left: Math.min(Math.max(pos.left, pad), Math.max(pad, window.innerWidth - w - pad)),
    top: Math.min(Math.max(pos.top, pad), Math.max(pad, window.innerHeight - Math.min(h, 160) - pad)),
  };
};

const STATUS = {
  saving: 'Saving…',
  saved: 'All changes saved',
  idle: '',
};

export default function EditPanel({
  editing,
  onToggleEditing,
  savedQueries,
  rules,
  breakpoint,
  hiddenBuiltins,
  onRestoreBuiltin,
  onAddCard,
  onUpdateSaved,
  onDeleteSaved,
  onResetLayout,
  onDragStateChange,
  saveState,
  saveError,
}) {

  const [confirmingReset, setConfirmingReset] = useState(false);
  const panelRef = useRef(null);

  // null means "sit in the default corner"; anything else is a dragged spot.
  const [pos, setPos] = useState(readPos);
  const dragRef = useRef(null);

  /*
   * Dragging the palette by its header.
   *
   * Pointer events rather than mouse events so a stylus or touch works, and
   * setPointerCapture so the drag survives the pointer leaving the header —
   * which it will, because the whole point is to fling the panel across the
   * screen.
   */
  const onHeaderPointerDown = useCallback((e) => {
    // Let the close button be a button.
    if (e.target.closest('button')) return;

    const el = panelRef.current;
    if (!el) return;

    const box = el.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - box.left, dy: e.clientY - box.top };

    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }, []);

  const onHeaderPointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;

    setPos(clampPos({ left: e.clientX - d.dx, top: e.clientY - d.dy }, panelRef.current));
  }, []);

  const onHeaderPointerUp = useCallback((e) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);

    setPos((p) => {
      if (p) {
        try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
      }
      return p;
    });
  }, []);

  // A window that shrank can leave a dropped palette off the edge.
  useEffect(() => {
    if (!editing || !pos) return undefined;

    const onResize = () => setPos((p) => (p ? clampPos(p, panelRef.current) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [editing, pos]);

  // Escape closes the drawer — the same key that dismisses every other
  // transient surface in the portal.
  useEffect(() => {
    if (!editing) return undefined;

    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (confirmingReset) { setConfirmingReset(false); return; }
      onToggleEditing(false);
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing, confirmingReset, onToggleEditing]);

  /*
   * Closed, the whole feature is one chip. `ad-chip` is the portal's own
   * button — same height, radius, hover and press feedback as every filter
   * chip on every other admin screen — so this reads as part of the toolbar
   * rather than as a new control someone bolted on.
   */
  if (!editing) {
    return (
      <div className="pin-openrow">
        <button
          type="button"
          className="ad-chip ad-focusable pin-open"
          onClick={() => onToggleEditing(true)}
          title="Arrange this screen: add saved charts, move and resize cards"
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          Customise
        </button>
      </div>
    );
  }

  const narrow = breakpoint === 'sm';

  return (
    <>
      <aside
        ref={panelRef}
        className="pin-panel"
        aria-label="Arrange this screen"
        style={pos ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' } : undefined}
      >
        {/* The header is the drag handle — see onHeaderPointerDown. */}
        <header
          className="pin-panel-head"
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          onPointerCancel={onHeaderPointerUp}
        >
          <div className="pin-panel-heading">
            <GripHorizontal size={13} aria-hidden="true" className="pin-grip" />
            <div>
              <h2 className="pin-panel-title">Arrange</h2>
              <p className="pin-panel-sub">
                {narrow ? 'Stacked layout' : 'Wide layout'}
              </p>
            </div>
          </div>

          <button
            type="button"
            className="pin-icon-btn"
            onClick={() => onToggleEditing(false)}
            aria-label="Done arranging"
            title="Done"
          >
            <X size={16} />
          </button>
        </header>

        {/*
          * Which of the two layouts a drag will affect.
          *
          * The two are stored separately, so an admin who tidies up on a
          * laptop and later opens the same screen on a monitor would otherwise
          * find their work apparently missing. One line, because it is a
          * reminder rather than a lesson.
          */}
        <p className="pin-scope" role="status">
          {narrow ? <Columns2 size={12} /> : <LayoutGrid size={12} />}
          <span>The {narrow ? 'wide' : 'stacked'} layout stays as it is.</span>
        </p>

        <div className="pin-panel-body">
          <section className="pin-section">
            <h3 className="pin-section-title">Saved queries</h3>
            <p className="pin-section-hint">
              Drag one onto the grid, or click to add it at the bottom.
            </p>

            <SavedQueryStrip
              savedQueries={savedQueries}
              rules={rules}
              onAdd={onAddCard}
              onUpdate={onUpdateSaved}
              onDelete={onDeleteSaved}
              onDragStateChange={onDragStateChange}
            />
          </section>

          {hiddenBuiltins.length > 0 && (
            <section className="pin-section">
              <h3 className="pin-section-title">Hidden panels</h3>
              {/*
                * "Hidden" rather than "removed", because this list is also
                * where a newly shipped panel turns up for someone whose layout
                * predates it — and that one was never removed by anybody.
                */}
              <p className="pin-section-hint">
                Not currently on this screen. Click to put one back.
              </p>

              <ul className="pin-hidden">
                {hiddenBuiltins.map((b) => (
                  <li key={b.key}>
                    <button
                      type="button"
                      className="pin-row"
                      onClick={() => onRestoreBuiltin(b.key)}
                    >
                      <span>{b.label}</span>
                      <Plus size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/*
            * One line, not four.
            *
            * The instructions were a list of everything the grid can do, shown
            * permanently to somebody who by then is holding a card. Dragging
            * and the resize corner are discoverable by trying them, so what is
            * left is the part nobody would guess: that a right-click is where
            * the options live.
            */}
          <p className="pin-tip">
            Drag cards to move, corner to resize, right-click for options.
          </p>
        </div>

        <footer className="pin-panel-foot">
          {/*
            * Reset asks in place rather than through window.confirm. A native
            * dialog steals focus from the drawer and returns it somewhere
            * else, and it cannot say what is and is not about to be lost.
            */}
          {confirmingReset ? (
            <div className="pin-confirm" role="alertdialog" aria-label="Confirm reset">
              <p>
                Put this screen back to its original arrangement? Cards you
                added are removed and every panel returns to its place.
                <strong> Your saved queries are not deleted.</strong>
              </p>
              <div className="pin-confirm-actions">
                <button
                  type="button"
                  className="ad-chip ad-focusable"
                  onClick={() => setConfirmingReset(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="pin-danger ad-focusable"
                  onClick={() => { setConfirmingReset(false); onResetLayout(); }}
                >
                  Reset layout
                </button>
              </div>
            </div>
          ) : (
            <div className="pin-foot-row">
              <button
                type="button"
                className="ad-chip ad-focusable"
                onClick={() => setConfirmingReset(true)}
              >
                <RotateCcw size={13} aria-hidden="true" />
                Reset layout
              </button>

              <button
                type="button"
                className="pin-done ad-focusable"
                onClick={() => onToggleEditing(false)}
              >
                <Check size={14} aria-hidden="true" />
                Done
              </button>
            </div>
          )}

          {/*
            * The save state. A quiet line rather than a toast: it reports on
            * something nobody asked for confirmation of, and a toast per drag
            * would be four notifications for one rearrangement.
            */}
          <p
            className={`pin-save ${saveState === 'error' ? 'is-error' : ''}`}
            role="status"
          >
            {saveState === 'error'
              ? saveError
              : STATUS[saveState] || 'Changes save automatically.'}
          </p>
        </footer>
      </aside>
    </>
  );
}
