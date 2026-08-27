/*
 * The saved-query library, inside the arrange drawer.
 *
 * One row per saved question. Opening a row reveals the templates it was saved
 * with; each of those is what you actually drag onto the grid, because "put
 * this question on the dashboard" is not a complete instruction until it says
 * as what.
 *
 * WHY A VERTICAL LIST AND NOT THE HORIZONTAL SHELF IT WAS
 * -------------------------------------------------------
 * It used to be a sideways-scrolling strip above the grid. Two things were
 * wrong with that. It could not be dragged from once the page was scrolled —
 * and on AI Insights, which runs to several screenfuls, dropping a card near
 * the bottom is the normal case. And a row that scrolls sideways hides most of
 * the library behind a gesture, which defeats the point of having one.
 *
 * In a 360px drawer a list shows every saved query at once and stays on screen
 * for the whole drag.
 *
 * WHY A TEMPLATE CAN BE GREYED OUT HERE
 * -------------------------------------
 * The Dashboard does not take tables (see config/dashboardCards.js). Rather
 * than hide the option — which would leave someone wondering where their table
 * went — it is shown disabled with the reason on it. The server enforces the
 * same rule; this is the courtesy of saying so first.
 */

import { useEffect, useRef, useState } from 'react';
import { GripVertical, Pencil, Plus, Trash2, X, Check } from 'lucide-react';
import { VISUALS } from './visuals';
import { beginDrag, endDrag } from './dragState';

/*
 * A card's starting size, by template. Tables get the full row because a
 * six-column table shows three columns and an ellipsis; charts read fine at
 * half width. Heights are pixels — see GRID_ROW_HEIGHT in the backend config.
 */
export const defaultSizeFor = (visual) =>
  (visual === 'table' ? { w: 12, h: 416 } : { w: 6, h: 336 });

export default function SavedQueryStrip({
  savedQueries,
  rules,
  onAdd,
  onUpdate,
  onDelete,
  onDragStateChange,
}) {

  // Which saved query is expanded, by id.
  const [openId, setOpenId] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(null);

  const rootRef = useRef(null);

  // Collapsing on an outside click, registered only while something is open so
  // the page carries no listener the rest of the time.
  useEffect(() => {
    if (openId === null) return undefined;

    const close = (e) => {
      if (!rootRef.current?.contains(e.target)) {
        setOpenId(null);
        setRenaming(null);
        setConfirmingDelete(null);
      }
    };

    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openId]);

  const allowsTables = rules?.allowTables !== false;

  const commitRename = async (saved) => {
    const name = draft.trim();

    if (!name || name === saved.name) {
      setRenaming(null);
      return;
    }

    setBusy(true);
    setError('');

    try {
      await onUpdate(saved.id, { name });
      setRenaming(null);
    } catch (e) {
      setError(e.message || 'That name could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const commitVisuals = async (saved, visual) => {
    const next = saved.visuals.includes(visual)
      ? saved.visuals.filter((v) => v !== visual)
      : [...saved.visuals, visual];

    // Un-ticking the last one would leave a saved query that cannot be shown
    // at all, so the last tick is not removable.
    if (!next.length) return;

    setBusy(true);
    setError('');

    try {
      await onUpdate(saved.id, { visuals: next });
    } catch (e) {
      setError(e.message || 'That change could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const commitDelete = async (saved) => {
    setBusy(true);
    try {
      await onDelete(saved.id);
      setOpenId(null);
      setConfirmingDelete(null);
    } catch (e) {
      setError(e.message || 'That saved query could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  if (!savedQueries.length) {
    return (
      <p className="pin-strip-empty">
        Nothing saved yet. Ask a question on <strong>Ask the Data</strong> and
        save the answer — it appears here, ready to drag onto this screen.
      </p>
    );
  }

  return (
    <div ref={rootRef} className="pin-strip">
      {savedQueries.map((saved) => {
        const isOpen = openId === saved.id;

        return (
          <div key={saved.id}>
            <button
              type="button"
              className={`pin-chip${isOpen ? ' is-open' : ''}`}
              onClick={() => {
                setOpenId(isOpen ? null : saved.id);
                setRenaming(null);
                setConfirmingDelete(null);
              }}
              aria-expanded={isOpen}
              title={saved.question}
            >
              <GripVertical size={13} aria-hidden="true" style={{ opacity: 0.45, flexShrink: 0 }} />
              <span className="pin-chip-name">{saved.name}</span>
            </button>

            {isOpen && (
              <div className="pin-pop">

                {renaming === saved.id ? (
                  <div style={{ display: 'flex', gap: 5, padding: 2 }}>
                    <input
                      autoFocus
                      className="pin-inline-input"
                      value={draft}
                      maxLength={120}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(saved);
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      aria-label="New name"
                    />
                    <button
                      type="button" className="pin-icon-btn"
                      onClick={() => commitRename(saved)} disabled={busy}
                      title="Save name"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button" className="pin-icon-btn"
                      onClick={() => setRenaming(null)} title="Cancel"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="pin-pop-head">Drag onto the grid</div>
                )}

                {/*
                  * Every template this query was saved with. Dragging one is
                  * the primary action; clicking adds it at the bottom — the
                  * same result without a mouse gesture, and the only route
                  * available from a keyboard.
                  */}
                {VISUALS.filter((v) => saved.visuals.includes(v.key)).map((v) => {
                  const blocked = v.key === 'table' && !allowsTables;
                  const Icon = v.icon;

                  return (
                    <button
                      key={v.key}
                      type="button"
                      className="pin-pop-item"
                      disabled={blocked}
                      draggable={!blocked}
                      title={blocked
                        ? 'The Dashboard does not take tables — this one can go on AI Insights.'
                        : `Drag ${v.label.toLowerCase()} onto the grid, or click to add it`}
                      onDragStart={(e) => {
                        const size = defaultSizeFor(v.key);
                        beginDrag({ savedQueryId: saved.id, visual: v.key, ...size });
                        onDragStateChange?.(size);

                        // dataTransfer keeps the browser treating this as a
                        // real drag rather than a text selection; the payload
                        // itself is read from module state (see dragState.js).
                        e.dataTransfer.effectAllowed = 'copy';
                        e.dataTransfer.setData('text/plain', `${saved.id}:${v.key}`);
                      }}
                      onDragEnd={() => { endDrag(); onDragStateChange?.(null); }}
                      onClick={() => { if (!blocked) { onAdd(saved, v.key); setOpenId(null); } }}
                    >
                      <Icon size={14} aria-hidden="true" style={{ flexShrink: 0, opacity: 0.7 }} />
                      <span style={{ flex: 1 }}>{v.label}</span>
                      <Plus size={13} aria-hidden="true" style={{ opacity: 0.4 }} />
                    </button>
                  );
                })}

                <div className="pin-pop-sep" />
                <div className="pin-pop-head">Shown as</div>

                {/*
                  * Re-ticking the templates this query offers. The set only
                  * ever narrows from what the original result supported — a
                  * template that was never available at save time is not
                  * listed, because nothing here can check whether today's rows
                  * would carry it.
                  */}
                {VISUALS.map((v) => {
                  const on = saved.visuals.includes(v.key);
                  const last = on && saved.visuals.length === 1;

                  return (
                    <button
                      key={`t-${v.key}`}
                      type="button"
                      className="pin-pop-item"
                      disabled={busy || last}
                      onClick={() => commitVisuals(saved, v.key)}
                      title={last
                        ? 'A saved query needs at least one way of being shown.'
                        : on ? `Stop offering ${v.label.toLowerCase()}`
                          : `Also offer ${v.label.toLowerCase()}`}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 14, height: 14, flexShrink: 0,
                          border: `1.5px solid ${on ? 'var(--ad-accent)' : 'var(--ad-rule-strong)'}`,
                          borderRadius: 4,
                          background: on ? 'var(--ad-accent)' : 'transparent',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        {on && <Check size={10} color="#fff" />}
                      </span>
                      <span style={{ flex: 1, fontWeight: on ? 600 : 450 }}>{v.label}</span>
                    </button>
                  );
                })}

                <div className="pin-pop-sep" />

                <button
                  type="button" className="pin-pop-item"
                  onClick={() => { setRenaming(saved.id); setDraft(saved.name); setError(''); }}
                >
                  <Pencil size={14} aria-hidden="true" style={{ opacity: 0.6 }} />
                  <span style={{ flex: 1 }}>Rename</span>
                </button>

                {/*
                  * Deleting is confirmed in place. A saved query can be on
                  * several screens at once and takes every card with it —
                  * which is neither recoverable nor visible from here — so the
                  * consequence is spelled out where the click happens.
                  */}
                {confirmingDelete === saved.id ? (
                  <div style={{ padding: '6px 8px' }}>
                    <p className="pin-pop-note" style={{ margin: '0 0 8px', borderTop: 0, paddingTop: 0 }}>
                      Delete “{saved.name}”? Any card showing it is removed from
                      your Dashboard and AI Insights.
                    </p>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        type="button" className="pin-btn"
                        style={{ padding: '5px 10px' }}
                        onClick={() => setConfirmingDelete(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button" className="pin-danger"
                        style={{ padding: '5px 10px', fontSize: 12 }}
                        onClick={() => commitDelete(saved)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button" className="pin-pop-item pin-pop-danger"
                    onClick={() => setConfirmingDelete(saved.id)}
                    disabled={busy}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    <span style={{ flex: 1 }}>Delete saved query</span>
                  </button>
                )}

                {error && (
                  <p className="pin-pop-note" style={{ color: 'var(--ad-accent)' }}>
                    {error}
                  </p>
                )}

                <p className="pin-pop-note">{saved.question}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
