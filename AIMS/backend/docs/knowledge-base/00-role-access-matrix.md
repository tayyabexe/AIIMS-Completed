---
title: Role Access Matrix
audience: staff
---

# Who can see what in AIMS

Derived from the actual route guards in `backend/src/routes/*.js` and the role
groups in `backend/src/config/roles.js`. This is the reference for any question
about whether an account should be able to reach something.

## The eight roles

| ID | Role | Portal |
|----|------|--------|
| 1 | Super Admin | Admin |
| 2 | Admin | Admin |
| 3 | Teacher | Faculty |
| 4 | Student | Student |
| 5 | Parent | Parent |
| 6 | HR | Admin (limited) |
| 7 | Accountant | Admin (limited) |
| 8 | Library | Admin (limited) |

Super Admin is allowed everywhere Admin is. Route files that listed only role 2
previously locked Super Admin out of whole modules, which is why the role groups
exist in one file rather than being written inline.

## Role groups used by the guards

- **ADMINS** — Super Admin, Admin. All write operations.
- **ADMIN_TEACHER** — plus Teacher. Reads the faculty portal needs.
- **ADMIN_STUDENT** — plus Student. Reads the student portal needs.
- **ADMIN_TEACHER_STUDENT** — academic reference data every portal reads.
- **ACADEMIC_REFERENCE** — the above plus Parent. Subjects and semesters are
  catalogue data carrying no personal information, so a parent reading them
  learns nothing about anyone's child.

## Students

A student may read **only their own records**. This is enforced two ways:

- `scopeStudentToSelf` resolves the caller's own `student_id` and filters the
  response. A student naming someone else's id explicitly is refused rather
  than handed an empty list.
- `requireStudentAccess` guards routes where the student is named in the URL.

Reachable: own enrolments, attendance, marks, results, GPA/CGPA, fee vouchers
and payments, timetable, documents, notifications, announcements for their role.

Never reachable: another student's anything, staff records, institute-wide
aggregates.

## Teachers

A teacher's scope is **the classes on their timetable**. The faculty portal
derives this in `facultyPortalService` by resolving the teacher from their
employee record and reading their timetable rows.

Reachable: their own class rosters, attendance for those classes, marks they
enter, class performance, their own schedule and workload, exams for their
subjects.

A teacher is *not* an administrator. They cannot reach fee data, payroll,
institute-wide reports, or students they do not teach.

> **Known gap.** The shared helper `mayAccessStudent` in
> `selfScope.middleware.js` returns true for **any** teacher against **any**
> student, so several REST routes (student documents, marks by student id) are
> broader than this section describes. The AI assistant deliberately does not
> use that helper — it derives faculty scope from the timetable instead.

## Admins

Super Admin and Admin have institute-wide read and write: admissions, staff
onboarding, academic structure, fees, examinations, reports, audit logs, and
credential reissue.

Even an administrator cannot retrieve a stored password. Passwords are hashed
and can only be reset, never read back.

## Parents

A parent may read information about **their registered wards only**, resolved
through the `student_guardians` table. They also read the shared academic
catalogue (subjects, semesters) so their portal can label a timetable.

## Data nobody reaches through the assistant

Regardless of role, the AI assistant reads through a database account that has
no access at all to:

- password hashes
- CNIC / B-Form numbers
- employee salaries and payroll
- stored document files
- other users' assistant conversations

This is enforced by database privileges, not by policy, so it holds even if
every other check were bypassed.
