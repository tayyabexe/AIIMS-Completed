const bcrypt = require("bcrypt");
const Teacher = require("../models/Teacher");
const User = require("../models/user.model");
const { sequelize } = require("../database/connection");
const { ROLES } = require("../config/roles");

// The teachers table stores only teacher_id, employee_id and specialization.
// The person's actual name, designation and department live in `employees`,
// and the email on `users`, so reads are enriched with those here. Nothing is
// removed from the response - these are additional fields.
const attachEmployeeDetails = async (teachers) => {

    const many = Array.isArray(teachers);
    const list = many ? teachers : [teachers];

    const employeeIds = [
        ...new Set(list.map((t) => t.employee_id).filter(Boolean))
    ];

    if (employeeIds.length === 0) return teachers;

    const rows = await sequelize.query(
        `SELECT e.employee_id,
                e.user_id,
                e.employee_code,
                e.first_name,
                e.last_name,
                e.designation,
                e.employment_status,
                e.department_id,
                d.department_name,
                u.email
         FROM employees e
         LEFT JOIN departments d ON d.department_id = e.department_id
         LEFT JOIN users u ON u.user_id = e.user_id
         WHERE e.employee_id IN (:employeeIds)`,
        {
            type: sequelize.QueryTypes.SELECT,
            replacements: { employeeIds }
        }
    );

    const byEmployeeId = new Map(rows.map((r) => [r.employee_id, r]));

    const merge = (teacher) => {

        const plain = teacher.get
            ? teacher.get({ plain: true })
            : { ...teacher };

        const employee = byEmployeeId.get(plain.employee_id) || null;

        return {
            ...plain,
            // Lets a signed-in teacher find their own teacher_id from their user_id.
            user_id: employee ? employee.user_id : null,
            employee_code: employee ? employee.employee_code : null,
            first_name: employee ? employee.first_name : null,
            last_name: employee ? employee.last_name : null,
            full_name: employee
                ? [employee.first_name, employee.last_name].filter(Boolean).join(" ")
                : null,
            designation: employee ? employee.designation : null,
            employment_status: employee ? employee.employment_status : null,
            department_id: employee ? employee.department_id : null,
            department_name: employee ? employee.department_name : null,
            email: employee ? employee.email : null
        };
    };

    return many ? list.map(merge) : merge(list[0]);
};

// Get all teachers
const getAllTeachers = async () => {
    const teachers = await Teacher.findAll({
        where: {
            is_deleted: false
        }
    });

    return await attachEmployeeDetails(teachers);
};

// Get teacher by ID
const getTeacherById = async (id) => {
    const teacher = await Teacher.findOne({
        where: {
            teacher_id: id,
            is_deleted: false
        }
    });

    if (!teacher) return null;

    return await attachEmployeeDetails(teacher);
};

const fail = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

// employee_code is NOT NULL and UNIQUE, so one is generated when the caller
// does not supply it.
const nextEmployeeCode = async (transaction) => {
    const [row] = await sequelize.query(
        `SELECT MAX(CAST(SUBSTRING(employee_code, 5) AS UNSIGNED)) AS max_code
         FROM employees WHERE employee_code LIKE 'EMP-%'`,
        { type: sequelize.QueryTypes.SELECT, transaction }
    );

    return `EMP-${Number(row.max_code || 1000) + 1}`;
};

// Create teacher.
//
// Two shapes are accepted:
//   1. { employee_id, specialization }            - link an existing employee
//   2. { first_name, last_name, department_id, …, email, password }
//                                                 - create user + employee + teacher
// The second exists because a teacher's name, department and designation live
// on `employees`, and `employees.user_id` is NOT NULL, so all three rows must
// be written together or not at all.
const createTeacher = async (teacherData) => {

    if (teacherData.employee_id) {

        const existingTeacher = await Teacher.findOne({
            where: { employee_id: teacherData.employee_id }
        });

        if (existingTeacher) {
            throw fail("Teacher already exists for this employee", 409);
        }

        const created = await Teacher.create(teacherData);
        return await attachEmployeeDetails(created);
    }

    const {
        email,
        password,
        first_name,
        last_name,
        department_id,
        designation,
        basic_salary,
        hire_date,
        employment_status,
        employee_code,
        phone,
        specialization
    } = teacherData;

    const missing = ["email", "password", "first_name", "last_name", "department_id"]
        .filter((field) => !teacherData[field]);

    if (missing.length) {
        throw fail(`Missing required field(s): ${missing.join(", ")}`, 400);
    }

    const duplicate = await User.findOne({ where: { email } });
    if (duplicate) throw fail("Email already exists", 409);

    // The enrichment read runs after commit; inside the transaction the new
    // employee row is not yet visible to a separate query.
    const teacher = await sequelize.transaction(async (transaction) => {

        const user = await User.create({
            email,
            password_hash: await bcrypt.hash(password, 10),
            role_id: ROLES.TEACHER,
            phone: phone || null,
            is_active: true,
            // See provisioningService.createLogin: there is no verification
            // flow in this system and nothing ever cleared a 0, so a teacher
            // created here was flagged "Email unverified" for good.
            email_verified: true,
            failed_login_attempts: 0,
            is_deleted: false
        }, { transaction });

        const [employee] = await sequelize.query(
            `INSERT INTO employees
                (user_id, employee_code, first_name, last_name, department_id,
                 designation, basic_salary, hire_date, employment_status, is_deleted)
             VALUES
                (:user_id, :employee_code, :first_name, :last_name, :department_id,
                 :designation, :basic_salary, :hire_date, :employment_status, 0)`,
            {
                type: sequelize.QueryTypes.INSERT,
                transaction,
                replacements: {
                    user_id: user.user_id,
                    employee_code: employee_code || await nextEmployeeCode(transaction),
                    first_name,
                    last_name,
                    department_id,
                    designation: designation || null,
                    // NOT NULL columns with no sensible default from this screen.
                    basic_salary: basic_salary ?? 0,
                    hire_date: hire_date || new Date().toISOString().slice(0, 10),
                    employment_status: employment_status || "Active"
                }
            }
        );

        return await Teacher.create({
            employee_id: employee,
            specialization: specialization || null,
            is_deleted: false
        }, { transaction });
    });

    return await attachEmployeeDetails(teacher);
};

// Update teacher
const updateTeacher = async (id, teacherData) => {

    const teacher = await Teacher.findByPk(id);

    if (!teacher || teacher.is_deleted) {
        return null;
    }

    if (teacherData.employee_id) {

        const existingTeacher = await Teacher.findOne({
            where: {
                employee_id: teacherData.employee_id
            }
        });

        if (
            existingTeacher &&
            existingTeacher.teacher_id != id
        ) {
            const conflict = new Error("Employee already assigned as teacher");
            conflict.statusCode = 409;
            throw conflict;
        }
    }

    // Fields belonging to the employees table are written there, not onto the
    // teachers row, so editing a name or department actually persists.
    const EMPLOYEE_FIELDS = [
        "first_name",
        "last_name",
        "department_id",
        "designation",
        "basic_salary",
        "hire_date",
        "employment_status"
    ];

    const employeeUpdates = EMPLOYEE_FIELDS
        .filter((field) => teacherData[field] !== undefined);

    const teacherUpdates = {};
    if (teacherData.specialization !== undefined) {
        teacherUpdates.specialization = teacherData.specialization;
    }
    if (teacherData.employee_id !== undefined) {
        teacherUpdates.employee_id = teacherData.employee_id;
    }

    await sequelize.transaction(async (transaction) => {

        if (Object.keys(teacherUpdates).length) {
            await teacher.update(teacherUpdates, { transaction });
        }

        if (employeeUpdates.length && teacher.employee_id) {
            const setClause = employeeUpdates
                .map((field) => `\`${field}\` = :${field}`)
                .join(", ");

            const replacements = { employee_id: teacher.employee_id };
            for (const field of employeeUpdates) {
                replacements[field] = teacherData[field];
            }

            await sequelize.query(
                `UPDATE employees SET ${setClause} WHERE employee_id = :employee_id`,
                { transaction, replacements }
            );
        }
    });

    return await attachEmployeeDetails(teacher);
};

/*
 * Removing a teacher.
 *
 * WHAT THIS USED TO DO, AND WHY THAT WAS NOT A DELETE
 * --------------------------------------------------
 * It flipped `teachers.is_deleted` and stopped. Two things survived:
 *
 *   1. The `users` row was untouched, so a "deleted" teacher could still sign
 *      in to the faculty portal — see their classes, their students and their
 *      marks entry screens — because nothing in the login path reads
 *      teachers.is_deleted. Hidden from the directory is not removed.
 *   2. Their `timetables` rows still pointed at them. `timetables.teacher_id`
 *      is NOT NULL, so those slots cannot be orphaned by the database; they
 *      simply went on naming a teacher no screen could find, and the sections
 *      sitting in those classes had nobody in front of them.
 *
 * So the delete now does three things together, and refuses rather than doing
 * two of them: the timetable is checked FIRST, and if the teacher still holds
 * slots nothing is written at all. The count is in the message because
 * "reassign their classes" is not actionable without knowing how many there
 * are — the same reason academicStructureService.refuseIfReferenced names every
 * blocker at once.
 *
 * Teaching assignments (`teacher_assignments`, `teacher_subjects`) deliberately
 * do NOT block. They are the record of what this person was given to teach,
 * which stays true of someone who has left, and blocking on them would make
 * every teacher in this database undeletable while telling the admin to undo
 * history. The timetable is different: it is the live weekly schedule, and a
 * slot in it is a class that is going to happen.
 */
const deleteTeacher = async (id) => {
    const teacher = await Teacher.findByPk(id);

    // An already soft-deleted teacher is treated as absent so a repeat
    // delete returns 404 instead of reporting success a second time.
    if (!teacher || teacher.is_deleted) {
        return null;
    }

    const [{ slots }] = await sequelize.query(
        "SELECT COUNT(*) AS slots FROM timetables WHERE teacher_id = :id",
        { type: sequelize.QueryTypes.SELECT, replacements: { id: teacher.teacher_id } }
    );

    const held = Number(slots || 0);

    if (held > 0) {
        const blocker = `${held} timetable slot${held === 1 ? "" : "s"}`;

        const error = fail(
            `This teacher still holds ${blocker}. Reassign or remove those classes `
            + "before deleting them.",
            409
        );
        // Rendered verbatim by the admin screens; see apiError.sendError.
        error.blockedBy = [blocker];

        throw error;
    }

    /*
     * The teacher row and the login, together. Either both are gone or neither
     * is — a committed teachers row beside a live users row is the exact state
     * this function existed to stop producing.
     *
     * `employees` is left alone on purpose. It is the HR record of somebody who
     * worked here, it is what payroll and the department headcount read, and
     * ending a teaching role is not the same act as ending an employment. An
     * admin who means the second one sets employment_status on the staff screen.
     */
    await sequelize.transaction(async (transaction) => {
        await teacher.update({ is_deleted: true }, { transaction });

        await sequelize.query(
            `UPDATE users u
               JOIN employees e ON e.user_id = u.user_id
                SET u.is_active = 0, u.is_deleted = 1, u.updated_at = NOW()
              WHERE e.employee_id = :employeeId`,
            { replacements: { employeeId: teacher.employee_id }, transaction }
        );
    });

    return teacher;
};

module.exports = {
    getAllTeachers,
    getTeacherById,
    createTeacher,
    updateTeacher,
    deleteTeacher
};