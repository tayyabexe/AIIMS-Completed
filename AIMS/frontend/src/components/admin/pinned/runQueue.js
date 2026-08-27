/*
 * A gate in front of the saved-card queries.
 *
 * THE PROBLEM THIS EXISTS FOR
 * ---------------------------
 * Every pinned card re-runs its query when it mounts. Open a dashboard with
 * six of them and six real database queries leave the browser in the same
 * tick, alongside the screen's own requests for its figures and its layout.
 *
 * Three things then stack up. The browser opens at most six connections to one
 * origin over HTTP/1.1, so the later cards sit in a queue before they are even
 * sent. The API is one Node process against a remote database, so the queries
 * it did receive contend with each other. And the HTTP client aborts anything
 * still outstanding at 30 seconds.
 *
 * The result was cards that reported "The server took too long to respond" on
 * every page load and then worked perfectly when their refresh button was
 * pressed — because by then they were the only request in flight. That is the
 * signature of queueing, not of a slow query, and it is why the fix is
 * scheduling rather than optimisation.
 *
 * WHY TWO AT A TIME
 * -----------------
 * One is needlessly serial: two cards genuinely can overlap, since a good part
 * of each request is network latency to a remote database rather than work.
 * Much more than two and they are contending for the same connection pool
 * again, which is the thing being avoided. Two keeps the pipe busy without
 * rebuilding the pile-up.
 *
 * The queue is module-level on purpose: the limit has to hold across every
 * card on the screen, and each card only knows about itself.
 */

const MAX_IN_FLIGHT = 2;

let inFlight = 0;
const waiting = [];

const pump = () => {
  while (inFlight < MAX_IN_FLIGHT && waiting.length) {
    const job = waiting.shift();

    /*
     * A card that unmounted, or whose query changed, while it was queued.
     * Dropping it here rather than running it means switching a card's chart
     * type twice does not run the query twice.
     */
    if (job.cancelled()) continue;

    inFlight += 1;

    job.run()
      .then(job.resolve, job.reject)
      .finally(() => {
        inFlight -= 1;
        pump();
      });
  }
};

/**
 * Runs `task` when a slot is free.
 *
 * `cancelled` is consulted at the moment the slot opens, so work that has
 * become pointless while queued is never started.
 */
export const enqueue = (task, cancelled = () => false) =>
  new Promise((resolve, reject) => {
    waiting.push({ run: task, resolve, reject, cancelled });
    pump();
  });

export default enqueue;
