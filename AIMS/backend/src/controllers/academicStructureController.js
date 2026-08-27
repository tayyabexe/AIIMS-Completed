/*
 * CRUD handlers for the academic structure.
 *
 * Six resources with identical mechanics — list, read one, create, update,
 * delete — so they are generated from one description rather than written out
 * thirty times. What differs between them is entirely in the service: which
 * table, which validation, which references block a delete.
 *
 * Every write is recorded in the audit log with the row's before and after
 * state. Structural changes are the ones nobody remembers making and everybody
 * needs to trace: "who moved that batch to another programme" has no other
 * answer, because the row itself only shows where it is now.
 */

const service = require("../services/academicStructureService");
const audit = require("../services/auditService");

/*
 * A service error carrying `status` is a statement about the request — the name
 * is taken, the batch does not exist, the section still holds students — and the
 * caller can act on it. Anything else is this service being broken and must not
 * have its internals echoed back.
 */
const respondToError = (res, error, what) => {
    if (error && Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
        return res.status(error.status).json({
            success: false,
            message: error.message,
            ...(error.blockedBy ? { blockedBy: error.blockedBy } : {})
        });
    }

    console.error(`[academics/${what}]`, error);

    return res.status(500).json({
        success: false,
        message: `Failed to ${what}.`
    });
};

const idFrom = (req, res) => {
    const id = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ success: false, message: "A numeric id is required." });
        return null;
    }

    return id;
};

/**
 * @param name      plural resource name, for messages and the audit module
 * @param singular  singular resource name, for messages
 * @param methods   the service functions backing this resource
 * @param auditKey  the audit module this resource's writes belong to
 */
const resource = ({ name, singular, methods, auditModule }) => ({
    list: async (req, res) => {
        try {
            const data = await methods.list(req.query);
            return res.status(200).json({ success: true, count: data.length, data });
        } catch (error) {
            return respondToError(res, error, `load ${name}`);
        }
    },

    read: async (req, res) => {
        const id = idFrom(req, res);
        if (id === null) return undefined;

        try {
            const row = await methods.get(id);

            if (!row) {
                return res.status(404).json({ success: false, message: `${singular} not found.` });
            }

            return res.status(200).json({ success: true, data: row });
        } catch (error) {
            return respondToError(res, error, `load ${singular.toLowerCase()}`);
        }
    },

    create: async (req, res) => {
        try {
            const row = await methods.create(req.body || {});

            await audit.record({
                userId: req.user?.user_id,
                action: `${singular.toUpperCase().replace(/\s+/g, "_")}_CREATED`,
                module: auditModule,
                entity: `${name}#${row.id}`,
                after: row,
                req
            });

            return res.status(201).json({
                success: true,
                message: `${singular} created.`,
                data: row
            });
        } catch (error) {
            return respondToError(res, error, `create ${singular.toLowerCase()}`);
        }
    },

    update: async (req, res) => {
        const id = idFrom(req, res);
        if (id === null) return undefined;

        try {
            // Read first so the audit entry can say what it was, not only what
            // it became. A structural edit is only legible as a pair.
            const before = await methods.get(id);
            const row = await methods.update(id, req.body || {});

            await audit.record({
                userId: req.user?.user_id,
                action: `${singular.toUpperCase().replace(/\s+/g, "_")}_UPDATED`,
                module: auditModule,
                entity: `${name}#${id}`,
                before,
                after: row,
                req
            });

            return res.status(200).json({
                success: true,
                message: `${singular} updated.`,
                data: row
            });
        } catch (error) {
            return respondToError(res, error, `update ${singular.toLowerCase()}`);
        }
    },

    remove: async (req, res) => {
        const id = idFrom(req, res);
        if (id === null) return undefined;

        try {
            const before = await methods.get(id);
            const result = await methods.remove(id);

            await audit.record({
                userId: req.user?.user_id,
                action: `${singular.toUpperCase().replace(/\s+/g, "_")}_DELETED`,
                module: auditModule,
                entity: `${name}#${id}`,
                before,
                req
            });

            return res.status(200).json({
                success: true,
                message: `${singular} deleted.`,
                data: result
            });
        } catch (error) {
            return respondToError(res, error, `delete ${singular.toLowerCase()}`);
        }
    }
});

const departments = resource({
    name: "departments",
    singular: "Department",
    auditModule: audit.MODULES.ACADEMICS,
    methods: {
        list: service.listDepartments,
        get: service.getDepartment,
        create: service.createDepartment,
        update: service.updateDepartment,
        remove: service.deleteDepartment
    }
});

const programs = resource({
    name: "programs",
    singular: "Programme",
    auditModule: audit.MODULES.ACADEMICS,
    methods: {
        list: service.listPrograms,
        get: service.getProgram,
        create: service.createProgram,
        update: service.updateProgram,
        remove: service.deleteProgram
    }
});

const batches = resource({
    name: "batches",
    singular: "Batch",
    auditModule: audit.MODULES.ACADEMICS,
    methods: {
        list: service.listBatches,
        get: service.getBatch,
        create: service.createBatch,
        update: service.updateBatch,
        remove: service.deleteBatch
    }
});

const sections = resource({
    name: "sections",
    singular: "Section",
    auditModule: audit.MODULES.ACADEMICS,
    methods: {
        list: service.listSections,
        get: service.getSection,
        create: service.createSection,
        update: service.updateSection,
        remove: service.deleteSection
    }
});

const classrooms = resource({
    name: "classrooms",
    singular: "Classroom",
    auditModule: audit.MODULES.ACADEMICS,
    methods: {
        list: service.listClassrooms,
        get: service.getClassroom,
        create: service.createClassroom,
        update: service.updateClassroom,
        remove: service.deleteClassroom
    }
});

const semesters = resource({
    name: "semesters",
    singular: "Semester",
    auditModule: audit.MODULES.ACADEMICS,
    methods: {
        list: service.listSemesters,
        get: service.getSemester,
        create: service.createSemester,
        update: service.updateSemester,
        remove: service.deleteSemester
    }
});

const getOverview = async (req, res) => {
    try {
        const data = await service.getOverview();
        return res.status(200).json({ success: true, ...data });
    } catch (error) {
        return respondToError(res, error, "load the academic structure");
    }
};

module.exports = {
    departments,
    programs,
    batches,
    sections,
    classrooms,
    semesters,
    getOverview
};
