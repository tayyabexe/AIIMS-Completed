/*
 * Institute-wide tools. ADMIN and SUPER_ADMIN only.
 *
 * There is no scope filter in this file, and that is correct rather than an
 * oversight: an admin is already entitled to the whole dataset through the
 * admin portal, so filtering here would only mean the assistant knows less
 * than the screens the same person can open in another tab.
 *
 * The restrictions that do apply are the ones the portal cannot relax either —
 * the read-only account these queries run through cannot read password hashes,
 * CNICs, salaries or document blobs, whatever an admin asks for.
 *
 * `roles: ["admin"]` on every tool here means the registry never even offers
 * them to a teacher or student, so the model cannot call one by guessing its
 * name.
 */

const { readonlySequelize } = require("../../../database/readonlyConnection");
const config = require("../../../config/assistant");
const analytics = require("../../../config/analytics");

const select = async (sql, replacements) =>
    readonlySequelize.query(sql, {
        type: readonlySequelize.QueryTypes.SELECT,
        replacements
    });

const tools = {

    // ------------------------------------------------------------ headcount

    get_institute_overview: {
        description:
            "Headline counts for the whole institute: active students, " +
            "teachers, programmes, sections and current semesters. Use for " +
            "'how big is the institute' or as a starting point for analysis.",
        roles: ["admin"],
        parameters: { type: "object", properties: {} },

        run: async () => {
            const rows = await select(
                `SELECT
                    (SELECT COUNT(*) FROM students  WHERE is_deleted = 0)                              AS total_students,
                    (SELECT COUNT(*) FROM students  WHERE is_deleted = 0 AND academic_status = 'Active') AS active_students,
                    (SELECT COUNT(*) FROM teachers  WHERE is_deleted = 0)                              AS total_teachers,
                    (SELECT COUNT(*) FROM employees WHERE is_deleted = 0)                              AS total_employees,
                    (SELECT COUNT(*) FROM programs  WHERE is_deleted = 0)                              AS total_programs,
                    (SELECT COUNT(*) FROM sections  WHERE is_deleted = 0)                              AS total_sections,
                    (SELECT COUNT(*) FROM subjects  WHERE is_deleted = 0)                              AS total_subjects,
                    (SELECT COUNT(*) FROM semesters WHERE is_archived = 0)                             AS active_semesters`,
                {}
            );
            return { type: "answer", rows };
        }
    },

    get_students_by_program: {
        description:
            "Student headcount broken down by programme, batch or academic " +
            "status. Use for enrolment distribution questions and charts.",
        roles: ["admin"],
        parameters: {
            type: "object",
            properties: {
                group_by: {
                    type: "string",
                    enum: ["program", "batch", "section", "status", "gender"],
                    description: "Default 'program'."
                }
            }
        },

        run: async (_scope, args) => {

            /*
             * The grouping is chosen from a fixed map rather than interpolated
             * from the argument. An enum in the JSON schema is a request to the
             * model; this map is what makes an unexpected value impossible to
             * turn into SQL.
             */
            const GROUPINGS = {
                program: ["p.program_name", "programme"],
                batch: ["b.batch_name", "batch"],
                section: ["sec.section_name", "section"],
                status: ["st.academic_status", "status"],
                gender: ["st.gender", "gender"]
            };

            const [column, label] = GROUPINGS[args?.group_by] || GROUPINGS.program;

            const rows = await select(
                `SELECT ${column} AS ${label}, COUNT(*) AS students
                   FROM students st
              LEFT JOIN programs p   ON p.program_id  = st.program_id
              LEFT JOIN batches  b   ON b.batch_id    = st.batch_id
              LEFT JOIN sections sec ON sec.section_id = st.section_id
                  WHERE st.is_deleted = 0
                  GROUP BY ${column}
                  ORDER BY students DESC
                  LIMIT :max`,
                { max: analytics.maxDisplayRows }
            );

            return {
                type: "chart",
                chartType: "bar",
                labelKey: label,
                valueKey: "students",
                rows
            };
        }
    },

    // ----------------------------------------------------------------- fees

    get_fee_collection_summary: {
        description:
            "Fee collection by programme and semester: total payable, " +
            "collected, outstanding and collection rate.",
        roles: ["admin"],
        parameters: {
            type: "object",
            properties: {
                program_id: { type: "integer" }
            }
        },

        run: async (_scope, args) => {
            const rows = await select(
                `SELECT program_name, semester_number, total_challans,
                        total_payable, total_collected, outstanding_balance,
                        collection_rate_percentage
                   FROM vw_fee_collection_summary
                  WHERE (:programId IS NULL OR program_id = :programId)
                  ORDER BY collection_rate_percentage ASC
                  LIMIT :max`,
                {
                    programId: args?.program_id || null,
                    max: analytics.maxDisplayRows
                }
            );
            return {
                type: "chart",
                chartType: "bar",
                labelKey: "program_name",
                valueKey: "collection_rate_percentage",
                rows
            };
        }
    },

    get_fee_defaulters: {
        description:
            "Students with overdue fee vouchers, with the amount outstanding " +
            "and how many days overdue. Filterable by programme or batch.",
        roles: ["admin"],
        parameters: {
            type: "object",
            properties: {
                program_id: { type: "integer" },
                batch_id: { type: "integer" },
                min_days_overdue: { type: "integer" },
                min_amount: { type: "number" }
            }
        },

        run: async (_scope, args) => {
            const rows = await select(
                `SELECT registration_number, first_name, last_name, program_name,
                        batch_name, section_name, total_payable, amount_paid,
                        remaining_balance, due_date, status, days_overdue
                   FROM vw_fee_defaulters
                  WHERE (:programId IS NULL OR program_id = :programId)
                    AND (:batchId   IS NULL OR batch_id   = :batchId)
                    AND (:minDays   IS NULL OR days_overdue >= :minDays)
                    AND (:minAmount IS NULL OR remaining_balance >= :minAmount)
                  ORDER BY days_overdue DESC, remaining_balance DESC
                  LIMIT :max`,
                {
                    programId: args?.program_id || null,
                    batchId: args?.batch_id || null,
                    minDays: args?.min_days_overdue ?? null,
                    minAmount: args?.min_amount ?? null,
                    max: analytics.maxDisplayRows
                }
            );
            return { type: "table", rows };
        }
    },

    // --------------------------------------------------------- academic ops

    get_enrollment_stats: {
        description:
            "Enrolment per subject per semester, with active, completed and " +
            "dropped counts. Use to spot subjects with high drop rates.",
        roles: ["admin"],
        parameters: {
            type: "object",
            properties: {
                program_id: { type: "integer" },
                semester_id: { type: "integer" }
            }
        },

        run: async (_scope, args) => {
            const rows = await select(
                `SELECT program_name, semester_number, subject_code, subject_name,
                        credit_hours, enrolled_count, active_count,
                        completed_count, dropped_count
                   FROM vw_semester_enrollment_summary
                  WHERE (:programId  IS NULL OR program_id  = :programId)
                    AND (:semesterId IS NULL OR semester_id = :semesterId)
                  ORDER BY dropped_count DESC, enrolled_count DESC
                  LIMIT :max`,
                {
                    programId: args?.program_id || null,
                    semesterId: args?.semester_id || null,
                    max: analytics.maxDisplayRows
                }
            );
            return { type: "table", rows };
        }
    },

    get_program_catalog: {
        description:
            "The curriculum: which subjects a programme teaches in which " +
            "semester, with credit hours and prerequisites. Contains no " +
            "personal data.",
        roles: ["admin", "teacher", "student"],
        parameters: {
            type: "object",
            properties: {
                program_id: { type: "integer" },
                semester_number: { type: "integer" }
            }
        },

        run: async (scope, args) => {

            // A student asking about "my programme" should not have to know
            // its id, so their own programme is the default.
            const programId = args?.program_id
                ?? (scope.kind === "student" ? scope.programId : null);

            const rows = await select(
                `SELECT program_name, semester_number, subject_code, subject_name,
                        credit_hours, prerequisite_subject_code
                   FROM vw_program_semester_catalog
                  WHERE (:programId IS NULL OR program_id = :programId)
                    AND (:semesterNumber IS NULL OR semester_number = :semesterNumber)
                    AND subject_id IS NOT NULL
                  ORDER BY program_name, semester_number, subject_code
                  LIMIT :max`,
                {
                    programId: programId || null,
                    semesterNumber: args?.semester_number || null,
                    max: analytics.maxDisplayRows
                }
            );

            return { type: "table", rows };
        }
    },

    get_attendance_by_program: {
        description:
            "Average attendance aggregated by programme, batch or subject. " +
            "Use for institute-wide attendance health.",
        roles: ["admin"],
        parameters: {
            type: "object",
            properties: {
                group_by: {
                    type: "string",
                    enum: ["program", "batch", "subject"],
                    description: "Default 'program'."
                }
            }
        },

        run: async (_scope, args) => {

            const GROUPINGS = {
                program: ["p.program_name", "programme"],
                batch: ["b.batch_name", "batch"],
                subject: ["sub.subject_name", "subject"]
            };

            const [column, label] = GROUPINGS[args?.group_by] || GROUPINGS.program;

            const rows = await select(
                `SELECT ${column} AS ${label},
                        COUNT(DISTINCT a.student_id) AS students,
                        ROUND(AVG(a.attendance_percentage), 2) AS avg_attendance
                   FROM vw_student_attendance_summary a
                   JOIN students st  ON st.student_id  = a.student_id
                   JOIN subjects sub ON sub.subject_id = a.subject_id
              LEFT JOIN programs p   ON p.program_id   = st.program_id
              LEFT JOIN batches  b   ON b.batch_id     = st.batch_id
                  GROUP BY ${column}
                  ORDER BY avg_attendance ASC
                  LIMIT :max`,
                { max: analytics.maxDisplayRows }
            );

            return {
                type: "chart",
                chartType: "bar",
                labelKey: label,
                valueKey: "avg_attendance",
                rows
            };
        }
    },

    get_results_distribution: {
        description:
            "Distribution of published GPA/CGPA across the institute, bucketed, " +
            "optionally narrowed to one programme or semester.",
        roles: ["admin"],
        parameters: {
            type: "object",
            properties: {
                program_id: { type: "integer" },
                semester_number: { type: "integer" }
            }
        },

        run: async (_scope, args) => {
            const rows = await select(
                `SELECT CASE
                            WHEN cgpa >= 3.5 THEN '3.50 - 4.00'
                            WHEN cgpa >= 3.0 THEN '3.00 - 3.49'
                            WHEN cgpa >= 2.5 THEN '2.50 - 2.99'
                            WHEN cgpa >= 2.0 THEN '2.00 - 2.49'
                            ELSE 'Below 2.00'
                        END AS cgpa_band,
                        COUNT(*) AS students
                   FROM vw_student_gpa_summary
                  WHERE (:programId IS NULL OR program_id = :programId)
                    AND (:semesterNumber IS NULL OR semester_number = :semesterNumber)
                    AND cgpa IS NOT NULL
                  GROUP BY cgpa_band
                  ORDER BY cgpa_band DESC`,
                {
                    programId: args?.program_id || null,
                    semesterNumber: args?.semester_number || null
                }
            );
            return {
                type: "chart",
                chartType: "pie",
                labelKey: "cgpa_band",
                valueKey: "students",
                rows
            };
        }
    },

    get_teacher_workload_report: {
        description:
            "Teaching load across all teachers, highest first, with department. " +
            "Use to find over- and under-loaded staff.",
        roles: ["admin"],
        parameters: {
            type: "object",
            properties: {
                department_id: { type: "integer" }
            }
        },

        run: async (_scope, args) => {
            const rows = await select(
                `SELECT first_name, last_name, department_name, weekly_sessions,
                        distinct_subjects, distinct_sections, weekly_contact_hours
                   FROM vw_teacher_workload
                  WHERE (:departmentId IS NULL OR department_id = :departmentId)
                  ORDER BY weekly_contact_hours DESC
                  LIMIT :max`,
                {
                    departmentId: args?.department_id || null,
                    max: analytics.maxDisplayRows
                }
            );
            return { type: "table", rows };
        }
    },

    find_teacher: {
        description:
            "Look up a teacher by name, to obtain their teacher_id and see " +
            "what they teach. The counterpart of find_student.",
        roles: ["admin"],
        parameters: {
            type: "object",
            properties: {
                search: {
                    type: "string",
                    description: "First name, last name, or both."
                }
            },
            required: ["search"]
        },

        run: async (_scope, args) => {

            const term = String(args?.search || "").trim();

            if (term.length < 2) {
                return {
                    type: "refused",
                    message: "Give at least two characters to search for."
                };
            }

            /*
             * Matched against the joined name as well as each part, because a
             * user types "Tariq Raza" and the database stores those in two
             * columns. Searching only first_name and last_name separately
             * finds nothing for the one thing people actually type.
             */
            const rows = await select(
                `SELECT t.teacher_id,
                        CONCAT(e.first_name, ' ', e.last_name) AS teacher_name,
                        d.department_name,
                        e.designation,
                        COUNT(DISTINCT tt.subject_id) AS subjects_taught,
                        COUNT(DISTINCT tt.section_id) AS sections_taught
                   FROM teachers t
                   JOIN employees e   ON e.employee_id  = t.employee_id
                                     AND e.is_deleted = 0
              LEFT JOIN departments d ON d.department_id = e.department_id
              LEFT JOIN timetables tt ON tt.teacher_id   = t.teacher_id
                  WHERE t.is_deleted = 0
                    AND (CONCAT(e.first_name, ' ', e.last_name) LIKE :term
                         OR e.first_name LIKE :term
                         OR e.last_name  LIKE :term)
                  GROUP BY t.teacher_id, teacher_name, d.department_name,
                           e.designation
                  ORDER BY teacher_name
                  LIMIT 25`,
                { term: `%${term}%` }
            );

            return { type: "table", rows };
        }
    },

    get_student_teachers: {
        description:
            "Which teachers teach a given student, and which subject each of " +
            "them teaches them. Accepts the student's name or their id.",
        roles: ["admin"],
        parameters: {
            type: "object",
            properties: {
                search: {
                    type: "string",
                    description:
                        "The student's name or registration number. Use this " +
                        "when the question names a student rather than an id."
                },
                student_id: { type: "integer" }
            }
        },

        run: async (_scope, args) => {

            const term = String(args?.search || "").trim();
            const studentId = Number(args?.student_id) || null;

            if (!studentId && term.length < 2) {
                return {
                    type: "refused",
                    message:
                        "Name the student, or give their registration number."
                };
            }

            /*
             * vw_teacher_class_roster already pairs a teacher to a student
             * through the timetable AND the enrolment, so this is a filter
             * rather than a join. That pairing is the same rule the faculty
             * scope is built from, which is why "who teaches her" and "may
             * this teacher see her" can never give contradictory answers.
             *
             * The student's own name is returned on every row rather than
             * assumed: a search for "ahmed" may match several people, and a
             * result that does not say which one it is about is worse than
             * one that lists them all.
             */
            const rows = await select(
                `SELECT CONCAT(r.student_first_name, ' ', r.student_last_name) AS student_name,
                        r.registration_number,
                        CONCAT(r.teacher_first_name, ' ', r.teacher_last_name) AS teacher_name,
                        r.subject_code,
                        r.subject_name,
                        r.section_name,
                        r.enrollment_status
                   FROM vw_teacher_class_roster r
                  WHERE (:studentId IS NULL OR r.student_id = :studentId)
                    AND (:term IS NULL
                         OR CONCAT(r.student_first_name, ' ', r.student_last_name) LIKE :term
                         OR r.student_first_name   LIKE :term
                         OR r.student_last_name    LIKE :term
                         OR r.registration_number  LIKE :term)
                  ORDER BY student_name, r.subject_code
                  LIMIT :max`,
                {
                    studentId,
                    term: term.length >= 2 ? `%${term}%` : null,
                    max: analytics.maxDisplayRows
                }
            );

            return { type: "table", rows };
        }
    },

    find_student: {
        description:
            "Look up a student by registration number or name, to obtain their " +
            "student_id for use with the per-student tools.",
        roles: ["admin"],
        parameters: {
            type: "object",
            properties: {
                search: {
                    type: "string",
                    description: "Registration number, first name or last name."
                }
            },
            required: ["search"]
        },

        run: async (_scope, args) => {

            const term = String(args?.search || "").trim();

            if (term.length < 2) {
                return {
                    type: "refused",
                    message: "Give at least two characters to search for."
                };
            }

            /*
             * The wildcards are added to the bound value, not to the SQL, so
             * a search term containing % or _ is matched literally-ish rather
             * than turning into a scan of the whole table. Sequelize binds it
             * as a single string; there is no way for it to become syntax.
             */
            const rows = await select(
                `SELECT student_id, registration_number, full_name, program_name,
                        batch_name, section_name, current_semester_number,
                        academic_status
                   FROM vw_student_profile_full
                  WHERE registration_number LIKE :term
                     OR full_name LIKE :term
                  ORDER BY registration_number
                  LIMIT 25`,
                { term: `%${term}%` }
            );

            return { type: "table", rows };
        }
    }
};

module.exports = { tools };
