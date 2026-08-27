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
const { ADMIN_TEACHER } = require("../config/roles");

const { sequelize } = require("../database/connection");

// Departments had no endpoint at all, so the faculty screens had no way to
// offer a department list. Read-only.
router.get(
    "/",
    authenticate,
    authorize(...ADMIN_TEACHER),
    async (req, res) => {

        try {

            const data = await sequelize.query(
                `SELECT department_id, department_name, head_employee_id
                 FROM departments
                 WHERE is_deleted = 0
                 ORDER BY department_name`,
                { type: sequelize.QueryTypes.SELECT }
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
                message: "Failed to load departments"
            });

        }

    }
);

module.exports = router;
