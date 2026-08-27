# AIMS — Gaps and Limitations

**What AIMS does not do, and what it would take to close each gap.**

AIMS works well for the cycle it covers: admission → enrolment → timetable →
attendance → marks → results → fees. This document is about what a real
institute would find missing on top of that.

Everything here was verified against the code, not inferred from the
documentation. Where a feature is partly present, this says exactly how far it
goes.

**Effort:** **S** ≈ days · **M** ≈ 1–3 weeks · **L** ≈ 1–3 months, for one
developer familiar with the codebase.

---

## Priority summary

| # | Gap | Impact | Effort |
|:--:|---|---|:--:|
| 1 | **Elective courses** — no concept at all | Blocks any programme with choice | **L** |
| 2 | **Student self-registration** for courses | Enrolment stays a clerical job | **L** |
| 3 | **Semester progression** — no promotion workflow | Every new term is rebuilt by hand | **M** |
| 4 | **Retake / repeat / grade replacement** | A failing student cannot be handled correctly | **M** |
| 5 | **Prerequisites stored but never enforced** | Students enrol in courses they are not ready for | **S** |
| 6 | **Credit-hour load rules** — no min/max per semester | Nothing stops an impossible load | **S** |
| 7 | **Password policy** — 8 characters, nothing else | Real security weakness | **S** |
| 8 | **No automated tests** | Every change risks silent regression | **L** |
| 9 | **HR / payroll / library / leave** — tables, no screens | Whole departments unserved | **L** each |
| 10 | **Teacher choice of section** | Common in universities; not supported | **M** |
| 11 | **Two attendance thresholds** (80 vs 75) | Students see a different rule | **S** |
| 12 | **No institute-wide settings** | Cannot be branded or configured | **M** |
| 13 | **Permission tables unused** | Cannot grant fine-grained access | **M** |
| 14 | **No online payment** | Every payment is manual and verified by hand | **M** |
| 15 | **No email / SMS** | Nothing reaches anyone outside the app | **M** |

---

## 1. Academic gaps

These matter most, because they are the difference between a school system and
a university system.

### 1.1 Elective courses — not modelled at all

**Status: ✗ Nothing exists.** There is no `is_elective` column, no elective
group, no capacity, no election period, no preference ordering. The word does
not appear in the schema or the backend.

Today every subject in a programme semester is compulsory for the whole cohort.
`enrolCohort()` enrols an entire section into every subject of its semester.

**What a real institute needs:**

- Subjects marked core or elective
- **Elective groups** — "choose 2 of these 5"
- **Capacity** per elective offering, and what happens when it fills
- An **election window** with a deadline
- **Preference ordering**, and an allocation rule when demand exceeds supply
- Credit-hour totals that stay correct when students take different subjects

**Why it is large:** it changes the shape of enrolment. Today enrolment is a
property of the *section*; with electives it becomes a property of the
*student*. That touches enrolment, the timetable (elective students come from
several sections), attendance registers, marks sheets and GPA.

**Effort: L.** This is the single biggest gap.

### 1.2 Student self-registration — not supported

**Status: ✗** Students cannot register for anything. Enrolment is an
administrative action only.

Needs: a registration window, a student-facing course-selection screen, clash
detection against the student's own timetable, credit-hour limits, and an
add/drop period with its own deadline.

**Depends on §1.1** — self-registration without electives is only useful for
add/drop.

**Effort: L.**

### 1.3 Semester progression — no promotion workflow

**Status: ✗** There is no operation that moves a cohort from one semester to the
next.

A student's current semester is *derived from their enrolments*, which is a
sound design — but it means progression happens implicitly, as a side effect of
somebody enrolling them in the next term's classes. There is no step that says
"this batch has completed semester 3", no check that they passed enough credits,
and no handling of a student who should repeat.

**Needs:** a promotion operation per batch, promotion criteria (minimum CGPA,
minimum credits earned), a probation state, and a repeat path for students who
do not qualify.

**Effort: M.**

### 1.4 Retake, repeat and grade replacement

**Status: ✗** A student who fails a subject has no defined path.

`enrollments.status` includes `Dropped`, and the GPA calculation correctly
excludes dropped enrolments. But there is no concept of:

- retaking a failed subject in a later term
- which attempt counts toward CGPA — best, latest, or both
- a transcript that shows the attempt history
- a cap on attempts

Enrolling a student in the same subject twice would produce two enrolment rows
and two sets of marks, and the GPA would count **both**.

**Effort: M.** The GPA and transcript logic is the delicate part.

### 1.5 Prerequisites — stored, displayed, never enforced

**Status: ◑ Half-built.**

`subjects.prerequisite_subject_id` exists. It is exposed by
`vw_program_semester_catalog`, returned by the enrolment explorer, and described
to the AI assistant.

**Nothing checks it.** `enrolCohort()` does not consult it. A student can be
enrolled in a subject whose prerequisite they have never taken, let alone
passed.

**Needs:** a check at enrolment, a clear refusal naming the missing
prerequisite, and an override for an administrator with a reason recorded.

Note the current model allows only **one** prerequisite per subject. Real
programmes often need "A and B", or "A or B", which means a join table.

**Effort: S** to enforce the single-prerequisite model. **M** to generalise it.

### 1.6 Credit-hour load rules

**Status: ✗** `credit_hours` exists on every subject and is used correctly for
GPA weighting. But nothing constrains **how many** credit hours a student may
take.

There is no minimum for full-time status, no maximum, and no per-programme
total for graduation. Nothing detects that a student is short of credits to
graduate.

**Effort: S** for min/max per semester. **M** including graduation audit.

### 1.7 Section capacity

**Status: ✗** `sections` and `classrooms` both carry capacity, and the timetable
matches a room's *type*. But nothing prevents enrolling more students into a
section than the room holds, or than the section declares.

**Effort: S.**

### 1.8 Mid-term withdrawal

**Status: ◑** A student can be marked `Withdrawn` at the record level, and an
enrolment can be `Dropped`. There is no workflow around it: no effective date,
no fee proration, no rule about whether a withdrawal appears on a transcript,
and no impact on attendance denominators.

**Effort: M.**

---

## 2. Teacher and staffing gaps

### 2.1 Student choice of teacher

**Status: ✗** A section has one teacher per subject, assigned by an
administrator.

In universities where the same course runs in several sections with different
teachers, and students choose, AIMS cannot express it. That needs multiple
offerings of one subject in one term, each with its own teacher, capacity and
timetable slot — and students selecting between them.

**Depends on §1.1 and §1.2.**

**Effort: M** on top of those.

### 2.2 Teacher workload limits

**Status: ✗** The qualification registry controls *what* a teacher may teach.
The placement engine prevents *clashes*. Nothing limits the total.

No maximum periods per week, no maximum sections, no contracted-hours check.
`vw_teacher_workload` reports the load; nothing enforces a ceiling.

**Effort: S.**

### 2.3 Substitute teachers

**Status: ✗** No concept of a substitute for an absent teacher. Attendance for a
period is tied to the assigned teacher.

**Effort: M.**

---

## 3. Modules with tables but no interface

These tables exist in the schema, carry foreign keys, and are **entirely
unreachable** from any screen or API route. They were designed and never built.

| Table | Intended for | Backend references |
|---|---|:--:|
| `books`, `book_issues` | Library circulation | Delete-guards only |
| `payroll` | Salary processing | None |
| `employee_documents` | Staff document storage | None |
| `leave_requests` | Staff leave | None |
| `performance_evaluations` | Staff appraisal | None |
| `teacher_attendance` | Staff attendance | None |
| `scholarships` | Fee concessions | Delete-guard only |
| `meeting_requests` | Parent–teacher meetings | Almost none |
| `ai_predictions`, `prediction_models`, `prediction_history` | ML predictions | None |
| `dashboard_widgets` | Configurable dashboards | None |

There is also a stored procedure, **`sp_calculate_book_fines`**, for a library
module that has no interface — and nothing calls it.

### What this means

The **HR** and **Library Staff** roles are defined, enforced by the role gate,
and map to the admin portal — but have **no screens of their own**. A person
given either role sees an admin portal with nothing in it that belongs to them.

**Effort: L per module.** Each is a full CRUD module with its own rules.

> **Recommendation:** decide per module whether to build it or drop the tables.
> Carrying schema for features that do not exist misleads the next developer —
> the tables look like working features until you search for the code.

---

## 4. Financial gaps

| Gap | Status | Effort |
|---|---|:--:|
| **Online payment gateway** | ✗ Payment happens outside AIMS and is declared, then verified by hand | **M** |
| **Scholarships and concessions** | ✗ Table exists; no interface, no effect on a voucher | **M** |
| **Late fees / fines** | ✗ `sp_mark_overdue_fees` exists but nothing schedules it | **S** |
| **Refunds** | ✗ Overpayment carries forward; there is no refund path | **M** |
| **Instalment plans** | ◑ Instalments are recorded; there is no plan or schedule to define upfront | **M** |
| **Per-student fee adjustment** | ✗ Structures are per programme and semester only | **M** |
| **Financial reporting** | ◑ Collection and defaulter reports exist; no ledger, no reconciliation, no export to accounting | **M** |
| **Multi-currency** | ✗ PKR is fixed throughout | **M** |

---

## 5. Communication gaps

| Gap | Status | Consequence |
|---|---|---|
| **Email delivery** | ✗ Not configured | No password reset by email, no receipts, no notices off-platform |
| **SMS delivery** | ✗ Not configured | Guardians without the app are unreachable |
| **Parent–teacher meetings** | ✗ Table exists, no interface | Scheduling happens outside AIMS |
| **Direct messaging** | ✗ | Announcements are one-way |
| **Push notifications** | ✗ | Notifications only exist inside the app |

**Email is the most consequential.** Its absence is why password reset must be
performed by an administrator in person — a real operational cost that grows
with the institute.

**Effort: M** for email, including a transport, templates and a queue.

---

## 6. Security gaps

Detail and mitigations are in `SECURITY.md`. Summarised here because they belong
on the same list.

| Gap | Detail | Effort |
|---|---|:--:|
| **No password complexity policy** | `authValidator.js` enforces `min: 8` and nothing else. No uppercase, digit, symbol, dictionary or reuse check. | **S** |
| **No global rate limiting** | Only the two AI routes are limited. Sign-in relies on account locking after five failures. | **S** |
| **Permission tables unused** | `permissions` (18 rows) and `role_permissions` (35) are seeded, but `authorize()` compares **role IDs only**. Nothing reads them. Fine-grained permissions are impossible without a code change. | **M** |
| **No MFA** | Not supported. | **M** |
| **Token in `sessionStorage`** | Deliberate — per-tab sessions — but readable by any successful XSS. | **M** |
| **Secrets were committed** | `.env` files were tracked. Every secret in git history must be treated as compromised. | **S** (rotate) |
| **No password expiry or history** | A password can be reused indefinitely. | **S** |

---

## 7. Operational gaps

| Gap | Status | Effort |
|---|---|:--:|
| **Automated test suite** | ✗ `npm test` prints "No tests yet". Manual suites exist in `backend/src/testing/` and must be run by hand. | **L** |
| **CI/CD** | ✗ None | **M** |
| **Health endpoint** | ✗ Nothing to point a monitor at | **S** |
| **Structured logging** | ✗ `morgan("dev")` to stdout, unrotated | **S** |
| **Monitoring / alerting** | ✗ None | **M** |
| **Scheduled backups** | ✗ Script exists; nothing schedules it | **S** |
| **Scheduled jobs generally** | ✗ Nothing runs on a schedule, including the two stored procedures written for it | **S** |
| **Multi-instance support** | ✗ Caches and rate limiters are in-process | **M** |
| **Deployment infrastructure** | ✗ No Dockerfile, reverse-proxy config or process-manager unit | **M** |

---

## 8. Known defects

Not missing features — things that are wrong.

| # | Defect | Evidence | Effort |
|:--:|---|---|:--:|
| D-1 | **AI retrieval settings have no effect.** `orchestrator.js` passes `limit`; `vectorStore.js` reads `topK`. Config says top 10 / floor 0.30; **top 5 / floor 0.35 actually runs**. | `orchestrator.js:260`, `vectorStore.js:148` | **S** |
| D-2 | **Two attendance thresholds.** The student dashboard colours courses against **80%**; faculty and admin use **75%**. A student sees a different rule from their teacher. | `StudentDashboard.jsx:511,517` vs `attendancePanels.jsx:28` | **S** |
| D-3 | **Dead AI prediction panel.** The student dashboard calls `/api/ai/predict/:id`, which the backend never mounts. It 404s, the error is swallowed, and the panel never renders. | `StudentDashboard.jsx:127` | **S** |
| D-4 | **Unused dependency.** `tesseract.js` is a frontend dependency that nothing imports, and it is not small. | `package.json` | **S** |
| D-5 | **Committed build artefacts.** `frontend/dist/` was committed with `localhost:5000` compiled in — unusable anywhere but a developer machine. | `dist/assets/client-*.js` | **S** |

---

## 9. What AIMS does well

For balance, and so effort is not spent re-doing solved problems.

- **Server-side authority.** Every rule and permission is enforced on the
  server. The browser hides nothing that matters.
- **One definition per figure.** Database views carry definitions, so two
  screens cannot compute "defaulter" differently.
- **Constraints in the database.** "Only one active term" is a unique index,
  not a service check — it holds against scripts and direct SQL too.
- **The marks workflow.** Draft → Submitted → Released, with the teacher unable
  to approve their own entry, is a genuine separation of duties.
- **Per-period attendance.** Correct, and harder than per-day.
- **The sign-in failure policy.** One message for every failure, a ghost counter
  for unknown addresses, locking after five.
- **The AI design.** Row data never enters the model, and every query runs on a
  `SELECT`-only account. Built after a real failure, and built correctly.
- **Auditability.** Significant changes are recorded, credentials scrubbed,
  rendered as readable sentences.

---

## 10. Suggested sequence

**Before going live** — small, and each removes a real risk:
1. Password complexity policy (§6)
2. Rotate every secret that was in git history (§6)
3. Reconcile the attendance threshold, D-2
4. Add a health endpoint (§7)
5. Schedule backups (§7)
6. Enforce prerequisites, §1.5

**First quarter** — makes the system operable:
7. Automated tests around fees, GPA and access control (§7)
8. Email delivery (§5)
9. Semester progression (§1.3)
10. Credit-hour load rules (§1.6)
11. Decide, per unused module, build or drop (§3)

**Beyond** — makes it a university system:
12. Electives (§1.1)
13. Student self-registration (§1.2)
14. Retake and grade replacement (§1.4)
15. Teacher choice (§2.1)
16. Online payment (§4)

---

## Related documents

| Document | Covers |
|---|---|
| `SRS.md` | Every requirement, marked implemented / partial / not implemented |
| `SECURITY.md` | §6 in full, with mitigations |
| `PROJECT_OVERVIEW.md` | What the system does today |
| `AI_IMPLEMENTATION.md` | D-1 in detail |
