/*
 * The faculty portal's landing screen.
 *
 * WHAT CHANGED, AND WHAT DID NOT
 * ------------------------------
 * The three requests below, the figures they return and every panel drawn from
 * them are exactly what this screen has always shown. What changed is that the
 * panels are no longer laid out by this file. They are registered by key in
 * facultyPanels.jsx and placed by the same pinned grid the admin portal's
 * Dashboard and AI Insights use, so a teacher can move them, resize them, hide
 * the ones they never read, and drop their own saved questions among them.
 *
 * WHY THE OLD LAYOUT HAD DEAD SPACE
 * ---------------------------------
 * `.dash-grid` put Today's Schedule beside Recent Notifications in one CSS grid
 * row, and a grid row is as tall as its tallest cell. A teacher with no
 * lectures timetabled got a 90px schedule panel sitting in a 600px row, with
 * half a screen of white under it. The pinned grid compacts vertically instead:
 * a short panel occupies short space and whatever sits beneath it moves up.
 *
 * WHAT STAYS FIXED
 * ----------------
 * The red hero. It is the screen's greeting, it is full-bleed by design, and a
 * greeting that can be dragged into the middle of the board stops reading as
 * one. It sits above the grid exactly as the admin Dashboard's greeting row
 * does — and, as there, the Customise control rides in it rather than taking a
 * band of its own.
 *
 * THE SURFACE IS 'faculty_dashboard'
 * ----------------------------------
 * Its own board, separate from the 'faculty_insights' board under Ask the Data.
 * Both are listed for the teacher scope in config/dashboardCards.js, and the
 * server refuses any surface a scope does not list — see the migration at
 * database/migrations/20260821170000 for why they are two boards and not one.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Layout from '../../components/faculty/Layout.jsx';
import { useAuth } from '../../context/FacultyAuthContext.jsx';
import DataGate from '../../components/faculty/DataState.jsx';
import { faculty as facultyApi } from '../../api/endpoints';
import { useServerQuery } from '../../hooks/useAdminPage';

import CardGrid from '../../components/admin/pinned/CardGrid.jsx';
import EditPanel from '../../components/admin/pinned/EditPanel.jsx';
import SavedQueryCard from '../../components/admin/pinned/SavedQueryCard.jsx';
import { usePinnedSurface } from '../../components/admin/pinned/usePinnedSurface.js';
import '../../components/admin/pinned/pinned.css';

import PANELS from './facultyPanels.jsx';
import './FacultyDashboard.css';
import './facultyDashboard.pinned.css';

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

  /*
   * Three independent reads, each on its own cache key.
   *
   * They were three hand-rolled fetches with six pieces of state between them,
   * re-run in full every time this screen was opened. Kept separate rather
   * than merged, because they fail independently — a dead activity feed must
   * not blank the summary tiles — and because the notice feed is read by other
   * surfaces too.
   */
  const {
    data: dashData, loading, error, refresh: load,
  } = useServerQuery(() => facultyApi.dashboard(), {}, { key: 'faculty-dashboard' });

  const dash = dashData?.data || null;

  const noticesQuery = useServerQuery(
    () => facultyApi.notifications({ limit: 8 }), {}, { key: 'faculty-notices-8' },
  );
  const notices = Array.isArray(noticesQuery.data?.data) ? noticesQuery.data.data : [];
  const noticesState = { loading: noticesQuery.loading, error: noticesQuery.error };

  const activityQuery = useServerQuery(
    () => facultyApi.activity({ limit: 8 }), {}, { key: 'faculty-activity-8' },
  );
  const activity = Array.isArray(activityQuery.data?.data) ? activityQuery.data.data : [];
  const activityState = { loading: activityQuery.loading, error: activityQuery.error };

  const pinned = usePinnedSurface('faculty_dashboard');

  // The placeholder size while a chip from the Customise list hovers the grid.
  const [droppingSize, setDroppingSize] = useState(null);


  /*
   * The board's own request is waited for alongside the figures.
   *
   * Drawing the panels first and then rearranging them when the layout arrives
   * would show every card jump once on every page load. One wait, one paint.
   */
  if (loading || pinned.loading || error || !dash) {
    return (
      <Layout title="Dashboard">
        <DataGate
          loading={loading || pinned.loading}
          error={error || (!dash && !loading ? 'No dashboard data was returned.' : null)}
          onRetry={load}
          label="Loading dashboard…"
        />
      </Layout>
    );
  }

  const { today } = dash;

  const renderCard = (card, ctx) => {
    if (card.kind === 'builtin') {
      const Panel = PANELS[card.builtinKey];

      /*
       * A key the server knows and this build does not. Reported rather than
       * drawn as a blank cell, because the honest reading is a version
       * mismatch and a silent empty box invites the teacher to think their
       * panel lost its data.
       */
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

      /*
       * The faculty panels draw their own card chrome — they always did — so
       * they go into the cell as they are rather than inside the pinned card
       * shell. `pin-native` only makes them fill the height the grid gave them.
       */
      return (
        <div className="pin-native">
          <Panel
            data={dash}
            editing={ctx.editing}
            navigate={navigate}
            notices={notices}
            noticesState={noticesState}
            activity={activity}
            activityState={activityState}
          />
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

  return (
    <Layout title="Dashboard">
      <div className="dash-hero">
        <div className="dash-hero-top">
          <div>
            <div className="dash-hero-sub">{greeting()} 👋</div>
            <h2>{dash.teacher.full_name || user?.name}</h2>
            <div className="dash-hero-date">
              {new Date(`${today.date}T00:00:00`).toLocaleDateString('en-GB', {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
              })}
              {dash.teacher.department_name ? ` · ${dash.teacher.department_name}` : ''}
              {dash.teacher.designation ? ` · ${dash.teacher.designation}` : ''}
            </div>
          </div>

          {/* Customise rides in the hero rather than taking a band of its own,
              the same move the admin Dashboard makes with its greeting row. */}
          <div className="dash-hero-tools">
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
        </div>
      </div>

      {pinned.loadError && (
        <div role="alert" className="dash-arrange-error">
          <span>This screen could not be arranged: {pinned.loadError}</span>
          <button type="button" className="pin-btn" onClick={pinned.reload}>
            Try again
          </button>
        </div>
      )}

      {/*
        * Every panel is hidden and nothing is pinned. Reachable here in a way
        * it is not on the admin Dashboard, because these built-ins CAN be
        * removed — so the screen has to say how to get them back rather than
        * showing a teacher an empty page and letting them work it out.
        */}
      {pinned.cards.length === 0 ? (
        <div className="pin-empty">
          <strong>Nothing on this dashboard</strong>
          <span>
            Every panel has been hidden. Press Customise to add them back, or to
            drop in a question you saved from Ask the Data.
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
    </Layout>
  );
}
