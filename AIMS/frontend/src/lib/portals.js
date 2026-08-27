import { Student, ChalkboardTeacher, UsersThree, ShieldStar } from '@phosphor-icons/react';

/**
 * The four portals, described once.
 *
 * ON ICONS
 * Phosphor rather than the stroke set the dashboards use. These four glyphs
 * are drawn in `duotone`, which gives each portal a filled ground in its own
 * hue behind a solid outline — a chip that reads as an issued emblem rather
 * than a generic line icon, and one that survives being scaled down to 20px.
 *
 * ON COLOUR
 * Every action on these screens — button, focus ring, link — is Oxford blue,
 * the one primary the design system defines. A portal's own hue is never an
 * action colour; it appears only in small doses that say *which* portal this
 * is: the ruled edge of the plate, the emblem and the ambient aura behind the
 * page. The four hues sit at a common depth and chroma so they read as one
 * family rather than four brands, and each carries a light counterpart for use
 * on the ink pane, where the deep version would not survive.
 *
 * ON COPY
 * Every line here has to be true of the portal as built. These screens used to
 * advertise "12,000+ students managed" and an invented last-login time; none
 * of that was real, and none of it belongs on the door.
 */
export const PORTALS = {
  admin: {
    id: 'admin',
    label: 'Admin Portal',
    short: 'Admin',
    holder: 'Administrator',
    icon: ShieldStar,
    hue: '#8b1d3f',
    hueSoft: '#ffe1e8',
    hueOnInk: '#ffb1c4',
    aura: 'rgba(139, 29, 63, .16)',
    desc: 'Run the institute: people and access, fees, academics and institute-wide reporting.',
    duties: [
      'Users, roles and access control',
      'Fee vouchers, payments and reconciliation',
      'Institute-wide academic and audit reporting',
    ],
    signInTo: '/dashboard',
  },
  faculty: {
    id: 'faculty',
    label: 'Faculty Portal',
    short: 'Faculty',
    holder: 'Faculty member',
    icon: ChalkboardTeacher,
    hue: '#004ac6',
    hueSoft: '#dbe1ff',
    hueOnInk: '#b4c5ff',
    aura: 'rgba(0, 74, 198, .20)',
    desc: 'Teach your sections: attendance, gradebook, assignments and announcements.',
    duties: [
      'Attendance and gradebook for your sections',
      'Assignments, announcements and class material',
      'Your timetable and class reports',
    ],
    signInTo: '/faculty/dashboard',
  },
  student: {
    id: 'student',
    label: 'Student Portal',
    short: 'Student',
    holder: 'Student',
    icon: Student,
    hue: '#00695c',
    hueSoft: '#cdeee7',
    hueOnInk: '#7fd8c8',
    aura: 'rgba(0, 105, 92, .16)',
    desc: 'Your semester in one place: courses, timetable, attendance, results and fees.',
    duties: [
      'Enrolled courses, timetable and material',
      'Attendance record and published results',
      'Fee status and payment vouchers',
    ],
    signInTo: '/student/dashboard',
  },
  parent: {
    id: 'parent',
    label: 'Parent Portal',
    short: 'Parent',
    holder: 'Parent or guardian',
    icon: UsersThree,
    hue: '#8a5300',
    hueSoft: '#ffe6c4',
    hueOnInk: '#ffc06b',
    aura: 'rgba(138, 83, 0, .16)',
    desc: "Follow your ward's term: attendance, timetable, results, fees and notices.",
    duties: [
      "Your ward's attendance and timetable",
      'Published results and progress',
      'Fee status and school notices',
    ],
    signInTo: '/parent/dashboard',
  },
};

export const PORTAL_ORDER = ['student', 'faculty', 'parent', 'admin'];

/** The bare /sign-in route has no parameter; admin is the fallback there. */
export const resolvePortal = (key) => PORTALS[key] || PORTALS.admin;
