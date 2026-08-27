// Restricts a signed-in STUDENT to their own records.
//
// Why this exists: the finance and result list endpoints (student-fees, gpa,
// challans, receipts, student-results) return every row in the table. Students
// need read access to their own data for the student portal, so granting them
// GET on those routes without this middleware would expose all ~2,000 students'
// fees and results to any student who logs in.
//
// Admins and staff are unaffected - the middleware returns immediately for any
// role other than STUDENT.

const { ROLES } = require("../config/roles");
const { sequelize } = require("../database/connection");

// user_id -> student_id, cached for the life of the process. The mapping never
// changes for an existing account.
const studentIdCache = new Map();

const resolveStudentId = async (userId) => {

    if (studentIdCache.has(userId)) return studentIdCache.get(userId);

    const rows = await sequelize.query(
        `SELECT student_id FROM students
         WHERE user_id = :userId AND is_deleted = 0
         LIMIT 1`,
        {
            type: sequelize.QueryTypes.SELECT,
            replacements: { userId }
        }
    );

    const studentId = rows.length ? rows[0].student_id : null;
    studentIdCache.set(userId, studentId);

    return studentId;
};

// The fee vouchers belonging to a student, so payment rows - which carry only
// a fee_voucher_id - can be scoped too.
//
// This read `challans` before the fee module was consolidated; that table and
// its receipts/payments siblings no longer exist. See
// migrations/20260808090000-consolidate-fee-module.js.
const resolveVoucherIds = async (studentId) => {

    const rows = await sequelize.query(
        `SELECT fee_voucher_id FROM fee_vouchers WHERE student_id = :studentId`,
        {
            type: sequelize.QueryTypes.SELECT,
            replacements: { studentId }
        }
    );

    return new Set(rows.map((r) => r.fee_voucher_id));
};

// Keeps only the rows that belong to this student. A row with neither
// student_id nor fee_voucher_id is dropped rather than leaked.
const belongsToStudent = (row, studentId, voucherIds) => {

    if (!row || typeof row !== "object") return false;

    if (row.student_id !== undefined && row.student_id !== null) {
        return Number(row.student_id) === Number(studentId);
    }

    // A payment names its voucher, not its student.
    if (row.fee_voucher_id !== undefined && row.fee_voucher_id !== null) {
        return voucherIds.has(Number(row.fee_voucher_id));
    }

    // Nested under an included voucher.
    if (row.voucher && row.voucher.student_id !== undefined) {
        return Number(row.voucher.student_id) === Number(studentId);
    }

    return false;
};

const scopeStudentToSelf = async (req, res, next) => {

    if (!req.user || req.user.role_id !== ROLES.STUDENT) return next();

    try {

        const studentId = await resolveStudentId(req.user.user_id);

        if (!studentId) {
            return res.status(403).json({
                success: false,
                message: "No student record is linked to this account"
            });
        }

        req.ownStudentId = studentId;

        // A student asking for someone else's id explicitly is refused rather
        // than silently given an empty list.
        const requested = req.params.student_id || req.query.student_id;

        if (requested && Number(requested) !== Number(studentId)) {
            return res.status(403).json({
                success: false,
                message: "You can only access your own records"
            });
        }

        const voucherIds = await resolveVoucherIds(studentId);

        // Filter the response on the way out, so each controller keeps its own
        // query logic and this stays in one place.
        const originalJson = res.json.bind(res);

        res.json = (body) => {

            if (body && typeof body === "object") {

                for (const key of ["data", "attendance", "students"]) {

                    if (Array.isArray(body[key])) {
                        const filtered = body[key].filter(
                            (row) => belongsToStudent(row, studentId, voucherIds)
                        );

                        body[key] = filtered;
                        body.count = filtered.length;
                        if (body.total !== undefined) body.total = filtered.length;
                    }
                }

                // A single record belonging to somebody else is refused.
                if (body.data && !Array.isArray(body.data)
                    && !belongsToStudent(body.data, studentId, voucherIds)) {

                    res.status(403);

                    return originalJson({
                        success: false,
                        message: "You can only access your own records"
                    });
                }
            }

            return originalJson(body);
        };

        return next();

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to verify record ownership"
        });

    }

};

// The student_ids a PARENT is the registered guardian of.
const resolveWardIds = async (userId) => {

    const rows = await sequelize.query(
        `SELECT sg.student_id
           FROM student_guardians sg
           JOIN parents p ON p.parent_id = sg.parent_id
          WHERE p.user_id = :userId`,
        {
            type: sequelize.QueryTypes.SELECT,
            replacements: { userId }
        }
    );

    return new Set(rows.map((r) => Number(r.student_id)));
};

// True when this caller is allowed to see the given student's records.
//
// Admin/Super Admin and Teachers are staff and may read any student. A student
// may read only their own row; a parent only a student they are the guardian
// of. Any other role is refused.
const mayAccessStudent = async (user, studentId) => {

    if (!user) return false;

    const target = Number(studentId);

    if (!Number.isInteger(target)) return false;

    if (user.role_id === ROLES.SUPER_ADMIN
        || user.role_id === ROLES.ADMIN
        || user.role_id === ROLES.TEACHER) {
        return true;
    }

    if (user.role_id === ROLES.STUDENT) {
        return Number(await resolveStudentId(user.user_id)) === target;
    }

    if (user.role_id === ROLES.PARENT) {
        return (await resolveWardIds(user.user_id)).has(target);
    }

    return false;
};

/**
 * Guards a route whose student is named in the URL or body.
 *
 * Without this, GET /api/students/documents/:student_id and
 * POST /api/students/upload-document were `authenticate` only: any signed-in
 * user could read - or write - another student's identity documents (CNIC,
 * B-Form, certificates) just by changing the id in the request.
 *
 * `field` is the request key holding the student id; it is looked for in
 * params, body and query in that order.
 */
const requireStudentAccess = (field = "student_id") => async (req, res, next) => {

    const studentId = req.params[field] ?? req.body?.[field] ?? req.query?.[field];

    if (studentId === undefined || studentId === null || studentId === "") {
        return res.status(400).json({
            success: false,
            message: `${field} is required`
        });
    }

    try {

        if (!(await mayAccessStudent(req.user, studentId))) {
            return res.status(403).json({
                success: false,
                message: "You can only access your own records"
            });
        }

        return next();

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to verify record ownership"
        });

    }

};

/**
 * Guards a route addressed by document id rather than student id, by resolving
 * the row's owner first. DELETE /api/students/documents/:id previously deleted
 * whatever id it was handed, from any account.
 */
const requireDocumentAccess = async (req, res, next) => {

    try {

        const rows = await sequelize.query(
            `SELECT student_id FROM student_documents WHERE doc_id = :docId LIMIT 1`,
            {
                type: sequelize.QueryTypes.SELECT,
                replacements: { docId: req.params.id }
            }
        );

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: "Document not found."
            });
        }

        // A student must not be able to probe which ids exist by comparing 404
        // against 403, but the row is already known to exist here; the check
        // below is what decides whether they may act on it.
        if (!(await mayAccessStudent(req.user, rows[0].student_id))) {
            return res.status(403).json({
                success: false,
                message: "You can only access your own records"
            });
        }

        return next();

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to verify record ownership"
        });

    }

};

module.exports = {
    scopeStudentToSelf,
    resolveStudentId,
    resolveWardIds,
    mayAccessStudent,
    requireStudentAccess,
    requireDocumentAccess
};
