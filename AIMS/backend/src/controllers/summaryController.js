// Read-only access to the reporting views that already exist in the database.
//
// These views do the aggregation in SQL, which is what the dashboards need.
// Without them the frontend had to pull all 59,394 attendance rows (7.7MB) and
// aggregate in the browser.
//
// Everything here is SELECT-only. Identifiers are never taken from user input:
// the view name comes from a fixed map and every filter value is bound as a
// replacement, so none of this is injectable.

const { sequelize } = require("../database/connection");

// view name -> the columns that may be filtered on
const VIEWS = {
    attendance: {
        name: "vw_student_attendance_summary",
        filters: ["student_id", "subject_id"],
        order: "student_id"
    },
    "fee-status": {
        name: "fee_vouchers",
        filters: ["student_id", "status"],
        order: "student_id"
    },
    "teacher-workload": {
        name: "vw_teacher_workload",
        filters: ["teacher_id"],
        order: "teacher_id"
    },
    "class-performance": {
        name: "vw_class_performance_summary",
        filters: ["section_id", "subject_id", "semester_id"],
        order: "section_id"
    }
};

const query = (sql, replacements) =>
    sequelize.query(sql, {
        type: sequelize.QueryTypes.SELECT,
        replacements
    });

// Builds a WHERE clause from the whitelisted filters present on the request.
const buildWhere = (spec, reqQuery) => {
    const clauses = [];
    const replacements = {};

    for (const column of spec.filters) {
        const value = reqQuery[column];
        if (value !== undefined && value !== "") {
            clauses.push(`\`${column}\` = :${column}`);
            replacements[column] = value;
        }
    }

    return {
        sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
        replacements
    };
};

// The attendance view is one row per student PER SUBJECT (9,899 rows). A list
// screen wants one figure per student, so ?group=student rolls it up in SQL and
// returns ~2,000 rows instead. Late counts as attended, matching the frontend.
const groupedAttendance = async (req, res) => {

    const where = buildWhere(VIEWS.attendance, req.query);

    const rows = await query(
        `SELECT student_id,
                SUM(total_sessions)  AS total_sessions,
                SUM(present_count)   AS present_count,
                SUM(absent_count)    AS absent_count,
                SUM(late_count)      AS late_count,
                SUM(leave_count)     AS leave_count,
                ROUND(
                    100 * SUM(present_count + late_count)
                        / NULLIF(SUM(total_sessions), 0),
                    2
                ) AS attendance_percentage
         FROM \`vw_student_attendance_summary\`${where.sql}
         GROUP BY student_id
         ORDER BY student_id`,
        where.replacements
    );

    return res.status(200).json({
        success: true,
        count: rows.length,
        total: rows.length,
        grouped: "student",
        data: rows
    });
};

const getSummary = (key) => async (req, res) => {

    try {

        if (key === "attendance" && req.query.group === "student") {
            return await groupedAttendance(req, res);
        }

        const spec = VIEWS[key];
        const where = buildWhere(spec, req.query);

        const [{ total }] = await query(
            `SELECT COUNT(*) AS total FROM \`${spec.name}\`${where.sql}`,
            where.replacements
        );

        let sql = `SELECT * FROM \`${spec.name}\`${where.sql} ORDER BY \`${spec.order}\``;
        const replacements = { ...where.replacements };

        // Pagination is opt-in, matching the other list endpoints.
        const limitNum = Number.parseInt(req.query.limit, 10);
        const pageNum = Number.parseInt(req.query.page, 10);

        if (Number.isInteger(limitNum) && limitNum > 0) {
            const offset = Number.isInteger(pageNum) && pageNum > 1
                ? (pageNum - 1) * limitNum
                : 0;
            sql += " LIMIT :limit OFFSET :offset";
            replacements.limit = limitNum;
            replacements.offset = offset;
        }

        const data = await query(sql, replacements);

        return res.status(200).json({
            success: true,
            count: data.length,
            total: Number(total),
            page: Number.isInteger(limitNum) && limitNum > 0
                ? (Number.isInteger(pageNum) && pageNum > 0 ? pageNum : 1)
                : undefined,
            limit: Number.isInteger(limitNum) && limitNum > 0 ? limitNum : undefined,
            data
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to load summary"
        });

    }

};

module.exports = {
    getAttendanceSummary: getSummary("attendance"),
    getFeeStatusSummary: getSummary("fee-status"),
    getTeacherWorkload: getSummary("teacher-workload"),
    getClassPerformance: getSummary("class-performance")
};
