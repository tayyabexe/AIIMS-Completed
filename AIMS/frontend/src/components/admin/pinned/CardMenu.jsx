/*
 * The right-click menu on a card.
 *
 * Four things, in the order they are wanted: how tall, how wide, shown as
 * what, and remove. A built-in gets the first two and — where its surface
 * allows it — the last; it has no template to switch and no query behind it.
 *
 * WHY "FIT TO CONTENT" IS THE FIRST ITEM
 * --------------------------------------
 * Height is the thing people get wrong and then cannot undo. A card dragged to
 * an awkward height had no way back except resetting the whole screen, which
 * throws away every other placement to fix one. This puts it back to exactly
 * what it holds, which is where it started.
 *
 * It is disabled, not hidden, when the card is already at its content height —
 * so the option is discoverable before it is needed, and its greyed state says
 * "nothing to do here" rather than leaving someone hunting for it.
 *
 * WHY REMOVE IS ABSENT RATHER THAN DISABLED ON THE DASHBOARD
 * ----------------------------------------------------------
 * The Dashboard's own figures and feed are what the screen is for; an account
 * that deleted them would be looking at a dashboard that no longer does its
 * job. A greyed-out Delete invites "how do I enable this", and the honest
 * answer is "you cannot" — so the item is not there. Cards the user added
 * themselves always have it.
 *
 * The server enforces the same rule (layout.service refuses a Dashboard layout
 * that has dropped a built-in), so this is the UI agreeing with a constraint
 * rather than being it.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Trash2, Check, Maximize2 } from 'lucide-react';
import { VISUALS, SIZE_PRESETS } from './visuals';

export default function CardMenu({
  card,
  at,
  rules,
  breakpoint,
  savedQuery,
  onResize,
  onFit,
  onChangeVisual,
  onRemove,
  onClose,
}) {

  const ref = useRef(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });

  /*
   * Nudged back on screen once it has been measured. A menu opened near the
   * right or bottom edge would otherwise hang off the viewport — and the edge
   * is exactly where someone right-clicks the last card in a row.
   */
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const box = node.getBoundingClientRect();
    const pad = 8;

    setPos({
      left: Math.max(pad, Math.min(at.x, window.innerWidth - box.width - pad)),
      top: Math.max(pad, Math.min(at.y, window.innerHeight - box.height - pad)),
    });
  }, [at.x, at.y]);

  // Escape, an outside click, or a scroll dismisses it. Scroll included
  // because the menu is position:fixed and would otherwise detach from the
  // card it belongs to.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose(); };

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onClose, true);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const isBuiltin = card.kind === 'builtin';
  const removable = !isBuiltin || rules?.builtinsRemovable === true;
  const allowsTables = rules?.allowTables !== false;

  // Width is meaningless in the single-column stack, so the width presets go.
  const narrow = breakpoint === 'sm';

  // `minH` is the measured content height. Equal heights mean the card is
  // already fitted and there is nothing for "fit" to do.
  const fitted = !card.minH || Math.abs((card.h || 0) - card.minH) <= 1;

  return (
    <div
      ref={ref}
      className="pin-menu"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      aria-label="Card options"
    >
      <div className="pin-menu-label">Height</div>

      <button
        type="button"
        role="menuitem"
        className="pin-menu-item"
        disabled={fitted}
        onClick={onFit}
        title={fitted
          ? 'Already exactly as tall as its contents'
          : 'Shrink back to exactly what this card holds'}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Maximize2 size={13} aria-hidden="true" style={{ transform: 'rotate(90deg)' }} />
          Fit to content
        </span>
      </button>

      <p className="pin-menu-note">
        Drag the bottom-right corner for any height. A card never shrinks past
        the information it holds.
      </p>

      {!narrow && (
        <>
          <div className="pin-menu-sep" />
          <div className="pin-menu-label">Width</div>

          {SIZE_PRESETS.map((preset) => {
            const active = card.w === preset.w;

            return (
              <button
                key={preset.label}
                type="button"
                role="menuitem"
                className={`pin-menu-item${active ? ' is-active' : ''}`}
                onClick={() => onResize(preset.w, card.h || preset.h)}
              >
                <span>{preset.label}</span>
                <span style={{ fontSize: 11, color: 'var(--ad-ink-4)' }}>
                  {preset.w}/{rules?.columns ?? 12}
                </span>
              </button>
            );
          })}
        </>
      )}

      {/*
        * Only for a pinned query, and only among the templates it was saved
        * with. Offering one it was not saved with would be offering a view
        * nothing has checked the data can carry — the save dialog is where
        * that check happens, against a real result.
        */}
      {savedQuery && savedQuery.visuals.length > 1 && (
        <>
          <div className="pin-menu-sep" />
          <div className="pin-menu-label">Shown as</div>

          {VISUALS.filter((v) => savedQuery.visuals.includes(v.key)).map((v) => {
            const blocked = v.key === 'table' && !allowsTables;
            const active = card.visual === v.key;
            const Icon = v.icon;

            return (
              <button
                key={v.key}
                type="button"
                role="menuitem"
                className={`pin-menu-item${active ? ' is-active' : ''}`}
                disabled={blocked}
                title={blocked ? 'This screen does not take tables.' : undefined}
                onClick={() => onChangeVisual(v.key)}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Icon size={13} aria-hidden="true" style={{ opacity: active ? 1 : 0.6 }} />
                  {v.label}
                </span>
                {active && <Check size={13} aria-hidden="true" />}
              </button>
            );
          })}
        </>
      )}

      {removable && (
        <>
          <div className="pin-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="pin-menu-item is-danger"
            onClick={onRemove}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Trash2 size={13} aria-hidden="true" />
              Remove from this screen
            </span>
          </button>
        </>
      )}

      {isBuiltin && !removable && (
        <p className="pin-menu-note">
          One of the Dashboard&rsquo;s own panels. It can be moved and resized,
          but not removed.
        </p>
      )}
    </div>
  );
}
