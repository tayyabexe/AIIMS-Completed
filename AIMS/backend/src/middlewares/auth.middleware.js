const jwt = require("jsonwebtoken");

/*
 * A header the browser sends saying which account the open tab THINKS it is.
 *
 * It is not a credential and is never trusted for anything. The JWT decides
 * who the caller is, exactly as before. This is only cross-checked against it.
 *
 * WHY IT IS WORTH CHECKING
 * ------------------------
 * The session used to live in localStorage, which every tab of an origin
 * shares, so signing into the Faculty portal in one tab replaced the token an
 * Admin tab was already using. That tab kept showing the admin UI while
 * sending a teacher's token, and the server answered it correctly — as a
 * teacher. The frontend now keeps the session per tab, which removes the
 * cause.
 *
 * This is the check that makes the class of bug non-silent regardless. Any
 * future path that lets a tab's displayed identity drift from the token it
 * sends gets an explicit 409 instead of a confidently wrong answer computed
 * for somebody else's account. For the chatbot and analytics that distinction
 * matters more than most: their whole output is scoped data, and a plausible
 * answer for the wrong role is worse than no answer at all.
 *
 * Requests without the header — Postman, the test suites, the health checks,
 * and any older client still in a cached tab — are unaffected.
 */
const ACTING_USER_HEADER = "x-aims-acting-user";

const authenticate = (req, res, next) => {

    try {

        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Access token required"
            });
        }

        const token = authHeader.split(" ")[1];

        const decoded = jwt.verify(
            token,
            process.env.JWT_ACCESS_SECRET
        );

        const claimed = req.headers[ACTING_USER_HEADER];

        /*
         * Compared as strings because the header is always text and the claim
         * is a number; `1` and "1" must agree, and neither may be coerced into
         * matching something it is not.
         */
        if (claimed !== undefined
            && String(claimed) !== String(decoded.user_id)) {

            return res.status(409).json({
                success: false,
                session_mismatch: true,
                message:
                    "This tab is signed in as a different account than the one " +
                    "it is displaying. Sign in again in this tab."
            });
        }

        req.user = decoded;

        next();

    } catch (error) {

        return res.status(401).json({
            success: false,
            message: "Invalid or expired token"
        });

    }

};

module.exports = authenticate;
module.exports.ACTING_USER_HEADER = ACTING_USER_HEADER;
