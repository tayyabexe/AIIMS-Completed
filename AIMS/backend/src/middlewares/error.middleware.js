/*
 * The last-resort error handler.
 *
 * It used to answer EVERY error with 500 "Internal Server Error", discarding
 * whatever the thrower had said. Any route that reported a problem by calling
 * next(error) — rather than res.status(...).json(...) itself — therefore told
 * the caller nothing: "this semester still has 12 marks in Draft" and "the
 * database is down" arrived identically, and the admin screen could only show
 * "Internal Server Error" for a condition the user could have fixed.
 *
 * The rule now:
 *
 *   - An error carrying an explicit `status` was RAISED DELIBERATELY by our own
 *     code to be shown to the caller. Its status and message are passed
 *     through, along with `blockedBy` where a service listed the specific
 *     obstacles.
 *
 *   - An error with no status is unexpected — a bug, a driver fault, a null
 *     dereference. Those keep the generic 500 and their message is NOT sent,
 *     because an unplanned message can carry a query, a path or a column name.
 *
 * Either way the full error is logged, so nothing is lost from the server's
 * own record.
 */
const errorHandler = (err, req, res, next) => {

    console.error(err);

    // Express requires the four-argument signature to recognise this as an
    // error handler; `next` is unused once a response is sent.
    if (res.headersSent) {
        return next(err);
    }

    const status = Number(err?.status);
    const deliberate = Number.isInteger(status) && status >= 400 && status < 600;

    return res.status(deliberate ? status : 500).json({

        success: false,

        message: deliberate && err.message
            ? err.message
            : "Internal Server Error",

        // Present when a service could name what is standing in the way, e.g.
        // "3 classes, 40 enrolments". Rendered verbatim by ApiErrorNotice.
        ...(deliberate && err.blockedBy ? { blockedBy: err.blockedBy } : {})

    });

};

module.exports = errorHandler;
