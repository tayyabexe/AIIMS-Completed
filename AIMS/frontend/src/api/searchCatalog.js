// What each portal's search bar is allowed to find.
//
// The modules listed per portal are exactly the ones that role can reach, so
// the search can never offer a student a route into an admin screen. Keywords
// are the extra words a person might type for a module ("marks" for Results,
// "challan" for Fee Management) — matching is over label + keywords.
//
// Records are searched separately by each portal's adapter; this file only
// describes navigation targets.

import { PORTALS } from './roles';
import { ADMIN_NAV_ITEMS } from '../pages/admin/adminNav';

/**
 * Student portal. Mirrors the sidebar in pages/student/* and the routes
 * declared under /student/* in App.jsx.
 */
const STUDENT_MODULES = [
  {
    id: 'student-dashboard',
    label: 'Dashboard',
    path: '/student/dashboard',
    keywords: ['home', 'overview', 'summary', 'gpa', 'cgpa'],
  },
  {
    id: 'student-courses',
    label: 'My Courses',
    path: '/student/my-courses',
    keywords: ['subjects', 'subject', 'course', 'enrolled', 'credit hours', 'classes'],
  },
  {
    id: 'student-timetable',
    label: 'Timetable',
    path: '/student/time-table',
    keywords: ['schedule', 'classes', 'periods', 'slots', 'week', 'lectures'],
  },
  {
    id: 'student-attendance',
    label: 'Attendance',
    path: '/student/attendance',
    keywords: ['present', 'absent', 'percentage', 'leaves', 'shortage'],
  },
  {
    id: 'student-results',
    label: 'Results',
    path: '/student/result',
    keywords: ['marks', 'grades', 'gpa', 'cgpa', 'transcript', 'exam', 'score'],
  },
  {
    id: 'student-fees',
    label: 'Fee Management',
    path: '/student/fee-management',
    keywords: ['fees', 'challan', 'payment', 'dues', 'receipt', 'invoice', 'outstanding'],
  },
  {
    id: 'student-documents',
    label: 'Documents',
    path: '/student/document',
    keywords: ['files', 'certificate', 'transcript', 'upload', 'cnic', 'b-form'],
  },
  {
    id: 'student-profile',
    label: 'Profile',
    path: '/student/profile',
    keywords: ['account', 'settings', 'email', 'phone', 'contact', 'personal'],
  },
  {
    id: 'student-notifications',
    label: 'Notifications',
    path: '/student/notifications',
    keywords: ['alerts', 'announcements', 'messages', 'unread'],
  },
];

/** Faculty portal. Mirrors the /faculty/* routes in App.jsx. */
const FACULTY_MODULES = [
  {
    id: 'faculty-dashboard',
    label: 'Dashboard',
    path: '/faculty/dashboard',
    keywords: ['home', 'overview', 'summary'],
  },
  {
    id: 'faculty-classes',
    label: 'My Classes',
    path: '/faculty/my-classes',
    keywords: ['sections', 'courses', 'subjects', 'teaching', 'assigned'],
  },
  {
    id: 'faculty-students',
    label: 'Students',
    path: '/faculty/students',
    keywords: ['roll number', 'registration', 'enrolled', 'class list'],
  },
  {
    id: 'faculty-attendance',
    label: 'Attendance',
    path: '/faculty/attendance',
    keywords: ['mark attendance', 'present', 'absent', 'register'],
  },
  {
    id: 'faculty-marks',
    label: 'Marks',
    path: '/faculty/marks',
    keywords: ['grades', 'results', 'score', 'exam', 'grading'],
  },
  {
    id: 'faculty-assignments',
    label: 'Assignments',
    path: '/faculty/assignments',
    keywords: ['homework', 'submissions', 'tasks', 'due'],
  },
  {
    id: 'faculty-announcements',
    label: 'Announcements',
    path: '/faculty/announcements',
    keywords: ['notice', 'broadcast', 'message'],
  },
  {
    id: 'faculty-timetable',
    label: 'Timetable',
    path: '/faculty/timetable',
    keywords: ['schedule', 'periods', 'slots', 'week', 'lectures'],
  },
  {
    id: 'faculty-reports',
    label: 'Reports',
    path: '/faculty/reports',
    keywords: ['analytics', 'export', 'statistics', 'summary'],
  },
  {
    id: 'faculty-profile',
    label: 'Profile',
    path: '/faculty/profile',
    keywords: ['account', 'personal', 'email', 'contact'],
  },
  {
    id: 'faculty-settings',
    label: 'Settings',
    path: '/faculty/settings',
    keywords: ['preferences', 'password', 'configuration'],
  },
  {
    id: 'faculty-notifications',
    label: 'Notifications',
    path: '/faculty/notifications',
    keywords: ['alerts', 'messages', 'unread'],
  },
];

/*
 * Admin portal.
 *
 * DERIVED FROM THE SIDEBAR, NOT RESTATED
 * --------------------------------------
 * This list used to be written out by hand, and it had drifted badly. The
 * sidebar (pages/admin/adminNav.js) defines seventeen modules; this file
 * listed nine. Enrolment, Parents, Academic Structure, Teachers,
 * Announcements, Notifications, Staff Accounts and the Audit Trail existed as
 * real screens with real URLs and simply could not be found by searching for
 * them — typing "audit" or "announcement" into the header returned nothing,
 * because search only knew about the nine.
 *
 * Two of the nine it did know about were wrong in a way that made them worse
 * than missing: User Management carried `tab: 'user-management'` where the nav
 * declares `tab: 'users'`, and Settings pointed at `path: '/dashboard'`. Both
 * selected the wrong screen when chosen from the results.
 *
 * So the module list is now GENERATED from ADMIN_NAV. A screen that exists in
 * the sidebar is searchable by construction, with its real tab and its real
 * path, and a module added later cannot be forgotten here — which is exactly
 * how the previous eight came to be missing.
 *
 * Only the search keywords are declared by hand below, because they are the
 * one thing the nav has no reason to know: they are the words someone TYPES
 * for a screen rather than the name it is labelled with ("challan" for Fee
 * Management, "log" for the Audit Trail). A module with no entry here is still
 * searchable by its label; it just has no synonyms.
 */

/** Extra words that should find a module, keyed by its nav tab. */
const ADMIN_KEYWORDS = {
  'dashboard': ['home', 'overview', 'summary', 'stats', 'tiles'],
  'students': ['student', 'roll number', 'registration', 'admissions', 'roster', 'directory'],
  'enrollment': ['enrolment', 'enrol', 'enroll', 'registration', 'courses', 'semester', 'intake'],
  'attendance': ['present', 'absent', 'register', 'percentage', 'shortage', 'leaves'],
  'fee-management': ['fees', 'challan', 'payment', 'dues', 'receipt', 'defaulters', 'voucher', 'invoice', 'outstanding'],
  'examination': ['exams', 'marks', 'results', 'grades', 'datesheet', 'transcript', 'gpa', 'cgpa'],
  'parents': ['parent', 'guardian', 'father', 'mother', 'next of kin', 'contact'],
  'academic-structure': ['departments', 'programmes', 'programs', 'batches', 'sections', 'semesters', 'classrooms', 'rooms', 'structure', 'curriculum'],
  'faculty': ['teachers', 'teacher', 'staff', 'lecturers', 'professors', 'instructors', 'employees'],
  'ai-insights': ['insights', 'predictions', 'risk', 'machine learning', 'analytics', 'at risk'],
  'reports': ['analytics', 'export', 'statistics', 'csv', 'pdf', 'download'],
  'announcements': ['announcement', 'notice', 'circular', 'broadcast', 'message', 'bulletin'],
  'notifications': ['alerts', 'notices', 'messages', 'unread', 'bell'],
  'staff-accounts': ['staff', 'admin accounts', 'super admin', 'hr', 'accounts', 'library', 'roles'],
  'users': ['users', 'accounts', 'logins', 'roles', 'permissions', 'credentials', 'password'],
  'audit': ['audit', 'log', 'logs', 'trail', 'history', 'activity', 'who changed', 'changes'],
  'settings': ['preferences', 'configuration', 'account', 'general', 'profile', 'theme'],
};

const ADMIN_MODULES = ADMIN_NAV_ITEMS.map((item) => ({
  id: `admin-${item.tab}`,
  label: item.label,
  path: item.path,
  tab: item.tab,
  keywords: ADMIN_KEYWORDS[item.tab] || [],
}));

/**
 * Parent portal. Like the admin portal these are tabs inside one shell rather
 * than separate routes, so each entry carries the tab to switch to.
 *
 * A parent may only reach what concerns their own children — attendance,
 * results, fees, timetable and notices. There is deliberately no entry that
 * leads to another family's records, to a class roster, or to any
 * administrative screen.
 */
const PARENT_MODULES = [
  {
    id: 'parent-dashboard',
    label: 'Dashboard',
    path: '/parent/dashboard',
    keywords: ['home', 'overview', 'summary'],
  },
  {
    id: 'parent-children',
    label: 'My Children',
    path: '/parent/my-children',
    keywords: ['child', 'ward', 'son', 'daughter', 'students', 'enrolled'],
  },
  {
    id: 'parent-attendance',
    label: 'Attendance',
    path: '/parent/attendance',
    keywords: ['present', 'absent', 'percentage', 'shortage', 'leaves'],
  },
  {
    id: 'parent-results',
    label: 'Results',
    path: '/parent/results',
    keywords: ['marks', 'grades', 'gpa', 'cgpa', 'exam', 'transcript', 'score'],
  },
  {
    id: 'parent-fees',
    label: 'Fee Details',
    path: '/parent/fees',
    keywords: ['fees', 'challan', 'payment', 'dues', 'receipt', 'invoice', 'outstanding', 'overdue'],
  },
  {
    id: 'parent-timetable',
    label: 'Timetable',
    path: '/parent/timetable',
    keywords: ['schedule', 'classes', 'periods', 'slots', 'week', 'lectures'],
  },
  {
    id: 'parent-notifications',
    label: 'Notifications',
    path: '/parent/notifications',
    keywords: ['alerts', 'announcements', 'notices', 'messages', 'unread'],
  },
  {
    id: 'parent-profile',
    label: 'My Profile',
    path: '/parent/profile',
    keywords: ['account', 'settings', 'email', 'phone', 'contact'],
  },
];

export const MODULES_BY_PORTAL = {
  [PORTALS.STUDENT]: STUDENT_MODULES,
  [PORTALS.FACULTY]: FACULTY_MODULES,
  [PORTALS.ADMIN]: ADMIN_MODULES,
  [PORTALS.PARENT]: PARENT_MODULES,
};

export const modulesForPortal = (portal) => MODULES_BY_PORTAL[portal] || [];

/**
 * Scores a module against a query. Returns 0 when it does not match.
 * An exact label hit outranks a prefix hit, which outranks a keyword hit, so
 * typing "res" puts Results above Reports.
 */
export const scoreModule = (module, query) => {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const label = module.label.toLowerCase();
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.includes(q)) return 60;

  const keyword = (module.keywords || []).find((k) => k.toLowerCase().includes(q));
  if (keyword) return keyword.toLowerCase().startsWith(q) ? 40 : 25;

  return 0;
};

/** Modules in a portal matching `query`, best match first. */
export const searchModules = (portal, query, limit = 6) =>
  modulesForPortal(portal)
    .map((m) => ({ module: m, score: scoreModule(m, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.module);
