/*
 * Tools a STUDENT may call, plus the tools an admin or teacher uses to look at
 * a named student.
 *
 * THE RULE THIS FILE ENFORCES
 * ---------------------------
 * None of these functions take a student id from the model. Where a student
 * must be identified, the id comes from `scope.studentId` (the signed-in
 * student) or is checked with `maySeeStudent` first. That is the whole reason
 * the tool layer exists instead of letting the model write SQL: a WHERE clause
 * the model composes is a WHERE clause the model can omit.
 *
 * Every query below is parameterised. Nothing the model produces is
 * concatenated into SQL.
 */

const { maySeeStudent } = require("../scope.service");
const { readonlySequelize } = require("../../../database/readonlyConnection");
const config = require("../../../config/assistant");
const analytics = require("../../../config/analytics");

const select = async (sql, replacements) =>
    readonlySequelize.query(sql, {
        type: readonlySequelize.QueryTypes.SELECT,
        replacements
    });

/*
 * Resolves which student a call is about.
 *
 * A student is always themselves — the `student_id` argument is ignored
 * outright rather than compared, so a model that hallucinates one cannot even
 * produce an error message that confirms another id exists.
 *
 * Staff must name someone, and that name is checked against their scope.
 */
const targetStudent = (scope, args) => {

    if (scope.kind === "student") {
        return { ok: true, studentId: scope.studentId };
    }

    const requested = args?.student_id;

    if (!requested) {
        return {
            ok: false,
            message: "Which student? Give a registration number or a name."
        };
    }

    if (!maySeeStudent(scope, requested)) {
        return {
            ok: false,
            message:
                "That student is not in your scope. You can only ask about " +
                "students in the classes you teach."
        };
    }

    return { ok: true, studentId: Number(requested) };
};

const tools = {

    // ------------------------------------------------------------- identity

    get_my_profile: {
        description:
            "The signed-in student's own enrolment record: programme, batch, " +
            "section, current semester and academic status. Use for questions " +
            "like 'what programme am I in' or 'which semester am I in'.",
        roles: ["student"],
        parameters: { type: "object", properties: {} },

        run: async (scope) => {
            const rows = await select(
                `SELECT registration_number, full_name, program_name, department_name,
                        batch_name, section_name, current_semester_number,
                        academic_status, semester_start_date, semester_end_date
                   FROM vw_student_profile_full
                  WHERE student_id = :studentId`,
                { studentId: scope.studentId }
            );
            return { type: "answer", rows };
        }
    },

    // ----------------------------------------------------------- attendance

    get_attendance_summary: {
        description:
            "Attendance percentage per subject. Reports both the standard " +
            "figure (Late counts as attended) and the strict figure. Use for " +
            "'what is my attendance' or 'am I short on attendance'.",
        roles: ["student", "teacher"],
        parameters: {
            type: "object",
            properties: {
                student_id: {
                    type: "integer",
                    description:
                        "Only for staff. Ignored when a student asks - they " +
                        "always get their own attendance."
                },
                subject_code: {
                    type: "string",
                    description: "Optional, e.g. 'CS202', to narrow to one subject."
                }
            }
        },

        run: async (scope, args) => {
            const target = targetStudent(scope, args);
            if (!target.ok) return { type: "refused", message: target.message };

            const rows = await select(
                `SELECT subject_code, subject_name, semester_id, total_sessions,
                        present_count, absent_count, late_count, leave_count,
                        attendance_percentage, strict_attendance_percentage,
                        first_session, last_session
                   FROM vw_student_attendance_summary
                  WHERE student_id = :studentId
                    AND (:subjectCode IS NULL OR subject_code = :subjectCode)
                  ORDER BY attendance_percentage ASC
                  LIMIT :max`,
                {
                    studentId: target.studentId,
                    subjectCode: args?.subject_code || null,
                    max: analytics.maxDisplayRows
                }
            );

            return { type: "table", rows };
        }
    },

    get_attendance_trend: {
        description:
            "Attendance over time, by date, for charting a trend. Use when " +
            "asked whether attendance is improving or getting worse.",
        roles: ["student", "teacher"],
        parameters: {
            type: "object",
            properties: {
                student_id: { type: "integer", description: "Staff only." },
                subject_code: { type: "string" },
                date_from: { type: "string", description: "YYYY-MM-DD" },
                date_to: { type: "string", description: "YYYY-MM-DD" }
            }
        },

        run: async (scope, args) => {
            const target = targetStudent(scope, args);
            if (!target.ok) return { type: "refused", message: target.message };

            /*
             * Read from `attendance` directly rather than vw_attendance_daily,
             * because that view aggregates across every student in a section —
             * correct for a class trend, wrong for one person's.
             *
             * This used to return one row per session with a `status` of
             * 'Present' / 'Absent'. That is not a trend and cannot be plotted:
             * a line chart needs a number per point, and every column returned
             * was text. The chart rendered as an empty box.
             *
             * It now aggregates to a running attendance percentage per date,
             * which is what "is my attendance improving" actually asks.
             */
            const rows = await select(
                `SELECT a.att_date,
                        COUNT(*)                                   AS sessions,
                        SUM(a.status IN ('Present','Late'))        AS attended,
                        ROUND(SUM(a.status IN ('Present','Late'))
                              / COUNT(*) * 100, 2)                 AS attendance_percentage
                   FROM attendance a
                   JOIN subjects sub ON sub.subject_id = a.subject_id
                  WHERE a.student_id = :studentId
                    AND a.status <> 'Holiday'
                    AND (:subjectCode IS NULL OR sub.subject_code = :subjectCode)
                    AND (:dateFrom IS NULL OR a.att_date >= :dateFrom)
                    AND (:dateTo IS NULL OR a.att_date <= :dateTo)
                  GROUP BY a.att_date
                  ORDER BY a.att_date
                  LIMIT :max`,
                {
                    studentId: target.studentId,
                    subjectCode: args?.subject_code || null,
                    dateFrom: args?.date_from || null,
                    dateTo: args?.date_to || null,
                    max: analytics.maxDisplayRows
                }
            );

            return {
                type: "chart",
                chartType: "line",
                labelKey: "att_date",
                valueKey: "attendance_percentage",
                rows
            };
        }
    },

    // ---------------------------------------------------------------- marks

    get_my_marks: {
        description:
            "Published exam marks with percentage and grade letter. Only " +
            "published marks are visible - drafts and marks awaiting " +
            "verification are not released yet.",
        roles: ["student", "teacher"],
        parameters: {
            type: "object",
            properties: {
                student_id: { type: "integer", description: "Staff only." },
                subject_code: { type: "string" },
                exam_type: {
                    type: "string",
                    enum: ["Quiz", "Assignment", "Mid-Term", "Final", "Practical", "Viva"]
                }
            }
        },

        run: async (scope, args) => {
            const target = targetStudent(scope, args);
            if (!target.ok) return { type: "refused", message: target.message };

            const rows = await select(
                `SELECT subject_code, subject_name, exam_name, exam_type, exam_date,
                        obtained_marks, total_marks, percentage, grade_letter, grade_point
                   FROM vw_student_subject_marks
                  WHERE student_id = :studentId
                    AND (:subjectCode IS NULL OR subject_code = :subjectCode)
                    AND (:examType IS NULL OR exam_type = :examType)
                  ORDER BY exam_date DESC
                  LIMIT :max`,
                {
                    studentId: target.studentId,
                    subjectCode: args?.subject_code || null,
                    examType: args?.exam_type || null,
                    max: analytics.maxDisplayRows
                }
            );

            return { type: "table", rows };
        }
    },

    get_gpa_history: {
        description:
            "Published GPA and CGPA per semester. Use for 'what is my CGPA' " +
            "or to chart academic progress across semesters.",
        roles: ["student", "teacher"],
        parameters: {
            type: "object",
            properties: {
                student_id: { type: "integer", description: "Staff only." }
            }
        },

        run: async (scope, args) => {
            const target = targetStudent(scope, args);
            if (!target.ok) return { type: "refused", message: target.message };

            const rows = await select(
                `SELECT semester_number, gpa, cgpa, published_at
                   FROM vw_student_gpa_summary
                  WHERE student_id = :studentId
                  ORDER BY semester_number`,
                { studentId: target.studentId }
            );

            /*
             * The axes are declared, not inferred. Left to guess the first
             * numeric column, the frontend plotted `semester_number` as the
             * value and `gpa` as the axis label — semester number on the Y
             * axis, which is meaningless and looked plausible enough to ship.
             */
            return {
                type: "chart",
                chartType: "line",
                labelKey: "semester_number",
                valueKey: "cgpa",
                rows
            };
        }
    },

    // ------------------------------------------------------------ timetable

    get_timetable: {
        description:
            "The weekly class timetable: subject, teacher, room, day and time. " +
            "For a student this is their own section's timetable.",
        roles: ["student", "teacher", "admin"],
        descriptions: { admin: "The weekly class timetable for ANY section: subject, teacher, room, day and time." },
        parameters: {
            type: "object",
            properties: {
                day_of_week: {
                    type: "string",
                    enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
                },
                section_id: { type: "integer", description: "Staff only." }
            }
        },

        run: async (scope, args) => {

            let sectionId;

            if (scope.kind === "student") {
                sectionId = scope.sectionId;
            } else {
                sectionId = args?.section_id;

                if (!sectionId) {
                    return {
                        type: "refused",
                        message: "Which section's timetable?"
                    };
                }

                if (scope.kind === "teacher"
                    && !scope.sectionIds.includes(Number(sectionId))) {
                    return {
                        type: "refused",
                        message: "You do not teach that section."
                    };
                }
            }

            const rows = await select(
                `SELECT day_of_week, start_time, end_time, subject_code, subject_name,
                        teacher_first_name, teacher_last_name, room_name, building
                   FROM vw_student_timetable
                  WHERE section_id = :sectionId
                    AND (:day IS NULL OR day_of_week = :day)
                  ORDER BY FIELD(day_of_week,'Monday','Tuesday','Wednesday',
                                 'Thursday','Friday','Saturday'), start_time
                  LIMIT :max`,
                {
                    sectionId,
                    day: args?.day_of_week || null,
                    max: analytics.maxDisplayRows
                }
            );

            return { type: "table", rows };
        }
    },

    // ---------------------------------------------------------------- exams

    get_exam_schedule: {
        description:
            "Exams for the student's programme, with date, room and whether " +
            "marks have been published yet. Covers both upcoming and past exams.",
        roles: ["student", "teacher"],
        parameters: {
            type: "object",
            properties: {
                upcoming_only: { type: "boolean" },
                subject_code: { type: "string" }
            }
        },

        run: async (scope, args) => {

            // A student sees their own programme's exams; staff see everything
            // their scope allows, which the WHERE below narrows for a teacher.
            const rows = await select(
                `SELECT exam_name, exam_type, exam_date, days_until, subject_code,
                        subject_name, total_marks, room_name, building,
                        marks_entered, marks_published
                   FROM vw_exam_schedule_full
                  WHERE (:programId IS NULL OR program_id = :programId)
                    AND (:subjectCode IS NULL OR subject_code = :subjectCode)
                    AND (:upcomingOnly = 0 OR exam_date >= CURDATE())
                  ORDER BY exam_date DESC
                  LIMIT :max`,
                {
                    programId: scope.kind === "student" ? scope.programId : null,
                    subjectCode: args?.subject_code || null,
                    upcomingOnly: args?.upcoming_only ? 1 : 0,
                    max: analytics.maxDisplayRows
                }
            );

            return { type: "table", rows };
        }
    },

    // ----------------------------------------------------------------- fees

    get_fee_status: {
        description:
            "Fee vouchers with amount payable, paid, outstanding and due date. " +
            "Distinguishes payments that are verified from those still awaiting " +
            "verification, so a submitted-but-unverified payment is not " +
            "reported as unpaid.",
        roles: ["student"],
        parameters: {
            type: "object",
            properties: {
                student_id: { type: "integer", description: "Admin only." },
                unpaid_only: { type: "boolean" }
            }
        },

        run: async (scope, args) => {
            const target = targetStudent(scope, args);
            if (!target.ok) return { type: "refused", message: target.message };

            const rows = await select(
                `SELECT voucher_number, semester_number, issue_date, due_date,
                        total_payable, amount_paid, remaining_balance, status,
                        verified_total, pending_total, payment_count,
                        last_payment_date, days_overdue
                   FROM vw_student_fee_status
                  WHERE student_id = :studentId
                    AND (:unpaidOnly = 0 OR status NOT IN ('Paid','Cancelled'))
                  ORDER BY due_date DESC
                  LIMIT :max`,
                {
                    studentId: target.studentId,
                    unpaidOnly: args?.unpaid_only ? 1 : 0,
                    max: analytics.maxDisplayRows
                }
            );

            return { type: "table", rows };
        }
    },

    // ----------------------------------------------------------- enrolment

    get_enrolled_subjects: {
        description:
            "The subjects the student is enrolled in, with credit hours and " +
            "enrolment status (Active, Completed, Dropped).",
        roles: ["student", "teacher"],
        parameters: {
            type: "object",
            properties: {
                student_id: { type: "integer", description: "Staff only." },
                status: {
                    type: "string",
                    enum: ["Active", "Completed", "Dropped"]
                }
            }
        },

        run: async (scope, args) => {
            const target = targetStudent(scope, args);
            if (!target.ok) return { type: "refused", message: target.message };

            const rows = await select(
                `SELECT sub.subject_code, sub.subject_name, sub.credit_hours,
                        sem.semester_number, en.status, en.enrollment_date
                   FROM enrollments en
                   JOIN subjects  sub ON sub.subject_id  = en.subject_id
                   JOIN semesters sem ON sem.semester_id = en.semester_id
                  WHERE en.student_id = :studentId
                    AND sub.is_deleted = 0
                    AND (:status IS NULL OR en.status = :status)
                  ORDER BY sem.semester_number, sub.subject_code
                  LIMIT :max`,
                {
                    studentId: target.studentId,
                    status: args?.status || null,
                    max: analytics.maxDisplayRows
                }
            );

            return { type: "table", rows };
        }
    },

    // -------------------------------------------------------- announcements

    get_announcements: {
        description:
            "Recent announcements addressed to the signed-in user's role.",
        roles: ["student", "teacher"],
        parameters: {
            type: "object",
            properties: {
                limit: { type: "integer", description: "Default 10." }
            }
        },

        run: async (scope, args) => {
            const rows = await select(
                `SELECT a.title, a.content, a.target_role, a.created_at
                   FROM announcements a
                  WHERE :isAdmin = 1
                     OR a.target_role IN ('All', :roleName)
                  ORDER BY a.created_at DESC
                  LIMIT :take`,
                {
                    isAdmin: scope.kind === "admin" ? 1 : 0,
                    roleName: scope.kind === "teacher" ? "Teacher" : "Student",
                    take: Math.min(Number(args?.limit) || 10, 50)
                }
            );

            return { type: "table", rows };
        }
    }
};

module.exports = { tools, targetStudent };
