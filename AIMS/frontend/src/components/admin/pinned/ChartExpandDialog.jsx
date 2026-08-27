/*
 * A pinned card's chart, opened at a size you can actually read.
 *
 * WHY THIS EXISTS
 * ---------------
 * A card on the grid draws its chart in `fit` mode: exactly the size of the
 * card, never overflowing, so there is nothing to scroll and nothing that a
 * resize can break. That guarantee costs something real — in a small tile
 * Recharts drops the category labels that would collide, so a twelve-bar chart
 * may show four names.
 *
 * This is where those labels come back. The same rows, the same template, the
 * same colours, drawn in scrolling mode with 64px of room per category — the
 * canvas treatment, in a dialog. Nothing is recomputed and nothing is re-run:
 * the card already has the result and hands it over.
 *
 * So the split is: the grid stays calm and unbreakable, and the detail is one
 * click away rather than crammed into a tile that cannot hold it.
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { TEMPLATES, chartRows } from '../../common/ChartTemplates';
import { visualLabel } from './visuals';

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : n);

export default function ChartExpandDialog({ title, result, onClose }) {

  const closeRef = useRef(null);

  /*
   * Escape closes, and focus moves into the dialog on open.
   *
   * Matching SaveQueryDialog rather than inventing a second convention: two
   * dialogs in one screen that answer the Escape key differently is the kind
   * of inconsistency nobody reports and everybody feels.
   */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = result?.rows || [];
  const columns = result?.columns || [];
  const render = result?.render || { template: 'none' };
  const Template = TEMPLATES[render.template];

  /*
   * Rendered into <body>, not where it sits in the tree.
   *
   * This dialog is returned from a card that lives inside react-grid-layout,
   * and every grid item carries a CSS `transform` for its position. A
   * transform establishes a containing block, which means `position: fixed`
   * inside one resolves against the CARD rather than the viewport -- so the
   * full-screen scrim was 511px wide and the "expanded" chart came out
   * narrower than the card that opened it.
   *
   * A portal is the fix rather than a larger z-index or a width override,
   * because the problem is not stacking or sizing: it is which box the dialog
   * considers to be the screen.
   */
  return createPortal(
    <div
      className="pin-dialog-scrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="pin-dialog pin-dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="pin-expand-head">
          <div style={{ minWidth: 0 }}>
            <h2>{title}</h2>
            <p className="pin-dialog-sub">
              {fmt(result?.total_rows ?? rows.length)}
              {(result?.total_rows ?? rows.length) === 1 ? ' row' : ' rows'}
              {' · '}
              {visualLabel(render.template)}
            </p>
          </div>

          <button
            ref={closeRef}
            type="button"
            className="pin-icon-btn"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="pin-expand-body">
          {Template ? (
            <Template
              /* fit is deliberately absent: this is the scrolling treatment,
                 which is the whole reason for opening the dialog. */
              rows={chartRows(render, rows, columns)}
              columns={columns}
              xKey={render.xKey}
              yKeys={render.yKeys || []}
              page={0}
              pageSize={rows.length || 1}
            />
          ) : (
            <div className="pin-card-state">Nothing to draw.</div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
