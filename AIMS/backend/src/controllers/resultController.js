const Result = require("../models/result.model");
const Grade = require("../models/grade.model");
const Mark = require("../models/mark.model");
const Exam = require("../models/exam.model");
const Student = require("../models/student.model");
const Subject = require("../models/subject.model");
const { Op } = require("sequelize");
const audit = require("../services/auditService");
const notify = require("../services/notificationService");
// ================= CALCULATE GPA =================

const calculateGPA = async (req, res) => {

    try {

        const { student_id, semester_id } = req.body;

        const marks = await Mark.findAll({

            where: {
                student_id,
                status: "Verified"
            }

        });

        if (marks.length === 0) {

            return res.status(404).json({

                success: false,
                message: "No verified marks found."

            });

        }

        let totalGradePoints = 0;

        for (const mark of marks) {

            const exam = await Exam.findByPk(mark.exam_id);

            if (!exam) continue;

            const percentage =
                (Number(mark.obtained_marks) / Number(exam.total_marks)) * 100;

            const grade = await Grade.findOne({

                where: {

                    min_percentage: {
                        [require("sequelize").Op.lte]: percentage
                    },

                    max_percentage: {
                        [require("sequelize").Op.gte]: percentage
                    }

                }

            });

            if (grade) {

                totalGradePoints += Number(grade.grade_point);

            }

        }

        const gpa = (totalGradePoints / marks.length).toFixed(2);

        const result = await Result.create({

            student_id,
            semester_id,
            gpa,
            cgpa: gpa

        });

        return res.status(201).json({

            success: true,
            message: "GPA calculated successfully.",
            result

        });

    } catch (error) {

      console.log(error);

return res.status(500).json({
    success: false,
    message: error.message,
    errors: error.errors
});

    }

};
// ================= CALCULATE CGPA =================

const calculateCGPA = async (req, res) => {

    try {

        const { student_id } = req.params;

        const results = await Result.findAll({

            where: {
                student_id
            }

        });

        if (results.length === 0) {

            return res.status(404).json({

                success: false,
                message: "No results found."

            });

        }

        let totalGPA = 0;

        results.forEach(result => {

            totalGPA += Number(result.gpa);

        });

        const cgpa = (totalGPA / results.length).toFixed(2);

        await Result.update(

            { cgpa },

            {
                where: {
                    student_id
                }
            }

        );

        return res.status(200).json({

            success: true,
            cgpa

        });

    } catch (error) {

        return res.status(500).json({

            success: false,
            message: error.message

        });

    }

};
// ================= PUBLISH RESULT =================

const publishResult = async (req, res) => {

    try {

        const { id } = req.params;

        const result = await Result.findByPk(id);

        if (!result) {

            return res.status(404).json({

                success: false,
                message: "Result not found."

            });

        }

        const previousStatus = result.status;

        result.status = "Published";
        result.published_at = new Date();

        await result.save();

        /*
         * Publication is the moment a result becomes visible to the student and
         * their parent, and it is irreversible in practice even though the
         * column can be set back. The student's name is looked up so the entry
         * names a person rather than a result id; a failed lookup leaves the
         * name out rather than failing the publication.
         */
        const student = await Student.findByPk(result.student_id).catch(() => null);

        await audit.record({
            userId: req.user?.user_id,
            action: audit.ACTIONS.RESULT_PUBLISHED,
            module: audit.MODULES.EXAMS,
            entity: `results#${result.result_id}`,
            before: { status: previousStatus },
            after: {
                resultId: result.result_id,
                studentId: result.student_id,
                studentName: student
                    ? [student.first_name, student.last_name].filter(Boolean).join(" ")
                    : null,
                registrationNumber: student ? student.registration_number : null,
                semesterId: result.semester_id,
                gpa: result.gpa,
                cgpa: result.cgpa,
                status: result.status,
                publishedAt: result.published_at
            },
            req
        });

        /*
         * Publication is by definition the moment this becomes the student's
         * business, so it is the clearest notification in the system.
         *
         * The GPA is deliberately NOT in the message. A notification is read
         * from a bell dropdown that a classmate can see over a shoulder, and the
         * result screen is one tap away behind the student's own login — which
         * is the right place for the number.
         */
        if (previousStatus !== "Published") {
            await notify.notifyStudent({
                studentId: result.student_id,
                type: notify.TYPES.RESULT,
                priority: notify.PRIORITY.HIGH,
                subject: "results",
                actorUserId: req.user?.user_id,
                title: "Result published",
                ownMessage: "Your result has been published. Open your results page to view it.",
                guardianMessage: (role, who) =>
                    `${who}'s result has been published. Open the Results tab to view it.`
            });
        }

        return res.status(200).json({

            success: true,
            message: "Result published successfully.",
            result

        });

    } catch (error) {

        return res.status(500).json({

            success: false,
            message: error.message

        });

    }

};
// ================= GET STUDENT TRANSCRIPT =================

const getTranscript = async (req, res) => {

    try {

        const { student_id } = req.params;

        const student = await Student.findByPk(student_id);

        if (!student) {

            return res.status(404).json({

                success: false,
                message: "Student not found."

            });

        }

        const result = await Result.findAll({

            where: {
                student_id
            }

        });

        const transcript = await Mark.findAll({

            where: {
                student_id
            },

            include: [

                {

                    model: Exam,

                    include: [

                        {

                            model: Subject

                        }

                    ]

                }

            ]

        });

        return res.status(200).json({

            success: true,

            student,

            result,

            transcript

        });

    } catch (error) {

        return res.status(500).json({

            success: false,

            message: error.message

        });

    }

};
// ================= GRADING SCALE =================

/*
 * The institute's grading scale, straight from the `grades` table.
 *
 * Every screen that needed to turn a percentage into a letter had its own
 * hardcoded ladder ("A+": 10, "A": 9 ... ) which did not match the database and
 * produced GPAs out of thin air. There was no endpoint to read the real scale,
 * so this is it. It is reference data, readable by any signed-in role.
 */
const getGradingScale = async (req, res) => {

    try {

        const grades = await Grade.findAll({
            order: [["min_percentage", "DESC"]]
        });

        return res.status(200).json({
            success: true,
            count: grades.length,
            data: grades
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }

};

// ================= EXAMINATION REPORT =================

const getExamReport = async (req, res) => {

    try {

        const { exam_id } = req.params;

        const exam = await Exam.findByPk(exam_id);

        if (!exam) {

            return res.status(404).json({

                success: false,
                message: "Exam not found."

            });

        }

        const marks = await Mark.findAll({

            where: {
                exam_id
            }

        });

        if (marks.length === 0) {

            return res.status(404).json({

                success: false,
                message: "No marks found."

            });

        }

        const totalStudents = marks.length;

        let passedStudents = 0;
        let failedStudents = 0;

        let highestMarks = 0;
        let lowestMarks = Number(marks[0].obtained_marks);

        let totalMarks = 0;

        for (const mark of marks) {

            const obtained = Number(mark.obtained_marks);

            totalMarks += obtained;

            if (obtained > highestMarks)
                highestMarks = obtained;

            if (obtained < lowestMarks)
                lowestMarks = obtained;

            if ((obtained / exam.total_marks) * 100 >= 50)
                passedStudents++;
            else
                failedStudents++;

        }

        const averageMarks = (totalMarks / totalStudents).toFixed(2);

        const passPercentage = (

            (passedStudents / totalStudents) * 100

        ).toFixed(2);

        return res.status(200).json({

            success: true,

            report: {

                exam_id: exam.exam_id,
                exam_name: exam.exam_name,

                totalStudents,
                passedStudents,
                failedStudents,

                highestMarks,
                lowestMarks,
                averageMarks,

                passPercentage: passPercentage + "%"

            }

        });

    } catch (error) {

        return res.status(500).json({

            success: false,
            message: error.message

        });

    }

};
module.exports = {

    calculateGPA,
    calculateCGPA,
    publishResult,
    getTranscript,
    getGradingScale,
    getExamReport

};