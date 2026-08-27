/*
 * The dashboard's own screen.
 *
 * Every figure here comes from GET /api/admin/dashboard, which counts them in
 * SQL over the whole institute.
 *
 * THE THREE TIERS
 * ---------------
 * The screen still reads top to bottom in decreasing urgency, and each tier is
 * a different SHAPE because it answers a different kind of question:
 *
 *   1. FOUR FIGURES, at 32px. The state of the institute in one glance. A tile
 *      only takes colour when its supporting line is asking for something, so
 *      a healthy row is monochrome and a problem is the only thing on it.
 *   2. THREE PANELS, at 20px, each built around a proportion bar. These answer
 *      "compared to what?" — the question a bare figure cannot.
 *   3. THE FEED, at 13px. What has happened since you last looked.
 *
 * That the tiers are different sizes IS the hierarchy: squint at the page and
 * the four figures survive, then the three panel headings, then nothing. A
 * dashboard where every card is the same size has decided nothing.
 *
 * WHAT CHANGED, AND WHAT DID NOT
 * ------------------------------
 * The tiers used to be three CSS grids nested in this file. They are now items
 * in one drag-and-drop layout, so a chart saved from Ask the Data can be
 * dropped between them and push its neighbours aside instead of being stuck at
 * the bottom of the page.
 *
 * The default arrangement reproduces the old one exactly, from the factory
 * layout in the backend's config/dashboardCards.js. An admin who never presses
 * Customise sees precisely the screen they saw before.
 *
 * WHY THE BUILT-IN PANELS CANNOT BE DELETED HERE
 * ----------------------------------------------
 * They are what the screen is for. An account that had removed the four
 * figures and the feed would be looking at a dashboard that no longer answers
 * "what is the state of the institute", which is the only question it exists
 * to answer. They can be moved and rearranged; cards the user added themselves
 * can be moved, resized and removed. The server enforces the same rule — see
 * layout.service.js — so this is not a UI convention that a crafted request
 * could step around.
 *
 * They also keep their sizes. A stat tile stretched to half the screen is not
 * a better stat tile, and a proportion bar is tuned to the width its legend
 * needs.
 */

import { useEffect, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';

import WelcomeBanner from '../WelcomeBanner';
import StatCard from '../../common/StatCard';
import RouteLoader from '../../common/RouteLoader';
import RecentActivity from '../RecentActivity';
import FeeCollectionPanel from './FeeCollectionPanel';
import StudentRollPanel from './StudentRollPanel';
import AcademicStandingPanel from './AcademicStandingPanel';

import CardGrid from '../pinned/CardGrid';
import EditPanel from '../pinned/EditPanel';
import SavedQueryCard from '../pinned/SavedQueryCard';
import { usePinnedSurface } from '../pinned/usePinnedSurface';

import { formatMoneyCompact } from '../../../utils/currency';
import { admin as adminApi } from '../../../api/endpoints';
import { useAdminPage } from '../../../hooks/useAdminPage';
import {
  SURFACE, TYPE, SPACE, RULE, TONE, RADIUS, CARD, ACCENT,
} from '../../../styles/adminTheme';

// A figure the database cannot yet answer is shown as a dash, never as zero.
const pct = (value) => (value == null ? '—' : `${Number(value).toFixed(1)}%`);

/*
 * The eight panels the Dashboard ships with.
 *
 * Each is a thin wrapper over the component that already drew it — the tiles
 * are StatCards, the proportions are the three Panel components, the feed is
 * RecentActivity. Nothing about how any of them looks or what it reads has
 * changed; they have only stopped being positioned by this file.
 *
 * The keys match backend config/dashboardCards.js. A key the server sends that
 * is missing here renders an honest gap rather than an empty cell.
 */
/*
 * WHY EVERY LINKED PANEL TAKES `editing`
 * --------------------------------------
 * A stat tile is wrapped in a <Link> to the screen it summarises, so pressing
 * one, dragging it across the grid and releasing was delivered to that link as
 * an ordinary click: the card moved and the portal immediately navigated to
 * /students, throwing the arrangement away.
 *
 * Passing `to={undefined}` while arranging is the whole fix — StatCard renders
 * the bare card and no anchor at all when it has nowhere to go (see its final
 * `if (!to) return card`), so there is nothing left to click through. Outside
 * edit mode the links are exactly as they were.
 *
 * The stylesheet also blocks anchor hits inside an editing grid, which covers
 * any link nested deeper than this file can see — the activity feed's rows,
 * for one.
 */
const PANELS = {
  stat_students: ({ data, editing }) => (
    <StatCard
      title="Students"
      value={data.students.total.toLocaleString()}
      meta={
        data.students.pending > 0
          ? `${data.students.pending.toLocaleString()} awaiting verification`
          : `${data.students.active.toLocaleString()} active across ${data.students.programs} programme${data.students.programs === 1 ? '' : 's'}`
      }
      tone={data.students.pending > 0 ? 'warning' : 'neutral'}
      to={editing ? undefined : '/students'}
    />
  ),

  stat_pass_rate: ({ data, editing }) => (
    <StatCard
      title="Pass rate"
      value={pct(data.academics.passRate)}
      meta={
        data.academics.withResult > 0
          ? `${data.academics.passed.toLocaleString()} of ${data.academics.withResult.toLocaleString()} published results`
          : 'No published results yet'
      }
      tone={data.academics.passRate == null ? 'neutral'
        : data.academics.passRate >= 80 ? 'positive' : 'warning'}
      to={editing ? undefined : '/examination'}
    />
  ),

  stat_fees: ({ data, editing }) => (
    <StatCard
      title="Fees collected"
      value={formatMoneyCompact(data.fees.collected ?? 0)}
      meta={
        data.fees.studentsOverdue > 0
          ? `${data.fees.studentsOverdue.toLocaleString()} student${data.fees.studentsOverdue === 1 ? '' : 's'} overdue`
          : data.fees.outstanding > 0
            ? `${formatMoneyCompact(data.fees.outstanding)} still outstanding`
            : `All ${data.fees.studentsPaid.toLocaleString()} settled`
      }
      tone={data.fees.studentsOverdue > 0 ? 'critical'
        : data.fees.outstanding > 0 ? 'warning' : 'positive'}
      to={editing ? undefined : '/fee-management'}
    />
  ),

  stat_attendance: ({ data, editing }) => (
    <StatCard
      title="Attendance"
      value={pct(data.attendance.average)}
      meta={
        data.attendance.below75 > 0
          ? `${data.attendance.below75.toLocaleString()} below the 75% requirement`
          : `All ${data.attendance.studentsWithRecords.toLocaleString()} tracked students meet 75%`
      }
      tone={data.attendance.below75 > 0 ? 'critical' : 'positive'}
      to={editing ? undefined : '/attendance'}
    />
  ),

  panel_fee_collection: ({ data }) => (
    <FeeCollectionPanel fees={data.fees} totalStudents={data.students.total} />
  ),

  panel_student_roll: ({ data }) => (
    <StudentRollPanel students={data.students} />
  ),

  panel_academic_standing: ({ data }) => (
    <AcademicStandingPanel academics={data.academics} totalStudents={data.students.total} />
  ),

  feed_recent_activity: () => <RecentActivity />,
};

export default function DashboardHome() {
  const { data, loading, error, refresh } = useAdminPage(
    () => adminApi.dashboard(),
    {}, { key: 'admin-dashboard' });

  const pinned = usePinnedSurface('dashboard');

  // The placeholder size while a chip from the strip is hovering the grid.
  const [droppingSize, setDroppingSize] = useState(null);

  /*
   * When the figures on screen were last read from the database.
   *
   * A dashboard gets left open on an office desk for hours, and a number with
   * no timestamp beside it cannot be trusted or corrected — you cannot tell a
   * quiet morning from a stale tab. Stamped when a response lands rather than
   * when one is asked for, so it always describes the data actually being
   * shown.
   */
  const [readAt, setReadAt] = useState(null);
  const seen = useRef(null);

  useEffect(() => {
    if (data && data !== seen.current) {
      seen.current = data;
      setReadAt(new Date().toISOString());
    }
  }, [data]);

  if ((loading && !data) || pinned.loading) {
    return (
      <RouteLoader
        label="Loading dashboard…"
        hint="Institute-wide student, fee, attendance and academic figures"
      />
    );
  }

  if (error && !data) {
    return <LoadFailure error={error} onRetry={refresh} />;
  }

  const renderCard = (card, ctx) => {
    if (card.kind === 'builtin') {
      const Panel = PANELS[card.builtinKey];

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
       * The built-ins draw their own card chrome — they always did — so they
       * are placed in the cell as they are rather than wrapped in the pinned
       * card shell. `pin-native` only makes them fill the height the grid gave
       * them and scroll if their contents exceed it.
       */
      return (
        <div className="pin-native">
          <Panel data={data} editing={ctx.editing} />
        </div>
      );
    }

    const savedQuery = pinned.savedById.get(card.savedQueryId);

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
      style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xl }}
    >
      {/* Customise rides in the banner's control row, next to Refresh — both
          act on this screen as a whole. See WelcomeBanner. */}
      <WelcomeBanner
        onRefresh={refresh}
        refreshing={loading}
        readAt={readAt}
        actions={(
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
        )}
      />

      {/* A refresh that failed while figures are already on screen. The stale
          figures stay — blanking a working dashboard because one reload timed
          out is worse than showing numbers with a note saying how old they
          are, which the banner above already does. */}
      {error && <StaleNotice error={error} onRetry={refresh} />}

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
          padding: '0.7rem 0.9rem', borderRadius: RADIUS.control,
          border: '1px solid #FDE68A', background: '#FFFBEB',
          fontSize: '0.8rem', color: '#92400E',
        }}>
          <span>This screen could not be arranged: {pinned.loadError}</span>
          <button type="button" className="pin-btn" onClick={pinned.reload}>
            Try again
          </button>
        </div>
      )}

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
    </div>
  );
}

/* The dashboard could not be loaded at all, so there is nothing to show. */
function LoadFailure({ error, onRetry }) {
  return (
    <div
      role="alert"
      style={{
        ...CARD,
        padding: SPACE.xl,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: SPACE.sm,
        borderColor: ACCENT.edge,
      }}
    >
      <ShieldAlert size={20} style={{ color: ACCENT.base }} aria-hidden="true" />
      <p style={{ ...TYPE.heading, color: ACCENT.base }}>Could not load the dashboard</p>
      <p style={{ ...TYPE.body, textWrap: 'pretty' }}>{error}</p>
      <button type="button" onClick={onRetry} className="ad-chip ad-focusable" style={{ marginTop: SPACE.xs }}>
        Try again
      </button>
    </div>
  );
}

/*
 * A reload failed but the previous figures are still on screen. Deliberately a
 * quiet strip rather than a red panel: nothing is broken, the numbers are just
 * older than they look, and the banner above says exactly how old.
 */
function StaleNotice({ error, onRetry }) {
  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: SPACE.md,
        padding: `10px ${SPACE.lg}`,
        borderRadius: RADIUS.control,
        border: `1px solid ${RULE.hairline}`,
        backgroundColor: SURFACE.inset,
      }}
    >
      <p style={{ ...TYPE.meta, textWrap: 'pretty' }}>
        <span style={{ color: TONE.warning, fontWeight: 600 }}>Showing the last figures read.</span>
        {' '}The refresh did not go through: {error}
      </p>
      <button type="button" onClick={onRetry} className="ad-chip ad-focusable">
        Try again
      </button>
    </div>
  );
}
