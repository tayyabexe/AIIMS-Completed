const { validationResult } = require("express-validator");
const { Op } = require("sequelize");

const Student = require("../models/student.model");
const StudentDocument = require("../models/studentDocument.model");
const StudentGuardian = require("../models/studentGuardian.model");
const Enrollment = require("../models/enrollment.model");
const Semester = require("../models/semester.model");
const Program = require("../models/program.model");
const Batch = require("../models/batch.model");
const Section = require("../models/section.model");
const Parent = require("../models/parent.model");
const User = require("../models/user.model");
const audit = require("../services/auditService");
const notify = require("../services/notificationService");
const mediaService = require("../services/mediaService");

// The login account is joined onto student reads so the portal can show the
// student's email and phone, which live on users rather than students.
// password_hash and the lockout columns are deliberately excluded.
const ACCOUNT_INCLUDE = {
    model: User,
    as: "account",
    // profile_picture_size is selected purely as a "does this account have an
    // avatar" flag. Since media moved into the database the path column is
    // NULL for new uploads, so it can no longer answer that on its own — and
    // the bytes themselves must never be selected here (see the defaultScope
    // on the user model; this include runs on every student list).
    attributes: [
        "user_id", "email", "phone", "profile_picture", "profile_picture_size",
        "is_active", "last_login"
    ],
    required: false
};

// The student's placement, resolved from their own foreign keys.
//
// The portal used to fetch GET /api/batches and GET /api/sections in full and
// match on batch_id / section_id in the browser. Those list endpoints filter on
// is_deleted, so a student assigned to a batch or section that has since been
// soft-deleted matched nothing and saw a dash for both - even though the
// assignment on their record is real and is what the registrar placed them in.
// Resolving here through the association means the name comes from the row the
// student is actually attached to, and no client has to download every batch
// and section in the institute to label one record.
const PLACEMENT_INCLUDES = [
    {
        model: Program,
        attributes: ["program_id", "program_name", "department_id"],
        required: false
    },
    {
        model: Batch,
        attributes: ["batch_id", "batch_name", "start_year", "end_year"],
        required: false
    },
    {
        model: Section,
        attributes: ["section_id", "section_name"],
        required: false
    }
];

// Lifts the joined account's email/phone onto the student object so callers see
// a flat record. The student's own phone column wins when it is populated.
// The placement names are lifted the same way when PLACEMENT_INCLUDES was used;
// a read that did not join them simply leaves them null.
const withAccount = (student) => {

    const plain = student.toJSON ? student.toJSON() : student;
    const account = plain.account || null;

    return {
        ...plain,
        email: account ? account.email : null,
        phone: plain.phone || (account ? account.phone : null),
        program_name: plain.Program ? plain.Program.program_name : null,
        batch_name: plain.Batch ? plain.Batch.batch_name : null,
        section_name: plain.Section ? plain.Section.section_name : null
    };

};

// ================= GET ALL STUDENTS =================

const getStudents = async (req, res) => {

    try {

        const {
            program_id,
            batch_id,
            section_id,
            current_semester_id,
            academic_status,
            gender,
            first_name,
            last_name,
            registration_number,
            page,
            limit
        } = req.query;

        const where = {
            is_deleted: false
        };

        // Exact-match filters
        if (program_id) where.program_id = program_id;
        if (batch_id) where.batch_id = batch_id;
        if (section_id) where.section_id = section_id;
        if (current_semester_id) where.current_semester_id = current_semester_id;
        if (academic_status) where.academic_status = academic_status;
        if (gender) where.gender = gender;

        // Partial-match filters
        if (first_name) where.first_name = { [Op.like]: `%${first_name}%` };
        if (last_name) where.last_name = { [Op.like]: `%${last_name}%` };
        if (registration_number) {
            where.registration_number = { [Op.like]: `%${registration_number}%` };
        }

        // Pagination is applied only when the caller asks for it, so existing
        // clients that expect the full list keep working.
        const query = {
            where,
            order: [["first_name", "ASC"]]
        };

        const pageNum = Number.parseInt(page, 10);
        const limitNum = Number.parseInt(limit, 10);

        if (Number.isInteger(limitNum) && limitNum > 0) {
            query.limit = limitNum;
            query.offset = Number.isInteger(pageNum) && pageNum > 1
                ? (pageNum - 1) * limitNum
                : 0;
        }

        const { count: total, rows: students } = await Student.findAndCountAll(query);

        return res.status(200).json({
            success: true,
            count: students.length,
            total,
            page: query.limit ? (Number.isInteger(pageNum) && pageNum > 0 ? pageNum : 1) : undefined,
            limit: query.limit,
            students
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }

};

// ================= REGISTER STUDENT =================

const registerStudent = async (req, res) => {

    try {

        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const {
            user_id,
            registration_number,
            first_name,
            last_name,
            cnic_bform,
            phone,
            dob,
            program_id,
            batch_id,
            section_id,
            current_semester_id,
            academic_status
        } = req.body;

        const existingStudent = await Student.findOne({
            where: { registration_number }
        });

        if (existingStudent) {
            return res.status(409).json({
                success: false,
                message: "Registration Number already exists."
            });
        }

        const existingCNIC = await Student.findOne({
            where: { cnic_bform }
        });

        if (existingCNIC) {
            return res.status(409).json({
                success: false,
                message: "CNIC/B-Form already exists."
            });
        }

        const program = await Program.findByPk(program_id);

        if (!program) {
            return res.status(404).json({
                success: false,
                message: "Invalid Program."
            });
        }

        const batch = await Batch.findByPk(batch_id);

        if (!batch) {
            return res.status(404).json({
                success: false,
                message: "Invalid Batch."
            });
        }

        if (current_semester_id) {

            const semester = await Semester.findByPk(current_semester_id);

            if (!semester) {

                return res.status(404).json({

                    success: false,
                    message: "Invalid current semester."

                });

            }

        }

        const student = await Student.create({
            user_id,
            registration_number,
            first_name,
            last_name,
            cnic_bform,
            phone,
            dob,
            program_id,
            batch_id,
            section_id,
            current_semester_id,
            academic_status
        });

        return res.status(201).json({
            success: true,
            message: "Student Registered Successfully",
            student
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }

};

// ================= GET STUDENT PROFILE =================

const getStudentProfile = async (req, res) => {

    try {

        const { id } = req.params;

        const student = await Student.findOne({
            where: {
                student_id: id,
                is_deleted: false
            },
            include: [ACCOUNT_INCLUDE, ...PLACEMENT_INCLUDES]
        });

        if (!student) {
            return res.status(404).json({
                success: false,
                message: "Student not found."
            });
        }

        return res.status(200).json({
            success: true,
            student: withAccount(student)
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }

};

// ================= UPDATE STUDENT =================

/*
 * The six values students.academic_status allows. Checked here so a bad value
 * is a 400 naming the field rather than a 500 from the database, and so the
 * portal's status actions cannot invent a seventh.
 */
const ACADEMIC_STATUSES = [
    "Active", "Pending Verification", "Suspended",
    "Withdrawn", "Graduated", "Alumni"
];

/*
 * Only these columns may be set through this route.
 *
 * An explicit list rather than passing req.body through: `students` also holds
 * registration_number, user_id, cnic_bform and is_deleted, and a spread would
 * have let the Students screen renumber a student or detach their login by
 * sending one extra key.
 */
const ADMIN_EDITABLE = [
    "first_name", "last_name", "phone", "dob", "gender",
    "address", "nationality", "blood_group",
    "program_id", "batch_id", "section_id",
    "current_semester_id", "academic_status"
];

// The subset of a student worth keeping in an audit entry — enough to say what
// changed and who it was about, without copying the whole row twice per edit.
const studentSnapshot = (student) => ({
    studentId: student.student_id,
    registrationNumber: student.registration_number,
    studentName: [student.first_name, student.last_name].filter(Boolean).join(" "),
    phone: student.phone,
    dob: student.dob,
    gender: student.gender,
    programId: student.program_id,
    batchId: student.batch_id,
    sectionId: student.section_id,
    currentSemesterId: student.current_semester_id,
    academicStatus: student.academic_status
});

const updateStudent = async (req, res) => {

    try {

        const { id } = req.params;

        const student = await Student.findByPk(id);

        if (!student || student.is_deleted) {
            return res.status(404).json({
                success: false,
                message: "Student not found."
            });
        }

        /*
         * Only keys the caller actually sent are applied. The old version
         * destructured a fixed list and passed every one of them, so a form
         * that submitted just a phone number sent `section_id: undefined`
         * alongside it — and any field the screen did not render was liable to
         * be cleared by an edit that never mentioned it.
         */
        const changes = {};

        for (const field of ADMIN_EDITABLE) {
            if (Object.prototype.hasOwnProperty.call(req.body, field)) {
                changes[field] = req.body[field];
            }
        }

        if (!Object.keys(changes).length) {
            return res.status(400).json({
                success: false,
                message: "No editable fields were supplied."
            });
        }

        if (changes.academic_status !== undefined
            && !ACADEMIC_STATUSES.includes(changes.academic_status)) {
            return res.status(400).json({
                success: false,
                message: `academic_status must be one of: ${ACADEMIC_STATUSES.join(", ")}`
            });
        }

        if (changes.gender !== undefined && changes.gender !== null && changes.gender !== ""
            && !STUDENT_GENDERS.includes(changes.gender)) {
            return res.status(400).json({
                success: false,
                message: `gender must be one of: ${STUDENT_GENDERS.join(", ")}`
            });
        }

        if (changes.blood_group !== undefined && changes.blood_group !== null
            && changes.blood_group !== "" && !BLOOD_GROUPS.includes(changes.blood_group)) {
            return res.status(400).json({
                success: false,
                message: `blood_group must be one of: ${BLOOD_GROUPS.join(", ")}`
            });
        }

        // An empty date clears it; a malformed one would be coerced to NULL by
        // the DATE column and silently wipe a correct date of birth.
        if (changes.dob !== undefined && changes.dob !== null && changes.dob !== ""
            && !isValidDateOnly(changes.dob)) {
            return res.status(400).json({
                success: false,
                message: "dob must be a real date in YYYY-MM-DD form"
            });
        }

        if (changes.address !== undefined && changes.address !== null
            && String(changes.address).length > MAX_ADDRESS) {
            return res.status(400).json({
                success: false,
                message: `address must be ${MAX_ADDRESS} characters or fewer`
            });
        }

        if (changes.nationality !== undefined && changes.nationality !== null
            && String(changes.nationality).length > MAX_NATIONALITY) {
            return res.status(400).json({
                success: false,
                message: `nationality must be ${MAX_NATIONALITY} characters or fewer`
            });
        }

        const before = studentSnapshot(student);

        await student.update(changes);

        /*
         * Recorded with both snapshots. A student's programme, batch, section
         * and status decide which timetable, which fee structure and which
         * result set apply to them, so "who moved this student to another
         * programme" is a question that gets asked — and until now the row
         * could be changed without leaving any answer to it.
         */
        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.STUDENT_UPDATED,
            module: audit.MODULES.STUDENTS,
            entity: `students#${student.student_id}`,
            before,
            after: { ...studentSnapshot(student), fieldsChanged: Object.keys(changes) },
            req
        });

        return res.status(200).json({
            success: true,
            message: "Student Updated Successfully",
            student
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }

};

/*
 * ================= RESTORE STUDENT =================
 *
 * The counterpart to the soft delete below it, and the reason it exists: a
 * deleted student is only a flag on a row that still holds their attendance,
 * marks and fee history — but nothing in the API could clear that flag, so a
 * mistaken delete was permanent from the portal's point of view and could only
 * be undone by someone with database access.
 *
 * `academic_status` is deliberately NOT reset here. A student who was Suspended
 * when they were removed comes back Suspended; deciding what they should be now
 * is a separate act, done through the status action, and one that leaves its
 * own audit entry.
 */
const restoreStudent = async (req, res) => {

    try {

        const { id } = req.params;

        const student = await Student.findByPk(id);

        if (!student) {
            return res.status(404).json({
                success: false,
                message: "Student not found."
            });
        }

        if (!student.is_deleted) {
            return res.status(409).json({
                success: false,
                message: "That student is not deleted."
            });
        }

        student.is_deleted = false;

        await student.save();

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.STUDENT_RESTORED,
            module: audit.MODULES.STUDENTS,
            entity: `students#${student.student_id}`,
            before: { isDeleted: true },
            after: studentSnapshot(student),
            req
        });

        return res.status(200).json({
            success: true,
            message: "Student restored successfully.",
            student
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }

};

// ================= SOFT DELETE STUDENT =================

const deleteStudent = async (req, res) => {

    try {

        const { id } = req.params;

        const student = await Student.findByPk(id);

        if (!student) {
            return res.status(404).json({
                success: false,
                message: "Student not found."
            });
        }

        student.is_deleted = true;

        await student.save();

        /*
         * A soft delete removes a student from every screen in the portal while
         * their attendance, marks and fee history stay in the database. Someone
         * has to be answerable for that, so it is recorded with the record as it
         * stood — the row itself no longer says who hid it.
         */
        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.STUDENT_DELETED,
            module: audit.MODULES.STUDENTS,
            entity: `students#${student.student_id}`,
            before: {
                studentId: student.student_id,
                registrationNumber: student.registration_number,
                name: [student.first_name, student.last_name].filter(Boolean).join(" "),
                programId: student.program_id,
                batchId: student.batch_id,
                academicStatus: student.academic_status
            },
            after: { isDeleted: true },
            req
        });

        return res.status(200).json({
            success: true,
            message: "Student Deleted Successfully"
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }

};

// ================= ENROLL STUDENT =================

const enrollStudent = async (req, res) => {

    try {

        const { id } = req.params;

        const student = await Student.findOne({
            where: {
                student_id: id,
                is_deleted: false
            }
        });

        if (!student) {
            return res.status(404).json({
                success: false,
                message: "Student not found."
            });
        }

        const {
            subject_id,
            semester_id,
            enrollment_date,
            status
        } = req.body;

        const enrollment = await Enrollment.create({
            student_id: id,
            subject_id,
            semester_id,
            enrollment_date,
            status: status || "Active"
        });

        return res.status(201).json({
            success: true,
            message: "Student Enrolled Successfully",
            enrollment
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }

};

// ================= UPLOAD STUDENT DOCUMENT =================

const uploadStudentDocument = async (req, res) => {

    try {

        const { student_id, doc_type } = req.body;

        // Check if file exists
        if (!req.file) {

            return res.status(400).json({

                success: false,
                message: "No file uploaded."

            });

        }

        // Check if student exists
        const student = await Student.findOne({

            where: {
                student_id,
                is_deleted: false
            }

        });

        if (!student) {

            return res.status(404).json({

                success: false,
                message: "Student not found."

            });

        }

        /*
         * The file is stored IN the row now, not on disk — see
         * migrations/20260815090000-store-media-as-binary.js. `file_url` is
         * left NULL: it is the legacy disk path, and a document that has bytes
         * has no path. The download route checks the bytes first and only
         * falls back to a path for rows written before this change.
         *
         * The route middleware has already verified this really is a PDF or an
         * image by its signature, and `media.mime` is the DETECTED type rather
         * than the one the client claimed.
         */
        const media = mediaService.describeUpload(req.file);

        const document = await StudentDocument.create({

            student_id,
            doc_type,
            file_data: media.data,
            file_mime: media.mime,
            file_name: media.name,
            file_size: media.size,
            file_checksum: media.checksum,
            uploaded_at: new Date()

        });

        /*
         * A document travels in both directions, so it emits in both.
         *
         * The office needs to know a file is waiting to be checked, and the
         * student needs a receipt saying it arrived — the upload form gives them
         * a toast that is gone on the next navigation, and without this there is
         * nothing afterwards that says the institute has it.
         *
         * `actorUserId` suppresses whichever of the two performed the upload, so
         * a student uploading their own CNIC gets the office notice only and an
         * admin uploading on their behalf gets the student's copy only.
         */
        await notify.emit({
            audience: await notify.staffAudience(),
            type: notify.TYPES.DOCUMENT,
            subject: "documents",
            actorUserId: req.user?.user_id,
            title: "Document uploaded",
            message: `${doc_type} received for ${student.registration_number} `
                + "and is awaiting verification."
        });

        await notify.notifyStudent({
            studentId: student.student_id,
            includeGuardians: false,
            type: notify.TYPES.DOCUMENT,
            subject: "documents",
            actorUserId: req.user?.user_id,
            title: "Document received",
            ownMessage: `Your ${doc_type} has been received and is awaiting verification.`
        });

        return res.status(201).json({

            success: true,
            message: "Document Uploaded Successfully",

            /*
             * The created instance still holds the blob in memory, so it is
             * reshaped rather than returned — otherwise the response body
             * would carry the whole file back to a client that just sent it.
             */
            document: {
                doc_id: document.doc_id,
                student_id: document.student_id,
                doc_type: document.doc_type,
                file_name: document.file_name,
                file_mime: document.file_mime,
                file_size: document.file_size,
                uploaded_at: document.uploaded_at,
                file_url: `/api/students/documents/${document.doc_id}/file`
            }

        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({

            success: false,
            message: "Internal Server Error"

        });

    }

};

// ================= DOWNLOAD STUDENT DOCUMENT =================

/*
 * GET /api/students/documents/:id/file — the document itself.
 *
 * Unlike an avatar, this is genuinely private: these are CNICs, B-Forms and
 * medical records. The route is guarded by requireDocumentAccess, which
 * resolves the owning student FROM THE ROW and then applies the same rule as
 * the rest of the module — staff may read any, a student only their own, a
 * parent only a ward's. Deriving the owner from the row rather than from a
 * query parameter is what stops the id being swapped for someone else's.
 *
 * Served as an attachment rather than inline. A PDF or an image rendered
 * inline executes in the API's origin if a browser can be persuaded to treat
 * it as a document; `Content-Disposition: attachment` plus the `nosniff` that
 * mediaService sets means it is downloaded, never interpreted.
 */
const downloadStudentDocument = async (req, res) => {

    try {

        const docId = Number.parseInt(req.params.id, 10);

        if (!Number.isInteger(docId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid document id"
            });
        }

        // The only read in the system that pulls file_data — see the
        // defaultScope on the model.
        const document = await StudentDocument.scope("withFile").findByPk(docId);

        if (!document) {
            return res.status(404).json({
                success: false,
                message: "Document not found"
            });
        }

        const sent = mediaService.send(
            res,
            {
                data: document.file_data,
                mime: document.file_mime,
                checksum: document.file_checksum,
                name: document.file_name,
                legacyPath: document.file_url
            },
            { download: true }
        );

        if (!sent) {
            /*
             * The row exists but the file behind it does not. This is exactly
             * the failure the move to binary storage was made to end: a
             * pre-migration row whose disk file was lost to a redeploy. It is
             * reported as a 404 with a message that says which case it is,
             * rather than as a generic missing document.
             */
            return res.status(404).json({
                success: false,
                message: "The file for this document is no longer available. Please upload it again."
            });
        }

        return undefined;

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to load document"
        });

    }

};

// ================= GET STUDENT DOCUMENTS =================

const getStudentDocuments = async (req, res) => {

    try {

        const { student_id } = req.params;

        const documents = await StudentDocument.findAll({

            where: {
                student_id
            }

        });

        return res.status(200).json({

            success: true,
            count: documents.length,

            /*
             * `file_url` is rewritten to the download route rather than
             * returned raw.
             *
             * A document stored in the database has no path at all, so the raw
             * column is NULL and the portal's existing `<a href={file_url}>`
             * would render a dead link. Pointing every row at
             * /api/students/documents/:id/file gives one address that works
             * for both storage locations — the route falls back to the legacy
             * disk path for rows that still have one — so the client needs no
             * knowledge of where the bytes actually live.
             *
             * The blob itself is not in this response: the defaultScope on the
             * model excludes it, which is what keeps a twelve-document list
             * from being a hundred megabytes.
             */
            documents: documents.map((document) => {

                const plain = document.toJSON ? document.toJSON() : document;

                return {
                    ...plain,
                    file_url: `/api/students/documents/${plain.doc_id}/file`,

                    // Kept so a screen can still tell a pre-migration row
                    // apart from one stored in the database.
                    stored_in_database: plain.file_size != null
                };

            })

        });

    } catch (error) {

        return res.status(500).json({

            success: false,
            message: error.message

        });

    }

};

// ================= DELETE STUDENT DOCUMENT =================

const deleteStudentDocument = async (req, res) => {

    try {

        const { id } = req.params;

        const document = await StudentDocument.findByPk(id);

        if (!document) {

            return res.status(404).json({

                success: false,
                message: "Document not found."

            });

        }

        await document.destroy();

        return res.status(200).json({

            success: true,
            message: "Document deleted successfully."

        });

    } catch (error) {

        return res.status(500).json({

            success: false,
            message: error.message

        });

    }

};

// ================= SEARCH & FILTER STUDENTS =================

const searchStudents = async (req, res) => {

    try {

        const {
            search,
            program_id,
            batch_id,
            section_id,
            academic_status,
            first_name,
            last_name,
            registration_number,
            page,
            limit
        } = req.query;

        let whereClause = {
            is_deleted: false
        };

        if (first_name) {
            whereClause.first_name = { [Op.like]: `%${first_name}%` };
        }

        if (last_name) {
            whereClause.last_name = { [Op.like]: `%${last_name}%` };
        }

        if (registration_number) {
            whereClause.registration_number = { [Op.like]: `%${registration_number}%` };
        }

        if (search) {

            whereClause[Op.or] = [

                {
                    first_name: {
                        [Op.like]: `%${search}%`
                    }
                },

                {
                    last_name: {
                        [Op.like]: `%${search}%`
                    }
                },

                {
                    registration_number: {
                        [Op.like]: `%${search}%`
                    }
                }

            ];

        }

        if (program_id) {

            whereClause.program_id = program_id;

        }

        if (batch_id) {

            whereClause.batch_id = batch_id;

        }

        if (section_id) {

            whereClause.section_id = section_id;

        }

        if (academic_status) {

            whereClause.academic_status = academic_status;

        }

        const searchQuery = {

            where: whereClause,

            include: [

                {
                    model: Program,
                    attributes: [
                        "program_id",
                        "program_name"
                    ]
                },

                {
                    model: Batch,
                    attributes: [
                        "batch_id",
                        "batch_name"
                    ]
                },

                {
                    model: Section,
                    attributes: [
                        "section_id",
                        "section_name"
                    ]
                }

            ],

            order: [

                ["first_name", "ASC"]

            ]

        };

        const pageNum = Number.parseInt(page, 10);
        const limitNum = Number.parseInt(limit, 10);

        if (Number.isInteger(limitNum) && limitNum > 0) {
            searchQuery.limit = limitNum;
            searchQuery.offset = Number.isInteger(pageNum) && pageNum > 1
                ? (pageNum - 1) * limitNum
                : 0;
        }

        const { count: total, rows: students } =
            await Student.findAndCountAll(searchQuery);

        return res.status(200).json({

            success: true,

            total,

            count: students.length,

            students

        });

    }

    catch (error) {

        return res.status(500).json({

            success: false,

            message: error.message

        });

    }

};

// ================= GET STUDENT GUARDIANS =================

const getStudentGuardians = async (req, res) => {

    try {

        const { student_id } = req.params;

        const rows = await StudentGuardian.findAll({

            where: {

                student_id

            },

            include: [

                {

                    model: Parent,

                    attributes: [

                        "parent_id",
                        // The login account this parent signs in with. Carried
                        // so the email can be resolved below; `parents` has no
                        // email column of its own.
                        "user_id",
                        "first_name",
                        "last_name",
                        "phone",
                        "occupation"

                    ]

                }

            ]

        });

        /*
         * The guardian's email.
         *
         * `parents` has no email column — a parent's address lives on their
         * login account (users.email), reached through parents.user_id. The
         * guardian payload therefore could not carry one at all, which is why
         * the student profile could show a parent's name and phone but never a
         * way to reach them by mail.
         *
         * Resolved in one extra read rather than through a nested include:
         * Parent has no association to User declared anywhere in the models,
         * and adding one to satisfy a single screen would change the shape of
         * every other query that includes Parent. A student has one or two
         * guardians, so this is one small keyed lookup.
         */
        const parentUserIds = [
            ...new Set(
                rows
                    .map((row) => row.Parent?.user_id)
                    .filter((id) => id !== null && id !== undefined)
            )
        ];

        const emailByUserId = new Map();

        if (parentUserIds.length) {

            const accounts = await User.findAll({
                where: { user_id: { [Op.in]: parentUserIds } },
                attributes: ["user_id", "email"]
            });

            for (const account of accounts) {
                emailByUserId.set(account.user_id, account.email || null);
            }

        }

        // student_guardians only holds the link and the relationship; the name
        // and contact live on the joined parents row. Sequelize nests that
        // under a "Parent" key, and every portal was reading first_name/phone
        // off the top level instead - which is why the student and admin
        // profiles showed the relationship ("Guardian") but a dash for the
        // guardian's name and number. The parent's own columns are lifted onto
        // the row here so one shape serves all of them. The nested object is
        // kept as well so nothing that already reads it breaks.
        const guardians = rows.map((row) => {

            const plain = row.toJSON ? row.toJSON() : row;
            const parent = plain.Parent || null;

            return {
                ...plain,
                parent_id: plain.parent_id ?? (parent ? parent.parent_id : null),
                first_name: parent ? parent.first_name : null,
                last_name: parent ? parent.last_name : null,
                guardian_name: parent
                    ? [parent.first_name, parent.last_name].filter(Boolean).join(" ") || null
                    : null,
                phone: parent ? parent.phone : null,
                occupation: parent ? parent.occupation : null,
                // Null where the parent has no login account or no address on
                // it. The screens render their empty state for that rather
                // than inventing one.
                email: parent ? (emailByUserId.get(parent.user_id) ?? null) : null,
                user_id: parent ? (parent.user_id ?? null) : null
            };

        });

        return res.status(200).json({

            success: true,

            guardians

        });

    }

    catch (error) {

        return res.status(500).json({

            success: false,

            message: error.message

        });

    }

};

// ================= OWN RECORD =================
//
// The student portal needs the signed-in student's own row, but /api/students
// and /api/students/:id are Admin+Teacher only. This resolves the record from
// the token, so a student can never request anybody else's.

const getOwnStudentRecord = async (req, res) => {

    try {

        const student = await Student.findOne({
            where: {
                user_id: req.user.user_id,
                is_deleted: false
            },
            include: [ACCOUNT_INCLUDE, ...PLACEMENT_INCLUDES]
        });

        if (!student) {

            return res.status(404).json({
                success: false,
                message: "No student record is linked to this account"
            });

        }

        return res.status(200).json({
            success: true,
            data: withAccount(student)
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to load student record"
        });

    }

};

// ================= UPDATE OWN STUDENT RECORD =================
// Self-service profile edit for the student portal. Deliberately narrow: a
// student may correct their own contact details and the personal fields below,
// and nothing else. Academic and identity fields (program, batch, section,
// semester, status, registration number, CNIC/B-Form, name) stay on the
// Admin-only PUT /api/students/:id - those are what the record is verified
// against, so they must not be self-editable.

// Mirrors the ENUM on students.gender. Validated here rather than left to the
// database so a bad value comes back as 400 and not 500.
const STUDENT_GENDERS = ["Male", "Female", "Other"];

// Mirrors the ENUM on students.blood_group.
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

// Column widths on students.address / students.nationality. Checked here so an
// over-long value is a 400 naming the field rather than a truncation or a 500.
const MAX_ADDRESS = 255;
const MAX_NATIONALITY = 50;

// students.dob is a DATE column; anything else would be coerced to NULL and
// silently wipe a correct date of birth.
const isValidDateOnly = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

    const parsed = new Date(`${value}T00:00:00Z`);

    return !Number.isNaN(parsed.getTime())
        && parsed.toISOString().slice(0, 10) === value;
};

const updateOwnStudentRecord = async (req, res) => {

    try {

        const student = await Student.findOne({
            where: {
                user_id: req.user.user_id,
                is_deleted: false
            }
        });

        if (!student) {

            return res.status(404).json({
                success: false,
                message: "No student record is linked to this account"
            });

        }

        const {
            email, phone, dob, gender,
            address, nationality, blood_group
        } = req.body;

        if (gender !== undefined && !STUDENT_GENDERS.includes(gender)) {

            return res.status(400).json({
                success: false,
                message: `gender must be one of: ${STUDENT_GENDERS.join(", ")}`
            });

        }

        // An empty string clears the field; only a non-empty value is checked
        // against the ENUM, so "no blood group on file" stays expressible.
        if (blood_group !== undefined && blood_group !== null && blood_group !== ""
            && !BLOOD_GROUPS.includes(blood_group)) {

            return res.status(400).json({
                success: false,
                message: `blood_group must be one of: ${BLOOD_GROUPS.join(", ")}`
            });

        }

        if (address !== undefined && address !== null && String(address).length > MAX_ADDRESS) {

            return res.status(400).json({
                success: false,
                message: `address must be ${MAX_ADDRESS} characters or fewer`
            });

        }

        if (nationality !== undefined && nationality !== null
            && String(nationality).length > MAX_NATIONALITY) {

            return res.status(400).json({
                success: false,
                message: `nationality must be ${MAX_NATIONALITY} characters or fewer`
            });

        }

        if (dob !== undefined && !isValidDateOnly(dob)) {

            return res.status(400).json({
                success: false,
                message: "dob must be a valid date in YYYY-MM-DD format"
            });

        }

        // Email lives on the users row and must stay unique across accounts.
        if (email !== undefined) {

            const clash = await User.findOne({
                where: {
                    email,
                    user_id: { [Op.ne]: req.user.user_id }
                }
            });

            if (clash) {

                return res.status(409).json({
                    success: false,
                    message: "That email address is already in use"
                });

            }

        }

        // Applied in one update so a request carrying several fields is a
        // single write rather than one per field.
        const studentUpdates = {};

        if (phone !== undefined) studentUpdates.phone = phone;
        if (dob !== undefined) studentUpdates.dob = dob;
        if (gender !== undefined) studentUpdates.gender = gender;

        // "" means the student cleared the field, which is a NULL column and
        // not the empty string - otherwise an ENUM would reject it outright.
        const orNull = (value) => (value === "" ? null : value);

        if (address !== undefined) studentUpdates.address = orNull(address);
        if (nationality !== undefined) studentUpdates.nationality = orNull(nationality);
        if (blood_group !== undefined) studentUpdates.blood_group = orNull(blood_group);

        if (Object.keys(studentUpdates).length > 0) {
            await student.update(studentUpdates);
        }

        if (student.user_id && (email !== undefined || phone !== undefined)) {

            const accountUpdates = {};
            if (email !== undefined) accountUpdates.email = email;
            if (phone !== undefined) accountUpdates.phone = phone;

            await User.update(accountUpdates, {
                where: { user_id: student.user_id }
            });

        }

        const updated = await Student.findOne({
            where: { student_id: student.student_id },
            include: [ACCOUNT_INCLUDE]
        });

        return res.status(200).json({
            success: true,
            message: "Profile updated",
            data: withAccount(updated)
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to update profile"
        });

    }

};

module.exports = {

    getStudents,
    updateOwnStudentRecord,
    registerStudent,
    getStudentProfile,
    updateStudent,
    deleteStudent,
    restoreStudent,
    enrollStudent,
    uploadStudentDocument,
    downloadStudentDocument,
    getStudentDocuments,
    deleteStudentDocument,
    searchStudents,
    getStudentGuardians,
    getOwnStudentRecord

};
