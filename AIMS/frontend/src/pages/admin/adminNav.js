/*
 * The admin portal's navigation map — one place that defines every module, its
 * URL and its sidebar entry.
 *
 * WHY THIS EXISTS
 * ---------------
 * The portal had routes for nine of its modules in App.jsx, but the sidebar
 * never used them: each button called setAdminSubTab() directly and nothing
 * touched the URL. So every screen in the portal was served at whatever address
 * you happened to land on — in practice /dashboard for all of them. That made a
 * module impossible to bookmark, impossible to link to, impossible to open in a
 * second tab, and it meant the browser's back button left the portal entirely
 * instead of going back one screen.
 *
 * Five modules had no route at all: Student Profile, Parents, Teachers,
 * Notifications and Settings.
 *
 * The sidebar and the shell now both read this list, so a module cannot exist
 * in the navigation without a URL, or have a URL the router does not know.
 *
 * Note on `/teachers`: the admin's teacher-management screen cannot live at
 * /faculty — that prefix is the teachers' own portal, which is a different app
 * behind a different role guard.
 */

import {
    LayoutGrid, GraduationCap, UserCheck, DollarSign, BookOpen,
    BrainCircuit, BarChart3, Settings, Users, Bell, Shield, Megaphone,
    UserCog, Network, ClipboardList, ShieldCheck, ScrollText, Sparkles,
    CalendarRange, BookMarked,
} from 'lucide-react';

export const ADMIN_NAV = [
    {
        section: 'MAIN',
        items: [
            { tab: 'dashboard', path: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
        ],
    },
    {
        section: 'ACADEMIC',
        items: [
            { tab: 'students', path: '/students', label: 'Students', icon: GraduationCap },
            /*
             * Enrolment sits directly under Students because it is the same
             * population counted rather than listed, and clicking any of its
             * figures opens the roster behind it.
             */
            { tab: 'enrollment', path: '/enrollment', label: 'Enrolment', icon: ClipboardList },
            { tab: 'attendance', path: '/attendance', label: 'Attendance', icon: UserCheck },
            { tab: 'fee-management', path: '/fee-management', label: 'Fee Management', icon: DollarSign },
            { tab: 'examination', path: '/examination', label: 'Examination', icon: BookOpen },
            { tab: 'parents', path: '/parents', label: 'Parents', icon: Users },
            /*
             * The structure the rest of the portal hangs off — departments,
             * programmes, batches, sections, rooms and semesters. Last in this
             * group because it is the thing changed least often and the thing
             * whose changes reach furthest.
             */
            { tab: 'academic-structure', path: '/academic-structure', label: 'Academic Structure', icon: Network },
            /*
             * Timetable management: terms, classes, staffing and placement.
             *
             * It sits directly after Academic Structure because it consumes
             * everything that screen defines - a class is a section studying a
             * subject in a room - and because building a term is the next
             * thing you do once that structure exists.
             */
            { tab: 'timetable', path: '/timetable', label: 'Timetable', icon: CalendarRange },
        ],
    },
    {
        section: 'FACULTY',
        items: [
            { tab: 'faculty', path: '/teachers', label: 'Teachers', icon: Shield },
            /*
             * Which subjects each teacher may teach.
             *
             * It sits beside Teachers rather than under Academic, because the
             * row it edits is a standing fact about a *person* - no term, no
             * section, no batch - and the question it answers is asked about
             * a teacher, not about a curriculum.
             *
             * The table existed and had endpoints from the beginning, but no
             * screen ever called them, so the registry that sorts the staffing
             * shortlist could only be written by the provisioning service and
             * never corrected.
             */
            { tab: 'qualifications', path: '/qualifications', label: 'Qualifications', icon: BookMarked },
        ],
    },
    {
        section: 'INSIGHTS',
        items: [
            /*
             * Two different things, deliberately kept apart.
             *
             * "AI Insights" is the curated dashboard: fixed panels answering
             * questions someone decided in advance were worth a permanent
             * screen.
             *
             * "Ask the Data" is the free-form canvas. You type a question, it
             * becomes a query, and the rows come back. Nothing about the
             * result is written by a language model.
             */
            { tab: 'ai-insights', path: '/ai-analytics', label: 'AI Insights', icon: BrainCircuit },
            { tab: 'ai-ask', path: '/ask-the-data', label: 'Ask the Data', icon: Sparkles },
            { tab: 'reports', path: '/reports', label: 'Reports', icon: BarChart3 },
        ],
    },
    {
        section: 'ADMIN',
        items: [
            { tab: 'announcements', path: '/announcements', label: 'Announcements', icon: Megaphone },
            { tab: 'notifications', path: '/notifications', label: 'Notifications', icon: Bell },
            /*
             * Staff accounts: Super Admin, Admin, HR, Accounts and Library.
             * Distinct from User Management below, which lists every login the
             * institute has issued — 4,000-odd of them, mostly students and
             * parents. This one is the handful of administrative accounts, and it
             * is the only place they can be created, renamed or disabled.
             */
            { tab: 'staff-accounts', path: '/staff-accounts', label: 'Staff Accounts', icon: ShieldCheck },
            { tab: 'users', path: '/user-management', label: 'User Management', icon: UserCog },
            /*
             * The audit trail. It sits with the account screens rather than
             * under Insights because it is not analysis — it is the record of
             * what the people with these accounts have done, and it is read
             * for the same reasons those screens are opened.
             *
             * Also reachable from the dashboard's activity card, which is a
             * twelve-row window onto this same list.
             */
            { tab: 'audit', path: '/audit', label: 'Audit Trail', icon: ScrollText },
            { tab: 'settings', path: '/settings', label: 'Settings', icon: Settings, spaced: true },
        ],
    },
];

// Flat view of the same list, for the lookups below.
export const ADMIN_NAV_ITEMS = ADMIN_NAV.flatMap((group) => group.items);

/*
 * WHICH MODULES EACH ROLE MAY ACTUALLY OPEN
 * -----------------------------------------
 * The `roles` table has eight rows, and HR (6), Accountant (7) and Library
 * Staff (8) all have real accounts. `api/roles.js` sends all three to the ADMIN
 * portal because they have no portal of their own.
 *
 * But almost every admin endpoint is guarded by `authorize(...ADMINS)`, and
 * ADMINS is only [Super Admin, Admin]. So those three signed in, were shown
 * this entire sidebar, and got a 403 from nearly everything they clicked — a
 * menu of twenty items where two worked.
 *
 * This map is the honest version: each role sees the modules its token can
 * actually load. It is deliberately DESCRIPTIVE, not aspirational — it grants
 * nothing, it only stops the portal advertising what the server will refuse.
 * The server remains the authority; this is the menu agreeing with it.
 *
 * What each of the three can really do today:
 *   - Accountant  the fee module, because feeController explicitly admits role
 *                 7 alongside the admins. This is the only special-case for any
 *                 of the three anywhere in the backend.
 *   - HR          nothing of its own. It has no backend permission at all.
 *   - Library     nothing of its own. There is no library table in the schema.
 *
 * Roles absent from this map (Super Admin, Admin) see everything.
 */
const ROLE_MODULES = {
    // HR — no permissions granted anywhere in the backend. Until the role has
    // real reach, its menu is the two self-scoped screens every account has.
    6: ['notifications', 'settings'],
    // Accountant — fee management is genuinely theirs.
    7: ['fee-management', 'notifications', 'settings'],
    // Library Staff — no library module exists to point at.
    8: ['notifications', 'settings'],
};

/**
 * The sidebar for one role.
 *
 * Returns ADMIN_NAV unchanged for Super Admin, Admin and anything not listed
 * above, and a filtered copy — with empty sections dropped — for the rest.
 */
export const navForRole = (roleId) => {
    const allowed = ROLE_MODULES[Number(roleId)];
    if (!allowed) return ADMIN_NAV;

    return ADMIN_NAV
        .map((group) => ({
            ...group,
            items: group.items.filter((item) => allowed.includes(item.tab)),
        }))
        .filter((group) => group.items.length > 0);
};

// True when this role may open that module at all. Used to keep a bookmarked
// or hand-typed URL from rendering a screen whose every request will 403.
export const canOpenModule = (roleId, tab) => {
    const allowed = ROLE_MODULES[Number(roleId)];
    return !allowed || allowed.includes(tab);
};

/*
 * Modules that have a URL but no sidebar entry.
 *
 * A student's profile is one of them, and it stopped being a sidebar entry on
 * purpose. As a top-level destination it opened with no student chosen — the
 * sidebar could not name one — so the screen's own first state was "No student
 * selected", offering a search box and a link to the Students list. It was a
 * dead end that existed only to send you somewhere else.
 *
 * A profile is now reached by clicking a student in the list, and it lives
 * underneath that list at /students/:studentId, which is what the URL always
 * meant. The old /student-profile addresses are redirected in App.jsx so
 * anything already bookmarked still lands in the right place.
 */
export const ADMIN_HIDDEN_ROUTES = [
    { tab: 'student-profile', path: '/students/:studentId' },
];

// Every admin URL, for App.jsx to register in one place.
export const ADMIN_PATHS = [
    ...ADMIN_NAV_ITEMS.map((item) => item.path),
    ...ADMIN_HIDDEN_ROUTES.map((item) => item.path),
];

const TAB_BY_PATH = new Map(ADMIN_NAV_ITEMS.map((item) => [item.path, item.tab]));
const PATH_BY_TAB = new Map(ADMIN_NAV_ITEMS.map((item) => [item.tab, item.path]));

/**
 * Which module a URL is asking for. Unknown paths fall back to the dashboard,
 * matching what the router does with them.
 *
 * `/students/42` is the one address whose module is not decided by its first
 * segment: it is the Students section, but the profile screen. Everything else
 * ignores anything after the first segment, so /students?status=Active and
 * /reports/anything still resolve to their own module.
 */
export function tabForPath(pathname) {
    const segments = String(pathname || '').split('/').filter(Boolean);
    const clean = `/${segments[0] || ''}`;

    if (clean === '/students' && segments.length > 1) return 'student-profile';

    return TAB_BY_PATH.get(clean) || 'dashboard';
}

/**
 * The URL for a module, for the code paths that still navigate by tab name.
 *
 * `student-profile` resolves to the list rather than to a profile, because
 * without a student id there is no profile to show — see ADMIN_HIDDEN_ROUTES.
 */
export function pathForTab(tab) {
    if (tab === 'student-profile') return '/students';
    return PATH_BY_TAB.get(tab) || '/dashboard';
}

/** The URL of one student's profile. */
export function studentProfilePath(studentId) {
    return studentId ? `/students/${studentId}` : '/students';
}
