const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const { ADMINS } = require("../config/roles");

const searchController = require("../controllers/searchController");

const {
    parentLoginValidation
} = require("../validators/parentValidator");

const {
    parentLogin,
    listParents,
    getParentProfile,
    getChildProfile,
    getChildAttendance,
     getFees,
     getTimetable,
     getResults,
     getGpaCgpa,
     getNotifications,
     registerParent
} = require("../controllers/parentController");

// Admin-facing route to register a parent (associated with a student)
router.post(
    "/register",
    authenticate,
    authorize(...ADMINS),
    registerParent
);

// "/login" is the path used by the Postman collections; "/parent-login" is the
// original. Both resolve to the same handler.
router.post(
    "/parent-login",
    parentLoginValidation,
    parentLogin
);

router.post(
    "/login",
    parentLoginValidation,
    parentLogin
);


// The parent portal's search bar. Delegates to the shared search controller,
// which scopes a PARENT token to that parent's own children and the
// attendance, results, fees, timetable and notices belonging to them - the
// same code path and the same guarantees as every other portal's search.
// Declared before "/:..." style routes so it is never read as a parameter.
router.get(
    "/search",
    authenticate,
    searchController.search
);

router.get(
    "/search/resources",
    authenticate,
    searchController.getSearchAccess
);

// Admin-facing list of all parents with their linked children. Declared before
// the parent-self routes; "/" cannot collide with them.
router.get(
    "/",
    authenticate,
    authorize(...ADMINS),
    listParents
);

router.get(
    "/profile",
    authenticate,
    getParentProfile
);


router.get(
    "/children",
    authenticate,
    getChildProfile
);
router.get(
    "/attendance",
    authenticate,
    getChildAttendance
);
// One fee endpoint. /fee-status, /challan and /receipt were three partial
// views of two unlinked billing record sets; there is one billing table now.
router.get(
    "/fees",
    authenticate,
    getFees
);
router.get(
    "/timetable",
    authenticate,
    getTimetable
);
router.get(
    "/results",
    authenticate,
    getResults
);
router.get(
    "/gpa-cgpa",
    authenticate,
    getGpaCgpa
);
router.get(
    "/notifications",
    authenticate,
    getNotifications
);
module.exports = router;