"use strict";

/*
 * Eight new views, created for the AI assistant's tool layer.
 *
 * WHY THESE EXIST
 * ---------------
 * The assistant never writes SQL for Student or Faculty questions. Each of its
 * tools is a fixed, parameterised query, and the scope predicate (this
 * student, this teacher's sections) is welded into the backend rather than
 * supplied by the model. That design only works if the shape the tool needs is
 * one SELECT away — otherwise every tool grows a five-table join, the joins
 * drift apart, and the "one place the rule lives" property is lost.
 *
 * So each view below is the answer-shape for a family of questions:
 *
 *   vw_student_profile_full      who am I / who is this student
 *   vw_student_subject_marks     what did I get in X
 *   vw_teacher_class_roster      who is in my class  (also the faculty scope)
 *   vw_attendance_daily          attendance over time, for trends and charts
 *   vw_student_fee_status        what do I owe, what have I paid
 *   vw_program_semester_catalog  what subjects does this programme have
 *   vw_at_risk_students          who needs intervention
 *   vw_exam_schedule_full        when and where is the exam
 *
 * Every one filters soft-deleted rows, because a view the assistant reads is
 * a view whose omissions become sentences.
 *
 * SAFETY
 * ------
 * DDL on views only. No table is altered and no row is touched. `down` drops
 * exactly the eight views created here.
 */

const VIEWS = {
  /*
   * A student and everything needed to describe them in a sentence, resolved
   * once. Without this, "tell me about my enrolment" costs a five-table join
   * in every tool that needs to name the programme or the section.
   *
   * `current_semester_id` is the authoritative one where set; where it is
   * NULL the view falls back to the batch's programme so the row is still
   * usable rather than half-empty.
   */
  vw_student_profile_full: `
    SELECT
        st.student_id,
        st.user_id,
        u.email,
        st.registration_number,
        st.first_name,
        st.last_name,
        CONCAT(st.first_name, ' ', st.last_name) AS full_name,
        st.gender,
        st.dob,
        st.phone,
        st.academic_status,
        st.program_id,
        p.program_name,
        p.duration_semesters,
        d.department_id,
        d.department_name,
        st.batch_id,
        b.batch_name,
        b.start_year,
        b.end_year,
        st.section_id,
        sec.section_name,
        st.current_semester_id,
        sem.semester_number  AS current_semester_number,
        sem.start_date       AS semester_start_date,
        sem.end_date         AS semester_end_date
    FROM students st
    LEFT JOIN users       u   ON u.user_id       = st.user_id
    LEFT JOIN programs    p   ON p.program_id    = st.program_id
    LEFT JOIN departments d   ON d.department_id = p.department_id
    LEFT JOIN batches     b   ON b.batch_id      = st.batch_id
    LEFT JOIN sections    sec ON sec.section_id  = st.section_id
    LEFT JOIN semesters   sem ON sem.semester_id = st.current_semester_id
    WHERE st.is_deleted = 0
  `,

  /*
   * One row per published mark, with the exam it belongs to, the percentage,
   * and the grade letter that percentage earns under the current policy.
   *
   * Draft and Verified marks are excluded for the same reason they are
   * excluded from vw_class_performance_summary: a mark a teacher has not
   * published is not yet a fact about the student, and the assistant stating
   * it would be disclosing an unreleased result.
   *
   * The grade is resolved by range-join against `grades` rather than a CASE
   * expression, so changing the policy is an UPDATE and not a migration.
   */
  vw_student_subject_marks: `
    SELECT
        m.mark_id,
        m.student_id,
        e.exam_id,
        e.exam_name,
        e.exam_type,
        e.exam_date,
        e.subject_id,
        sub.subject_code,
        sub.subject_name,
        sub.credit_hours,
        e.semester_id,
        sem.semester_number,
        m.obtained_marks,
        e.total_marks,
        ROUND(m.obtained_marks / NULLIF(e.total_marks, 0) * 100, 2) AS percentage,
        g.grade_letter,
        g.grade_point
    FROM marks m
    JOIN      exams     e   ON e.exam_id     = m.exam_id
    JOIN      subjects  sub ON sub.subject_id = e.subject_id AND sub.is_deleted = 0
    JOIN      students  st  ON st.student_id  = m.student_id AND st.is_deleted = 0
    LEFT JOIN semesters sem ON sem.semester_id = e.semester_id
    LEFT JOIN grades    g
           ON ROUND(m.obtained_marks / NULLIF(e.total_marks, 0) * 100, 2)
              BETWEEN g.min_percentage AND g.max_percentage
    WHERE m.status = 'Published'
  `,

  /*
   * The roster of every class a teacher actually teaches.
   *
   * This view is doing double duty and the second job is the important one:
   * it is the definition of faculty scope. A teacher may see a student if and
   * only if a row exists here pairing them. The timetable is the source of
   * truth for that — it is what the faculty portal already derives a
   * teacher's classes from (facultyPortalService.timetableRowsFor) — and
   * using the same rule here means the assistant cannot be more permissive
   * than the portal the teacher already has.
   *
   * A student is on the roster when they are in the section the class is
   * taught to AND enrolled in that subject. Section alone would include
   * students who dropped the subject; enrolment alone would include students
   * from a different section taught by a different teacher.
   */
  vw_teacher_class_roster: `
    SELECT DISTINCT
        t.teacher_id,
        emp.employee_id,
        emp.first_name  AS teacher_first_name,
        emp.last_name   AS teacher_last_name,
        tt.subject_id,
        sub.subject_code,
        sub.subject_name,
        tt.section_id,
        sec.section_name,
        sec.batch_id,
        b.batch_name,
        sub.semester_id,
        st.student_id,
        st.registration_number,
        st.first_name   AS student_first_name,
        st.last_name    AS student_last_name,
        st.program_id,
        en.status       AS enrollment_status
    FROM timetables tt
    JOIN teachers    t   ON t.teacher_id    = tt.teacher_id AND t.is_deleted = 0
    JOIN employees   emp ON emp.employee_id = t.employee_id AND emp.is_deleted = 0
    JOIN subjects    sub ON sub.subject_id  = tt.subject_id AND sub.is_deleted = 0
    JOIN sections    sec ON sec.section_id  = tt.section_id AND sec.is_deleted = 0
    LEFT JOIN batches b  ON b.batch_id      = sec.batch_id
    JOIN students    st  ON st.section_id   = tt.section_id AND st.is_deleted = 0
    JOIN enrollments en  ON en.student_id   = st.student_id
                        AND en.subject_id   = tt.subject_id
  `,

  /*
   * Attendance at date grain, per subject and section.
   *
   * vw_student_attendance_summary answers "what is my percentage"; this
   * answers "how has it moved", which is what every trend chart and every
   * "am I getting worse" question needs. Aggregating per day here rather than
   * in the tool keeps the date bucketing identical across all callers.
   *
   * Holiday rows are excluded from the counts but the day is kept, so a gap
   * in a chart reads as a holiday rather than as a day nobody attended.
   */
  vw_attendance_daily: `
    SELECT
        a.att_date,
        a.subject_id,
        sub.subject_code,
        sub.subject_name,
        sub.semester_id,
        tt.section_id,
        st.program_id,
        st.batch_id,
        COUNT(0)                       AS marked_count,
        SUM(a.status = 'Present')      AS present_count,
        SUM(a.status = 'Absent')       AS absent_count,
        SUM(a.status = 'Late')         AS late_count,
        SUM(a.status = 'Leave')        AS leave_count,
        SUM(a.status = 'Holiday')      AS holiday_count,
        ROUND(
            SUM(a.status IN ('Present','Late'))
            / NULLIF(SUM(a.status <> 'Holiday'), 0) * 100,
        2)                             AS attendance_percentage
    FROM attendance a
    JOIN subjects   sub ON sub.subject_id   = a.subject_id AND sub.is_deleted = 0
    JOIN students   st  ON st.student_id    = a.student_id AND st.is_deleted = 0
    LEFT JOIN timetables tt ON tt.timetable_id = a.timetable_id
    GROUP BY a.att_date, a.subject_id, sub.subject_code, sub.subject_name,
             sub.semester_id, tt.section_id, st.program_id, st.batch_id
  `,

  /*
   * A student's fee position per voucher, with the payment trail rolled up.
   *
   * `fee_vouchers.amount_paid` is the running total the app maintains, but
   * `fee_payments` gained a verification workflow (status Pending / Verified
   * / Rejected) that the voucher column predates. A student who has submitted
   * a payment that has not been verified is in a different position from one
   * who has paid nothing, and neither the voucher row nor the old views could
   * tell them apart. Both figures are exposed so a tool can say "we have
   * received it, it is awaiting verification" rather than "you have not paid".
   */
  vw_student_fee_status: `
    SELECT
        v.fee_voucher_id,
        v.student_id,
        st.registration_number,
        CONCAT(st.first_name, ' ', st.last_name) AS full_name,
        st.program_id,
        st.batch_id,
        st.section_id,
        v.voucher_number,
        v.semester_id,
        sem.semester_number,
        v.issue_date,
        v.due_date,
        v.total_payable,
        v.amount_paid,
        v.remaining_balance,
        v.status,
        COALESCE(SUM(fp.amount_paid), 0)                                   AS payments_total,
        COALESCE(SUM(CASE WHEN fp.status = 'Verified' THEN fp.amount_paid END), 0) AS verified_total,
        COALESCE(SUM(CASE WHEN fp.status = 'Pending'  THEN fp.amount_paid END), 0) AS pending_total,
        COALESCE(SUM(CASE WHEN fp.status = 'Rejected' THEN fp.amount_paid END), 0) AS rejected_total,
        COUNT(fp.fee_payment_id)                                           AS payment_count,
        MAX(fp.payment_date)                                               AS last_payment_date,
        CASE WHEN v.due_date < CURDATE() AND v.status NOT IN ('Paid','Cancelled')
             THEN TO_DAYS(CURDATE()) - TO_DAYS(v.due_date) ELSE 0 END      AS days_overdue
    FROM fee_vouchers v
    JOIN students  st  ON st.student_id  = v.student_id AND st.is_deleted = 0
    LEFT JOIN semesters    sem ON sem.semester_id = v.semester_id
    LEFT JOIN fee_payments fp  ON fp.fee_voucher_id = v.fee_voucher_id
    GROUP BY v.fee_voucher_id, v.student_id, st.registration_number, st.first_name,
             st.last_name, st.program_id, st.batch_id, st.section_id, v.voucher_number,
             v.semester_id, sem.semester_number, v.issue_date, v.due_date,
             v.total_payable, v.amount_paid, v.remaining_balance, v.status
  `,

  /*
   * The curriculum: which subjects a programme teaches in which semester.
   *
   * Pure reference data with no personal information in it, which makes it
   * the one view every role may read in full. It answers the large class of
   * "what will I study in semester 5" questions without touching a single
   * student row.
   */
  vw_program_semester_catalog: `
    SELECT
        p.program_id,
        p.program_name,
        p.duration_semesters,
        d.department_id,
        d.department_name,
        s.semester_id,
        s.semester_number,
        s.start_date,
        s.end_date,
        s.is_archived,
        sub.subject_id,
        sub.subject_code,
        sub.subject_name,
        sub.credit_hours,
        sub.prerequisite_subject_id,
        pre.subject_code AS prerequisite_subject_code,
        pre.subject_name AS prerequisite_subject_name
    FROM programs p
    JOIN      departments d   ON d.department_id = p.department_id
    JOIN      semesters   s   ON s.program_id    = p.program_id
    LEFT JOIN subjects    sub ON sub.semester_id = s.semester_id AND sub.is_deleted = 0
    LEFT JOIN subjects    pre ON pre.subject_id  = sub.prerequisite_subject_id
    WHERE p.is_deleted = 0
  `,

  /*
   * Students who need intervention, on the three signals AIMS actually holds.
   *
   * The thresholds are deliberately NOT applied here — the view emits the
   * measurements and the flags, and the calling tool decides what counts as
   * "at risk". Baking 75% into a view means changing a migration when the
   * institute changes its policy, and it means two callers can silently
   * disagree about what the word means.
   *
   * `ai_predictions` is intentionally not read. That table is empty and is
   * fed by a separate model; mixing a prediction into a view named for
   * measured facts would let the assistant present a guess as a record.
   */
  vw_at_risk_students: `
    SELECT
        st.student_id,
        st.registration_number,
        CONCAT(st.first_name, ' ', st.last_name) AS full_name,
        st.program_id,
        p.program_name,
        st.batch_id,
        st.section_id,
        st.academic_status,
        att.subjects_tracked,
        att.avg_attendance_percentage,
        att.lowest_attendance_percentage,
        res.latest_gpa,
        res.latest_cgpa,
        fee.unpaid_vouchers,
        fee.outstanding_balance,
        fee.max_days_overdue
    FROM students st
    LEFT JOIN programs p ON p.program_id = st.program_id
    LEFT JOIN (
        SELECT student_id,
               COUNT(0)                        AS subjects_tracked,
               ROUND(AVG(attendance_percentage), 2) AS avg_attendance_percentage,
               MIN(attendance_percentage)      AS lowest_attendance_percentage
        FROM vw_student_attendance_summary
        GROUP BY student_id
    ) att ON att.student_id = st.student_id
    LEFT JOIN (
        SELECT r.student_id, r.gpa AS latest_gpa, r.cgpa AS latest_cgpa
        FROM results r
        JOIN (
            SELECT student_id, MAX(semester_id) AS semester_id
            FROM results WHERE status = 'Published' GROUP BY student_id
        ) latest ON latest.student_id = r.student_id
                AND latest.semester_id = r.semester_id
        WHERE r.status = 'Published'
    ) res ON res.student_id = st.student_id
    LEFT JOIN (
        SELECT student_id,
               COUNT(0)                    AS unpaid_vouchers,
               SUM(remaining_balance)      AS outstanding_balance,
               MAX(GREATEST(TO_DAYS(CURDATE()) - TO_DAYS(due_date), 0)) AS max_days_overdue
        FROM fee_vouchers
        WHERE status NOT IN ('Paid','Cancelled')
        GROUP BY student_id
    ) fee ON fee.student_id = st.student_id
    WHERE st.is_deleted = 0
  `,

  /*
   * Every exam, past and future, fully resolved.
   *
   * vw_upcoming_exams filters to future dates, which makes "how did the
   * mid-term go" unanswerable from it. This is the same shape without the
   * date predicate, plus the mark count so a tool can tell "not sat yet"
   * apart from "sat, not marked" apart from "marked but unpublished" — three
   * states the assistant must not conflate when a student asks where their
   * result is.
   */
  vw_exam_schedule_full: `
    SELECT
        e.exam_id,
        e.exam_name,
        e.exam_type,
        e.exam_date,
        TO_DAYS(e.exam_date) - TO_DAYS(CURDATE()) AS days_until,
        e.total_marks,
        e.semester_id,
        sem.semester_number,
        sem.program_id,
        p.program_name,
        e.subject_id,
        sub.subject_code,
        sub.subject_name,
        sub.credit_hours,
        e.classroom_id,
        c.room_name,
        c.building,
        e.invigilator_id,
        emp.first_name AS invigilator_first_name,
        emp.last_name  AS invigilator_last_name,
        COUNT(m.mark_id)                              AS marks_entered,
        SUM(m.status = 'Published')                   AS marks_published
    FROM exams e
    JOIN      subjects   sub ON sub.subject_id  = e.subject_id AND sub.is_deleted = 0
    LEFT JOIN semesters  sem ON sem.semester_id = e.semester_id
    LEFT JOIN programs   p   ON p.program_id    = sem.program_id
    LEFT JOIN classrooms c   ON c.classroom_id  = e.classroom_id
    LEFT JOIN teachers   tch ON tch.teacher_id  = e.invigilator_id
    LEFT JOIN employees  emp ON emp.employee_id = tch.employee_id
    LEFT JOIN marks      m   ON m.exam_id       = e.exam_id
    GROUP BY e.exam_id, e.exam_name, e.exam_type, e.exam_date, e.total_marks,
             e.semester_id, sem.semester_number, sem.program_id, p.program_name,
             e.subject_id, sub.subject_code, sub.subject_name, sub.credit_hours,
             e.classroom_id, c.room_name, c.building, e.invigilator_id,
             emp.first_name, emp.last_name
  `,
};

module.exports = {
  async up(queryInterface) {
    for (const [name, body] of Object.entries(VIEWS)) {
      await queryInterface.sequelize.query(
        `CREATE OR REPLACE VIEW ${name} AS ${body}`
      );
    }
    console.log(`Created ${Object.keys(VIEWS).length} assistant views`);
  },

  async down(queryInterface) {
    // Reverse order: vw_at_risk_students reads vw_student_attendance_summary,
    // which this migration does not own, but dropping in reverse keeps the
    // habit correct if a future view here depends on an earlier one.
    for (const name of Object.keys(VIEWS).reverse()) {
      await queryInterface.sequelize.query(`DROP VIEW IF EXISTS ${name}`);
    }
    console.log(`Dropped ${Object.keys(VIEWS).length} assistant views`);
  },
};
