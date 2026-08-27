const searchService = require("../services/searchService");
const { RESOURCES } = require("../config/searchResources");

// Every handler resolves the caller's scope from the token before touching the
// database. There is no code path that reads a resource without one.

const withContext = (handler) => async (req, res) => {

    try {

        const role = searchService.effectiveRole(req.user);

        if (!role || searchService.allowedResources(role).length === 0) {
            return res.status(403).json({
                success: false,
                message: "Your role does not have search access"
            });
        }

        const ctx = await searchService.resolveContext(req.user);

        return await handler(req, res, ctx);

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Search failed"
        });

    }

};

// ================= WHAT THIS ROLE MAY SEARCH =================
// Lets each portal build its own filter UI from the same registry the queries
// use, instead of hardcoding a list that then drifts out of sync.
const getSearchAccess = withContext(async (req, res, ctx) => {

    return res.status(200).json({
        success: true,
        role_id: ctx.role_id,
        resources: searchService.describeAccess(ctx.role_id)
    });

});

// ================= SEARCH =================
//
//   GET /api/search?q=ali
//     every resource this role may search, capped per resource
//
//   GET /api/search?type=students&q=ali&program_id=3&page=1&limit=20
//     one resource, with exact filters and pagination
//
// A ?type= the role may not search is a 403, not an empty list, so the portal
// gets a clear answer instead of a result that looks like "no matches".
const search = withContext(async (req, res, ctx) => {

    const { type } = req.query;

    if (type) {

        if (!RESOURCES[type]) {
            return res.status(404).json({
                success: false,
                message: `Unknown search type: ${type}`,
                available: searchService.allowedResources(ctx.role_id)
            });
        }

        if (!searchService.canSearch(ctx.role_id, type)) {
            return res.status(403).json({
                success: false,
                message: `Your role cannot search ${type}`,
                available: searchService.allowedResources(ctx.role_id)
            });
        }

        const result = await searchService.searchResource(type, req.query, ctx);

        return res.status(200).json({
            success: true,
            ...result
        });

    }

    // A global search with neither free text nor a filter would run every
    // resource unfiltered, which is a dozen full table reads for nothing.
    const hasCriteria = Object.entries(req.query).some(
        ([key, value]) => !["page", "limit", "group_limit"].includes(key) && value !== ""
    );

    if (!hasCriteria) {
        return res.status(400).json({
            success: false,
            message: "Provide q= to search, or type= with filters"
        });
    }

    const result = await searchService.searchAll(req.query, ctx);

    return res.status(200).json({
        success: true,
        ...result
    });

});

module.exports = {
    search,
    getSearchAccess
};
