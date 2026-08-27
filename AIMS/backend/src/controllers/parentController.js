const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const { rejectIfInvalid } = require("../utils/apiError");

const User = require("../models/user.model");
const Parent = require("../models/parent.model");
const Student = require("../models/student.model");
const StudentGuardian = require("../models/studentGuardian.model");
const Attendance = require("../models/attendance.model");
// The consolidated fee module. The five tables these endpoints used to read
// (student_fees, challans, payments, receipts and the vw_student_fee_status
// view) were merged into these two; see
// migrations/20260808090000-consolidate-fee-module.js.
const feeService = require("../services/feeService");
const { sequelize } = require("../database/connection");
const Result = require("../models/result.model");
const Notification = require("../models/notification.model");
// One sign-in policy for all four portals; see the note in parentLogin below.
const loginSecurity = require("../services/loginSecurity");

/**
 * Every student id linked to a parent.
 *
 * The per-child endpoints below each resolved the family with
 * `StudentGuardian.findOne`, which returns whichever single link the database
 * happened to hand back first. A parent with two or more children therefore
 * received the first child's attendance, fees, challans, receipts, timetable
 * and results for the whole account, and nothing at all for the others - the
 * portal indexes these responses by student_id, so selecting a second child
 * showed empty cards for records that exist.
 *
 * Returning the full id list makes the responses cover every ward. The parent
 * is still resolved from the JWT by each caller, so the scope is unchanged:
 * this only widens a family to all of its own children.
 */
const resolveWardIds = async (parentId) => {

    const links = await StudentGuardian.findAll({
        where: { parent_id: parentId },
        attributes: ["student_id"]
    });

    return links.map((link) => link.student_id);
};

const parentLogin = async (req, res) => {

    try {

        if (rejectIfInvalid(req, res)) return;

        const { email, password } = req.body;

        const user = await User.findOne({

            where: {

                email,
                is_deleted: false

            }

        });

        /*
         * THE SAME FAILURE, WORD FOR WORD, AS /api/auth/login.
         *
         * This endpoint used to answer with its own wording ("Invalid email or
         * password", lower-cased where the other portal capitalised it) and
         * with a distinct 403 "Parent account not found" when a teacher or
         * student typed correct credentials here. Both were fingerprints: the
         * casing said which endpoint had been reached, and the 403 confirmed
         * the password was right and only the portal was wrong.
         *
         * Every rejection below now goes through the shared policy in
         * services/loginSecurity, which also owns the attempt counter and the
         * lock - so a parent account locks on the same five failures as
         * everyone else's, and the countdown reads the same.
         */
        const fail = async (row) => {

            const failure = await loginSecurity.recordFailure({
                user: row,
                email,
                req
            });

            return res.status(failure.status).json({
                success: false,
                message: failure.message
            });

        };

        if (!user) {

            await loginSecurity.equaliseTiming();

            return fail(null);

        }

        if (loginSecurity.isLocked(user)) {

            const locked = loginSecurity.lockedResponse();

            return res.status(locked.status).json({
                success: false,
                message: locked.message
            });

        }

        const isMatch = user.is_active && await bcrypt.compare(

            password,
            user.password_hash

        );

        if (!isMatch) {

            if (!user.is_active) await loginSecurity.equaliseTiming();

            return fail(user);

        }

        const parent = await Parent.findOne({

            where: {

                user_id: user.user_id,
                is_deleted: false

            }

        });

        // A valid account that is not a parent, and a parent whose record was
        // removed, are the same thing from out here: a sign-in that cannot
        // succeed on this portal. Counted and answered like any other failure.
        if (!parent) {

            return fail(user);

        }

        // Clears the counter, any lock, and stamps last_login.
        await loginSecurity.recordSuccess(user);

        // role_id is signed in alongside parent_id. Without it the token was
        // indistinguishable from any other account to authorize(), so no parent
        // route could ever use a role check - they all had to settle for bare
        // authenticate(). It is taken from the users row rather than hardcoded
        // to ROLES.PARENT, so an account that also holds another role keeps it.
        const token = jwt.sign(

            {

                user_id: user.user_id,
                role_id: user.role_id,
                parent_id: parent.parent_id

            },

            process.env.JWT_ACCESS_SECRET,

            {

                expiresIn: process.env.ACCESS_TOKEN_EXPIRES

            }

        );

        return res.status(200).json({

            success: true,
            message: "Parent login successful",

            token,

            parent,

            /*
             * The same flag POST /api/auth/login returns for every other role.
             *
             * A parent's login is provisioned exactly like a student's — the
             * admission flow creates both accounts and shows both generated
             * passwords to the admin (see provisioningService.admitStudent) —
             * so a parent is holding an admin-issued password just as often.
             *
             * Without it in this response the parent portal had no way to know,
             * ProtectedRoute never sent them to /change-password, and the
             * account sat flagged "Must change password" in User Management
             * forever because nothing ever cleared it. The change-password
             * endpoint itself was never the problem: PUT /api/auth/change-password
             * is role-independent and clears the flag for any token. The parent
             * was simply never taken there.
             *
             * Sent at the top level rather than inside `parent`, because it is a
             * fact about the users row, not about the parents row.
             */
            must_change_password: !!user.must_change_password

        });

    }

    catch (error) {

        return res.status(500).json({

            success: false,
            message: error.message

        });

    }

};
const getParentProfile = async (req, res) => {

    try {

        const parent = await Parent.findOne({

            where: {

                user_id: req.user.user_id,
                is_deleted: false

            }

        });

        if (!parent) {

            return res.status(404).json({

                success: false,
                message: "Parent not found"

            });

        }

        res.status(200).json({

            success: true,
            parent

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,
            message: "Internal Server Error"

        });

    }

};
const getChildProfile = async (req, res) => {

    try {

        const parent = await Parent.findOne({
            where: {
                user_id: req.user.user_id,
                is_deleted: false
            }
        });

        if (!parent) {
            return res.status(404).json({
                success: false,
                message: "Parent not found"
            });
        }

        // The attribute list used to stop at academic_status, so the parent
        // portal received no phone, no date of birth, no gender and - most
        // visibly - no current_semester_id. The dashboard reads all four: it
        // rendered an empty contact row and a dash wherever it prints the
        // child's semester, because the columns were never sent, not because
        // the student record lacks them.
        //
        // The login account is joined in for the child's email address, which
        // lives on `users` and not on `students`. The portal previously
        // hardcoded an em dash there for want of any source.
        const children = await StudentGuardian.findAll({

            where: {
                parent_id: parent.parent_id
            },

            include: [
                {
                    model: Student,
                    attributes: [
                        "student_id",
                        // The child's login id. Needed for one thing only: the
                        // portal builds /api/users/:id/avatar from it, which is
                        // how a parent sees their child's actual photograph
                        // instead of two grey letters. Without it the parent
                        // portal had no way to address the picture at all, so
                        // an uploaded portrait was visible on the student's own
                        // profile and nowhere else.
                        "user_id",
                        "registration_number",
                        "first_name",
                        "last_name",
                        "phone",
                        "dob",
                        "gender",
                        "address",
                        "program_id",
                        "batch_id",
                        "section_id",
                        "current_semester_id",
                        "academic_status"
                    ],
                    include: [
                        {
                            model: User,
                            as: "account",
                            // The address, and a flag saying whether a picture
                            // exists — the SIZE, never the bytes. It saves the
                            // portal a request per child that would 404, and it
                            // is not information a parent could not already see
                            // by looking at the avatar.
                            attributes: [
                                "user_id",
                                "email",
                                /*
                                 * BOTH storage locations, because there are two.
                                 *
                                 * `profile_picture_size` is set only for
                                 * pictures uploaded since media moved into the
                                 * database. `profile_picture` is the legacy path
                                 * for everything uploaded before that, which in
                                 * this database is 1,100 of the 2,006 student
                                 * accounts — every one of them a real file that
                                 * the avatar route serves perfectly well.
                                 *
                                 * Reading only the size column, as this first
                                 * did, told the portal "no picture" for all
                                 * 1,100 of them and it drew initials instead.
                                 */
                                "profile_picture",
                                "profile_picture_size",
                                "profile_picture_updated_at"
                            ],
                            required: false
                        }
                    ]
                }
            ]
        });

        return res.status(200).json({
            success: true,
            total_children: children.length,
            children
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });

    }

};
/*
 * Every fee voucher belonging to this parent's children, with the instalments
 * recorded against each.
 *
 * This one handler replaces three — getFeeStatus, getChallan and getReceipt —
 * which read `vw_student_fee_status`, `challans` and `payments`/`receipts`
 * respectively. Those were three views of two unlinked billing record sets, so
 * the portal received three partial answers and had to reconcile them on the
 * client. A payment recorded against a challan was missing from the fee-status
 * response entirely, which is why a part-settled voucher was shown to parents
 * as wholly unpaid.
 *
 * There is one billing table now, so there is one endpoint.
 */
const getFees = async (req, res) => {

    try {

        const parent = await Parent.findOne({
            where: {
                user_id: req.user.user_id,
                is_deleted: false
            }
        });

        if (!parent) {
            return res.status(404).json({
                success: false,
                message: "Parent not found"
            });
        }

        const wardIds = await resolveWardIds(parent.parent_id);

        if (!wardIds.length) {
            return res.status(404).json({
                success: false,
                message: "No children linked to this parent"
            });
        }

        // One settled position per child, from the same service the student
        // portal reads through /api/fee-vouchers/me. Neither side re-derives
        // the arithmetic, so neither can disagree with the other.
        const positions = {};

        for (const studentId of wardIds) {
            positions[studentId] = await feeService.getStudentPosition(studentId);
        }

        return res.status(200).json({
            success: true,
            total_children: wardIds.length,
            positions
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });

    }

};
const getTimetable = async (req, res) => {

    try {

        const parent = await Parent.findOne({
            where: {
                user_id: req.user.user_id,
                is_deleted: false
            }
        });

        if (!parent) {
            return res.status(404).json({
                success: false,
                message: "Parent not found"
            });
        }

        const wardIds = await resolveWardIds(parent.parent_id);

        if (!wardIds.length) {
            return res.status(404).json({
                success: false,
                message: "No children linked to this parent"
            });
        }

        /*
         * Every ward's own classes, from their enrolments.
         *
         * This used to return raw `timetables` rows for each ward's *section*.
         * Two problems: a section's grid includes subjects the child is not
         * enrolled in, and the raw rows carry only foreign keys — so the room
         * arrived as a `classroom_id` and the teacher could not be named at
         * all. `course_offerings` answers both: it is the join that says which
         * class a child is actually in, and who teaches it.
         *
         * `student_id` is returned on every row so the portal can still narrow
         * to the selected child; it used to do that by `section_id`, which
         * collapsed two children who happened to share a section.
         */
        const [timetable] = await sequelize.query(
            `SELECT e.student_id,
                    t.timetable_id,
                    o.offering_id,
                    o.section_id,
                    sec.section_name,
                    o.subject_id,
                    sub.subject_code,
                    sub.subject_name,
                    o.teacher_id,
                    CONCAT_WS(' ', emp.first_name, emp.last_name) AS teacher_name,
                    t.classroom_id,
                    room.room_name,
                    room.building,
                    t.day_of_week,
                    t.start_time,
                    t.end_time
               FROM enrollments e
               JOIN course_offerings o ON o.offering_id = e.offering_id
                                      AND o.is_deleted = 0
                                      AND o.status <> 'Cancelled'
               JOIN timetables t  ON t.offering_id = o.offering_id
               JOIN subjects   sub ON sub.subject_id = o.subject_id
          LEFT JOIN sections   sec ON sec.section_id = o.section_id
          LEFT JOIN teachers   tch ON tch.teacher_id = o.teacher_id
          LEFT JOIN employees  emp ON emp.employee_id = tch.employee_id
          LEFT JOIN classrooms room ON room.classroom_id = t.classroom_id
              WHERE e.student_id IN (:wardIds)
                AND e.status = 'Active'
              ORDER BY e.student_id,
                       FIELD(t.day_of_week, 'Monday','Tuesday','Wednesday',
                             'Thursday','Friday','Saturday'),
                       t.start_time`,
            { replacements: { wardIds } }
        );

        return res.status(200).json({

            success: true,
            total_classes: timetable.length,
            timetable

        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({

            success: false,
            message: "Internal Server Error"

        });

    }

};
const getResults = async (req, res) => {

    try {

        const parent = await Parent.findOne({
            where: {
                user_id: req.user.user_id,
                is_deleted: false
            }
        });

        if (!parent) {
            return res.status(404).json({
                success: false,
                message: "Parent not found"
            });
        }

        const wardIds = await resolveWardIds(parent.parent_id);

        if (!wardIds.length) {
            return res.status(404).json({
                success: false,
                message: "No children linked to this parent"
            });
        }

        const results = await Result.findAll({

            where: {
                student_id: wardIds
            },

            order: [
                ["semester_id", "ASC"]
            ]

        });

        return res.status(200).json({

            success: true,
            total_results: results.length,
            results

        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({

            success: false,
            message: "Internal Server Error"

        });

    }

};
const getGpaCgpa = async (req, res) => {

    try {

        const parent = await Parent.findOne({
            where: {
                user_id: req.user.user_id,
                is_deleted: false
            }
        });

        if (!parent) {
            return res.status(404).json({
                success: false,
                message: "Parent not found"
            });
        }

        const wardIds = await resolveWardIds(parent.parent_id);

        if (!wardIds.length) {
            return res.status(404).json({
                success: false,
                message: "No children linked to this parent"
            });
        }

        const result = await Result.findOne({

            where: {
                student_id: wardIds
            },

            order: [
                ["semester_id", "DESC"]
            ],

            attributes: [
                "semester_id",
                "gpa",
                "cgpa",
                "status"
            ]

        });

        if (!result) {
            return res.status(404).json({
                success: false,
                message: "No GPA/CGPA found"
            });
        }

        return res.status(200).json({

            success: true,
            result

        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({

            success: false,
            message: "Internal Server Error"

        });

    }

};
const getNotifications = async (req, res) => {

    try {

        const notifications = await Notification.findAll({

            where: {
                user_id: req.user.user_id
            },

            order: [
                ["created_at", "DESC"]
            ]

        });

        return res.status(200).json({

            success: true,
            total_notifications: notifications.length,
            notifications

        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({

            success: false,
            message: "Internal Server Error"

        });

    }

};
const getChildAttendance = async (req, res) => {

    try {

        const parent = await Parent.findOne({
            where: {
                user_id: req.user.user_id,
                is_deleted: false
            }
        });

        if (!parent) {
            return res.status(404).json({
                success: false,
                message: "Parent not found"
            });
        }

        const wardIds = await resolveWardIds(parent.parent_id);

        if (!wardIds.length) {
            return res.status(404).json({
                success: false,
                message: "No children linked to this parent"
            });
        }

        /*
         * The PERIOD, joined in, for the same reason as the student endpoint.
         *
         * This returned bare `attendance` rows: a date, a subject and a status.
         * A class can meet more than once on the same day — CS-101 CS-A meets
         * at 08:30 AND 10:00 on Mondays — so a parent reading their child's
         * record saw two rows for one Monday, same course, one Present and one
         * Absent, with nothing to say which lecture was which.
         *
         * Raw SQL rather than an include: no Attendance -> Timetable
         * association is declared in the models, and adding one would change
         * the shape of every other query that includes Attendance. The
         * timetable columns are lifted to the top level, so the shape this
         * returned before is a strict subset of what it returns now and
         * nothing reading `att_date` or `status` needs to change.
         */
        const attendance = await sequelize.query(
            `SELECT a.attendance_id,
                    a.student_id,
                    a.subject_id,
                    a.timetable_id,
                    a.att_date,
                    a.status,
                    a.marked_by,
                    t.day_of_week,
                    t.start_time,
                    t.end_time,
                    cr.room_name
               FROM attendance a
          LEFT JOIN timetables t ON t.timetable_id = a.timetable_id
          LEFT JOIN classrooms cr ON cr.classroom_id = t.classroom_id
              WHERE a.student_id IN (:wardIds)
              ORDER BY a.att_date DESC, t.start_time ASC`,
            { type: sequelize.QueryTypes.SELECT, replacements: { wardIds } }
        );

        return res.status(200).json({

            success: true,

            total_records: attendance.length,

            attendance

        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({

            success: false,
            message: "Internal Server Error"

        });

    }

};
// ================= LIST PARENTS (ADMIN) =================
//
// Every other /api/parent route is parent-self, so an admin had no way to see
// who the parents are. This lists them with their linked children, which is
// what the admin Parents screen needs.

const listParents = async (req, res) => {

    try {

        const { first_name, last_name, phone, page, limit } = req.query;

        const where = { is_deleted: false };

        if (first_name) where.first_name = { [Op.like]: `%${first_name}%` };
        if (last_name) where.last_name = { [Op.like]: `%${last_name}%` };
        if (phone) where.phone = { [Op.like]: `%${phone}%` };

        const query = {
            where,
            order: [["parent_id", "ASC"]]
        };

        const pageNum = Number.parseInt(page, 10);
        const limitNum = Number.parseInt(limit, 10);
        const paginated = Number.isInteger(limitNum) && limitNum > 0;

        if (paginated) {
            query.limit = limitNum;
            query.offset = Number.isInteger(pageNum) && pageNum > 1
                ? (pageNum - 1) * limitNum
                : 0;
        }

        const { count: total, rows } = await Parent.findAndCountAll(query);

        const parentIds = rows.map((p) => p.parent_id);

        // Children for just this page of parents, in two queries rather than
        // one per parent.
        let childrenByParent = new Map();

        if (parentIds.length > 0) {

            const links = await StudentGuardian.findAll({
                where: { parent_id: parentIds }
            });

            const studentIds = [...new Set(links.map((l) => l.student_id))];

            const students = studentIds.length
                ? await Student.findAll({
                    where: { student_id: studentIds, is_deleted: false },
                    attributes: [
                        "student_id",
                        "first_name",
                        "last_name",
                        "registration_number"
                    ]
                })
                : [];

            const studentById = new Map(
                students.map((s) => [s.student_id, s.get({ plain: true })])
            );

            childrenByParent = links.reduce((acc, link) => {
                const student = studentById.get(link.student_id);
                if (!student) return acc;

                const list = acc.get(link.parent_id) || [];
                list.push({
                    student_id: student.student_id,
                    name: [student.first_name, student.last_name]
                        .filter(Boolean).join(" "),
                    registration_number: student.registration_number,
                    relationship: link.relationship
                });
                acc.set(link.parent_id, list);
                return acc;
            }, new Map());
        }

        // Emails live on users, so resolve them for this page in one query.
        const userIds = rows.map((p) => p.user_id).filter(Boolean);

        const users = userIds.length
            ? await User.findAll({
                where: { user_id: userIds },
                attributes: ["user_id", "email"]
            })
            : [];

        const emailByUserId = new Map(users.map((u) => [u.user_id, u.email]));

        const data = rows.map((p) => {
            const plain = p.get({ plain: true });
            const children = childrenByParent.get(plain.parent_id) || [];

            return {
                ...plain,
                full_name: [plain.first_name, plain.last_name]
                    .filter(Boolean).join(" "),
                email: emailByUserId.get(plain.user_id) || null,
                children,
                children_count: children.length
            };
        });

        return res.status(200).json({
            success: true,
            count: data.length,
            total,
            page: paginated ? (Number.isInteger(pageNum) && pageNum > 0 ? pageNum : 1) : undefined,
            limit: paginated ? limitNum : undefined,
            data
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to list parents"
        });

    }

};

const registerParent = async (req, res) => {
    try {
        const { student_id, email, password, first_name, last_name, phone } = req.body;
        const existing = await User.findOne({ where: { email } });
        if (existing) {
            return res.status(409).json({ success: false, message: 'Email already in use' });
        }
        const { sequelize } = require('../database/connection');
        const result = await sequelize.transaction(async (t) => {
            const password_hash = await bcrypt.hash(password, 10);
            const user = await User.create({
                email,
                password_hash,
                role_id: 5,
                phone: phone || null,
                is_active: true,
                email_verified: true
            }, { transaction: t });
            const parent = await Parent.create({
                user_id: user.user_id,
                first_name,
                last_name,
                phone: phone || null
            }, { transaction: t });
            await StudentGuardian.create({
                student_id,
                parent_id: parent.parent_id,
                relationship: 'Father'
            }, { transaction: t });
            return parent;
        });
        return res.status(201).json({ success: true, parent: result });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ success: false, message: e.message });
    }
};

module.exports = {
    registerParent,
    parentLogin,
    listParents,
    getParentProfile,
    getChildProfile,
    getChildAttendance,
    getFees,
    getTimetable,
    getResults,
    getGpaCgpa,
    getNotifications
};
