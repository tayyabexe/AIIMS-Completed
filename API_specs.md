# AIMS — API Specification

**Regenerated:** 2026-08-26 (previous revision: 2026-08-10)
**Backend source:** `AIMS/backend/src/app.js` (mount prefixes) + `AIMS/backend/src/routes/*.js` (router paths)
**Frontend API layer:** `AIMS/frontend/src/api/endpoints.js`
**Base URL:** `http://localhost:5000`, set via `VITE_API_BASE_URL` in `AIMS/frontend/.env`

---

## 0. What changed since 2026-08-10

The previous revision described a codebase that has since moved. Corrections:

| Was stated | Now |
|---|---|
| 205 endpoints | **283** distinct endpoints (297 counting the `/api/parent` alias twice) |
| Frontend at `AIMS-Frontend/client/src` | Frontend is at **`AIMS/frontend/src`** — the separate client repo no longer exists |
| §3.13 "AI — `/api/ai` (6)" | **There is no `/api/ai` mount.** The two live AI services are `/api/chatbot` and `/api/analytics`. See §5 |
| Avatar upload "2MB max" | **1 MB**, and the file signature is verified — the declared MIME type is not trusted |
| `/api/teacher-subjects` DELETE `:teacherId/:subjectId/:batchId` | **`:teacherId/:subjectId`** — a qualification is no longer batch-scoped |
| `/api/marks` (5) | **6** — adds `GET /student/:student_id/assessments` |
| `/api/results` (6) | **9** — adds the three semester-publishing routes |
| `/api/fee-payments` (4) | **8** — adds the declare / verify / queue / history routes |
| `/api/classrooms`, `/api/audit-logs` listed as missing | **Both now exist** — see §3.6 and §3.14 |
| `/api/semesters` "read-only" | Full CRUD, admin-gated |
| §5 "Missing admin-portal APIs" | Rewritten against the current tree — several items have shipped |

New since the last revision: the whole timetable-management layer
(`/api/terms`, `/api/offerings`, `/api/scheduling`), the admin portal's own
surface (`/api/admin`, 26 endpoints), the teacher portal's own surface
(`/api/faculty`, 17), account unlock, semester result publishing, and the
qualification registry.

---

## 1. Conventions

1. Every path is prefixed with `/api`.
2. Authentication is a JWT in `Authorization: Bearer <token>`. The token carries
   `{ user_id, role_id }` and **nothing else** — scope is resolved from the
   database on each request.
3. Requests may also carry `x-aims-acting-user`. It is **not** a credential; it is
   the account the tab believes it is, cross-checked against the token. A mismatch
   is **409** with `session_mismatch: true`. Requests without the header are
   unaffected.
4. Role checks are `authorize(...roleIds)` — `middlewares/rbac.middleware.js`.
   Failure is **403**.
5. Self-scoping (a student sees only their own rows; a parent only their wards')
   is `middlewares/selfScope.middleware.js`. Failure is **403**.
6. Every string in an incoming body is edge-trimmed before any handler sees it.
   Passwords and tokens are exempt.
7. Money endpoints pass through `currency.middleware.js`, which attaches
   `{ code: "PKR", symbol: "Rs." }` to each successful response.
8. `:id`-style segments are numeric primary keys unless stated otherwise.
9. List endpoints accept `page` and `limit`; several also accept `q`, `sort` and
   resource-specific filters.
10. Successful responses are `{ success: true, ... }`; failures are
    `{ success: false, message }`.

### Role IDs and groups

| ID | Role | | Group | Members |
|---|---|---|---|---|
| 1 | Super Admin | | `ADMINS` | 1, 2 |
| 2 | Admin | | `ADMIN_TEACHER` | 1, 2, 3 |
| 3 | Teacher | | `ADMIN_STUDENT` | 1, 2, 4 |
| 4 | Student | | `ADMIN_TEACHER_STUDENT` | 1, 2, 3, 4 |
| 5 | Parent | | `ACADEMIC_REFERENCE` | 1, 2, 3, 4, 5 |
| 6 | HR | | | |
| 7 | Accountant | | | |
| 8 | Library Staff | | | |

Defined once in `backend/src/config/roles.js`.

---

## 2. Endpoint totals

| Prefix | Count | Router file |
|---|---|---|
| `/api/auth` | 8 | `authRoutes.js` |
| `/api/users` | 13 | `userRoutes.js` |
| `/api/students` | 16 | `studentRoutes.js` (15) + `courseOfferingRoutes.js` (1) |
| `/api/parents` and `/api/parent` | 14 | `parentRoutes.js` — same router, both spellings |
| `/api/subjects` | 6 | `subjectRoutes.js` |
| `/api/departments` | 6 | `academicStructureRoutes.js` |
| `/api/programs` | 7 | `academicStructureRoutes.js` |
| `/api/batches` | 6 | `academicStructureRoutes.js` |
| `/api/sections` | 6 | `academicStructureRoutes.js` |
| `/api/semesters` | 6 | `academicStructureRoutes.js` |
| `/api/classrooms` | 6 | `academicStructureRoutes.js` |
| `/api/academics` | 1 | `academicStructureRoutes.js` |
| `/api/terms` | 4 | `courseOfferingRoutes.js` |
| `/api/offerings` | 14 | `courseOfferingRoutes.js` |
| `/api/scheduling` | 4 | `courseOfferingRoutes.js` |
| `/api/timetables` | 6 | `timetableRoutes.js` |
| `/api/enrollments` | 2 | `enrollmentRoutes.js` |
| `/api/attendance` | 8 | `attendanceRoutes.js` |
| `/api/exams` | 5 | `examRoutes.js` |
| `/api/marks` | 6 | `markRoutes.js` |
| `/api/results` | 9 | `resultRoutes.js` |
| `/api/student-results` | 5 | `studentResultRoutes.js` |
| `/api/gpa` | 5 | `gpaRoutes.js` |
| `/api/teachers` | 5 | `teacherRoutes.js` |
| `/api/teacher-subjects` | 5 | `teacherSubjectRoutes.js` |
| `/api/teacher-assignments` | 5 | `teacherAssignmentRoutes.js` |
| `/api/teacher-profiles` | 5 | `teacherProfileRoutes.js` |
| `/api/teacher-schedules` | 5 | `teacherScheduleRoutes.js` |
| `/api/teacher-dashboard` | 1 | `teacherDashboardRoutes.js` |
| `/api/faculty` | 17 | `facultyPortalRoutes.js` |
| `/api/admin` | 26 | `adminPortalRoutes.js` |
| `/api/fee-structures` | 5 | `feeStructureRoutes.js` |
| `/api/fee-vouchers` | 7 | `feeRoutes.js` |
| `/api/fee-payments` | 8 | `feeRoutes.js` |
| `/api/fee-reports` | 2 | `feeReportRoutes.js` |
| `/api/search` | 2 | `searchRoutes.js` |
| `/api/summaries` | 4 | `summaryRoutes.js` |
| `/api/notifications` | 3 | `notificationRoutes.js` |
| `/api/announcements` | 5 | `announcementRoutes.js` |
| `/api/chatbot` | 5 | `chatbotRoutes.js` |
| `/api/analytics` | 10 | `analyticsRoutes.js` |
| **Total** | **283** | |

Plus `GET /` — an unauthenticated health check.

**Dead route files.** `batchRoutes.js`, `sectionRoutes.js`, `programRoutes.js`,
`departmentRoutes.js` and `semesterRoutes.js` are present in the tree but **not
mounted** in `app.js` — they were superseded by `academicStructureRoutes.js` and
carry no `authenticate()`. They are unreachable, but should be deleted rather
than left as a trap.

---

## 3. Endpoint inventory

### 3.1 Authentication — `/api/auth` (8)

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/register` | public | Create an account |
| POST | `/login` | public | Sign in. Body takes an optional `portal`; a role belonging to another portal is refused **before any token exists** |
| POST | `/logout` | public | Client-side session end |
| GET | `/profile` | any signed in | Echo the token's claims |
| PUT | `/change-password` | any signed in | Change own password; clears `must_change_password` |
| POST | `/forgot-password` | public | Returns the same message for every address. **No token is issued** |
| POST | `/reset-password` | public | Consume a reset token. No path currently mints one |
| GET | `/admin` | 1, 2 | Admin bootstrap check |

**Sign-in failure semantics** — every failure returns the same message and time:

| Condition | Status |
|---|---|
| Unknown address, wrong password, deactivated account, wrong portal | **401** |
| 5th failure or a locked account | **423** |

The message adds a remaining-tries countdown from the second failure onwards.
Failures against a non-existent address are counted in memory for 30 minutes so
the countdown reveals nothing.

### 3.2 Users — `/api/users` (13)

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/me` | any | Own account |
| PUT | `/me` | any | Update own email / phone |
| GET | `/me/preferences` | any | Own preference document |
| PUT | `/me/preferences` | any | Merge-update preferences |
| POST | `/me/profile-picture` | any | Upload avatar — **multipart, 1 MB, signature-verified** |
| DELETE | `/me/profile-picture` | any | Remove avatar |
| GET | `/:id/avatar` | any signed in | Serve an avatar as binary with `nosniff`. 404 means "no picture on record" |
| GET | `/` | ADMINS | List (filters: `role_id`, `is_active`, `email`, cohort, `page`, `limit`) |
| GET | `/:id` | ADMINS | Read one |
| POST | `/` | ADMINS | Create |
| PUT | `/:id` | ADMINS | Update |
| DELETE | `/:id` | ADMINS | Soft-delete **and** deactivate |
| POST | `/:id/unlock` | ADMINS | Clear a lock **and** the failure counter |

Account-health cohorts the list supports: `never_logged_in`, `locked`,
`failed_attempts`, `must_change_password`, `inactive`, `orphaned`.

### 3.3 Students — `/api/students` (16)

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/me` | any | Own student record |
| PUT | `/me` | any | Self-service contact edit |
| GET | `/` | ADMIN_TEACHER | List |
| GET | `/search` | ADMIN_TEACHER | Search |
| GET | `/:id` | ADMIN_TEACHER | Read one |
| POST | `/register` | ADMINS | Create a student |
| PUT | `/:id` | ADMINS | Update |
| DELETE | `/:id` | ADMINS | Delete |
| POST | `/:id/restore` | ADMINS | Restore a deleted student |
| PUT | `/:id/enroll` | ADMINS | Enrol into a semester |
| GET | `/guardians/:student_id` | self / ward / staff | Guardians |
| GET | `/documents/:student_id` | self / ward / staff | Document list |
| POST | `/upload-document` | self / ward / staff | Upload — **multipart, 8 MB, PDF or image, signature-verified** |
| GET | `/documents/:id/file` | owner-resolved | Download the bytes |
| DELETE | `/documents/:id` | owner-resolved | Delete a document |
| GET | `/:student_id/classes` | ADMIN_TEACHER_STUDENT + Parent | What this student is taking, who teaches it, where and when |

The student-addressed routes are guarded by `requireStudentAccess`, and the
document-addressed ones by `requireDocumentAccess`, which resolves the row's
owner first.

### 3.4 Parents — `/api/parent` **and** `/api/parents` (14)

Both prefixes mount the same router, so every path exists under both spellings.

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/login` | public | Parent sign-in |
| POST | `/parent-login` | public | Alias |
| POST | `/register` | ADMINS | Create a parent |
| GET | `/` | ADMINS | List with linked children |
| GET | `/profile` | parent | Own record |
| GET | `/children` | parent | Linked students |
| GET | `/attendance` | parent | Children's attendance |
| GET | `/fees` | parent | One settled fee position per child |
| GET | `/results` | parent | Children's published results |
| GET | `/gpa-cgpa` | parent | Children's GPA / CGPA |
| GET | `/timetable` | parent | Children's timetable |
| GET | `/notifications` | parent | Own feed |
| GET | `/search` | any | Role-scoped search |
| GET | `/search/resources` | any | Searchable resources |

Parent sign-in shares the same failure policy and lock counter as `/api/auth/login`.

### 3.5 Faculty portal — `/api/faculty` (17)

Every route resolves the teacher from the token. `?teacher_id=` is honoured for
admins only, which is how the same screens serve a head of department.
**Access: ADMIN_TEACHER on every route.**

| Method | Path | Purpose |
|---|---|---|
| GET | `/dashboard` | Today's lectures, counts, rates, grade spread |
| GET | `/notifications` | Own rows merged with announcements addressed to this teacher |
| GET | `/activity` | Registers marked, marks entered, exams created, notices posted |
| GET | `/badges` | Sidebar counts |
| GET | `/profile` | Own teacher record + load |
| PUT | `/profile` | Contact and specialization only |
| GET | `/classes` | One entry per subject+section, driven by **offerings** — an unplaced class still appears |
| GET | `/classes/:subjectId/:sectionId` | Roster with attendance and marks per student |
| GET | `/attendance` | Register for one class, one date, **one period** |
| POST | `/attendance` | Save a whole register (upsert). Refuses when the day has more than one period and none is named |
| GET | `/attendance/trend` | Day-by-day counts; re-anchors to the last window with records and says so |
| GET | `/exams` | Exams on own subjects |
| POST | `/exams` | Create a scoped exam |
| GET | `/marks` | Marks sheet for one exam and section |
| POST | `/marks` | Bulk upsert marks |
| GET | `/students` | Own students with CGPA / attendance / marks |
| GET | `/reports` | `type=attendance \| marks \| grades \| assignments \| student-performance \| class-summary` |

### 3.6 Academic structure (38)

Six identical CRUD routers plus two extras. **Reads:** `ACADEMIC_REFERENCE`
(classrooms: ADMINS only). **Writes:** `ADMINS`. Every write invalidates the
structure cache.

Each of `/api/departments`, `/api/programs`, `/api/batches`, `/api/sections`,
`/api/semesters`, `/api/classrooms` exposes:

| Method | Path |
|---|---|
| GET | `/` — list with live child counts |
| GET | `/:id` |
| POST | `/` |
| PUT | `/:id` |
| PATCH | `/:id` |
| DELETE | `/:id` — refused while referenced, naming every blocker |

Plus:

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/programs/search` | ACADEMIC_REFERENCE | The list endpoint with `q`. Declared before `/:id` |
| GET | `/api/academics/overview` | ADMINS | The whole structure tree with counts |

`DELETE` here is a **real** delete, not a soft-delete — the unique keys on these
tables do not include the deleted flag, so a hidden row went on reserving its
name. A `1451` foreign-key error from MySQL is translated into the same
`blockedBy` response shape.

### 3.7 Subjects — `/api/subjects` (6)

| Method | Path | Access |
|---|---|---|
| GET | `/` | ACADEMIC_REFERENCE (cached) |
| GET | `/search` | ACADEMIC_REFERENCE |
| GET | `/:id` | ACADEMIC_REFERENCE |
| POST | `/` | ADMINS |
| PUT | `/:id` | ADMINS |
| DELETE | `/:id` | ADMINS |

### 3.8 Timetable management — `/api/terms`, `/api/offerings`, `/api/scheduling` (22)

**Terms (4)**

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/terms` | ADMIN_TEACHER_STUDENT | Every term |
| GET | `/api/terms/current` | ADMIN_TEACHER_STUDENT | The Active term, or the nearest Planned one |
| POST | `/api/terms` | ADMINS | Create |
| PATCH | `/api/terms/:id/status` | ADMINS | Planned → Active → Closed. **Activating while another term is Active is refused** |

**Offerings — the classes (14)**

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/offerings` | ADMIN_TEACHER | List |
| GET | `/api/offerings/:id` | ADMIN_TEACHER | Read one |
| POST | `/api/offerings` | ADMINS | Create one class |
| POST | `/api/offerings/section` | ADMINS | Create every class a section needs for one curriculum semester; existing ones are skipped |
| POST | `/api/offerings/section/enrol` | ADMINS | Enrol the section into every class it has this term |
| PUT / PATCH | `/api/offerings/:id` | ADMINS | Update |
| DELETE | `/api/offerings/:id` | ADMINS | Delete — a class with enrolments or attendance is **cancelled** instead |
| GET | `/api/offerings/:id/teachers` | ADMINS | Eligible teachers, qualified ones flagged, each with their current load |
| PUT | `/api/offerings/:id/teacher` | ADMINS | Assign or change the teacher. Every existing period is checked; **any clash refuses the whole change** |
| POST | `/api/offerings/:id/enrol` | ADMINS | Enrol the section's Active students |
| GET | `/api/offerings/:id/roster` | ADMIN_TEACHER | Who is in the class |
| GET | `/api/offerings/:id/placement` | ADMINS | Every day × period, each with either its blocking reasons or the rooms that would work |
| POST | `/api/offerings/:id/sessions` | ADMINS | Place one meeting on the grid |

**Scheduling (4)**

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/scheduling/status` | ADMINS | The term worklist: unstaffed → not placed → partly placed → over-placed → complete |
| GET | `/api/scheduling/rooms` | ADMINS | Every room against every period this week |
| PUT | `/api/scheduling/sessions/:timetableId` | ADMINS | Move a meeting, validated with the row excluded from its own conflict set |
| DELETE | `/api/scheduling/sessions/:timetableId` | ADMINS | Unplace — **refused (422) if attendance has been recorded** |

Errors here carry their own status: **404** missing offering, **409** clash,
**422** a class not in a state to be scheduled.

### 3.9 Timetables — `/api/timetables` (6)

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/` | ADMIN_TEACHER_STUDENT | List |
| GET | `/current` | any signed in | The live role-scoped week, the slot grid, and which period is running |
| GET | `/:id` | ADMIN_TEACHER_STUDENT | Read one |
| POST | `/` | ADMINS | Create |
| PUT | `/:id` | ADMINS | Update |
| DELETE | `/:id` | ADMINS | Delete |

**The canonical period grid** — enforced by `timetableValidator.js` against
`config/timetableSlots.js`:

| Slot | Start | End |
|---|---|---|
| 1 | 08:30 | 10:00 |
| 2 | 10:00 | 11:30 |
| 3 | 11:30 | 13:00 |
| — | 13:00 | 13:30 — break, **not bookable** |
| 4 | 13:30 | 15:00 |

Three unique indexes on `timetables` make double-booking a section, a teacher or
a room impossible; uniqueness is scoped to the term.

### 3.10 Enrolments — `/api/enrollments` (2)

| Method | Path | Access |
|---|---|---|
| GET | `/` | ADMIN_TEACHER_STUDENT, self-scoped |
| GET | `/student/:student_id` | self / ward / staff |

### 3.11 Attendance — `/api/attendance` (8)

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/` | ADMIN_TEACHER | Mark |
| GET | `/` | ADMIN_TEACHER | List |
| GET | `/:id` | ADMIN_TEACHER | Read one |
| PUT | `/:id` | ADMIN_TEACHER | Amend — audited with the student's name |
| DELETE | `/:id` | ADMINS | Delete |
| GET | `/student/:id` | self / ward / staff | Per-student rows |
| GET | `/report/:student_id` | self / ward / staff | Report |
| GET | `/percentage/:id` | self / ward / staff | Percentage |

Unique key `(student_id, timetable_id, att_date)` — **one entry per student per
period per day.** The eligibility threshold is **75 %**, applied identically in
the reporting views and all four portals.

### 3.12 Exams and marks

**`/api/exams` (5)** — GET `/`, GET `/:id`, POST `/`, PUT `/:id`, DELETE `/:id`. Authenticated.

**`/api/marks` (6)**

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/` | ADMIN_TEACHER | Enter marks |
| PUT | `/:id` | ADMIN_TEACHER | Amend |
| PUT | `/verify/:id` | ADMINS | Draft → Verified. Notifies the teacher who entered it, not the student |
| GET | `/summary` | ADMIN_TEACHER | One aggregated exam score per student, for list screens |
| GET | `/student/:student_id` | self / ward / staff | A student's marks |
| GET | `/student/:student_id/assessments` | self / ward / staff | **Every** assessment their courses carry, graded or not |

**The visibility gate.** `marks.status` is `Draft → Verified → Published`.

| Caller | Sees |
|---|---|
| Student, Parent | `Published` only |
| Teacher, Admin, Super Admin | every status |

On `/assessments` the predicate sits on the JOIN rather than the WHERE, so an
unreleased mark hides the *score* while the sitting still appears, with a state
of `graded`, `pending` or `scheduled`. Subject percentages are computed over
`graded` sittings alone.

### 3.13 Results and GPA

**`/api/results` (9)**

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/grades` | any | The institute's grading ladder |
| GET | `/cgpa/:student_id` | self / ward / staff | CGPA |
| GET | `/transcript/:student_id` | self / ward / staff | Transcript |
| GET | `/report/:exam_id` | any | Exam report |
| POST | `/calculate` | any | **Legacy and known-incorrect** — ignores the semester, averages per exam unweighted, writes CGPA = GPA, and always INSERTs. Not used by the publishing flow. Do not call it |
| PUT | `/publish/:id` | any | Publish one result row |
| GET | `/publishable-semesters` | ADMINS | Every semester with marks, and whether it can be published (`draftMarks` is the blocker) |
| GET | `/semester/:semester_id` | ADMINS | One semester's published results |
| POST | `/publish-semester` | ADMINS | The real publish: `sp_publish_semester_results` — credit-hour weighted GPA, CGPA carried across prior Published semesters, upsert, all in one transaction — then moves every Verified mark in that semester to Published and notifies students and guardians |

**`/api/student-results` (5)** and **`/api/gpa` (5)** — standard CRUD; reads are
`ADMIN_STUDENT` and self-scoped, writes are `ADMINS`.

### 3.14 Teachers (26)

| Prefix | Count | Endpoints | Access |
|---|---|---|---|
| `/api/teachers` | 5 | GET `/`, GET `/:id`, POST, PUT `/:id`, DELETE `/:id` | reads 1,2,3,6 · writes 1,2,6 · delete 1,2 |
| `/api/teacher-profiles` | 5 | full CRUD | reads ADMIN_TEACHER · writes ADMINS |
| `/api/teacher-assignments` | 5 | full CRUD | reads ADMIN_TEACHER · writes ADMINS |
| `/api/teacher-schedules` | 5 | full CRUD | reads ADMIN_TEACHER · writes ADMINS |
| `/api/teacher-dashboard` | 1 | GET `/:id` | ADMIN_TEACHER |
| `/api/teacher-subjects` | 5 | see below | reads ADMIN_TEACHER · writes ADMINS |

**The qualification registry — `/api/teacher-subjects`**

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | One row per teacher with their subjects nested. `?unqualified_only=` is what the screen opens on |
| GET | `/subject/:subjectId` | Who is qualified for one subject — the staffing question |
| POST | `/` | Grant one qualification (`INSERT IGNORE`; the response says added vs already there) |
| PUT | `/teacher/:teacherId` | Replace a teacher's whole set in one transaction |
| DELETE | `/:teacherId/:subjectId` | Revoke — **refused while the teacher holds a live class in that subject**, naming the classes |

A qualification is `(teacher, subject)`. It carries **no batch** — competence to
teach a subject does not expire when a new intake arrives.

### 3.15 Admin portal — `/api/admin` (26)

One endpoint per screen, filtered and paged in SQL. **Access: ADMINS on every
route** (`router.use(authenticate, authorize(...ADMINS))`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/dashboard` | Institute-wide counts (cached) |
| GET | `/activity` | The twelve-row activity feed (cached) |
| GET | `/students` | The student register |
| GET | `/students/export` | The same, as a file |
| GET | `/students/:id` | One student's full profile |
| GET | `/enrollment` | Enrolment figures |
| GET | `/attendance` | Institute-wide attendance |
| GET | `/fees` | The finance screen |
| GET | `/examination` | The examination screen |
| GET | `/parents` | Guardian records |
| GET | `/teachers` | Teacher records |
| GET | `/ai-analytics` | The curated insight panels (cached) |
| GET | `/reports` | Report data |
| GET | `/audit-logs` | The audit trail — filters `module`, `action`, `user_id`, `from`, `to`, `q`; paged |
| POST | `/students/admit` | Admission: student login + record + parent login + parent record + guardian link, in one transaction |
| POST | `/teachers/onboard` | Onboarding: login + employee + teacher, plus assignments and qualifications |
| POST | `/credentials/:userId/reissue` | Issue a new one-time password |
| GET | `/admins` | Staff accounts |
| POST | `/admins` | Create |
| PUT | `/admins/:userId` | Amend |
| DELETE | `/admins/:userId` | Remove (soft-delete **and** deactivate) |
| POST | `/parents` | Create a parent |
| PUT | `/parents/:id` | Amend |
| DELETE | `/parents/:id` | Remove |
| POST | `/parents/:id/children` | Link a child |
| DELETE | `/parents/:id/children/:studentId` | Unlink |

**Guards enforced in the service, not the route:** an admin cannot delete or
deactivate their own account; only a Super Admin may create, amend or promote
into Super Admin; the institute may never be left with zero active Super Admins.

**Credential handling.** Generated passwords are returned exactly once, in the
response that created or reissued them. They are bcrypt-hashed before touching
the database, never logged, and stripped from the audit trail by a key-name
scrubber. Every generated password sets `must_change_password`.

This prefix replaces the ten general-purpose list calls (3.04 MB, ~6.5 s) the
portal used to make on every admin sign-in. The dashboard is now 485 bytes.

### 3.16 Finance (22)

**`/api/fee-structures` (5)** — the catalogue: what a programme's semester costs.
Full CRUD, ADMINS only. A semester's fee is spread across several rows (Tuition,
Examination, Laboratory, Library) and the amount billed is **their sum**.

**`/api/fee-reports` (2)** — GET `/`, GET `/:id`. ADMINS.

**`/api/fee-vouchers` (7)**

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/` | any, student self-scoped | Vouchers |
| GET | `/me` | any, self-scoped | Own whole fee position |
| GET | `/student/:student_id` | any | One student's whole position: every voucher, its instalments, and billed / paid / due / advance |
| GET | `/:id` | any | Read one |
| POST | `/` | ADMINS | Issue. Refuses a second live voucher for a semester the student already holds one for; a **cancelled** voucher does not block a reissue |
| PUT | `/:id` | ADMINS | Amend. `amount_paid` and `remaining_balance` are **not** accepted — they are owned by the payment rows. The bill cannot be lowered below money already taken |
| DELETE | `/:id` | ADMINS | Refused while any payment row exists — Pending, Verified or Rejected. **Cancel instead** |

**`/api/fee-payments` (8)**

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/` | any, student self-scoped | Payments |
| GET | `/history` | any, caller-scoped | The ledger: every status, ordered by decision date, undecided pinned to the top |
| GET | `/submitted` | ADMINS | The work queue — `status` defaults to `Pending` |
| POST | `/submit` | Parent, Student, ADMINS | Declare a payment. Written **Pending**; the voucher is **not** re-settled and **no receipt number is issued**. Cannot exceed what is still owed, counting anything already pending |
| PUT | `/:id/verify` | ADMINS | Verify or reject. Verifying issues the receipt number and re-settles the voucher in one transaction; rejecting keeps the row and stamps the decision time |
| POST | `/` | ADMINS | Record an instalment directly |
| PUT | `/:id` | ADMINS | Amend |
| DELETE | `/:id` | ADMINS | Delete |

**Settlement is server-side and derived.** Every write recomputes the voucher's
`amount_paid`, `remaining_balance` and `status` from its verified instalments.
Overpayment goes into a pool spent oldest-due-date first; anything left is
reported as an **advance**, never netted off the billed total. `Cancelled` is the
only status the arithmetic does not own.

### 3.17 Announcements, notifications, search, summaries (14)

**`/api/announcements` (5)** — GET `/` and `/:id` (any signed in, scoped to the
reader's audience); POST and PUT (ADMINS + Teacher); DELETE (ADMINS).

Audience resolution: `announcement_targets` rows first (each row is a rule; every
column set on it must match; rows OR together), then `target_role` as the
fallback, including `All` / `Everyone`. Admins see everything. A student's
placement is read from their own record, never from the request.

**`/api/notifications` (3)** — GET `/`, PUT `/read-all`, PUT `/:id/read`. Any
signed-in account, own rows only.

**`/api/search` (2)** — GET `/` and GET `/resources`. **No `authorize()` list on
purpose:** search is not allowed or denied per route; which resources it covers
and which rows come back are decided per role inside the controller.

**`/api/summaries` (4)** — GET `/attendance` (ADMIN_TEACHER_STUDENT),
`/fee-status` (ADMIN_STUDENT), `/teacher-workload` and `/class-performance`
(ADMIN_TEACHER). Prefer these over raw table reads: `summaries/attendance`
replaces what would otherwise be a 7.7 MB download of 59,394 rows.

---

## 4. Caching

`middlewares/cache.middleware.js` — tag-based, with per-write invalidation.

| Scope | Meaning |
|---|---|
| `global` | One entry for everyone. Reference data only |
| `role` | One entry per role |
| `user` | One entry per account. Pinned cards and layouts |

The cache sits **after** `authorize`, so a role gate is never bypassed by a warm
entry. Tags: `ACADEMICS`, `SUBJECTS`, `STUDENTS`, `DASHBOARD`, `PINNED`,
`SEARCH`, and one per structural resource. Writes call `invalidates([...tags])`.

---

## 5. The AI services

The single `/api/assistant` route is gone. It combined document lookup with
database querying and fed query results back through the model to summarise
them — which is how a 1,175-row result came to be reported as 200. Two services
replaced it, split because the two jobs want opposite things from a model.

### 5.1 `/api/chatbot` (5) — documentation Q&A

**Roles: Super Admin, Admin, Teacher, Student, Parent.** Rate-limited.

| Method | Path | Purpose |
|---|---|---|
| POST | `/chat` | One RAG turn over the AIMS documentation |
| GET | `/conversations` | History |
| GET | `/conversations/:id` | One conversation |
| DELETE | `/conversations/:id` | Delete one |
| GET | `/capabilities` | What this service can answer |

**It holds no database tools**, which is why parents are served here and nowhere
else: there is no scope to get wrong. The corpus is
`backend/docs/knowledge-base/*.md` (33 documents), embedded locally.

### 5.2 `/api/analytics` (10) — question in, rows out

**Roles: Super Admin, Admin, Teacher.** Students are excluded — every figure a
student is entitled to already has a purpose-built screen.

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/ask` | analytics roles | Question → plan → rows. Rate-limited |
| GET | `/capabilities` | analytics roles | What can be asked |
| GET | `/saved` | ADMINS + Teacher | Pinned cards (cached per user) |
| POST | `/saved` | ADMINS + Teacher | Pin one |
| PATCH | `/saved/:id` | ADMINS + Teacher | Amend |
| DELETE | `/saved/:id` | ADMINS + Teacher | Unpin |
| POST | `/saved/:id/run` | ADMINS + Teacher | Re-run a pinned card |
| GET | `/layout/:surface` | ADMINS + Teacher | Card layout for a surface |
| PUT | `/layout/:surface` | ADMINS + Teacher | Save layout |
| DELETE | `/layout/:surface` | ADMINS + Teacher | Reset to default |

**The rule this service is built around: row data never enters the model.** The
model converts the question into a plan and stops. The database answers the plan.
The rows travel to the browser and are drawn by fixed templates.

**Three controls, in order of load-bearing weight:**

1. **The database account.** Both services read through `aims_ai_ro`, which holds
   `SELECT` and nothing else. Password hashes, CNICs, salaries and payroll are
   unreadable to it.
2. **The scope resolver.** Resolved from the database on every request, never from
   the token, with a 60-second cache — so a revoked assignment takes effect within
   a minute. A teacher may see a student only where the timetable puts them in
   front of that student's section for that subject.
3. **The SQL guard.** Refuses non-SELECT statements, multi-statement bodies, file
   access and schema enumeration, and forces a `LIMIT` the grants cannot express.
   For a teacher, table names are additionally shadowed by CTEs scoped to their
   own roster — which is why their statements may not use `WITH`, may not
   schema-qualify a name, and may only name allowlisted tables.

Row ceilings: `ANALYTICS_MAX_ROWS` (default **50,000**) for the screen; 100 rows
rendered at a time; charts fall back to a table above 300 points. **A result over
the ceiling says so, with the true total from a separate count — it is never
silently trimmed.**

**Rate limits** (`assistantRateLimit.middleware.js`), keyed on the account, not
the IP:

| Window | Limit | Admin |
|---|---|---|
| Minute | 8 | 24 |
| Hour | 60 | 180 |
| Day | 200 | 600 |

Over the limit → **429** with `Retry-After`, `retry_after_seconds` and
`limit_window`. Rejected attempts are recorded too, so ignoring the limit does not
reset the window. Every response carries `X-Assistant-Remaining-Minute` and
`X-Assistant-Remaining-Day`.

### 5.3 `AIMS/AI` — the Python service is not wired in

`AIMS/AI/app.py` is a FastAPI app exposing `/health`, `/predict`, `/reports`,
`/ocr` and `/chat`. **It is not reachable from the product:**

- `app.js` mounts no `/api/ai` prefix.
- `app.py` imports `from chatbot import ask_chatbot`, and `AIMS/AI/chatbot.py`
  is not in the tree — the service will not start as committed.
- `frontend/src/api/endpoints.js` still exports an `ai` object naming six
  `/api/ai/*` paths. **Nothing imports it**, and every one of those paths would
  404.

**Action:** either restore `chatbot.py` and mount a proxy, or delete the `ai`
export from `endpoints.js`. Leaving it is how a future developer wires a screen to
a route that does not exist.

---

## 6. Frontend ↔ backend integration

1. `frontend/src/api/endpoints.js` is the single API layer. No component
   hardcodes a URL.
2. `frontend/src/api/client.js` holds the fetch wrapper: base URL, bearer token,
   the acting-user header, outgoing trimming, per-call timeouts, and the sign-out
   on 401 / 409.
3. `frontend/src/api/session.js` scopes the session to **one browser tab**, so
   two portals can be open at once without overwriting each other's token.
4. Media is fetched as authenticated binary and wrapped in a `blob:` URL, because
   an `<img src>` cannot carry a bearer token — see `hooks/useAuthedImage.js`,
   which revokes the object URL on unmount.

**Known drift (1 item):** the `ai` export described in §5.3. Every other export in
`endpoints.js` resolves to a live route.

---

## 7. Still missing

Tables that exist in the schema and hold data, with no route, controller or
service. Re-checked against the current tree.

### 7.1 HR / employee module — highest priority

| Table | Needed |
|---|---|
| `employees` | `GET/POST /api/employees`, `GET/PUT/DELETE /api/employees/:id` — currently only read indirectly through teacher joins |
| `employee_documents` | list, upload, delete |
| `payroll` | list, read, create, update |
| `leave_requests` | list, create, approve, reject |
| `performance_evaluations` | list, create, update |
| `teacher_attendance` | list, create, update |

The **HR role (6) has no backend permission anywhere.** Its menu is two
self-scoped screens because there is nothing else it can load.

### 7.2 Library module

| Table | Needed |
|---|---|
| `books` | full CRUD |
| `book_issues` | issue, return, fine calculation |

A `book-fine-procedure` stored procedure exists in the database and has no caller.
The **Library role (8)** has no module to point at.

### 7.3 Admin operations

| Table | Needed |
|---|---|
| `meeting_requests` | list, create, decide. The `MeetingRequests.jsx` screen that was built against this has since been removed from the frontend, so the table now has neither an API nor a UI |
| `scholarships` | full CRUD |
| `dashboard_widgets` | per-admin layout persistence |
| `reports` | saved report definitions |

**Now shipped, previously listed here:** `classrooms` (`/api/classrooms`) and
`audit_logs` (`GET /api/admin/audit-logs`).

### 7.4 RBAC administration

| Table | Needed |
|---|---|
| `roles` | `GET/POST /api/roles`, `PUT/DELETE /:id` |
| `permissions` | `GET /api/permissions` |
| `role_permissions` | `GET/PUT /api/roles/:id/permissions` |

Roles are read throughout the backend but cannot be managed through the API.
`role_permissions` is seeded and **read by nothing** — every gate in the codebase
is a hardcoded role list, not a permission lookup.

### 7.5 Institute settings

`frontend/src/pages/admin/Settings.jsx` persists institute name, academic year,
language, date format, timezone, density, font size and five notification toggles
to **`localStorage` only**. These are institute-wide, not per-user, so
`/api/users/me/preferences` is the wrong home.

Needed: `GET` / `PUT /api/settings`, backed by a new `institute_settings` table.

### 7.6 AI prediction persistence

`ai_predictions`, `prediction_models` and `prediction_history` are migrated and
read or written by nothing — the Python service that would use them is not wired
in (§5.3).

### 7.7 Password reset delivery

`POST /api/auth/reset-password` exists and works, but **no code path mints a
reset token**, because there is no mail transport to deliver one safely. Until
one exists, resets are done in person by the admin office. Adding a mailer is
what unblocks self-service reset.

---

## 8. Summary counts

| Metric | Count |
|---|---|
| Backend endpoints (distinct paths) | **283** |
| Counting the `/api/parent` alias separately | 297 |
| Unmounted / dead route files | 5 |
| Frontend exports resolving to a live route | all but the `ai` object |
| Tables with no API surface | 15 |
| Missing endpoints, estimated | ~50 |

---

## 9. Live database

Read from `AIMS/database/schema.sql` and `constraints.sql`, both generated from
the live database rather than maintained by hand.

| Object | Count |
|---|---|
| Tables | **58** |
| Views | **21** |
| Stored procedures | **4** |
| Migrations on disk | **92** |
| Seeders | **15** |

**Which database is which.** `AIMS/backend/.env` and `AIMS/database/.env` each
carry their own `DB_NAME` and they drift. Read both before running a migration
or a script — a migration applied to the database the app is not using looks
exactly like a migration that did nothing.

Stored procedures worth knowing: `sp_publish_semester_results` (the real GPA/CGPA
publish — see §3.13) and the book-fine procedure (no caller, §7.2).
