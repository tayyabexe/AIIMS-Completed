/*
 * The parent portal's navigation map — one entry per module, and the single
 * source the sidebar, the router and the search catalogue all read.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The portal used to be ONE route, `/parent-dashboard`, whose module was held
 * in a `parentTab` useState. Three things followed from that, and all three
 * were real:
 *
 *   1. Nothing outside the component could point at a screen. A fee notice
 *      could not link to the fee screen, so `?tab=` was bolted on as a
 *      one-shot parameter that was read and then erased from the URL.
 *   2. The whitelist that guarded `?tab=` listed seven tabs and the sidebar
 *      rendered eight — `my-children` was missing from it, so a link naming
 *      the My Children screen was silently dropped. That is exactly the class
 *      of drift a single map prevents.
 *   3. Reload, Back, Forward and bookmarking all returned the parent to the
 *      dashboard, whatever they had been looking at.
 *
 * Admin already solved this with `pages/admin/adminNav.js`; this mirrors it.
 *
 * `tab` is kept alongside `path` because it is the key the OLD notification
 * rows in the database use (`/parent-dashboard?tab=fees`) and the key the
 * search catalogue was written against. `tabToPath` below is what translates
 * one into the other, in one place.
 */

import {
  LayoutGrid, Users, CalendarCheck, CalendarRange,
  Award, DollarSign, Bell, User,
} from 'lucide-react';

/**
 * MAIN section of the sidebar, in the order it is drawn.
 *
 * `title` is what the top bar shows; `label` is what the sidebar shows. They
 * differ for Dashboard ("Parent Dashboard" reads as a page title and as a
 * redundant sidebar entry) and Profile, which is what the old inline ternary
 * did — it is preserved here rather than lost to the refactor.
 */
export const PARENT_MAIN_NAV = [
  { tab: 'dashboard', path: '/parent/dashboard', label: 'Dashboard', title: 'Parent Dashboard', icon: LayoutGrid },
  { tab: 'my-children', path: '/parent/my-children', label: 'My Children', title: 'My Children', icon: Users },
  { tab: 'attendance', path: '/parent/attendance', label: 'Attendance', title: 'Attendance', icon: CalendarCheck },
  { tab: 'timetable', path: '/parent/timetable', label: 'Timetable', title: 'Timetable', icon: CalendarRange },
  { tab: 'results', path: '/parent/results', label: 'Results', title: 'Results', icon: Award },
  { tab: 'fees', path: '/parent/fees', label: 'Fee Details', title: 'Fee Details', icon: DollarSign },
  { tab: 'notifications', path: '/parent/notifications', label: 'Notifications', title: 'Notifications', icon: Bell },
];

/** ACCOUNT section of the sidebar. */
export const PARENT_ACCOUNT_NAV = [
  { tab: 'profile', path: '/parent/profile', label: 'Profile', title: 'My Profile', icon: User },
];

export const PARENT_NAV = [...PARENT_MAIN_NAV, ...PARENT_ACCOUNT_NAV];

/** Every parent module path, for the router. */
export const PARENT_PATHS = PARENT_NAV.map((m) => m.path);

const BY_TAB = new Map(PARENT_NAV.map((m) => [m.tab, m]));
const BY_PATH = new Map(PARENT_NAV.map((m) => [m.path, m]));

/**
 * A `?tab=` value -> the route that now shows it, or null when the value names
 * no module.
 *
 * Returning null rather than a default is deliberate: a stale or crafted link
 * should land on the portal's own front page, not be quietly reinterpreted as
 * some other screen.
 */
export const tabToPath = (tab) => BY_TAB.get(tab)?.path || null;

/** The module a pathname belongs to, for the sidebar's active state and the
 *  page title in the top bar. */
export const moduleForPath = (pathname) => BY_PATH.get(pathname) || null;

export const PARENT_HOME = '/parent/dashboard';

/**
 * Pulls a `?tab=` out of a stored notification link.
 *
 * Rows written before the portal had routes carry `/parent-dashboard?tab=fees`.
 * They are still in `notifications` and there is no reason to migrate them:
 * the shape is unambiguous and this reads it. Rows written from now on carry
 * `/parent/fees` directly and fall straight through.
 */
export const parentLinkToPath = (link) => {
  if (!link) return null;
  if (!link.startsWith('/parent-dashboard')) return link;

  const query = link.split('?')[1] || '';
  const tab = new URLSearchParams(query).get('tab');

  return tabToPath(tab) || PARENT_HOME;
};
