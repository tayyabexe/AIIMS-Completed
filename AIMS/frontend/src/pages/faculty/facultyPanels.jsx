/*
 * The faculty dashboard, taken apart.
 *
 * This screen used to be one component that laid out its own grid in CSS: a
 * hero, a row of four stat tiles, a two-up chart row, a 1.6fr/1fr panel row and
 * a two-up insights row, in that order, always. Every figure is still computed
 * exactly as it was, from the same three endpoints — nothing about the numbers
 * has changed — but each block is now registered under a key, so the
 * arrangement is data rather than markup.
 *
 * That is what lets a teacher drop a saved question *between* the two charts
 * and push them aside. There is no longer a fixed row for the charts to be in.
 *
 * WHY THE FIXED ROWS HAD TO GO ANYWAY
 * -----------------------------------
 * The old `.dash-grid` put Today's Schedule beside Recent Notifications in one
 * CSS grid row. A row is as tall as its tallest cell, so a teacher with no
 * lectures timetabled got a 90px schedule panel sitting in a 600px row, with
 * half a screen of white space under it. Nothing was wrong with either panel;
 * the row was the problem. The pinned grid compacts vertically, so a short
 * panel takes short space and whatever is under it moves up.
 *
 * EVERY PANEL IS HANDED ITS DATA
 * ------------------------------
 * None of these fetches anything. The screen loads its three requests once and
 * passes the results down: ten panels each loading the dashboard endpoint would
 * be ten requests for one screen, and a panel the teacher has hidden should not
 * still be costing a query.
 *
 * `editing` is passed for the same reason it is on the admin dashboard: while
 * the board is being arranged, the stat tiles must stop being navigation. A
 * tile that navigates on click will fire that click at the end of a drag, and
 * the teacher who was moving it ends up on another screen.
 */

import {
  BookOpen,
  Users,
  CalendarClock,
  ClipboardCheck,
  TrendingUp,
  Megaphone,
  Upload,
  MessageSquare,
  AlertTriangle,
} from 'lucide-react';

import { BarChartCard, PieChartCard } from '../../components/faculty/Charts.jsx';
import { relativeTime } from '../../api/notificationsData';

/* --------------------------------------------------------------- shared -- */

const ACTIVITY_STYLE = {
  Attendance: { icon: ClipboardCheck, bg: '#e7f7ee', color: '#1f9d55' },
  Result: { icon: TrendingUp, bg: '#fdeaea', color: '#d1373f' },
  Academic: { icon: Megaphone, bg: '#fdf2df', color: '#b6791b' },
  Announcement: { icon: Megaphone, bg: '#fdf2df', color: '#b6791b' },
  Meeting: { icon: CalendarClock, bg: '#f1eafd', color: '#7c3aed' },
  Leave: { icon: CalendarClock, bg: '#eef0f2', color: '#6b7078' },
  Payroll: { icon: Upload, bg: '#eaf1fd', color: '#2a63c9' },
  HR: { icon: MessageSquare, bg: '#eaf1fd', color: '#2a63c9' },
  Fee: { icon: Upload, bg: '#fdf2df', color: '#b6791b' },
  default: { icon: MessageSquare, bg: '#eaf1fd', color: '#2a63c9' },
};

const clock = (hhmm) => {
  if (!hhmm) return '';
  const [h, m] = String(hhmm).split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`;
};

/*
 * A stat tile.
 *
 * `role="button"` and the keydown handler are the originals. What is new is
 * that both are withdrawn while the board is being arranged — see the header.
 * Withdrawing the role as well as the handler matters: a div that still
 * announces itself as a button to a screen reader while doing nothing when
 * pressed is worse than a plain div.
 */
function StatTile({ label, value, icon: Icon, bg, color, to, editing, navigate }) {
  const interactive = !editing && !!to;

  return (
    <div
      className="stat-card"
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => navigate(to) : undefined}
      onKeyDown={interactive ? (e) => e.key === 'Enter' && navigate(to) : undefined}
    >
      <div className="stat-card-top">
        <span className="stat-card-label">{label}</span>
        <span className="stat-icon" style={{ background: bg, color }}>
          <Icon size={17} />
        </span>
      </div>
      <span className="stat-value">{value}</span>
    </div>
  );
}

/*
 * The head of a panel, with its link suppressed while arranging.
 *
 * Same reason as the stat tiles: a "View all" button inside a card being
 * dragged is a navigation waiting to fire on mouse-up.
 */
function PanelHead({ title, action, editing }) {
  return (
    <div className="panel-head">
      <h3>{title}</h3>
      {action && !editing && (
        <button className="link link-btn" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- the registry -- */

const PANELS = {

  /* -- tier 1: the four figures ------------------------------------------ */

  stat_my_classes: ({ data, editing, navigate }) => (
    <StatTile
      label="My Classes"
      value={data.stats.classes}
      icon={BookOpen}
      bg="#f1eafd"
      color="#7c3aed"
      to="/faculty/my-classes"
      editing={editing}
      navigate={navigate}
    />
  ),

  stat_my_students: ({ data, editing, navigate }) => (
    <StatTile
      label="Students"
      value={data.stats.students}
      icon={Users}
      bg="#eaf1fd"
      color="#2a63c9"
      to="/faculty/students"
      editing={editing}
      navigate={navigate}
    />
  ),

  stat_lectures_today: ({ data, editing, navigate }) => (
    <StatTile
      label="Today's Lectures"
      value={data.stats.lectures_today}
      icon={CalendarClock}
      bg="#fdf2df"
      color="#b6791b"
      to="/faculty/timetable"
      editing={editing}
      navigate={navigate}
    />
  ),

  stat_avg_attendance: ({ data, editing, navigate }) => (
    <StatTile
      label="Avg Attendance"
      /* A dash, never a zero: a teacher with no registers marked yet has no
         average, and printing 0% would read as "nobody attends". */
      value={data.stats.average_attendance != null ? `${data.stats.average_attendance}%` : '—'}
      icon={ClipboardCheck}
      bg="#e7f7ee"
      color="#1f9d55"
      to="/faculty/attendance"
      editing={editing}
      navigate={navigate}
    />
  ),

  /* -- tier 2: the two charts -------------------------------------------- */

  /*
   * Both charts are handed `height="100%"` rather than the 280px they used to
   * take. Their cell is one the teacher can resize, and a chart that ignores
   * the box it was given would leave a growing band of empty card under itself
   * as the card is pulled taller. See `.pin-native > .chart-card` in
   * facultyDashboard.pinned.css for the grid rows that make 100% resolve.
   */
  chart_class_performance: ({ data }) => {
    const rows = (data.class_performance || [])
      .filter((c) => c.attendance_percentage !== null || c.marks_percentage !== null)
      .map((c) => ({
        name: c.label,
        attendance: c.attendance_percentage,
        marks: c.marks_percentage,
      }));

    return (
      <BarChartCard
        title="Class Performance"
        subtitle="Attendance rate against marks average, per class"
        data={rows}
        xKey="name"
        series={[
          { key: 'attendance', name: 'Attendance %', color: '#d1373f' },
          { key: 'marks', name: 'Marks %', color: '#2a63c9' },
        ]}
        height="100%"
        formatter={(v) => (v === null ? 'No data' : `${v}%`)}
      />
    );
  },

  chart_grade_distribution: ({ data }) => {
    const rows = (data.grade_distribution || [])
      .filter((g) => g.count > 0)
      .map((g) => ({ name: g.grade, value: g.count }));

    return (
      <PieChartCard
        title="Grade Distribution"
        subtitle="Students graded in my subjects"
        data={rows}
        height="100%"
        formatter={(v) => `${v} students`}
      />
    );
  },

  /* -- tier 3: today, and what has been announced ------------------------ */

  panel_today_schedule: ({ data, editing, navigate }) => (
    <div className="panel">
      <PanelHead
        title="Today's Schedule"
        editing={editing}
        action={{
          label: data.today.day_of_week,
          onClick: () => navigate('/faculty/timetable'),
        }}
      />

      <div className="fac-pin-list">
        {data.today.schedule.length === 0 && (
          <div className="schedule-row">
            <div className="schedule-card">
              <div className="meta">No lectures timetabled for {data.today.day_of_week}.</div>
            </div>
          </div>
        )}

        {data.today.schedule.map((s) => (
          <div className="schedule-row" key={s.timetable_id}>
            <div className="schedule-time">
              {clock(s.start_time)} – {clock(s.end_time)}
            </div>
            <div className="schedule-card">
              <div className="title">{s.subject_name}</div>
              <div className="meta">
                {s.subject_code} · Sec {s.section_name}
                {s.room_name ? ` · ${s.room_name}` : ''}
                {' · '}
                {s.is_marked ? 'Attendance marked' : 'Attendance pending'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  ),

  panel_notifications: ({ editing, navigate, notices, noticesState }) => (
    <div className="panel">
      <PanelHead
        title="Recent Notifications"
        editing={editing}
        action={{ label: 'View all >', onClick: () => navigate('/faculty/notifications') }}
      />

      <div className="fac-pin-list">
        {noticesState.loading && <div className="notif-row"><div className="body">Loading…</div></div>}

        {!noticesState.loading && noticesState.error && (
          <div className="notif-row">
            <div className="body">Could not load notifications: {noticesState.error}</div>
          </div>
        )}

        {!noticesState.loading && !noticesState.error && notices.length === 0 && (
          <div className="notif-row">
            <div className="body">No notifications or announcements for you yet.</div>
          </div>
        )}

        {!noticesState.loading && !noticesState.error && notices.slice(0, 5).map((n) => (
          <div className="notif-row" key={n.id}>
            <span
              className="notif-dot"
              style={{
                background: (ACTIVITY_STYLE[n.type] || ACTIVITY_STYLE.default).color,
                opacity: n.is_read ? 0.35 : 1,
              }}
            />
            <div>
              <div className="title">
                {n.title}
                {n.source === 'announcement' && n.posted_by_name ? ` · ${n.posted_by_name}` : ''}
              </div>
              <div className="body">{n.message}</div>
              <div className="time">{relativeTime(n.created_at)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  ),

  /* -- tier 4: the two long panels --------------------------------------- */

  panel_academic_insights: ({ data }) => (
    <div className="insights-card">
      <div className="insights-head">
        <span className="insights-icon">
          <AlertTriangle size={18} color="#fff" />
        </span>
        <div>
          <h3>Academic Insights</h3>
          <div className="confidence">
            Counted from my {data.stats.classes} classes · {data.stats.students} students
          </div>
        </div>
      </div>

      <div className="insights-stat-grid">
        {[
          {
            label: `At-Risk (<${data.thresholds.attendance_at_risk}% attendance)`,
            value: data.stats.students_at_risk,
            color: '#e05a5a',
          },
          {
            label: `Excelling (≥${data.thresholds.marks_excellent}% marks)`,
            value: data.stats.students_excelling,
            color: '#3fcf7f',
          },
          {
            label: 'Average Attendance',
            value: data.stats.average_attendance != null ? `${data.stats.average_attendance}%` : '—',
            color: '#f0b23c',
          },
          { label: 'Registers Pending Today', value: data.stats.registers_pending, color: '#4c9bf5' },
        ].map((s) => (
          <div className="insights-stat-cell" key={s.label}>
            <div className="insights-stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="insights-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="insights-actions">
        <h4>Recommended Actions</h4>
        <ul>
          {(data.recommended_actions || []).map((a) => <li key={a}>{a}</li>)}
        </ul>
      </div>

      {data.at_risk_students.length > 0 && (
        <div className="insights-actions">
          <h4>Students Needing Follow-Up</h4>
          <ul>
            {data.at_risk_students.map((s) => (
              <li key={s.student_id}>
                {s.full_name} ({s.registration_number})
                {s.section_name ? ` · Sec ${s.section_name}` : ''}
                {' — '}{s.percentage}% attendance over {s.total_sessions} sessions
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  ),

  feed_recent_activity: ({ editing, activity, activityState }) => (
    <div className="panel">
      <PanelHead title="Recent Activity" editing={editing} />

      <div className="fac-pin-list">
        {activityState.loading && (
          <div className="activity-row"><div className="meta">Loading recent activity…</div></div>
        )}

        {!activityState.loading && activityState.error && (
          <div className="activity-row">
            <div className="meta">Could not load recent activity: {activityState.error}</div>
          </div>
        )}

        {!activityState.loading && !activityState.error && activity.length === 0 && (
          <div className="activity-row">
            <div className="meta">
              Nothing recorded yet — registers you mark and marks you enter appear here.
            </div>
          </div>
        )}

        {!activityState.loading && !activityState.error && activity.map((a) => {
          const style = ACTIVITY_STYLE[a.kind] || ACTIVITY_STYLE.default;
          const Icon = style.icon;
          return (
            <div className="activity-row" key={a.id}>
              <span className="activity-icon-box" style={{ background: style.bg, color: style.color }}>
                <Icon size={17} />
              </span>
              <div style={{ flex: 1 }}>
                <div className="title-row">
                  <span className="title">{a.title}</span>
                  <span className="time">{relativeTime(a.at)}</span>
                </div>
                <div className="meta">{a.message}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  ),
};

export default PANELS;
