/*
 * Tools a TEACHER may call about their own classes.
 *
 * THE RULE THIS FILE ENFORCES
 * ---------------------------
 * Every query is bounded by the teacher's own roster. Where the model supplies
 * a subject or section, it is checked against `scope.classes` before the query
 * runs; where it supplies nothing, the query is filtered by the id sets
 * resolved in scope.service.js. There is no code path in which a teacher's
 * question reaches a student who is not on one of their rosters.
 *
 * Admins may call these too, unfiltered, because "show me class performance
 * for section 4" is an admin question as much as a teacher one. The difference
 * is entirely in the scope object, not in the SQL.
 */

const { readonlySequelize } = require("../../../database/readonlyConnection");
const config = require("../../../config/assistant");
const analytics = require("../../../config/analytics");

const select = async (sql, replacements) =>
    readonlySequelize.query(sql, {
        type: readonlySequelize.QueryTypes.SELECT,
        replacements
    });

/*
 * An id list safe to interpolate into an IN clause.
 *
 * Sequelize can bind an array to a single replacement, but an empty array
 * binds to `IN ()`, which is a MySQL syntax error — and an empty array is the
 * normal state for a teacher with no timetable rows. Mapping through Number()
 * and filtering non-integers means nothing but digits can reach the string,
 * and the empty case becomes a literal that matches no row rather than a
 * crash.
 */
const idList = (ids) => {
    const clean = (ids || []).map(Number).filter(Number.isInteger);
    return clean.length ? clean.join(",") : "NULL";
};

/*
 * True when this scope is allowed to look at this (subject, section) pair.
 * Admins always are. A teacher must actually teach it.
 */
const mayUseClass = (scope, subjectId, sectionId) => {

    if (scope.kind === "admin") return true;
    if (scope.kind !== "teacher") return false;

    return scope.classes.some(
        (c) =>
            (subjectId === undefined || subjectId === null
                || c.subjectId === Number(subjectId))
            && (sectionId === undefined || sectionId === null
                || c.sectionId === Number(sectionId))
    );
};

const tools = {

    // -------------------------------------------------------------- classes

    get_my_classes: {
        description:
            "The classes the signed-in teacher teaches: subject, section, " +
            "batch, and how many students are enrolled in each. Start here " +
            "when a teacher asks anything about 'my classes' or 'my students'.",
        roles: ["teacher"],
        parameters: { type: "object", properties: {} },

        run: async (scope) => {

            if (scope.kind === "admin") {
                const rows = await select(
                    `SELECT teacher_id, teacher_first_name, teacher_last_name,
                            subject_code, subject_name, section_name, batch_name,
                            COUNT(DISTINCT student_id) AS enrolled_students
                       FROM vw_teacher_class_roster
                      GROUP BY teacher_id, teacher_first_name, teacher_last_name,
                               subject_code, subject_name, section_name, batch_name
                      ORDER BY teacher_last_name, subject_code
                      LIMIT :max`,
                    { max: analytics.maxDisplayRows }
                );
                return { type: "table", rows };
            }

            const rows = await select(
                `SELECT subject_id, subject_code, subject_name,
                        section_id, section_name, batch_name, semester_id,
                        COUNT(DISTINCT student_id) AS enrolled_students
                   FROM vw_teacher_class_roster
                  WHERE teacher_id = :teacherId
                  GROUP BY subject_id, subject_code, subject_name,
                           section_id, section_name, batch_name, semester_id
                  ORDER BY subject_code, section_name`,
                { teacherId: scope.teacherId }
            );

            return { type: "table", rows };
        }
    },

    get_class_roster: {
        description:
            "The students enrolled in one of the teacher's classes. Requires " +
            "both a subject and a section - call get_my_classes first to find " +
            "the right pair.",
        roles: ["teacher", "admin"],
        descriptions: { admin: "The students enrolled in ANY class in the institute, given a subject_id and a section_id." },
        parameters: {
            type: "object",
            properties: {
                subject_id: { type: "integer" },
                section_id: { type: "integer" }
            },
            required: ["subject_id", "section_id"]
        },

        run: async (scope, args) => {

            if (!mayUseClass(scope, args?.subject_id, args?.section_id)) {
                return {
                    type: "refused",
                    message:
                        "You do not teach that subject to that section, so its " +
                        "roster is outside your scope."
                };
            }

            const rows = await select(
                `SELECT registration_number, student_first_name, student_last_name,
                        enrollment_status
                   FROM vw_teacher_class_roster
                  WHERE subject_id = :subjectId
                    AND section_id = :sectionId
                    AND (:teacherId IS NULL OR teacher_id = :teacherId)
                  ORDER BY registration_number
                  LIMIT :max`,
                {
                    subjectId: args.subject_id,
                    sectionId: args.section_id,
                    teacherId: scope.kind === "teacher" ? scope.teacherId : null,
                    max: analytics.maxDisplayRows
                }
            );

            return { type: "table", rows };
        }
    },

    // ---------------------------------------------------------- performance

    get_class_performance: {
        description:
            "Average percentage and pass rate per class, from published marks " +
            "only. Use for 'how did my class do' or to compare sections.",
        roles: ["teacher", "admin"],
        descriptions: { admin: "Average percentage and pass rate for ANY class in the institute, from published marks only." },
        parameters: {
            type: "object",
            properties: {
                subject_id: { type: "integer" },
                section_id: { type: "integer" }
            }
        },

        run: async (scope, args) => {

            if ((args?.subject_id || args?.section_id)
                && !mayUseClass(scope, args?.subject_id, args?.section_id)) {
                return {
                    type: "refused",
                    message: "That class is outside your scope."
                };
            }

            const scoped = scope.kind === "teacher";

            const rows = await select(
                `SELECT p.subject_id, p.subject_name, p.section_id, sec.section_name,
                        p.semester_id, p.students_assessed, p.avg_percentage,
                        p.pass_rate_percentage
                   FROM vw_class_performance_summary p
              LEFT JOIN sections sec ON sec.section_id = p.section_id
                  WHERE (:subjectId IS NULL OR p.subject_id = :subjectId)
                    AND (:sectionId IS NULL OR p.section_id = :sectionId)
                    ${scoped
                        ? `AND p.subject_id IN (${idList(scope.subjectIds)})
                           AND p.section_id IN (${idList(scope.sectionIds)})`
                        : ""}
                  ORDER BY p.avg_percentage ASC
                  LIMIT :max`,
                {
                    subjectId: args?.subject_id || null,
                    sectionId: args?.section_id || null,
                    max: analytics.maxDisplayRows
                }
            );

            return {
                type: "chart",
                chartType: "bar",
                labelKey: "subject_name",
                valueKey: "avg_percentage",
                rows
            };
        }
    },

    get_class_attendance: {
        description:
            "Attendance percentage for every student in one of the teacher's " +
            "classes, lowest first. Use to find who is falling behind.",
        roles: ["teacher", "admin"],
        descriptions: { admin: "Attendance percentage for every student in ANY class in the institute, lowest first." },
        parameters: {
            type: "object",
            properties: {
                subject_id: { type: "integer" },
                section_id: { type: "integer" },
                below_percentage: {
                    type: "number",
                    description:
                        "Optional threshold, e.g. 75, to list only students " +
                        "below it."
                }
            },
            required: ["subject_id", "section_id"]
        },

        run: async (scope, args) => {

            if (!mayUseClass(scope, args?.subject_id, args?.section_id)) {
                return {
                    type: "refused",
                    message: "That class is outside your scope."
                };
            }

            const rows = await select(
                `SELECT r.registration_number,
                        r.student_first_name,
                        r.student_last_name,
                        a.total_sessions,
                        a.present_count,
                        a.absent_count,
                        a.late_count,
                        a.attendance_percentage,
                        a.strict_attendance_percentage
                   FROM vw_teacher_class_roster r
                   JOIN vw_student_attendance_summary a
                     ON a.student_id = r.student_id
                    AND a.subject_id = r.subject_id
                  WHERE r.subject_id = :subjectId
                    AND r.section_id = :sectionId
                    AND (:teacherId IS NULL OR r.teacher_id = :teacherId)
                    AND (:below IS NULL OR a.attendance_percentage < :below)
                  ORDER BY a.attendance_percentage ASC
                  LIMIT :max`,
                {
                    subjectId: args.subject_id,
                    sectionId: args.section_id,
                    teacherId: scope.kind === "teacher" ? scope.teacherId : null,
                    below: args?.below_percentage ?? null,
                    max: analytics.maxDisplayRows
                }
            );

            return { type: "table", rows };
        }
    },

    get_class_marks: {
        description:
            "The marks sheet for one exam in one of the teacher's classes, " +
            "with each student's percentage and grade.",
        roles: ["teacher", "admin"],
        descriptions: { admin: "The marks sheet for one exam in ANY class in the institute, with each student percentage and grade." },
        parameters: {
            type: "object",
            properties: {
                subject_id: { type: "integer" },
                section_id: { type: "integer" },
                exam_type: {
                    type: "string",
                    enum: ["Quiz", "Assignment", "Mid-Term", "Final", "Practical", "Viva"]
                }
            },
            required: ["subject_id", "section_id"]
        },

        run: async (scope, args) => {

            if (!mayUseClass(scope, args?.subject_id, args?.section_id)) {
                return {
                    type: "refused",
                    message: "That class is outside your scope."
                };
            }

            const rows = await select(
                `SELECT r.registration_number,
                        r.student_first_name,
                        r.student_last_name,
                        m.exam_name, m.exam_type, m.exam_date,
                        m.obtained_marks, m.total_marks, m.percentage,
                        m.grade_letter
                   FROM vw_teacher_class_roster r
                   JOIN vw_student_subject_marks m
                     ON m.student_id = r.student_id
                    AND m.subject_id = r.subject_id
                  WHERE r.subject_id = :subjectId
                    AND r.section_id = :sectionId
                    AND (:teacherId IS NULL OR r.teacher_id = :teacherId)
                    AND (:examType IS NULL OR m.exam_type = :examType)
                  ORDER BY m.percentage DESC
                  LIMIT :max`,
                {
                    subjectId: args.subject_id,
                    sectionId: args.section_id,
                    teacherId: scope.kind === "teacher" ? scope.teacherId : null,
                    examType: args?.exam_type || null,
                    max: analytics.maxDisplayRows
                }
            );

            return { type: "table", rows };
        }
    },

    // -------------------------------------------------------------- at risk

    get_at_risk_students: {
        description:
            "Students needing intervention, by low attendance or low CGPA. " +
            "A teacher sees only students they teach, and no fee figures - " +
            "fee criteria and fee columns are available to admins only.",
        roles: ["teacher", "admin"],
        descriptions: { admin: "Students needing intervention anywhere in the institute, by low attendance, low CGPA or outstanding fees." },
        parameters: {
            type: "object",
            properties: {
                attendance_below: {
                    type: "number",
                    description: "Attendance threshold, default 75."
                },
                cgpa_below: {
                    type: "number",
                    description: "CGPA threshold, e.g. 2.0. Optional."
                },
                has_outstanding_fees: { type: "boolean" }
            }
        },

        run: async (scope, args) => {

            /*
             * The thresholds live here rather than in the view, so the
             * institute's definition of "at risk" is a value a caller passes
             * and not something baked into a migration. 75% is the default
             * because it is the conventional minimum, but nothing enforces it
             * as policy.
             */
            const attendanceBelow = args?.attendance_below ?? 75;
            const scoped = scope.kind === "teacher";

            /*
             * FEE COLUMNS ARE ADMIN-ONLY, AND THIS TOOL USED TO IGNORE THAT.
             *
             * vw_at_risk_students carries unpaid_vouchers, outstanding_balance
             * and max_days_overdue, and every caller got all three. For an
             * admin that is correct. For a teacher it contradicts the rule the
             * rest of AIMS states twice and enforces everywhere else -
             * "Teachers do not have access to fee data at all"
             * (06-fees-vouchers-payments.md, 31-teacher-what-i-cannot-do.md) -
             * and it contradicts this very service, which refuses a teacher
             * who asks for fee figures directly.
             *
             * The row filter was never the problem: a teacher only ever saw
             * their own students. The projection was. Asking "who is at risk"
             * is a legitimate teacher question, so the answer is to drop the
             * three columns rather than the tool, and to drop the fee
             * criterion with them - a filter a teacher may not see the result
             * of is not a filter they should be able to apply.
             */
            const feeColumns = scoped
                ? ""
                : `, unpaid_vouchers, outstanding_balance, max_days_overdue`;

            const feeCriterion = scoped
                ? ""
                : ` OR (:needFees = 1 AND outstanding_balance > 0)`;

            const rows = await select(
                `SELECT registration_number, full_name, program_name, section_id,
                        avg_attendance_percentage, lowest_attendance_percentage,
                        latest_gpa, latest_cgpa${feeColumns}
                   FROM vw_at_risk_students
                  WHERE (avg_attendance_percentage < :attendanceBelow
                         OR (:cgpaBelow IS NOT NULL AND latest_cgpa < :cgpaBelow)
                         ${feeCriterion})
                    ${scoped
                        ? `AND student_id IN (${idList([...scope.studentIds])})`
                        : ""}
                  ORDER BY avg_attendance_percentage ASC
                  LIMIT :max`,
                {
                    attendanceBelow,
                    cgpaBelow: args?.cgpa_below ?? null,
                    ...(scoped ? {} : { needFees: args?.has_outstanding_fees ? 1 : 0 }),
                    max: analytics.maxDisplayRows
                }
            );

            return { type: "table", rows };
        }
    },

    // ------------------------------------------------------------- workload

    get_my_workload: {
        description:
            "The teacher's weekly teaching load: sessions, distinct subjects " +
            "and sections, and total contact hours.",
        roles: ["teacher"],
        parameters: { type: "object", properties: {} },

        run: async (scope) => {

            const rows = await select(
                `SELECT first_name, last_name, department_name, weekly_sessions,
                        distinct_subjects, distinct_sections, weekly_contact_hours
                   FROM vw_teacher_workload
                  WHERE (:teacherId IS NULL OR teacher_id = :teacherId)
                  ORDER BY weekly_contact_hours DESC
                  LIMIT :max`,
                {
                    teacherId: scope.kind === "teacher" ? scope.teacherId : null,
                    max: analytics.maxDisplayRows
                }
            );

            return { type: "table", rows };
        }
    },

    get_my_teaching_timetable: {
        description:
            "The teacher's own weekly schedule - which class they teach when " +
            "and in which room.",
        roles: ["teacher"],
        parameters: {
            type: "object",
            properties: {
                day_of_week: {
                    type: "string",
                    enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
                }
            }
        },

        run: async (scope, args) => {

            if (scope.kind !== "teacher") {
                return {
                    type: "refused",
                    message:
                        "This tool reports the signed-in teacher's own schedule. " +
                        "Use get_timetable with a section id instead."
                };
            }

            const rows = await select(
                `SELECT day_of_week, start_time, end_time, subject_code,
                        subject_name, section_name, room_name, building
                   FROM vw_student_timetable
                  WHERE teacher_id = :teacherId
                    AND (:day IS NULL OR day_of_week = :day)
                  ORDER BY FIELD(day_of_week,'Monday','Tuesday','Wednesday',
                                 'Thursday','Friday','Saturday'), start_time`,
                {
                    teacherId: scope.teacherId,
                    day: args?.day_of_week || null
                }
            );

            return { type: "table", rows };
        }
    },

    get_my_exams: {
        description:
            "Exams for the subjects the teacher teaches, including whether " +
            "marks have been entered and published yet.",
        roles: ["teacher"],
        parameters: {
            type: "object",
            properties: {
                upcoming_only: { type: "boolean" }
            }
        },

        run: async (scope, args) => {

            const scoped = scope.kind === "teacher";

            const rows = await select(
                `SELECT exam_name, exam_type, exam_date, days_until, subject_code,
                        subject_name, total_marks, room_name,
                        marks_entered, marks_published
                   FROM vw_exam_schedule_full
                  WHERE (:upcomingOnly = 0 OR exam_date >= CURDATE())
                    ${scoped ? `AND subject_id IN (${idList(scope.subjectIds)})` : ""}
                  ORDER BY exam_date DESC
                  LIMIT :max`,
                {
                    upcomingOnly: args?.upcoming_only ? 1 : 0,
                    max: analytics.maxDisplayRows
                }
            );

            return { type: "table", rows };
        }
    }
};

module.exports = { tools, idList, mayUseClass };
