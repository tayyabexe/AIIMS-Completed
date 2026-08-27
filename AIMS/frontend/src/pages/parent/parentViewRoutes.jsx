/*
 * Route wrappers for the five parent views that already existed as components.
 *
 * AttendanceView, TimetableView, ResultsView, FeeView and NotificationsView
 * were written to be mounted by ParentDashboard with an identical prop set —
 * `{ wards, selectedChildId, onSelectChild }`. Rather than rewrite five
 * working screens to read a context, each gets a four-line wrapper that hands
 * them the same props from the same source. The views are untouched, which is
 * the point: this refactor moves the portal's navigation, it does not get to
 * change what any screen shows.
 *
 * The "no children" empty state used to be repeated inline five times, once
 * per tab, with a different icon each time. It is one component here.
 */

import { useNavigate } from 'react-router-dom';
import {
  CalendarCheck, CalendarRange, Award, DollarSign, Bell,
} from 'lucide-react';
import ParentAttendanceView from './AttendanceView';
import ParentTimetableView from './TimetableView';
import ParentResultsView from './ResultsView';
import ParentFeeView from './FeeView';
import ParentNotificationsView from './NotificationsView';
import ParentProfileView from './ProfileView';
import { useParentPortal, withChild } from './ParentPortalContext';
import { PARENT_HOME } from './parentNav';
import { sectionStyle, FAINT } from './parentTheme';

function NoChildren({ icon: Icon }) {
  return (
    <div style={{ ...sectionStyle, padding: '3rem', textAlign: 'center' }}>
      <Icon size={48} color="#CBD5E1" />
      <p style={{ fontSize: '1rem', color: FAINT, marginTop: '1rem' }}>
        No children assigned to your account
      </p>
    </div>
  );
}

/** The three props every ward-scoped view takes, from the portal context. */
function useWardProps() {
  const { myChildren, selectedChildId, selectChild } = useParentPortal();
  return {
    empty: myChildren.length === 0,
    props: {
      wards: myChildren,
      selectedChildId,
      onSelectChild: selectChild,
    },
  };
}

export function ParentAttendanceRoute() {
  const { empty, props } = useWardProps();
  if (empty) return <NoChildren icon={CalendarCheck} />;
  return <ParentAttendanceView {...props} />;
}

export function ParentTimetableRoute() {
  const { empty, props } = useWardProps();
  if (empty) return <NoChildren icon={CalendarRange} />;
  // No timetable rows are passed in: the view reads
  // GET /api/timetables/current?student_id= itself, which resolves the child's
  // section server-side and joins the teacher and classroom names that
  // /api/parent/timetable only has ids for.
  return <ParentTimetableView {...props} />;
}

export function ParentResultsRoute() {
  const { empty, props } = useWardProps();
  if (empty) return <NoChildren icon={Award} />;
  return <ParentResultsView {...props} />;
}

export function ParentFeesRoute() {
  const { empty, props } = useWardProps();
  if (empty) return <NoChildren icon={DollarSign} />;
  // No raw fee rows are passed: the loader merges both billing record sets
  // into one settled ledger per child, which the view reads off the child
  // record itself.
  return <ParentFeeView {...props} />;
}

export function ParentNotificationsRoute() {
  const navigate = useNavigate();
  const { empty, props } = useWardProps();
  if (empty) return <NoChildren icon={Bell} />;
  return (
    <ParentNotificationsView
      {...props}
      onViewChild={(id) => navigate(withChild(PARENT_HOME, id))}
    />
  );
}

export function ParentProfileRoute() {
  const navigate = useNavigate();
  const { user, parentData, myChildren } = useParentPortal();
  return (
    <ParentProfileView
      user={user}
      parentData={parentData}
      wards={myChildren}
      onViewChild={(id) => navigate(withChild(PARENT_HOME, id))}
    />
  );
}
