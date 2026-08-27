/*
 * Timetable management: terms, classes, staffing, enrolment and placement.
 *
 * Exported as four routers rather than one, because they hang off different
 * URLs and carry genuinely different access rules:
 *
 *   /api/terms       - the academic calendar
 *   /api/offerings   - classes, and everything done to them
 *   /api/scheduling  - the admin's placement views across a whole term
 *   (student classes are mounted under /api/students by app.js)
 *
 * WHO CAN DO WHAT
 * ---------------
 * Every write is ADMINS. Building a timetable is an institutional act: it
 * decides who teaches whom, in which room, at which hour, and one careless
 * edit moves a class that forty people are already sitting in.
 *
 * Reads are wider, and deliberately so. A teacher must be able to see their
 * own classes and rosters, and a student must be able to see who teaches them
 * - that question having been unanswerable is what this whole module exists to
 * fix. Row-level scoping is what keeps that safe: a student hitting the
 * classes route is pinned to their own record by scopeStudentToSelf, so
 * changing the id in the URL reads back their own timetable rather than
 * somebody else's.
 */

const express = require("express");

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ROLES, ADMINS, ADMIN_TEACHER, ADMIN_TEACHER_STUDENT } = require("../config/roles");
const {
    scopeStudentToSelf,
    requireStudentAccess
} = require("../middlewares/selfScope.middleware");

const controller = require("../controllers/courseOfferingController");

// ------------------------------------------------------------- terms ----

const terms = express.Router();

/*
 * The term list is read by every screen in the module to populate its term
 * picker, so it is open to the same roles that can see a timetable. It carries
 * no personal data - a code, a name, two dates and a status.
 */
terms.get("/", authenticate, authorize(...ADMIN_TEACHER_STUDENT), controller.listTerms);

// Declared before "/:id" so "current" is not read as an id.
terms.get("/current", authenticate, authorize(...ADMIN_TEACHER_STUDENT), controller.getCurrentTerm);

terms.post("/", authenticate, authorize(...ADMINS), controller.createTerm);

// Status is its own endpoint rather than a field on a general update, because
// moving a term to Active or Closed cascades over every class and enrolment in
// it. That is not something to do by accident while editing a date.
terms.patch("/:id/status", authenticate, authorize(...ADMINS), controller.setTermStatus);

// ---------------------------------------------------------- offerings ----

const offerings = express.Router();

offerings.get("/", authenticate, authorize(...ADMIN_TEACHER), controller.listOfferings);

/*
 * Bulk creation, declared before "/:id" so "section" is not read as an id.
 * This is how a term is actually built - one call per section rather than one
 * per subject.
 */
offerings.post("/section", authenticate, authorize(...ADMINS), controller.createOfferingsForSection);

offerings.post("/section/enrol", authenticate, authorize(...ADMINS), controller.enrolCohortForSection);

offerings.post("/", authenticate, authorize(...ADMINS), controller.createOffering);

offerings.get("/:id", authenticate, authorize(...ADMIN_TEACHER), controller.getOffering);

offerings.put("/:id", authenticate, authorize(...ADMINS), controller.updateOffering);
offerings.patch("/:id", authenticate, authorize(...ADMINS), controller.updateOffering);

offerings.delete("/:id", authenticate, authorize(...ADMINS), controller.deleteOffering);

// staffing
offerings.get("/:id/teachers", authenticate, authorize(...ADMINS), controller.getEligibleTeachers);
offerings.put("/:id/teacher", authenticate, authorize(...ADMINS), controller.assignTeacher);

// enrolment
offerings.post("/:id/enrol", authenticate, authorize(...ADMINS), controller.enrolCohort);

/*
 * The class list. A teacher needs it for their own classes - it is the screen
 * they take attendance and enter marks from - so ADMIN_TEACHER rather than
 * ADMINS.
 */
offerings.get("/:id/roster", authenticate, authorize(...ADMIN_TEACHER), controller.getRoster);

// scheduling, per class
offerings.get("/:id/placement", authenticate, authorize(...ADMINS), controller.getPlacementOptions);
offerings.post("/:id/sessions", authenticate, authorize(...ADMINS), controller.placeSession);

// --------------------------------------------------------- scheduling ----

const scheduling = express.Router();

scheduling.get("/status", authenticate, authorize(...ADMINS), controller.getSchedulingStatus);
scheduling.get("/rooms", authenticate, authorize(...ADMINS), controller.getRoomOccupancy);

// Moving and removing a period are keyed on the timetable row, not the class,
// because that is the thing being moved.
scheduling.put("/sessions/:timetableId", authenticate, authorize(...ADMINS), controller.moveSession);
scheduling.delete("/sessions/:timetableId", authenticate, authorize(...ADMINS), controller.unplaceSession);

// ---------------------------------------------- a student's own classes ----

const studentClasses = express.Router();

/*
 * "What am I taking, and who teaches it." requireStudentAccess authorises the
 * id - a student may only name their own, a parent only their children's - and
 * scopeStudentToSelf pins a student caller to their own record regardless of
 * what the URL says.
 */
studentClasses.get(
    "/:student_id/classes",
    authenticate,
    authorize(...ADMIN_TEACHER_STUDENT, ROLES.PARENT),
    requireStudentAccess("student_id"),
    // The parameter is named student_id rather than studentId so that
    // scopeStudentToSelf's own explicit-id check fires too - it looks for
    // req.params.student_id by that exact name, and a camelCase parameter
    // would silently skip it.
    scopeStudentToSelf,
    controller.getStudentClasses
);

module.exports = { terms, offerings, scheduling, studentClasses };
