// The AI Analytics API surface.
//
// One call, one result set. There is no conversation id here and no history,
// because a query result is not a dialogue — the same question asked twice
// should run the same query twice.
//
// The response carries rows, not prose. Nothing in it was written by a model
// except the corrected spelling of the question and the chart title, and both
// are labelled as such in the UI.

import { get, post, put, patch, del } from './client';

export const analytics = {
  /**
   * Ask one question. Returns { result } with rows, columns and a render spec.
   *
   * The request is deliberately just the question — no page size, no row
   * limit, no chart hint. What comes back is the whole result set, and how it
   * is drawn is decided server-side against the real columns.
   */
  ask: (question, { signal } = {}) =>
    post('/api/analytics/ask', { question }, { signal }),

  // What this account can ask about; drives the suggestion chips.
  capabilities: ({ signal } = {}) =>
    get('/api/analytics/capabilities', { signal })
};

/*
 * PINNED ANALYTICS
 * ================
 * A saved query is a question kept for later, and a card is one placement of
 * one saved query on one screen. Admin-only — see routes/analyticsRoutes.js.
 *
 * The important thing about `run` below: it re-executes the stored plan
 * against the live database. A card is never a picture of old rows, which is
 * why there is no "snapshot" call here to reach for by mistake.
 */
export const saved = {
  // Everything this account has pinned, newest first.
  list: ({ signal } = {}) =>
    get('/api/analytics/saved', { signal }),

  /**
   * Keep one result.
   *
   * `source` is the object the /ask response returned, passed straight back —
   * the browser does not construct a plan, it hands back the one it was given.
   * `visuals` are the templates ticked in the save dialog, which the dialog
   * offers only from the set the result actually supported.
   */
  create: (body, { signal } = {}) =>
    post('/api/analytics/saved', body, { signal }),

  // Rename, or change which templates it offers. The plan itself is immutable.
  update: (id, changes, { signal } = {}) =>
    patch(`/api/analytics/saved/${id}`, changes, { signal }),

  // Forget it. Its cards go too, on the server's cascade.
  remove: (id, { signal } = {}) =>
    del(`/api/analytics/saved/${id}`, { signal }),

  /**
   * Re-run it. Returns the same envelope /ask returns, so a card renders
   * through the same ChartTemplates registry the canvas does.
   */
  run: (id, visual, { signal } = {}) =>
    post(`/api/analytics/saved/${id}/run`, { visual }, { signal })
};

/*
 * A screen's arrangement. `surface` is 'dashboard' or 'ai_insights'.
 *
 * The GET carries the surface's rules with it — which panels exist, whether
 * they may be removed, whether tables are allowed — so the pencil menu and the
 * server are reading the same sentence rather than each holding a copy.
 */
export const layout = {
  get: (surface, { signal } = {}) =>
    get(`/api/analytics/layout/${surface}`, { signal }),

  /*
   * The whole arrangement, every time. A reflowing grid moves neighbours, so
   * there is no such thing as saving one card.
   *
   * `breakpoint` says which width it describes — 'lg' for the twelve-column
   * desktop grid, 'sm' for the single-column stack. They are stored
   * separately, so rearranging on a tablet leaves the desktop layout alone.
   */
  save: (surface, cards, breakpoint = 'lg', { signal } = {}) =>
    put(`/api/analytics/layout/${surface}`, { cards, breakpoint }, { signal }),

  // Back to the factory arrangement.
  reset: (surface, { signal } = {}) =>
    del(`/api/analytics/layout/${surface}`, { signal })
};

export default analytics;
