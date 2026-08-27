/* =====================================================================
 * DEAD CODE - NOT MOUNTED. DO NOT MOUNT THIS ROUTER.
 * =====================================================================
 *
 * Superseded by routes/academicStructureRoutes.js, which is what app.js
 * actually mounts. Read the comment at the top of that file for the full
 * account of why these were replaced.
 *
 * This one was read-only and did carry auth, but it is still unmounted and
 * unmaintained: it has no create, amend or delete, and it does not know about
 * the soft-delete and child-count rules the live router enforces.
 *
 * Kept only as a record of the shape that was replaced.
 * ===================================================================== */

const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ACADEMIC_REFERENCE } = require("../config/roles");

const { sequelize } = require("../database/connection");

// Read-only academic reference data, in the same bracket as subjects and
// timetables: every portal reads it, nobody but a migration writes it.
//
// Added because the admin announcement audience builder has to offer "students
// in semester N" as a target, and there was no way to list semesters at all.
//
// The programme name is joined in rather than declared as a Sequelize
// association: `semesters` has no association to `programs` anywhere in the
// models, and adding one to a model this many controllers share would change
// far more than this endpoint needs.

// ================= GET ALL SEMESTERS =================
router.get(
    "/",
    authenticate,
    // Parent included: a parent portal needs the semester numbering to label
    // "Semester 3" instead of printing the raw current_semester_id, or a dash.
    authorize(...ACADEMIC_REFERENCE),
    async (req, res) => {

        try {

            const { program_id } = req.query;

            const where = program_id ? "WHERE s.program_id = :program_id" : "";

            const data = await sequelize.query(
                `SELECT s.semester_id,
                        s.program_id,
                        s.semester_number,
                        s.start_date,
                        s.end_date,
                        s.is_archived,
                        p.program_name
                   FROM semesters s
                   LEFT JOIN programs p ON p.program_id = s.program_id
                   ${where}
                  ORDER BY s.program_id ASC, s.semester_number ASC`,
                {
                    type: sequelize.QueryTypes.SELECT,
                    replacements: program_id ? { program_id } : {}
                }
            );

            return res.status(200).json({
                success: true,
                count: data.length,
                data
            });

        } catch (error) {

            console.error(error);

            return res.status(500).json({
                success: false,
                message: "Failed to load semesters"
            });

        }

    }
);

module.exports = router;
