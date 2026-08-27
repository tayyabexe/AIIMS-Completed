/*
 * /parent-dashboard — kept alive as a redirect, nothing more.
 *
 * This file used to BE the parent portal: 1,400 lines holding eight screens in
 * a `parentTab` useState, one route for the lot. It is now
 * ParentLayout.jsx plus a page per module, generated from parentNav.js. What
 * remains here is the forwarding address.
 *
 * It has to remain, because the old URL is not only in bookmarks:
 *
 *   - Nine rows in `notifications` carry `/parent-dashboard?tab=fees` and
 *     `?tab=results` as their link. They were written by the server before the
 *     portal had routes, and they are still in the table.
 *   - `api/roles.js` names /parent-dashboard as the parent's landing page, and
 *     sign-in sends every parent there.
 *
 * `?tab=` is translated rather than dropped, so a two-year-old fee notice
 * still opens the fee screen. `replace` keeps the dead URL out of history:
 * pressing Back from /parent/fees should leave the portal, not bounce through
 * the redirect and land straight back where it started.
 */

import { Navigate, useSearchParams } from 'react-router-dom';
import { PARENT_HOME, tabToPath } from './parentNav';

export default function ParentDashboard() {
  const [searchParams] = useSearchParams();

  const tab = searchParams.get('tab');
  const child = searchParams.get('child');

  /*
   * An unrecognised tab falls through to the portal's front page rather than
   * being guessed at. That is what the old whitelist did — and the whitelist
   * was missing `my-children`, so the one link naming that screen was
   * silently dropped. The map behind `tabToPath` is now the same list the
   * sidebar and the router are built from, so it cannot go out of step again.
   */
  const target = tabToPath(tab) || PARENT_HOME;

  return <Navigate to={child ? `${target}?child=${child}` : target} replace />;
}
