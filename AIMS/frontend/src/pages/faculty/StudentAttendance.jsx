import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDraft, useOnlineStatus } from "../../hooks/useDraft";
import DraftNotice from "../../components/common/DraftNotice";
import { useSearchParams } from "react-router-dom";
import { Send, Download } from "lucide-react";
import Layout from "../../components/faculty/Layout.jsx";
import DataTable from "../../components/faculty/DataTable.jsx";
import Avatar from "../../components/faculty/Avatar.jsx";
import FilterBar, {
  FilterSelect,
  FilterInput,
  FilterDate,
} from "../../components/faculty/FilterBar.jsx";
import { useToast } from "../../components/faculty/Toast.jsx";
import DataGate from "../../components/faculty/DataState.jsx";
import { useAuth } from "../../context/FacultyAuthContext.jsx";
import { faculty as facultyApi } from "../../api/endpoints";
import { useFacultyClasses } from '../../hooks/useFacultyLookups';
import { fmtDateShort } from "../../utils/helpers.js";
import { exportCSV, exportExcel, exportPDF } from "../../utils/exporters.js";
import CardGrid from "../../components/admin/pinned/CardGrid.jsx";
import EditPanel from "../../components/admin/pinned/EditPanel.jsx";
import SavedQueryCard from "../../components/admin/pinned/SavedQueryCard.jsx";
import { usePinnedSurface } from "../../components/admin/pinned/usePinnedSurface.js";
import "../../components/admin/pinned/pinned.css";

import ATTENDANCE_PANELS from "./attendancePanels.jsx";
import "./StudentAttendance.css";
/*
 * Borrowed wholesale from the dashboard, not copied.
 *
 * Every rule in it is scoped under `.pin-cell` / `.pin-native` and it exists to
 * do exactly one thing: make a `.chart-card` resolve `height: 100%` against the
 * cell the grid gave it. That problem is identical here, and a second stylesheet
 * restating it is how the two drift apart.
 */
import "./facultyDashboard.pinned.css";

// Register for one class on one date, read from and written to
// GET/POST /api/faculty/attendance. Statuses are the `attendance.status` ENUM.
const STATUSES = ["Present", "Absent", "Late", "Leave", "Holiday"];

const STATUS_COLOR = {
  Present: "#16a34a",
  Absent: "#dc2626",
  Late: "#d97706",
  Leave: "#2563eb",
  Holiday: "#7c3aed",
};

const PERIODS = ["Daily", "Weekly", "Monthly"];

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const shiftDays = (iso, days) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const clock = (hhmm) => {
  if (!hhmm) return "";
  const [h, m] = String(hhmm).split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
};

export default function StudentAttendance() {
  const showToast = useToast();
  const { can } = useAuth();
  const [searchParams] = useSearchParams();

  /*
   * Shared with My Classes, Reports and Marks. This screen previously fetched
   * the same list a fourth time, and it is the list the register cannot be
   * drawn without, so it was on the critical path of every visit.
   */
  const {
    data: classes,
    loading: classesLoading,
    error: classesError,
  } = useFacultyClasses();

  const [selectedKey, setSelectedKey] = useState("");
  const [date, setDate] = useState(todayIso);
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("Weekly");
  const [exporting, setExporting] = useState("");

  const [sheet, setSheet] = useState(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState(null);

  /*
   * WHICH PERIOD'S REGISTER IS OPEN.
   *
   * A register belongs to a timetable SLOT, not to a day. CS-101 CS-A meets
   * twice on a Monday — 08:30 and 10:00 — and this screen could only ever
   * reach the first: the server resolved the slot as "the first one matching
   * this weekday", so the 10:00 lecture had no register at all and its
   * sessions never entered the 75% denominator.
   *
   * null means "whichever the server opens", which is the only period on days
   * that have one. Cleared whenever the class or the date changes, because a
   * period id from Monday means nothing on Tuesday.
   */
  const [slotId, setSlotId] = useState(null);

  // Pending status edits, keyed by student_id. Merged over the saved sheet so
  // an unsaved change is visible without pretending it has been persisted.
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const online = useOnlineStatus();

  /*
   * The half-marked register survives a crash, a refresh or a flat battery.
   *
   * `draft` holds the Present/Absent/Late marks set but not yet submitted. It
   * was ordinary React state, so a teacher who marked thirty of forty students
   * and then lost the tab started again from nothing.
   *
   * The key carries the class AND the date: a register is per-day, and marks
   * from Monday must never reappear on Tuesday's sheet.
   */
  // The register is per PERIOD, so a draft belongs to a period. Two lectures
  // on one Monday are two registers and must not share half-finished marks.
  const draftKey = `faculty.attendance.${selectedKey || 'none'}.${date}.${slotId ?? 'auto'}`;


  const registerDraft = useDraft(draftKey, draft, {
    enabled: !!selectedKey && !!date,
    isEmpty: (value) => !value || Object.keys(value).length === 0,
    /*
     * Restored by hand below, not automatically.
     *
     * loadSheet() calls setDraft({}) every time it runs, which is right when
     * the class or date changes — but it also runs on first mount, straight
     * after this hook would have restored. Auto-restoring would put the saved
     * marks back and loadSheet would immediately wipe them again.
     */
    autoRestore: false,
  });

  // Applies a restored register once its sheet has loaded, and only once per
  // class+date, so re-renders cannot keep re-applying it over live edits.
  const appliedDraftKey = useRef(null);

  useEffect(() => {
    if (!sheet || appliedDraftKey.current === draftKey) return;

    /*
     * The key is recorded only when a draft is actually APPLIED, never merely
     * because this effect ran.
     *
     * useDraft publishes `restoredDraft` through setState, so on the pass where
     * the sheet arrives it can still be null here. Claiming the work was done
     * on that pass meant the draft — which lands one render later — was never
     * applied at all: the key sat in localStorage and the register came back
     * blank. Reproduced on screen before this fix, with
     * `aims.draft.u7.faculty.attendance.21:4.2026-08-24` written and not one
     * radio restored after a reload.
     *
     * With no draft to restore this simply never fires, which is correct.
     */
    const saved = registerDraft.restoredDraft;
    if (!saved?.value || !Object.keys(saved.value).length) return;

    appliedDraftKey.current = draftKey;
    setDraft(saved.value);
  }, [sheet, draftKey, registerDraft.restoredDraft]);

  const [trend, setTrend] = useState({ series: [], totals: {} });
  const [trendLoading, setTrendLoading] = useState(false);

  /*
   * The analytics board.
   *
   * Declared here, above every early return, because it is a hook — the two
   * `return` guards further down for the class list would otherwise call it on
   * some renders and not others.
   *
   * Its own surface, separate from 'faculty_dashboard': these panels describe
   * ONE class over ONE period and change with the picker above, where the
   * dashboard's describe the whole roster. See the migration at
   * database/migrations/20260823120000.
   */
  const pinned = usePinnedSurface("faculty_attendance");

  // The placeholder size while a chip from the Customise list hovers the grid.
  const [droppingSize, setDroppingSize] = useState(null);

  // ------------------------------------------------------------- the classes
  /*
   * Choosing the class to show.
   *
   * This used to be the tail of the fetch above: the response arrived, and the
   * same block picked either the class My Classes linked here with
   * (?subject_id=&section_id=) or the first in the list. The fetch is now
   * shared, so the choosing is its own effect, keyed on the list and the URL.
   *
   * `prev ||` is kept: it must never override a class the teacher has since
   * picked by hand, and this effect can re-run when the cached list is
   * refreshed underneath them.
   */
  useEffect(() => {
    if (!classes.length) return;

    const wantSubject = searchParams.get("subject_id");
    const wantSection = searchParams.get("section_id");
    const wanted = wantSubject && wantSection
      ? classes.find((c) => String(c.subject_id) === wantSubject
        && String(c.section_id) === wantSection)
      : null;

    setSelectedKey((prev) => prev || (wanted || classes[0])?.key || "");
  }, [classes, searchParams]);

  const selected = useMemo(
    () => classes.find((c) => c.key === selectedKey) || null,
    [classes, selectedKey],
  );

  // -------------------------------------------------------------- the sheet
  /*
   * Loads one period's register.
   *
   * The period is an ARGUMENT rather than a dependency. It is set from the
   * response — the server tells us which slot it opened — so having the
   * callback depend on it would rebuild the callback, re-run the effect, and
   * loop. Switching period calls this directly with the id instead, which is
   * also the honest description of what that control does.
   */
  const loadSheet = useCallback(async (forSlotId) => {
    if (!selected) return;
    setSheetLoading(true);
    setSheetError(null);
    setDraft({});
    try {
      const res = await facultyApi.attendanceSheet({
        subject_id: selected.subject_id,
        section_id: selected.section_id,
        att_date: date,
        // Omitted on a day with one period; the server opens the only one.
        ...(forSlotId ? { timetable_id: forSlotId } : {}),
      });
      const data = res?.data || null;
      setSheet(data);
      /*
       * Adopt whichever period the server actually opened, so Save names the
       * same one the teacher is looking at. Without this the save would go
       * back with no period on an ambiguous day and be refused — correctly,
       * but for a choice the teacher had already made on screen.
       */
      setSlotId(data?.session?.timetable_id ?? null);
    } catch (err) {
      setSheetError(err.message || "Could not load the register.");
      setSheet(null);
    } finally {
      setSheetLoading(false);
    }
  }, [selected, date]);

  // Class or date changed: open whichever period the server picks for the new
  // day. A period id from Monday means nothing on Tuesday.
  useEffect(() => { loadSheet(); }, [loadSheet]);

  /** Switches which of the day's periods is being marked. */
  const openPeriod = useCallback((id) => {
    if (id === slotId) return;
    loadSheet(id);
  }, [loadSheet, slotId]);

  // -------------------------------------------------------------- the trend
  useEffect(() => {
    if (!selected) return undefined;

    const from = period === "Daily"
      ? date
      : period === "Weekly"
        ? shiftDays(date, -6)
        : `${date.slice(0, 7)}-01`;

    let cancelled = false;
    setTrendLoading(true);

    facultyApi
      .attendanceTrend({
        subject_id: selected.subject_id,
        section_id: selected.section_id,
        date_from: from,
        date_to: date,
        // Lets the server re-anchor the window on the last date this class
        // actually has records for, rather than returning an empty chart.
        period,
      })
      .then((res) => { if (!cancelled) setTrend(res?.data || { series: [], totals: {} }); })
      .catch(() => { if (!cancelled) setTrend({ series: [], totals: {} }); })
      .finally(() => { if (!cancelled) setTrendLoading(false); });

    return () => { cancelled = true; };
  }, [selected, date, period]);

  // ------------------------------------------------------------------- rows
  const rows = useMemo(() => {
    const records = sheet?.records || [];
    const q = query.trim().toLowerCase();

    return records
      .filter((r) => !q
        || r.full_name.toLowerCase().includes(q)
        || String(r.registration_number).toLowerCase().includes(q))
      .map((r) => ({
        ...r,
        status: draft[r.student_id] !== undefined ? draft[r.student_id] : r.status,
        dirty: draft[r.student_id] !== undefined && draft[r.student_id] !== r.status,
      }));
  }, [sheet, draft, query]);

  const summary = useMemo(() => {
    const counts = { Present: 0, Absent: 0, Late: 0, Leave: 0, Holiday: 0, unmarked: 0 };
    (sheet?.records || []).forEach((r) => {
      const status = draft[r.student_id] !== undefined ? draft[r.student_id] : r.status;
      if (status && counts[status] !== undefined) counts[status] += 1;
      else counts.unmarked += 1;
    });
    const total = (sheet?.records || []).length;
    const marked = total - counts.unmarked;
    return {
      ...counts,
      total,
      marked,
      pct: marked > 0 ? Math.round(((counts.Present + counts.Late) / marked) * 100) : 0,
    };
  }, [sheet, draft]);

  const dirtyCount = useMemo(
    () => (sheet?.records || []).filter(
      (r) => draft[r.student_id] !== undefined && draft[r.student_id] !== r.status,
    ).length,
    [sheet, draft],
  );

  const trendSeries = useMemo(
    () => (trend.series || []).map((d) => ({
      day: fmtDateShort(d.att_date),
      pct: d.percentage ?? 0,
      present: d.present,
      absent: d.absent,
      late: d.late,
    })),
    [trend],
  );

  const statusPie = useMemo(() => {
    const t = trend.totals || {};
    return [
      { name: "Present", value: t.present || 0, color: "#1f9d55" },
      { name: "Absent", value: t.absent || 0, color: "#d1373f" },
      { name: "Late", value: t.late || 0, color: "#b6791b" },
      { name: "Leave", value: t.leave || 0, color: "#2a63c9" },
      { name: "Holiday", value: t.holiday || 0, color: "#7c3aed" },
    ].filter((s) => s.value > 0);
  }, [trend]);

  // The window the chart is actually drawing. When the selected date is past
  // the last register this class has, the server re-anchors and says so —
  // silently drawing an empty chart was the earlier behaviour.
  const trendRange = useMemo(() => {
    if (trendLoading) return "Loading…";
    if (!trend.range) return "No attendance recorded for this class yet";

    const label = `${fmtDateShort(trend.range.from)} – ${fmtDateShort(trend.range.to)}`;
    if (!trend.series.length) return `No records between ${label}`;
    return trend.anchored
      ? `${label} — latest period with records`
      : label;
  }, [trend, trendLoading]);

  // ----------------------------------------------------------------- actions
  const setStatus = (studentId, status) => {
    setDraft((prev) => ({ ...prev, [studentId]: status }));
  };

  const markAll = (status) => {
    const next = {};
    (sheet?.records || []).forEach((r) => { next[r.student_id] = status; });
    setDraft(next);
  };

  const handleSubmit = async () => {
    if (!selected || !sheet) return;

    // Only students whose status is set are sent; an untouched row stays
    // unmarked rather than being written as Absent.
    const records = (sheet.records || [])
      .map((r) => ({
        student_id: r.student_id,
        status: draft[r.student_id] !== undefined ? draft[r.student_id] : r.status,
      }))
      .filter((r) => r.status);

    if (!records.length) {
      showToast("Nothing to submit — no statuses have been set.");
      return;
    }

    setSaving(true);
    try {
      const res = await facultyApi.saveAttendance({
        subject_id: selected.subject_id,
        section_id: selected.section_id,
        att_date: date,
        timetable_id: sheet.session ? sheet.session.timetable_id : undefined,
        records,
      });
      /*
       * Name the period in the confirmation. On a class that meets twice a
       * day "Attendance saved" does not say WHICH lecture was filed, and that
       * is exactly the thing a teacher needs to be sure of.
       */
      const at = res?.data?.session;
      showToast(
        at
          ? `${res?.message || "Attendance saved."} · ${at.day_of_week} `
            + `${clock(at.start_time)}–${clock(at.end_time)}`
          : (res?.message || "Attendance saved."),
      );
      // The local copy is only discarded once the server has the register.
      registerDraft.clear();
      // Reopen the SAME period, not whichever the server would pick.
      await loadSheet(sheet.session ? sheet.session.timetable_id : undefined);
    } catch (err) {
      showToast(err.message || "Could not save attendance.");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Exports the full roster with each student's cumulative attendance for this
   * subject, fetched from the API rather than derived from the day on screen.
   * The register alone only says what happened today; a report is expected to
   * carry the running position.
   */
  const handleExport = async (format) => {
    if (!selected) return;

    setExporting(format);

    const headers = [
      "Roll Number",
      "Student Name",
      `Status on ${date}`,
      "Present",
      "Absent",
      "Late",
      "Leave",
      "Total Sessions",
      "Attendance %",
      "Enrolment Status",
    ];

    try {
      const res = await facultyApi.classRoster(selected.subject_id, selected.section_id);
      const roster = res?.data?.students || [];

      const statusToday = new Map(
        rows.map((r) => [r.student_id, r.status || "Not marked"]),
      );

      // The roster is the source of names; the day's sheet only fills the
      // "status today" column, so a student filtered out by the search box
      // still appears in the report.
      const exportRows = roster.map((s) => [
        s.registration_number,
        s.full_name,
        statusToday.get(s.student_id) || "Not marked",
        s.attendance?.present ?? 0,
        s.attendance?.absent ?? 0,
        s.attendance?.late ?? 0,
        s.attendance?.leave ?? 0,
        s.attendance?.total_sessions ?? 0,
        s.attendance?.percentage != null ? `${s.attendance.percentage}%` : "—",
        s.academic_status || "—",
      ]);

      if (!exportRows.length) {
        showToast("There is nothing to export — this section has no students.");
        return;
      }

      const filename = `attendance_${selected.subject_code}_${selected.section_name}_${date}.`;
      const subtitle = `${selected.subject_code} — ${selected.subject_name} · Section `
        + `${selected.section_name} · Register for ${fmtDateShort(date)} · `
        + `${exportRows.length} students · Generated by AIMS`;

      if (format === "csv") exportCSV(`${filename}csv`, headers, exportRows);
      if (format === "xlsx") exportExcel(`${filename}xlsx`, "Attendance", headers, exportRows);
      if (format === "pdf") {
        exportPDF(`${filename}pdf`, {
          title: "Attendance Report",
          subtitle,
          headers,
          rows: exportRows,
        });
      }

      showToast(`Attendance exported as ${format.toUpperCase()}`);
    } catch (err) {
      showToast(err.message || "Could not build the export.");
    } finally {
      setExporting("");
    }
  };

  /*
   * One cell of the analytics board.
   *
   * The four figures and the two charts come from ATTENDANCE_PANELS and are
   * handed the trend response this screen already loaded — see that file's
   * header for why they do not fetch their own. A card the teacher pinned from
   * Ask the Data is a saved query and draws itself.
   */
  const renderAnalyticsCard = (card, ctx) => {
    if (card.kind === "builtin") {
      const Panel = ATTENDANCE_PANELS[card.builtinKey];

      /*
       * A key the server knows and this build does not. Reported rather than
       * drawn as a blank cell: the honest reading is a version mismatch, and a
       * silent empty box invites the teacher to think the panel lost its data.
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
       * These panels draw their own card chrome — the same `.stat-card` and
       * `.chart-card` the faculty portal has always used — so they go into the
       * cell as they are rather than inside the pinned card shell.
       * `pin-native` only makes them fill the height the grid gave them.
       */
      return (
        <div className="pin-native">
          <Panel
            trend={trend}
            trendSeries={trendSeries}
            trendRange={trendRange}
            statusPie={statusPie}
            period={period}
            loading={trendLoading}
            editing={ctx.editing}
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

  // ------------------------------------------------------------------ render
  if (classesLoading || classesError) {
    return (
      <Layout title="Attendance">
        <DataGate
          loading={classesLoading}
          error={classesError}
          onRetry={() => window.location.reload()}
          label="Loading your classes…"
        />
      </Layout>
    );
  }

  if (!classes.length) {
    return (
      <Layout title="Attendance">
        <div className="assign-heading">
          <h2>Attendance</h2>
          <p>You have no classes on the timetable, so there is no register to mark.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Attendance">
      <div className="attendance-top-row">
        <div className="assign-heading">
          <h2>Attendance</h2>
          <p>
            {selected
              ? `${selected.subject_code} — ${selected.subject_name} · Section ${selected.section_name}`
              : "Select a class"}
          </p>
        </div>
        {can("export_reports") && (
          <div className="attendance-export-group">
            {["Excel", "PDF", "CSV"].map((f) => (
              <button
                key={f}
                className="btn btn-outline"
                disabled={exporting === f.toLowerCase() || !sheet}
                onClick={() => handleExport(f.toLowerCase())}
              >
                <Download size={14} />{" "}
                {exporting === f.toLowerCase() ? "Exporting…" : `Export ${f}`}
              </button>
            ))}
          </div>
        )}
      </div>

      <FilterBar
        resetActive={!!query}
        onReset={() => setQuery("")}
      >
        <FilterSelect
          label="Class"
          value={selectedKey}
          onChange={(e) => setSelectedKey(e.target.value)}
          options={classes.map((c) => ({
            value: c.key,
            label: `${c.subject_code} · ${c.subject_name} · Sec ${c.section_name}`,
          }))}
        />
        <FilterDate label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
        <FilterInput
          label="Search"
          placeholder="Student name or roll"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </FilterBar>

      {sheet && (
        <div
          className="attendance-session"
          style={{
            background: sheet.is_class_day ? "#f8fafc" : "#fdf2df",
          }}
        >
          {sheet.is_class_day ? (
            <>
              <div className="attendance-session-line">
                <strong>{sheet.day_of_week}</strong>
                {" · "}
                {clock(sheet.session.start_time)} – {clock(sheet.session.end_time)}
                {sheet.session.room_name ? ` · ${sheet.session.room_name}` : ""}
                {sheet.session.building ? `, ${sheet.session.building}` : ""}
                {" · "}
                {sheet.summary.marked} of {sheet.summary.total} marked
              </div>

              {/*
                * THE PERIOD PICKER.
                *
                * Shown only when this class genuinely meets more than once on
                * the chosen day. CS-101 CS-A meets at 08:30 AND 10:00 on
                * Mondays, and until now the second lecture had no register at
                * all: the server resolved the slot as "the first one on this
                * weekday", so the 10:00 period could not be opened, could not
                * be marked, and never entered the 75% denominator. A student
                * could miss every 10:00 Monday lecture of a term and still
                * read 100%.
                *
                * Each period keeps its own marks, its own saved rows and its
                * own unsaved draft, which is what the table's unique key
                * (student, timetable, date) has always said.
                */}
              {sheet.multiple_sessions && (
                <div
                  className="attendance-periods"
                  role="group"
                  aria-label={`Periods on ${sheet.day_of_week}`}
                >
                  <span className="attendance-periods-label">
                    {sheet.sessions.length} periods this {sheet.day_of_week}:
                  </span>
                  {sheet.sessions.map((slot, i) => {
                    const on = slot.timetable_id === sheet.session.timetable_id;
                    return (
                      <button
                        key={slot.timetable_id}
                        type="button"
                        className={`attendance-period-chip${on ? " on" : ""}`}
                        aria-pressed={on}
                        onClick={() => openPeriod(slot.timetable_id)}
                        disabled={sheetLoading}
                      >
                        <span className="attendance-period-no">P{i + 1}</span>
                        {clock(slot.start_time)}–{clock(slot.end_time)}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <strong>{sheet.subject_code}</strong> does not meet on {sheet.day_of_week}.
              Pick a date this class is timetabled for to mark the register.
            </>
          )}
        </div>
      )}

      <div className="attendance-summary">
        {[
          { label: "Present", value: summary.Present, color: "var(--success-text)" },
          { label: "Absent", value: summary.Absent, color: "var(--danger-text)" },
          { label: "Late", value: summary.Late, color: "var(--warning-text)" },
          { label: "Leave", value: summary.Leave, color: "#7c3aed" },
          { label: "Not marked", value: summary.unmarked, color: "#94a3b8" },
        ].map((s) => (
          <div className="attendance-summary-item" key={s.label}>
            <div className="attendance-summary-value" style={{ color: s.color }}>{s.value}</div>
            <div className="attendance-summary-label">{s.label}</div>
          </div>
        ))}
        <div className="attendance-summary-item highlight">
          <div className="attendance-summary-value">{summary.pct}%</div>
          <div className="attendance-summary-label">Attendance Rate</div>
        </div>
      </div>

      {can("manage_attendance") && sheet?.is_class_day && (
        <div style={{ display: "flex", gap: "8px", marginBottom: "0.85rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.82rem", color: "#64748B", alignSelf: "center" }}>
            Mark everyone:
          </span>
          {["Present", "Absent", "Holiday"].map((s) => (
            <button key={s} className="btn btn-outline" onClick={() => markAll(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <DataGate
        loading={sheetLoading}
        error={sheetError}
        onRetry={loadSheet}
        label="Loading register…"
      >
        <DataTable
          columns={[
            {
              key: "name",
              label: "Student",
              render: (r) => (
                <div className="attendance-student-cell">
                  <Avatar name={r.full_name} size={34} userId={r.user_id} />
                  <span style={{ fontWeight: 700 }}>{r.full_name}</span>
                </div>
              ),
            },
            { key: "roll", label: "Roll Number", render: (r) => r.registration_number },
            {
              key: "academic_status",
              label: "Enrolment",
              render: (r) => r.academic_status || "—",
            },
            {
              key: "saved",
              label: "Saved",
              align: "center",
              render: (r) => (r.attendance_id
                ? <span className="badge badge-success">Saved</span>
                : <span style={{ color: "#94A3B8" }}>—</span>),
            },
            {
              key: "status",
              label: "Attendance Status",
              render: (r) => (
                <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                  {STATUSES.map((opt) => (
                    <label
                      key={opt}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        fontSize: "13px",
                        fontWeight: r.status === opt ? 700 : 500,
                        color: r.status === opt ? STATUS_COLOR[opt] : "#64748B",
                        cursor: can("manage_attendance") ? "pointer" : "default",
                        userSelect: "none",
                      }}
                    >
                      <input
                        type="radio"
                        name={`att_status_${r.student_id}`}
                        value={opt}
                        checked={r.status === opt}
                        onChange={() => can("manage_attendance") && setStatus(r.student_id, opt)}
                        disabled={!can("manage_attendance") || !sheet?.is_class_day}
                        style={{
                          cursor: "pointer",
                          width: "15px",
                          height: "15px",
                          accentColor: STATUS_COLOR[opt],
                        }}
                      />
                      {opt}
                    </label>
                  ))}
                  {r.dirty && (
                    <span style={{ fontSize: "11px", color: "#b6791b", fontWeight: 700 }}>
                      unsaved
                    </span>
                  )}
                </div>
              ),
            },
          ]}
          rows={rows}
          rowKey={(r) => r.student_id}
          searchable={false}
          emptyMessage="No students are assigned to this section."
        />
      </DataGate>

      {can("manage_attendance") && (
        <div className="attendance-actions">
          <DraftNotice draft={registerDraft} online={online} onDiscard={() => setDraft({})} compact />
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={saving || !sheet?.is_class_day || summary.marked === 0}
          >
            <Send size={16} />{" "}
            {saving
              ? "Saving…"
              : dirtyCount
                ? `Submit Attendance (${dirtyCount} changed)`
                : "Submit Attendance"}
          </button>
        </div>
      )}

      {/* ------------------------------------------------- analytics board --

          Everything above this point is a task in a fixed order — choose a
          class, mark the register, submit. Everything below it is six read-only
          summaries of one trend response, and which of them a teacher wants
          first is genuinely personal. So the task stays put and the summaries
          become a board.                                                     */}
      <div className="attendance-analytics">
        <div className="attendance-analytics-head">
          <div className="attendance-analytics-title">
            <h3>Attendance Analytics</h3>
            <p>
              {selected
                ? `${selected.subject_code} · Section ${selected.section_name}`
                : "Select a class"}
            </p>
          </div>

          <div className="attendance-analytics-tools">
            <div className="period-tabs" role="tablist" aria-label="Trend period">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={period === p}
                  className={`period-tab${period === p ? " active" : ""}`}
                  onClick={() => setPeriod(p)}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Customise rides beside the period tabs rather than taking a band
                of its own — the same move the dashboard makes in its hero. */}
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

        {pinned.loadError && (
          <div role="alert" className="attendance-arrange-error">
            <span>This section could not be arranged: {pinned.loadError}</span>
            <button type="button" className="pin-btn" onClick={pinned.reload}>
              Try again
            </button>
          </div>
        )}

        {/*
          * The board is waited for before it is drawn, for the reason the
          * dashboard waits: painting the panels in their default order and then
          * rearranging them when the layout arrives makes every card jump once
          * on every visit to this screen.
          */}
        {pinned.loading ? (
          <div className="attendance-analytics-loading" aria-hidden="true">
            <span className="att-skeleton att-skeleton-tile" />
            <span className="att-skeleton att-skeleton-tile" />
            <span className="att-skeleton att-skeleton-tile" />
            <span className="att-skeleton att-skeleton-tile" />
            <span className="att-skeleton att-skeleton-chart" />
            <span className="att-skeleton att-skeleton-chart att-skeleton-chart-sm" />
          </div>
        ) : pinned.cards.length === 0 ? (
          <div className="pin-empty">
            <strong>Nothing on this board</strong>
            <span>
              Every panel has been hidden. Press Customise to add them back, or
              to drop in a question you saved from Ask the Data.
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
            renderCard={renderAnalyticsCard}
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

    </Layout>
  );
}
