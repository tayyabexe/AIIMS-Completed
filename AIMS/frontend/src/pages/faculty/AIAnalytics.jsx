/*
 * Ask the Data — the faculty portal's analytics screen.
 *
 * WHY THIS PAGE EXISTS
 * --------------------
 * The backend has answered teacher questions since the analytics route
 * shipped: ANALYTICS_ROLES includes Teacher, and scopedSql rewrites every
 * table name in a teacher's generated SQL to a CTE pinned to their own roster,
 * so a question phrased about the whole institute comes back about their 707
 * students and nobody else's. What did not exist was anywhere to type it. The
 * only screen calling /api/analytics/ask lived in the admin portal, so the
 * feature was reachable by curl and by nothing a teacher could click.
 *
 * WHAT IS SHARED WITH THE ADMIN CANVAS, AND WHY THAT IS SAFE
 * ----------------------------------------------------------
 * The question box and result renderer are the SAME component the admin portal
 * uses. That is deliberate rather than lazy: the response envelope is
 * identical for both roles — same rows, same columns, same render template,
 * same chart options — because the scoping happens in the database, not in the
 * presentation. A second copy of that renderer would be a second place for the
 * two to drift, and the drift would be silent.
 *
 * The canvas reads the signed-in role for two cosmetic decisions only: which
 * opening prompts to offer, and whether to draw the Save button. Neither is a
 * security boundary. The boundaries are all server-side:
 *
 *   - the route gate            (ANALYTICS_ROLES, before a token is spent)
 *   - the catalogue             (a teacher is never told get_fee_defaulters
 *                                exists, so there is nothing to talk it into)
 *   - scopedSql                 (their SQL cannot name a table that is not a
 *                                CTE restricted to their roster)
 *   - SURFACES_BY_SCOPE         (which board they may arrange)
 *
 * WHY THE BOARD BELOW STARTS EMPTY
 * --------------------------------
 * `faculty_insights` ships with no built-in panels. Every built-in on the two
 * admin surfaces is an institute-wide figure — fee collection, the whole
 * student roll, the institute pass rate — and a teacher is entitled to none of
 * them. Rather than assemble a teacher-safe subset, which would put a
 * permission boundary in a layout file, the board holds only what this teacher
 * chose to keep. Those cards re-run their stored PLAN on every load, never a
 * stored result, so a card is always as current and as scoped as the question
 * that made it.
 */

import { useState } from 'react';
import { BarChart3 } from 'lucide-react';

import Layout from '../../components/faculty/Layout.jsx';
import AskCanvas from '../admin/AIAnalytics.jsx';

import CardGrid from '../../components/admin/pinned/CardGrid.jsx';
import EditPanel from '../../components/admin/pinned/EditPanel.jsx';
import SavedQueryCard from '../../components/admin/pinned/SavedQueryCard.jsx';
import { usePinnedSurface } from '../../components/admin/pinned/usePinnedSurface.js';
import '../../components/admin/pinned/pinned.css';
import './AIAnalytics.css';

export default function FacultyAIAnalytics() {

  const pinned = usePinnedSurface('faculty_insights');

  // The placeholder size while a chip from the strip hovers over the grid.
  const [droppingSize, setDroppingSize] = useState(null);

  /*
   * Only one kind of card can appear here.
   *
   * The admin version branches on `builtin` first, because its surfaces are
   * mostly built-ins with saved queries dropped among them. This surface
   * declares none, so a builtin card would mean the server sent a key for a
   * board that has no keys — reported rather than rendered as a blank cell,
   * since the honest reading is a version mismatch.
   */
  const renderCard = (card, ctx) => {

    if (card.kind === 'builtin') {
      return (
        <div className="pin-card">
          <div className="pin-card-state">
            <strong>Unknown panel</strong>
            <span>This screen shows saved questions only.</span>
          </div>
        </div>
      );
    }

    const savedQuery = pinned.savedById.get(card.savedQueryId);

    if (!savedQuery) {
      return (
        <div className="pin-card">
          <div className="pin-card-state">
            <strong>Saved question removed</strong>
            <span>This card has nothing left to show. Remove it.</span>
          </div>
        </div>
      );
    }

    return (
      <SavedQueryCard
        savedQuery={savedQuery}
        visual={card.visual}
        editing={ctx.editing}
        onRemove={ctx.remove}
        onOpenMenu={ctx.openMenu}
      />
    );
  };

  const pinnedCount = pinned.cards.length;

  return (
    /*
     * `fa-ask` carries the indigo-glass token set for everything on this page
     * that is NOT the shared canvas — the pinned board below, mainly, which
     * borrows admin-portal components styled against `--ad-*` variables that
     * do not exist outside `.aims-dash`. Without this the headings below fell
     * back to inherited colours and the pinned cards drew with no background
     * at all.
     *
     * The canvas itself is themed by its own `aa--faculty` class; this is the
     * matching half for the parts of the page the canvas does not own.
     */
    <Layout title="Ask the Data">
      <div className="fa-ask">

        {/* The question box and its result. Same component as the admin
            canvas — see the header for why sharing it is the safe choice. */}
        <AskCanvas />

        <section className="fa-pinned">

          <div className="fa-pinned-head">
            <div>
              <h2>
                <span className="fa-pinned-icon" aria-hidden="true">
                  <BarChart3 size={15} />
                </span>
                My pinned questions
                {/* The count belongs beside the heading rather than being
                    something you work out by counting cards. */}
                {pinnedCount > 0 && (
                  <span className="fa-pinned-count">{pinnedCount}</span>
                )}
              </h2>
              {/* Says plainly that a card is a question, not a snapshot. A
                  reader who thinks these are stored figures will distrust
                  them the first time one changes. */}
              <p>
                Each card re-runs its question against your own classes every
                time this screen loads.
              </p>
            </div>

            <EditPanel
              editing={pinned.editing}
              onToggleEditing={pinned.setEditing}
              savedQueries={pinned.savedQueries}
              rules={pinned.rules}
              breakpoint={pinned.breakpoint}
              hiddenBuiltins={pinned.hiddenBuiltins}
              onRestoreBuiltin={pinned.restoreBuiltin}
              onAddCard={(saved, visual) =>
                pinned.addCard(saved, visual, null, pinned.breakpoint)}
              onUpdateSaved={pinned.updateSaved}
              onDeleteSaved={pinned.removeSaved}
              onResetLayout={pinned.resetLayout}
              onDragStateChange={setDroppingSize}
              saveState={pinned.saveState}
              saveError={pinned.saveError}
            />
          </div>

          {pinned.loadError && (
            <div role="alert" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexWrap: 'wrap', gap: '0.75rem',
              padding: '0.7rem 0.9rem', borderRadius: 12,
              border: '1px solid #FDE68A', background: '#FFFBEB',
              fontSize: '0.8rem', color: '#92400E',
            }}>
              <span>This screen could not be arranged: {pinned.loadError}</span>
              <button type="button" className="pin-btn" onClick={pinned.reload}>
                Try again
              </button>
            </div>
          )}

          {pinned.cards.length === 0 && !pinned.loadError ? (
            /*
             * The empty state names the exact next action, because on this
             * board "empty" is the starting condition rather than the result
             * of removing something — a teacher arriving for the first time
             * has nothing here and no reason to guess how it fills.
             */
            <div className="pin-empty">
              <strong>Nothing pinned yet</strong>
              <span>
                Ask a question above, then press Save on the result to keep it.
                Saved questions can be dropped here from Customise.
              </span>
            </div>
          ) : (
            <CardGrid
              cards={pinned.cards}
              layouts={pinned.rglLayouts}
              rules={pinned.rules}
              editing={pinned.editing}
              breakpoint={pinned.breakpoint}
              onBreakpointChange={pinned.setBreakpoint}
              renderCard={renderCard}
              onLayoutChange={pinned.applyGeometry}
              onDropCard={pinned.addCard}
              onRemoveCard={pinned.removeCard}
              onResizeCard={pinned.resizeCard}
              onFitCard={pinned.fitCardToContent}
              onChangeVisual={pinned.setCardVisual}
              savedById={pinned.savedById}
              droppingSize={droppingSize}
              onAutoHeight={pinned.setCardHeight}
            />
          )}
        </section>
      </div>
    </Layout>
  );
}
