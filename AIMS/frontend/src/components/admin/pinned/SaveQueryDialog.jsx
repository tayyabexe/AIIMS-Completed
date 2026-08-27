/*
 * "Save this answer" — the dialog behind the star on Ask the Data.
 *
 * Two decisions, and only two: what to call it, and which ways it may be
 * shown. Everything else the card needs — the plan, the axes, the title — is
 * carried over from the result already on screen and is not the user's to
 * re-enter.
 *
 * WHY THE TEMPLATE LIST IS NOT THE FULL SEVEN
 * -------------------------------------------
 * The /ask response includes `options`: for each template, either `true` or a
 * sentence saying why this particular result cannot carry it — no numeric
 * column, too many slices, too many points to plot. That is computed by the
 * server against the real rows, which is the only place it can be computed
 * honestly.
 *
 * So the ticks offered here are exactly the ones the data supports, and the
 * ones it does not are shown greyed with the server's own reason as their
 * tooltip rather than hidden. "Why can't I pick a pie chart" is a real
 * question with a real answer, and hiding the option hides the answer too.
 *
 * That set is then frozen into the saved row. A card can later be switched
 * between the ticked templates without re-running anything, because every one
 * of them was checked against a genuine result on the day it was saved.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { VISUALS } from './visuals';
import { saved as savedApi } from '../../../api/analytics';
import './pinned.css';

/*
 * A first-guess name from the question.
 *
 * The planner's chart title if there is one, otherwise the question with its
 * trailing punctuation trimmed — long enough to recognise, short enough for a
 * chip. It is a starting point in an editable field, never a name applied
 * silently.
 */
const suggestName = (result, question) => {
  const base = String(result?.render?.title || question || '').trim();
  const clean = base.replace(/[?.!]+$/, '').replace(/\s+/g, ' ');

  if (clean.length <= 60) return clean;
  return `${clean.slice(0, 57).trimEnd()}…`;
};

export default function SaveQueryDialog({
  result,
  question,
  onClose,
  onSaved,
  /*
   * Which boards this account may pin to, and whether all of them take tables.
   * Passed in rather than read from the role here: this component is shared by
   * both portals and the answer is a property of the surfaces the caller's
   * scope owns, not of this dialog. Defaults to the admin pair.
   */
  boards = { names: 'Dashboard or AI Insights', tablesAnywhere: false },
}) {

  const [name, setName] = useState(() => suggestName(result, question));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const inputRef = useRef(null);

  /*
   * Which templates this result can actually carry.
   *
   * `table` is not in `options` because it is never unavailable — every result
   * with rows can be listed — so it is added here rather than special-cased at
   * three later call sites.
   */
  const available = useMemo(() => {
    const options = result?.options || {};

    return VISUALS.map((v) => {
      if (v.key === 'table') return { ...v, ok: true, reason: null };

      const state = options[v.key];
      return {
        ...v,
        ok: state === true,
        reason: state === true ? null : String(state || 'Not available for this result'),
      };
    });
  }, [result]);

  /*
   * Ticked by default: whatever is on screen right now, plus the table.
   *
   * The user is looking at a chart they chose or accepted, so that is the one
   * they mean. The table rides along because it is always valid and is the
   * thing people reach for when a chart turns out not to answer the question.
   */
  const [picked, setPicked] = useState(() => {
    const shown = result?.render?.template;
    const start = new Set(['table']);
    if (shown && shown !== 'none' && shown !== 'table') start.add(shown);
    return start;
  });

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const toggle = (key) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const submit = async (e) => {
    e.preventDefault();

    if (busy) return;

    if (!name.trim()) {
      setError('Give this query a name.');
      return;
    }

    if (!picked.size) {
      setError('Tick at least one way to show it.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      /*
       * `source` is handed back exactly as the server sent it. The browser
       * does not build a plan and is not trusted to — the server re-validates
       * this against the caller's own catalogue on every single run.
       */
      const res = await savedApi.create({
        name: name.trim(),
        question: result.question || question,
        correctedQuestion: result.corrected_question || null,
        title: result.render?.title || null,
        source: result.source,
        visuals: VISUALS.filter((v) => picked.has(v.key)).map((v) => v.key),
        // The template on screen, so a card starts as what was being looked at.
        defaultVisual: picked.has(result.render?.template)
          ? result.render.template
          : [...picked][0],
        axes: result.axes || null,
      });

      onSaved?.(res.saved);
      onClose();

    } catch (err) {
      setError(err.message || 'That could not be saved.');
      setBusy(false);
    }
  };

  return (
    <div
      className="pin-dialog-scrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <form
        className="pin-dialog"
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-save-title"
      >
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: '0.75rem',
        }}>
          <h2 id="pin-save-title">Save this answer</h2>
          <button
            type="button" className="pin-icon-btn" onClick={onClose}
            disabled={busy} aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <p className="pin-dialog-sub">
          It becomes a chip you can drag onto your {boards.names}. The card
          re-runs this query every time it is opened, so it always shows
          current figures — nothing is frozen.
        </p>

        {error && <p className="pin-dialog-error" role="alert">{error}</p>}

        <label className="pin-field">
          <span>Name</span>
          <input
            ref={inputRef}
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Fee defaulters by programme"
          />
        </label>

        <div className="pin-field">
          <span>Ways to show it</span>
          <div className="pin-visuals">
            {available.map((v) => {
              const on = picked.has(v.key);

              return (
                <label
                  key={v.key}
                  className={`pin-visual${!v.ok ? ' is-off' : on ? ' is-on' : ''}`}
                  title={v.ok ? undefined : v.reason}
                >
                  <input
                    type="checkbox"
                    checked={on && v.ok}
                    disabled={!v.ok || busy}
                    onChange={() => toggle(v.key)}
                  />
                  <v.icon size={14} />
                  <span>{v.label}</span>
                </label>
              );
            })}
          </div>

          <p style={{
            margin: '0.6rem 0 0', fontSize: '0.72rem', color: '#94A3B8',
            lineHeight: 1.5,
          }}>
            Only the ones this result can actually carry are available — the
            greyed-out ones say why when you hover them.
            {!boards.tablesAnywhere
              && ' The Dashboard takes charts only; a table can still be pinned to AI Insights.'}
          </p>
        </div>

        <div className="pin-dialog-actions">
          <button
            type="button" className="pin-btn" onClick={onClose} disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className="pin-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save query'}
          </button>
        </div>
      </form>
    </div>
  );
}
