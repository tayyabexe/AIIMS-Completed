---
title: Admin Portal Guide
audience: staff
---

# The Admin portal

Institute-wide read and write. Super Admin (role 1) and Admin (role 2) have the
same access.

## Screens

| Screen | Route | What it is for |
|---|---|---|
| Dashboard | `/admin` | Institute-wide KPIs |
| Students | `/admin/students` | Admissions, records, credential reissue |
| Teachers | `/admin/teachers` | Onboarding and staff records |
| Academics | `/admin/academics` | Programmes, batches, sections, semesters, subjects |
| Enrollment | `/admin/enrollment` | Subject enrolment per semester |
| Attendance | `/admin/attendance` | Institute-wide attendance oversight |
| Examination | `/admin/examination` | Exam scheduling and result publication |
| Fees | `/admin/fees` | Structures, vouchers, payments, verification |
| Reports | `/admin/reports` | Exportable operational reports |
| Audit Logs | `/admin/audit-logs` | Record of administrative actions |
| Settings | `/admin/settings` | System configuration |

## Admitting a student

**Students → Admit**. Creates the user account, the student record and the
login credentials together. Assign programme, batch, section and current
semester at admission — a student without a section cannot be timetabled.

## Onboarding a teacher

**Teachers → Onboard**. Creates the user account, employee record and teacher
record. A teacher has no classes until they appear on a timetable, so
onboarding alone does not give them a portal with anything in it.

## Publishing results

Publication is per semester, not per student. Until a semester is published its
GPAs are not visible to students and are excluded from CGPA.

## Verifying payments

Payments arrive as **Pending** and must be verified before they count as
settled. The verification trail records who approved each one and when. A
backlog of pending payments shows up to students as an unsettled balance, so it
is worth clearing promptly.

## Reports available

Enrolment distribution, fee collection and defaulters, attendance by programme,
CGPA distributions, teacher workload, and per-student lookups.

## Using the AI assistant

Ask in plain English — "how many students per programme", "who has overdue
fees", "which teachers are overloaded".

For questions no report covers, the assistant can query the database directly
and will do so automatically. It is **read-only at the database account level**:
it cannot insert, update or delete anything, and it cannot read password
hashes, CNICs, salaries, payroll or other users' conversations. Those
restrictions are enforced by database privileges rather than by instructions,
so they hold regardless.

Every query it runs is recorded with the account, the tool, the arguments and
the SQL, successful or refused.
