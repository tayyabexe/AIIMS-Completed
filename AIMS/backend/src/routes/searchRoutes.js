const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");

const searchController = require("../controllers/searchController");

// No authorize() list here on purpose. Search is not "allowed" or "denied" per
// role at the route - every role has a search, and what differs is which
// resources it reaches and which rows come back. That decision lives in
// config/searchResources.js and is enforced for every query, so putting a role
// list here as well would only be a second place to keep in sync.

// ================= SEARCHABLE RESOURCES FOR THIS ROLE =================
// Declared before "/" is irrelevant (different paths), but kept first because
// a portal calls this once on load and then hits "/" repeatedly.
router.get(
    "/resources",
    authenticate,
    searchController.getSearchAccess
);

// ================= SEARCH =================
router.get(
    "/",
    authenticate,
    searchController.search
);

module.exports = router;
