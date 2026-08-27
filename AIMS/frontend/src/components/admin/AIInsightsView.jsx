/*
 * AI Insights.
 *
 * Served by GET /api/admin/ai-analytics and GET /api/admin/fees.
 *
 * The risk cohorts are counted in SQL over every student in the institute, and
 * the named at-risk list is the worst 25. Risk is scored on the four signals
 * the database actually carries: attendance below 75%, a published CGPA below
 * the pass mark, an exam average below 50%, and an outstanding fee balance.
 * Nothing here is a prediction — every reason shown beside a student is a fact
 * already recorded against them.
 *
 * WHAT THIS FILE IS NOW
 * ---------------------
 * A loader and a grid. It fetches the two responses, derives every figure once
 * into a `view` object, and hands that to whichever panels the user has kept
 * on screen. The panels themselves are in insights/insightPanels.jsx.
 *
 * The split exists so that a pinned query card can be dropped *between* the
 * built-in panels and push them aside — which is impossible while the panels
 * are literal JSX in a fixed CSS grid, and free once every one of them is an
 * item in the same layout.
 *
 * WHY EVERY PANEL HERE CAN BE REMOVED
 * -----------------------------------
 * Unlike the Dashboard, this screen is a workspace rather than a readout. All
 * of it is analysis and all of it is optional: an admin who wants only their
 * own pinned questions here should get exactly that. Anything removed is one
 * click from coming back, from the hidden-panels menu in the toolbar.
 */

import { useMemo, useState } from 'react';
import { admin as adminApi } from '../../api/endpoints';
import { useAdminPage } from '../../hooks/useAdminPage';
import { LIVE } from '../../api/queryClient';
import RouteLoader from '../common/RouteLoader';

import CardGrid from './pinned/CardGrid';
import EditPanel from './pinned/EditPanel';
import SavedQueryCard from './pinned/SavedQueryCard';
import { usePinnedSurface } from './pinned/usePinnedSurface';
import { INSIGHT_PANELS } from './insights/insightPanels';

export default function AIInsightsView() {

  const { data, loading } = useAdminPage(
    () => adminApi.aiAnalytics({ limit: 25 }),
    // Every panel here is a GROUP BY over the whole institute, so it
    // refreshes on the slower analytics beat rather than every 30s.
    {}, { key: 'ai-analytics', live: LIVE.analytics });

  const pinned = usePinnedSurface('ai_insights');

  // The placeholder size while a chip from the strip is hovering the grid.
  const [droppingSize, setDroppingSize] = useState(null);

  /*
   * Every figure the panels read, derived once.
   *
   * Computed here rather than in each panel so that eight panels showing eight
   * views of the same two responses cannot disagree about the totals, and so a
   * panel the user removed costs nothing.
   */
  const view = useMemo(() => {
    const cohorts = data?.cohorts ?? {};
    const totalStudents = cohorts.students ?? 0;

    /*
     * `riskFactors` is a count of how many of the four signals a student
     * trips, turned into the 0-99 figure the panel draws. The weights are
     * presentation; the underlying facts, and the reasons printed beside each
     * student, come from the database.
     */
    const atRisk = (data?.atRisk ?? []).map((s) => ({
      name: s.name,
      id: s.id,
      dept: s.program || 'General',
      semester: s.semester || 'N/A',
      riskFactor: Math.min(25 * (s.riskFactors || 0) + 10, 99),
      reason: s.reasons.join(', ') || 'Needs monitoring',
      cgpa: s.cgpa,
      attendance: s.attendancePercent,
      feeStatus: s.remainingBalance > 0 ? 'Overdue' : 'Paid',
    }));

    // How many students fall in each attendance band, counted by the database.
    const attendanceBands = (data?.attendanceBands ?? []).map((b) => ({
      band: b.band,
      count: b.students,
    }));

    return {
      totalStudents,
      atRisk,
      // How many the institute holds in each risk band, not how many are in
      // the list above — that list is capped at 25 by design.
      atRiskTotal: (cohorts.critical ?? 0) + (cohorts.high ?? 0),

      avgAttendance: cohorts.averageAttendance ?? 0,
      shortageCount: cohorts.lowAttendance ?? 0,
      failedCount: cohorts.lowCgpa ?? 0,
      overdueCount: cohorts.feeOutstanding ?? 0,
      distinctionCount: cohorts.onTrack ?? 0,

      passRate: totalStudents && cohorts.lowCgpa != null
        ? ((totalStudents - cohorts.lowCgpa) / totalStudents) * 100
        : 0,

      attendanceBands,
      attendanceTracked: attendanceBands.reduce((sum, b) => sum + b.count, 0),

      /*
       * The fee figures now arrive with everything else.
       *
       * This screen used to make a second request to GET /api/admin/fees for
       * these four values. That endpoint belongs to Fee Management and does
       * its work — a paged student roster, a cohort COUNT, a fee-category
       * distribution and a filterOptions() read of four reference tables —
       * about 600ms of it, for two aggregates. `limit=1` shrank the roster and
       * paid for the rest anyway.
       *
       * They are computed by the ai-analytics query now, from SQL lifted
       * verbatim off that endpoint, and cached with the rest of this response.
       */
      totalFeeCollected: data?.feeCollection?.totals?.collected ?? 0,
      paidCount: data?.feeCollection?.totals?.paid ?? 0,
      pendingCount: data?.feeCollection?.totals?.unpaid ?? 0,
      monthlyCollection: data?.feeCollection?.monthly ?? [],
      // One response now, so "has the fee data arrived" is the same question
      // as "has anything arrived".
      analyticsLoaded: !!data,
    };
  }, [data]);

  /*
   * The whole screen waits for its first response.
   *
   * Every figure below coalesces to 0, so rendering before the data lands
   * would draw an institute in total collapse — 0 students, 0% attendance, a
   * 0% pass rate — confidently, for about a second, on every visit.
   */
  if ((loading && !data) || pinned.loading) {
    return (
      <RouteLoader
        label="Loading AI analytics…"
        hint="Risk cohorts counted across the whole institute"
      />
    );
  }

  /*
   * One card. Either a built-in panel or a pinned query, both wearing the same
   * shell so the grid reads as one arrangement rather than two kinds of thing.
   */
  const renderCard = (card, ctx) => {
    if (card.kind === 'builtin') {
      const Panel = INSIGHT_PANELS[card.builtinKey];

      // A key the server knows and this build does not — an older frontend
      // against a newer backend. Better an honest gap than a blank cell.
      if (!Panel) {
        return (
          <div className="pin-card">
            <div className="pin-card-state">
              <strong>Unknown panel</strong>
              <span>“{card.builtinKey}” is not available in this version.</span>
            </div>
          </div>
        );
      }

      return (
        <Panel
          view={view}
          editing={ctx.editing}
          removable={pinned.rules?.builtinsRemovable !== false}
          onRemove={ctx.remove}
          onOpenMenu={ctx.openMenu}
        />
      );
    }

    const savedQuery = pinned.savedById.get(card.savedQueryId);

    /*
     * The saved query behind this card is gone. In practice the delete path
     * removes its cards too, so this is the tab that was open in another
     * window when it happened.
     */
    if (!savedQuery) {
      return (
        <div className="pin-card">
          <div className="pin-card-state">
            <strong>Saved query removed</strong>
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

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
    >

      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '0.75rem',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <h1 style={{
              fontSize: '1.5rem', fontWeight: 800, color: '#0F172A', margin: 0,
              letterSpacing: '-0.02em',
            }}>
              AI Insights
            </h1>
            <span style={{
              padding: '0.15rem 0.5rem', fontSize: '0.6rem', fontWeight: 800,
              background: 'linear-gradient(135deg, #8B5CF6, #EC4899)',
              color: '#FFFFFF', borderRadius: 6, letterSpacing: '0.03em',
            }}>
              LIVE
            </span>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#64748B', margin: '0.25rem 0 0' }}>
            Computed from {view.totalStudents.toLocaleString()} student records.
            Arrange this screen, or pin your own saved queries to it.
          </p>
        </div>

        {/*
          * The arrange control sits where "Ask AI Assistant" used to.
          *
          * That button opened the chatbot, which is reachable from the
          * assistant widget floating on every screen in the portal — so it was
          * a second door to a room that already has one, taking the most
          * prominent position on the page. Arranging is the thing you can only
          * do here, so it gets the spot.
          */}
        <EditPanel
          editing={pinned.editing}
          onToggleEditing={pinned.setEditing}
          savedQueries={pinned.savedQueries}
          rules={pinned.rules}
          breakpoint={pinned.breakpoint}
          hiddenBuiltins={pinned.hiddenBuiltins}
          onRestoreBuiltin={pinned.restoreBuiltin}
          onAddCard={(saved, visual) => pinned.addCard(saved, visual, null, pinned.breakpoint)}
          onUpdateSaved={pinned.updateSaved}
          onDeleteSaved={pinned.removeSaved}
          onResetLayout={pinned.resetLayout}
          onDragStateChange={setDroppingSize}
          saveState={pinned.saveState}
          saveError={pinned.saveError}
        />
      </div>

      {/*
        * The layout request failed, so there are no cards to draw — not the
        * factory arrangement, which also comes from that response. This used
        * to say "so this is the default arrangement" above an empty screen,
        * which told the user the one thing that was not true.
        */}
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
        <div className="pin-empty">
          <strong>This screen is empty</strong>
          <span>
            Every panel has been removed. Press Customise to put them back or to
            drop in a saved query.
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
    </div>
  );
}
