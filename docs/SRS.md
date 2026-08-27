# AIMS — Software Requirements Specification

**What the system is required to do, and the rules it must enforce.**

This describes the system **as built**. Where a requirement is only partly met,
it says so rather than describing an intention.

Legend: **✔ Implemented** · **◑ Partial** · **✗ Not implemented**

---

## 1. Scope

AIMS manages the academic and administrative record of an educational institute
across four web portals: administration, faculty, student and parent.

**In scope:** admissions, academic structure, curriculum, timetabling,
attendance, examinations, marks, results and GPA, fees, announcements,
notifications, user and account administration, audit, search, and two AI
assistance features.

**Out of scope as built:** payroll, library circulation, HR leave management,
scholarship administration, online payment processing, email or SMS delivery,
and student self-registration for courses. Some of these have database tables
but no interface — see `GAPS_AND_LIMITATIONS.md`.

---

## 2. User roles and permissions

### 2.1 Roles

Eight roles are defined. Role IDs are fixed in the source (`config/roles.js`)
and mirrored in the `roles` table — **role 1 *is* Super Admin**, and the numbers
cannot be reassigned without a code change.

| ID | Role | Portal | Status |
|:--:|---|---|---|
| 1 | Super Admin | Admin | ✔ |
| 2 | Admin | Admin | ✔ |
| 3 | Teacher | Faculty | ✔ |
| 4 | Student | Student | ✔ |
| 5 | Parent | Parent | ✔ |
| 6 | HR | Admin | ◑ No screens of its own |
| 7 | Accountant | Admin | ◑ Fee permissions only |
| 8 | Library Staff | Admin | ◑ No screens of its own |

### 2.2 Permission model

Access is enforced at three levels, all on the server:

1. **Route gate** — `authorize(...roleIds)` returns 403 to a role not listed.
2. **Self-scope** — a student is restricted to their own rows, a parent to their
   wards', by middleware that inspects the record being addressed.
3. **Query scope** — resolved per request, deciding which rows a query may
   return at all.

> **The browser hides nothing that matters.** A control absent from a screen is
> a convenience; the refusal is on the server. This is testable — see
> `TESTING_GUIDE.md` §20.

### 2.3 Role groups

| Group | Members | Used for |
|---|---|---|
| `ADMINS` | Super Admin, Admin | All management writes |
| `ADMIN_TEACHER` | + Teacher | Teacher portal reads |
| `ADMIN_STUDENT` | + Student | Student portal reads |
| `ADMIN_TEACHER_STUDENT` | + both | Shared academic reference |
| `ACADEMIC_REFERENCE` | + Parent | Subject and semester catalogues — no personal data |

---

## 3. Functional requirements

### FR-1 Authentication and accounts

| | Requirement | Status |
|---|---|:--:|
| FR-1.1 | Users sign in with email and password | ✔ |
| FR-1.2 | Passwords are stored bcrypt-hashed, never in plaintext | ✔ |
| FR-1.3 | A JWT is issued carrying user ID and role | ✔ |
| FR-1.4 | The role determines which portal the user lands in | ✔ |
| FR-1.5 | **Every** failed sign-in returns the same message, whatever went wrong | ✔ |
| FR-1.6 | A countdown warns from three attempts remaining | ✔ |
| FR-1.7 | The account locks after **5** consecutive failures | ✔ |
| FR-1.8 | Only an administrator can unlock an account | ✔ |
| FR-1.9 | An admin-issued password forces a change at first sign-in | ✔ |
| FR-1.10 | Any user may change their own password from any portal | ✔ |
| FR-1.11 | Password reset is performed by an administrator | ✔ |
| FR-1.12 | Self-service reset by email link | ✗ No email delivery is configured |
| FR-1.13 | Sessions are scoped to one browser tab | ✔ |

> **FR-1.5 is deliberate.** A wrong password, an unknown address, a disabled
> account and a valid password on the wrong portal all return
> *"Email or password is incorrect"*. Anything more specific tells an attacker
> which addresses exist.

### FR-2 Student administration

| | Requirement | Status |
|---|---|:--:|
| FR-2.1 | Admit a student, creating login, person record and registration number in one transaction | ✔ |
| FR-2.2 | Link a student to one or more guardians | ✔ |
| FR-2.3 | Reuse an existing parent account when admitting a sibling | ✔ |
| FR-2.4 | Bulk import students from CSV | ✔ |
| FR-2.5 | Upload, store and download student documents | ✔ |
| FR-2.6 | Soft-delete a student and restore them | ✔ |
| FR-2.7 | Students maintain their own contact details | ✔ |
| FR-2.8 | A student's current semester is **derived from their enrolments**, not typed | ✔ |

### FR-3 Academic structure

| | Requirement | Status |
|---|---|:--:|
| FR-3.1 | Manage departments, programmes, batches, sections, semesters and classrooms | ✔ |
| FR-3.2 | Refuse deletion of anything still referenced, naming what references it | ✔ |
| FR-3.3 | Maintain a subject catalogue with codes and credit hours | ✔ |
| FR-3.4 | Assign subjects to a programme semester | ✔ |
| FR-3.5 | Classify rooms by type and capacity | ✔ |
| FR-3.6 | **Elective** subjects with election and capacity | ✗ Not modelled at all — no column, no concept |
| FR-3.7 | Record a subject's prerequisite | ✔ `subjects.prerequisite_subject_id` |
| FR-3.8 | **Enforce** a prerequisite at enrolment | ✗ Stored and displayed, never checked |

### FR-4 Terms, classes and enrolment

| | Requirement | Status |
|---|---|:--:|
| FR-4.1 | Create academic terms with a lifecycle: Planned → Active → Closed | ✔ |
| FR-4.2 | **Exactly one term may be Active** | ✔ Enforced by a database constraint |
| FR-4.3 | Create classes (course offerings) within a term | ✔ |
| FR-4.4 | Assign a qualified teacher to a class | ✔ |
| FR-4.5 | Enrol a whole cohort into a class | ✔ |
| FR-4.6 | Students self-register for courses | ✗ Not supported |
| FR-4.7 | Students choose their teacher | ✗ Not supported |

### FR-5 Teachers

| | Requirement | Status |
|---|---|:--:|
| FR-5.1 | Onboard a teacher, creating login and employee record together | ✔ |
| FR-5.2 | Record which subjects a teacher is qualified to teach | ✔ |
| FR-5.3 | Refuse to revoke a qualification currently being taught | ✔ |
| FR-5.4 | Assign teachers to subject/section pairs, with dates | ✔ |

### FR-6 Timetable

| | Requirement | Status |
|---|---|:--:|
| FR-6.1 | Periods sit on a fixed grid: four 90-minute slots from 08:30 | ✔ |
| FR-6.2 | 13:00–13:30 is a break and is **not bookable** | ✔ |
| FR-6.3 | Place a class into a day / period / room | ✔ |
| FR-6.4 | Refuse a clash on teacher, section or room, **and say which** | ✔ |
| FR-6.5 | Match room type to the class's requirement — a lab class needs a Lab | ✔ |
| FR-6.6 | Show room-by-room occupancy for a term | ✔ |
| FR-6.7 | Each portal sees its own live week | ✔ |
| FR-6.8 | Automatic timetable generation | ✗ Placement is manual, assisted |

Room types: **Lecture · Lab · Auditorium · Seminar**.

### FR-7 Attendance

| | Requirement | Status |
|---|---|:--:|
| FR-7.1 | Attendance is marked **per period**, not per day | ✔ |
| FR-7.2 | Five statuses: Present, Late, Absent, Leave, Holiday | ✔ |
| FR-7.3 | **Late counts as present** for the percentage; **Holiday is excluded entirely** | ✔ |
| FR-7.4 | Amend attendance, with an audit entry | ✔ |
| FR-7.5 | Flag students below the attendance threshold | ✔ |
| FR-7.6 | Each portal reports attendance consistently | ◑ See NFR-7.3 |
| FR-7.7 | Biometric or card-based capture | ✗ |

**A session is a timetable slot, not a day.** A class meeting twice on a Monday
contributes two sessions.

### FR-8 Examinations and marks

| | Requirement | Status |
|---|---|:--:|
| FR-8.1 | Create exams of several types, including Assignment | ✔ |
| FR-8.2 | Enter marks per student per exam | ✔ |
| FR-8.3 | Marks follow **Draft → Submitted → Released** | ✔ |
| FR-8.4 | A student sees **nothing** until marks are Released | ✔ |
| FR-8.5 | A teacher may enter and correct; **only an admin may verify** | ✔ |
| FR-8.6 | Amend a released mark, with an audit entry | ✔ |
| FR-8.7 | Marks are validated against the exam total | ✔ |

> **FR-8.5 exists because a teacher countersigning their own entry is not a
> check.**

### FR-9 Results, GPA and CGPA

| | Requirement | Status |
|---|---|:--:|
| FR-9.1 | A configurable grading scale drives grade and grade point | ✔ |
| FR-9.2 | Compute semester GPA weighted by credit hours | ✔ |
| FR-9.3 | Compute CGPA across semesters | ✔ |
| FR-9.4 | Publish a semester's results as one operation | ✔ |
| FR-9.5 | Publishing releases marks and notifies students and guardians | ✔ |
| FR-9.6 | Re-publishing **corrects**, never duplicates | ✔ |
| FR-9.7 | Refuse to publish if a mark falls outside every grade band | ✔ |
| FR-9.8 | Both GPA sides use credits of **not-dropped** enrolments | ✔ |
| FR-9.9 | Generate a transcript | ✔ |

Default scale: **A ≥85 → 4.0 · B ≥70 → 3.0 · C ≥60 → 2.0 · D ≥50 → 1.0 · F → 0**.
Bands are rows in `grades`; adding one requires no code change.

### FR-10 Fees

| | Requirement | Status |
|---|---|:--:|
| FR-10.1 | Define fee structures per programme and semester | ✔ |
| FR-10.2 | Generate vouchers for students | ✔ |
| FR-10.3 | Record payments, including instalments | ✔ |
| FR-10.4 | Students and parents declare a payment they have made | ✔ |
| FR-10.5 | An administrator verifies or rejects a declaration | ✔ |
| FR-10.6 | Overpayment carries forward | ✔ |
| FR-10.7 | Distinguish cancelling a voucher from deleting one | ✔ |
| FR-10.8 | Report on collection and defaulters | ✔ |
| FR-10.9 | Online payment gateway | ✗ Payment happens outside the system |
| FR-10.10 | All money is PKR | ✔ Attached to every money response |

### FR-11 Communication

| | Requirement | Status |
|---|---|:--:|
| FR-11.1 | Post announcements with rule-based audiences — programme, batch, section, semester, individual, OR'd | ✔ |
| FR-11.2 | In-app notifications, per role wording and per role links | ✔ |
| FR-11.3 | Mark one read, or all read | ✔ |
| FR-11.4 | The actor is never notified of their own action | ✔ |
| FR-11.5 | Email or SMS delivery | ✗ |

### FR-12 Administration and audit

| | Requirement | Status |
|---|---|:--:|
| FR-12.1 | Create and manage staff accounts | ✔ |
| FR-12.2 | **Never leave zero active Super Admins** | ✔ |
| FR-12.3 | Reissue credentials for an account | ✔ |
| FR-12.4 | Record every significant change in an audit trail | ✔ |
| FR-12.5 | Scrub credentials from audit entries | ✔ |
| FR-12.6 | Render each audit row as a readable sentence | ✔ |
| FR-12.7 | Role-scoped search across permitted resources | ✔ |
| FR-12.8 | Per-account preferences — theme, density, font size, muted notification types | ✔ Stored server-side and honoured |
| FR-12.9 | **Institute-wide** settings — name, branding, academic policy | ✗ None exist. The Settings screen holds per-account preferences only |
| FR-12.10 | Configurable locale, language or date format | ✗ No i18n layer |

### FR-13 AI features

| | Requirement | Status |
|---|---|:--:|
| FR-13.1 | Ask a data question in plain language and receive real rows | ✔ |
| FR-13.2 | **Row data never enters the language model** | ✔ |
| FR-13.3 | Results render as one of seven fixed templates | ✔ |
| FR-13.4 | Pin results as cards; drag, resize and persist | ✔ |
| FR-13.5 | A teacher's query is restricted to their own roster | ✔ |
| FR-13.6 | All AI queries run through a read-only database account | ✔ |
| FR-13.7 | A documentation chatbot answers "how do I" | ✔ |
| FR-13.8 | The chatbot holds **no** database access | ✔ |
| FR-13.9 | Documentation results are filtered by audience before scoring | ✔ |
| FR-13.10 | Every AI call is written to an audit log | ✔ |
| FR-13.11 | Retrieval tuning honours `CHATBOT_TOP_K` / `CHATBOT_MIN_SCORE` | ✗ **Known bug** — see `AI_IMPLEMENTATION.md` §9 |

---

## 4. Non-functional requirements

### NFR-1 Security

| | Requirement | Status |
|---|---|:--:|
| NFR-1.1 | Passwords bcrypt-hashed | ✔ |
| NFR-1.2 | Stateless JWT authentication | ✔ |
| NFR-1.3 | Server-side authorisation on every route | ✔ |
| NFR-1.4 | Input validated before reaching a controller | ✔ |
| NFR-1.5 | SQL injection prevented by parameterised queries | ✔ |
| NFR-1.6 | Security headers via helmet | ✔ |
| NFR-1.7 | CORS restricted to an explicit origin list | ✔ |
| NFR-1.8 | Uploads verified by **file signature**, not extension | ✔ |
| NFR-1.9 | AI queries confined to a `SELECT`-only account | ✔ |
| NFR-1.10 | Password complexity policy | ✗ **Minimum 8 characters only** |
| NFR-1.11 | Global rate limiting | ✗ Only the two AI routes |
| NFR-1.12 | Multi-factor authentication | ✗ |
| NFR-1.13 | Encryption at rest | ◑ Depends on the database host |

Full treatment: `SECURITY.md`.

### NFR-2 Performance

| | Requirement | Status |
|---|---|:--:|
| NFR-2.1 | Filtering, sorting and paging happen **in SQL**, not in the browser | ✔ |
| NFR-2.2 | Aggregates are served by database views | ✔ |
| NFR-2.3 | Responses are cached with tag-based invalidation | ✔ |
| NFR-2.4 | Screens show skeletons, not spinners | ✔ |
| NFR-2.5 | Avatars are cached client-side so a list does not refetch per row | ✔ |
| NFR-2.6 | AI query plans are cached for 6 hours | ✔ |
| NFR-2.7 | A generated query is cut off at 10 seconds | ✔ |
| NFR-2.8 | Documented performance targets | ✗ None defined or measured |

### NFR-3 Usability

| | Requirement | Status |
|---|---|:--:|
| NFR-3.1 | Each role sees only its own modules | ✔ |
| NFR-3.2 | Light and dark appearance | ✔ |
| NFR-3.3 | Refusals explain themselves in the response body | ✔ |
| NFR-3.4 | Every URL is addressable, reloadable and bookmarkable | ✔ |
| NFR-3.5 | Two portals open side by side without conflict | ✔ Per-tab sessions |
| NFR-3.6 | Responsive to small screens | ◑ Varies by screen |
| NFR-3.7 | WCAG conformance | ✗ Not audited |

### NFR-4 Maintainability

| | Requirement | Status |
|---|---|:--:|
| NFR-4.1 | Business rules live in services, not controllers | ✔ |
| NFR-4.2 | Every URL is written in one place on the client | ✔ |
| NFR-4.3 | Role IDs, slots, room types and currency have exactly one home | ✔ |
| NFR-4.4 | Schema changes go through migrations | ✔ 92 |
| NFR-4.5 | Automated test suite | ✗ `npm test` prints "No tests yet" |
| NFR-4.6 | Manual verification suites | ✔ `backend/src/testing/` |
| NFR-4.7 | CI pipeline | ✗ |

### NFR-5 Reliability

| | Requirement | Status |
|---|---|:--:|
| NFR-5.1 | A failure in an optional subsystem must not take down the whole request | ✔ |
| NFR-5.2 | The chatbot answers even when the transcript store is unavailable | ✔ |
| NFR-5.3 | Qdrant being absent costs documentation search, nothing else | ✔ |
| NFR-5.4 | An outage must not be reported to the user as "not documented" | ✔ |
| NFR-5.5 | Automated backups | ✗ A script exists; nothing schedules it |
| NFR-5.6 | Health endpoint for monitoring | ✗ |
| NFR-5.7 | Structured logging | ✗ `morgan("dev")` to stdout |

### NFR-6 Compatibility

| | Requirement | Status |
|---|---|:--:|
| NFR-6.1 | Node.js 18+ | ✔ |
| NFR-6.2 | **MySQL 8.4+ — not 5.7, not MariaDB** | ✔ |
| NFR-6.3 | `utf8mb4` throughout | ✔ |
| NFR-6.4 | Modern evergreen browsers | ✔ |
| NFR-6.5 | Internet Explorer | ✗ Not supported |

### NFR-7 Data integrity

| | Requirement | Status |
|---|---|:--:|
| NFR-7.1 | Referential integrity enforced by 111 foreign keys | ✔ |
| NFR-7.2 | Multi-row operations are transactional | ✔ |
| NFR-7.3 | A figure means the same thing in every portal | ◑ **Two attendance thresholds coexist** |
| NFR-7.4 | Soft delete preserves history | ✔ |
| NFR-7.5 | Money is stored as `DECIMAL`, never floating point | ✔ |

> **NFR-7.3 is an open defect.** The student portal shows an 80% attendance
> line; every other surface uses 75%. They have never been reconciled.

---

## 5. Business rules

Rules the system enforces, independent of any screen.

| # | Rule |
|---|---|
| BR-1 | Role 1 is Super Admin. Role IDs are fixed in code and cannot be reassigned. |
| BR-2 | Exactly one academic term may be Active — a database constraint, not application logic. |
| BR-3 | A teacher may only be assigned to a subject they are qualified for. |
| BR-4 | A qualification cannot be revoked while it is being taught. |
| BR-5 | A period must occupy a slot on the canonical grid. The 13:00–13:30 break is unbookable. |
| BR-6 | A room must satisfy the class's room-type requirement. |
| BR-7 | No teacher, section or room may be double-booked in a period. |
| BR-8 | Attendance is recorded per period. |
| BR-9 | Late counts as attended. Holiday is excluded from both numerator and denominator. |
| BR-10 | Marks are invisible to a student until Released. |
| BR-11 | The teacher who enters a mark cannot verify it. |
| BR-12 | GPA is credit-hour weighted, over not-dropped enrolments only. |
| BR-13 | Publishing a semester twice corrects it; it never duplicates. |
| BR-14 | A mark matching no grade band blocks publication. |
| BR-15 | Overpayment carries forward to the next voucher. |
| BR-16 | A voucher with payments against it is cancelled, not deleted. |
| BR-17 | Five consecutive failed sign-ins lock the account. Only an admin unlocks it. |
| BR-18 | An admin-issued password must be changed at first use. |
| BR-19 | The number of active Super Admins may never reach zero. |
| BR-20 | A student sees only their own rows; a parent only their wards'. |
| BR-21 | Deleting a referenced record is refused, naming the references. |
| BR-22 | Every significant change is written to the audit trail, with credentials scrubbed. |
| BR-23 | The actor of an action is never notified of it. |
| BR-24 | Row data never enters a language model. |
| BR-25 | All AI database access uses a `SELECT`-only account. |
| BR-26 | A student's semester is derived from enrolments, never typed in. |

---

## 6. Constraints

| | |
|---|---|
| **Database** | MySQL 8.4+ only. Generated columns, `CHECK` constraints and window functions are used. |
| **Currency** | PKR throughout. No multi-currency support. |
| **Language** | English only. No internationalisation. |
| **Email/SMS** | None configured. Anything needing delivery is done by an administrator in person. |
| **Payments** | No gateway. Payment happens outside the system and is declared and verified inside it. |
| **AI provider** | Groq. Replacing it means rewriting one client file. |
| **Vector store** | Qdrant, via Docker. Optional. |
| **Session** | Per browser tab. Closing the tab signs the user out. |

---

## 7. Input and output

### Inputs

| | |
|---|---|
| Forms | Every module, validated server-side by `express-validator` |
| CSV | Bulk student import |
| Images | Avatars — **1 MB** limit, cropped to 512×512 |
| Documents | Student documents — **8 MB** limit, verified by file signature |
| Natural language | Both AI features |

### Outputs

| | |
|---|---|
| Screens | Four portals |
| PDF | Transcripts, vouchers, reports (jsPDF) |
| CSV / Excel | Data exports (SheetJS) |
| Charts | Six chart types plus tables (Recharts) |
| Notifications | In-app only |
| JSON | The REST API — see `API_specs.md` |

---

## 8. Principal use cases

### UC-1 Admit a student
**Actor:** Admin · **Pre:** programme, batch and section exist
1. Admin opens Students → Admit
2. Enters personal, academic and guardian details
3. System creates, in **one transaction**: login, student record, guardian link,
   registration number, generated password
4. Credentials are displayed **once** for the administrator to pass on

**Post:** the student can sign in and is forced to change the password.

### UC-2 Mark attendance
**Actor:** Teacher · **Pre:** class is timetabled and enrolled
1. Teacher opens Attendance, picks the class and a date the class meets
2. **Picks the period** — a class meeting twice that day has two registers
3. Marks each student Present / Late / Absent / Leave / Holiday
4. Saves

**Post:** visible to admin, student and parent. Students below the threshold are
flagged.

### UC-3 Enter and release marks
**Actors:** Teacher, then Admin · **Pre:** an exam exists
1. Teacher enters marks → saved as **Draft**, badged *"not visible to the
   student"*
2. Teacher clicks **Submit for Approval** → **Submitted**
3. **Admin** verifies → **Released**
4. Student's Result page now shows them

**Post:** GPA recalculates. The teacher cannot perform step 3.

### UC-4 Publish semester results
**Actor:** Admin
1. Admin opens Examination → Result Publishing
2. Selects a semester; system reports blockers
3. Publishes
4. System computes GPA and CGPA, releases marks, notifies students and guardians

**Post:** re-publishing corrects rather than duplicating. A mark outside every
grade band blocks the operation.

### UC-5 Declare a fee payment
**Actors:** Student or Parent, then Admin
1. Pays outside the system
2. Opens Fee Management and declares the payment with a reference
3. Admin reviews in Fee Payment Approvals
4. Admin verifies or rejects

**Post:** on verification the voucher settles; overpayment carries forward.

### UC-6 Place a timetable period
**Actor:** Admin · **Pre:** a class exists with a teacher
1. Opens Timetable, selects the class
2. Picker offers only rooms matching the class's room type
3. Selects a day and period
4. System refuses any teacher, section or room clash **and says which**

**Post:** the period appears in every portal's live week.

### UC-7 Ask a data question
**Actor:** Admin or Teacher
1. Opens Ask the Data, types a question
2. Model produces a **query plan** — it sees no rows
3. Plan is validated; a teacher's is rewritten to their own roster
4. Query runs on the read-only account
5. Rows render as a chart or table

**Post:** the result can be pinned. *"How this was answered"* shows the tool or
exact SQL. Every call is audited.

---

## 9. Acceptance

The system is verified by walking
**`TESTING_GUIDE.md`** end to end — from an empty
database to a running academic term, across all four portals.

The overall acceptance test is **§16.4**: the admin, teacher, student and parent
must describe the same class the same way. If any of the four disagrees, that is
a defect.

---

## Related documents

| Document | Covers |
|---|---|
| `PROJECT_OVERVIEW.md` | The system at a high level |
| `ARCHITECTURE.md` | How the requirements are implemented |
| `GAPS_AND_LIMITATIONS.md` | The ✗ items above, and what they would take |
| `SECURITY.md` | NFR-1 in full |
| `TESTING_GUIDE.md` | Verifying every requirement by hand |
| `API_specs.md` | The API contract |
