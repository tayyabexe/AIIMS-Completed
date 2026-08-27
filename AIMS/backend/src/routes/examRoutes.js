const express = require("express");

const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");

const {

    createExam,
    getAllExams,
    getExamById,
    updateExam,
    deleteExam

} = require("../controllers/examController");

const {

    createExamValidation

} = require("../validators/examValidator");

// ================= CREATE EXAM =================

router.post(
    "/",
    authenticate,
    createExamValidation,
    createExam
);
// ================= GET ALL EXAMS =================

router.get(
    "/",
    authenticate,
    getAllExams
);

// ================= GET EXAM BY ID =================

router.get(
    "/:id",
    authenticate,
    getExamById
);

// ================= UPDATE EXAM =================

router.put(
    "/:id",
    authenticate,
    updateExam
);

// ================= DELETE EXAM =================

router.delete(
    "/:id",
    authenticate,
    deleteExam
);
module.exports = router;