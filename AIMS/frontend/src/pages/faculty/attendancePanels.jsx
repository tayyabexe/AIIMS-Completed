/*
 * The Attendance screen's analytics section, taken apart.
 *
 * Same move facultyPanels.jsx makes for the dashboard: each block below the
 * "Attendance Analytics" heading is registered under a key, so the arrangement
 * is data rather than markup and a teacher can move, resize or hide any of it.
 *
 * WHAT IS NOT IN HERE
 * -------------------
 * The class picker, the register table and Submit. Those are a task with an
 * order — choose, mark, submit — and an order is not something to arrange. They
 * stay fixed above the board. See the migration at
 * database/migrations/20260823120000 for the full reasoning.
 *
 * EVERY PANEL IS HANDED ITS DATA
 * ------------------------------
 * None of these fetches anything. StudentAttendance.jsx already loads
 * GET /api/faculty/attendance/trend once per (class, date, period) and passes
 * the result down. Six panels each loading that endpoint would be six requests
 * for one section of one screen, and a panel the teacher has hidden should not
 * still be costing a query.
 *
 * That is also what keeps them updated. The panels are pure functions of the
 * `trend` prop, so changing the class in the picker or the period on the tabs
 * re-renders all six from the one response — there is no per-panel cache to
 * fall out of step with the heading above it.
 *
 * THE 75% LINE
 * ------------
 * The institute requires 75% attendance. That number is not decoration here:
 * it is the same threshold `facultyPortalService.ATTENDANCE_AT_RISK` flags
 * students against, so a class below it is a class the teacher will be asked
 * about. It is drawn on the trend chart and stated on the average tile, and
 * those are the only two places colour is spent on a verdict rather than on
 * the register's own status vocabulary.
 */

import {
  UserCheck,
  Clock3,
  UserX,
  CalendarOff,
  ClipboardList,
} from 'lucide-react';

import { LineChartCard, PieChartCard } from '../../components/faculty/Charts.jsx';

/*
 * The institute's attendance requirement, and the one number on this screen
 * that carries a judgement. Mirrors ATTENDANCE_AT_RISK in
 * backend/src/services/facultyPortalService.js — if that moves, this moves.
 */
export const ATTENDANCE_REQUIREMENT = 75;

/* ---------------------------------------------------------------- a tile -- */

/*
 * One figure from the register.
 *
 * WHY THIS IS NOT THE DASHBOARD'S `StatTile`
 * ------------------------------------------
 * That one is a link — every dashboard tile navigates somewhere. These four
 * describe the class already on screen, so there is nowhere for them to go, and
 * a tile that looks pressable but is not is worse than one that plainly is not.
 * They share the visual language (`.stat-card` chrome, an icon chip in the
 * status colour) and drop the interaction.
 *
 * `tone` is the register's own colour for that mark — the same green, amber,
 * red and blue the radio buttons in the table above use. Reusing them is what
 * lets the eye connect "Absences 3" with the three red marks it just made,
 * instead of learning a second palette for the same five states.
 */
function AttendanceStat({ label, value, hint, icon: Icon, tone }) {
  return (
    <div className="att-stat" style={{ '--att-tone': tone }}>
      <div className="att-stat-top">
        <span className="att-stat-label">{label}</span>
        <span className="att-stat-chip">
          <Icon size={16} />
        </span>
      </div>

      <span className="att-stat-value">{value}</span>

      {/* Always rendered, even when empty, so a tile with a hint and a tile
          without do not sit at two different heights in the same row. */}
      <span className="att-stat-hint">{hint || ' '}</span>
    </div>
  );
}

/*
 * An empty state that names the action rather than the absence.
 *
 * "No records in this period" tells a teacher what is missing; it does not tell
 * them that the register above is how to fix it. On a screen where the remedy
 * is fifteen centimetres up the page, saying so is the whole job.
 */
function NoRecords({ title, note }) {
  return (
    <div className="chart-card att-empty-card">
      <div className="chart-card-head">
        <div>
          <h3>{title}</h3>
          <p>{note}</p>
        </div>
      </div>
      <div className="att-empty">
        <span className="att-empty-mark">
          <ClipboardList size={20} />
        </span>
        <strong>Nothing marked yet</strong>
        <span>
          Mark the register above and submit it. This fills in from the
          registers you have already saved for this class.
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- the registry -- */

const ATTENDANCE_PANELS = {

  /* -- tier 1: the four figures, in the order a register is read ---------- */

  /*
   * The focal tile. It is the only one of the four with a rule attached, so it
   * is the only one that states a verdict — the other three are counts you
   * read, this is a figure you judge.
   *
   * A dash, never a zero, when nothing is marked: printing 0% for a class whose
   * register has never been taken reads as "nobody attends", which is a much
   * worse lie than "not known yet". Same rule the dashboard's average tile
   * follows.
   */
  stat_avg_attendance: ({ trend }) => {
    const pct = trend?.totals?.percentage;
    const known = pct != null;
    const meets = known && pct >= ATTENDANCE_REQUIREMENT;

    return (
      <AttendanceStat
        label="Avg Attendance"
        value={known ? `${pct}%` : '—'}
        hint={
          known
            ? (meets
              ? `Meets the ${ATTENDANCE_REQUIREMENT}% requirement`
              : `${Math.round((ATTENDANCE_REQUIREMENT - pct) * 10) / 10} pts below ${ATTENDANCE_REQUIREMENT}%`)
            : 'No registers submitted yet'
        }
        icon={UserCheck}
        /* Red only when the class is actually short of the requirement. An
           average that meets it is not an alert. */
        tone={known && !meets ? 'var(--danger-text)' : 'var(--success-text)'}
      />
    );
  },

  stat_late_arrivals: ({ trend }) => {
    const late = trend?.totals?.late ?? 0;

    return (
      <AttendanceStat
        label="Late Arrivals"
        value={late}
        /* 'Late' still counts as attended — see the SUM in
           facultyPortalService.classAttendanceRates. Saying so here stops the
           tile reading as a second absence count sitting beside the first. */
        hint={late ? 'Counted as present' : 'None recorded'}
        icon={Clock3}
        tone="var(--warning-text)"
      />
    );
  },

  stat_absences: ({ trend }) => {
    const absent = trend?.totals?.absent ?? 0;
    const total = trend?.totals?.total ?? 0;

    return (
      <AttendanceStat
        label="Absences"
        value={absent}
        hint={total ? `of ${total} marks in this period` : 'None recorded'}
        icon={UserX}
        tone="var(--danger-text)"
      />
    );
  },

  stat_leave_holiday: ({ trend }) => {
    const leave = trend?.totals?.leave ?? 0;
    const holiday = trend?.totals?.holiday ?? 0;

    return (
      <AttendanceStat
        label="Leave + Holiday"
        value={leave + holiday}
        /* Broken out because they are not the same thing to a teacher: leave is
           one student's excused absence, a holiday is the whole class. A single
           combined figure hides which of the two happened. */
        hint={
          leave || holiday
            ? `${leave} leave · ${holiday} holiday`
            : 'None recorded'
        }
        icon={CalendarOff}
        tone="var(--info-text)"
      />
    );
  },

  /* -- tier 2: the two charts -------------------------------------------- */

  /*
   * Both charts are handed `height="100%"` rather than a fixed pixel height.
   * Their cell is one the teacher can resize, and a chart that ignores the box
   * it was given leaves a growing band of empty card under itself as the card
   * is pulled taller. See `.pin-native > .chart-card` in
   * facultyDashboard.pinned.css for the grid rows that make 100% resolve —
   * this screen imports the same file.
   */
  chart_attendance_trend: ({ trendSeries, trendRange, period }) => {
    if (!trendSeries.length) {
      return <NoRecords title={`Attendance Trend — ${period}`} note={trendRange} />;
    }

    return (
      <LineChartCard
        title={`Attendance Trend — ${period}`}
        subtitle={trendRange}
        data={trendSeries}
        xKey="day"
        series={[{ key: 'pct', name: 'Attendance %', color: '#2a63c9' }]}
        height="100%"
        formatter={(v) => `${v}%`}
        /* The signature. See the header, and LineChartCard's own. */
        reference={{
          value: ATTENDANCE_REQUIREMENT,
          label: `${ATTENDANCE_REQUIREMENT}% required`,
          color: 'var(--danger-text)',
        }}
      />
    );
  },

  chart_status_split: ({ trend, statusPie, trendRange }) => {
    if (!statusPie.length) {
      return <NoRecords title="Status Split" note="No records in this period" />;
    }

    return (
      <PieChartCard
        title="Status Split"
        subtitle={`${trend.totals.total} records · ${trendRange}`}
        data={statusPie}
        height="100%"
        formatter={(v) => `${v} records`}
      />
    );
  },
};

export default ATTENDANCE_PANELS;
