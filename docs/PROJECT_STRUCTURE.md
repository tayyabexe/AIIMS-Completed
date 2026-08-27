# Project File Structure

**Regenerated:** 2026-08-27, against the tracked tree after the handover cleanup.
**Scope:** every tracked source file in the repository, with one line saying what it holds.
**Excluded:** `node_modules/`, `frontend/dist/` (build output), `backend/.models/` (the downloaded ONNX embedding model), `.env` files, `database/backups/`, and `.agents/` / `.claude/` (agent tooling config, not product code).

Read this to see the whole project at a glance, and to know which file to open
when a screen behaves in a way you want to explain.

> ### What changed in the handover cleanup
>
> - **`AIMS/AI/` was deleted.** The Python FastAPI service could not start — it
>   imported a `chatbot` module that was not in the tree, and nothing mounted
>   `/api/ai`. The live AI features are the Node ones.
> - **`node_modules/`, `frontend/dist/` and the three `.env` files were
>   untracked.** All remain on disk; only the git index changed. Tracked files
>   went from **47,122 to 767**.
> - **Thirteen handover documents were written**, all under `docs/` — see §2.
> - **`.agents/` and `.claude/` were untracked** — 322 files of agent tooling,
>   unrelated to the product.
> - **The user manual's sources were removed** — the HTML fragments, 143
>   screenshots and the authoring toolchain. The finished PDF is kept. The
>   manual can no longer be rebuilt from this repository.
> - **The `backend/` and `frontend/` READMEs were removed.** Their content is
>   covered by `DEPLOYMENT.md` and `SOURCE_CODE.md`.
> - **The database folder was reorganised**: `reference_data.sql` and
>   `DATABASE_SETUP.md` (now at `docs/`) added; the superseded rebuild guide,
>   ERD PDF and the PII-bearing backups removed.
> - **Five legacy routers and three controllers were annotated `DO NOT MOUNT`**
>   rather than deleted — see §4.4.

---

## 0. How the project is laid out

```
AIMS Frontend-Backend/          ← repository root
├── .gitignore                  ← root-level ignore rules
├── API_specs.md                ← the API contract
├── README.md                   ← orientation and quick start
├── docs/                       ← ALL documentation
│   ├── *.md                    ← the thirteen handover documents
│   └── AIMS User Manual.pdf    ← the end-user manual
└── AIMS/                       ← the product, and nothing else
    ├── backend/                ← Node.js + Express REST API
    ├── database/               ← MySQL schema, migrations, seeders, scripts
    └── frontend/               ← React 19 + Vite single-page app (all four portals)
```

**Documentation lives in `docs/`, code lives in `AIMS/`.** The only `.md` files
left under `AIMS/` are `README.md` at its root and `API_TEST_PLAN.md` beside the
suites it describes.

Three deployable pieces: **backend** (Express, port 5000), **frontend** (Vite
build → static files) and **database** (MySQL 8.4+). Qdrant is an optional
fourth, in Docker, used only by the help chatbot.

---

## 1. Repository root

| File | What it contains |
|---|---|
| `.gitignore` | Root ignore rules. Covers everything outside `AIMS/`, which the per-directory files cannot reach. |
| `API_specs.md` | The API contract: every endpoint, its role gate, and what the frontend calls. |
| `skills-lock.json` | Tooling lockfile. Not product code. |

---

## 2. `docs/` — all documentation

### 2.1 The handover documents

Thirteen files, all at `docs/`. Read them in roughly this order.

| File | What it contains |
|---|---|
| `PROJECT_OVERVIEW.md` | The system at a high level: purpose, users, modules, stack, status, limitations. **Start here.** |
| `SRS.md` | Requirements — functional and non-functional — each marked implemented / partial / not implemented, plus 26 business rules and 7 use cases. |
| `ARCHITECTURE.md` | Layers, request lifecycle, frontend/backend/database design, auth, data flow, caching, scaling. |
| `DATABASE_SETUP.md` | Building the database from the three SQL files, and how to read them as the reference. |
| `DEPLOYMENT.md` | Installing and deploying from nothing. Prerequisites, env vars, build, nginx/systemd, TLS, troubleshooting. |
| `SERVER_HANDOVER.md` | What exists versus what to provision. Sizing, ports, paths, backups, monitoring, credential transfer. |
| `SECURITY.md` | Authentication, authorisation, AI security, auditing, and ten known weaknesses with severities. |
| `GAPS_AND_LIMITATIONS.md` | What AIMS does not do, ranked by impact, with effort estimates. |
| `SOURCE_CODE.md` | Repo structure, layering rules, coding conventions, dependencies, build, branching, testing. |
| `AI_IMPLEMENTATION.md` | Every AI file, self-hosting, where the API keys live. |
| `AI_RUNBOOK.md` | Docker, embeddings, Ask the Data, and troubleshooting. |
| `TESTING_GUIDE.md` | Walking the whole system by hand, empty database to running term. |
| `PROJECT_STRUCTURE.md` | **This file.** Every tracked file, one line each. |

### 2.2 The two PDFs

| File | What it contains |
|---|---|
| `AIMS User Manual.pdf` | The finished end-user manual — how to operate each portal, written for the people using AIMS rather than maintaining it. |
| `AIMS AI Pipelines.pdf` | A visual explainer for the two AI features: what each does step by step, every tuned setting, the guards, and where the model is deliberately *not* used. The illustrated companion to `AI_IMPLEMENTATION.md`. |

> **Neither can be rebuilt from this repository.** The manual's HTML fragments,
> screenshots and authoring toolchain were removed in the handover cleanup, and
> the pipelines PDF was printed from a published page that does not live here.
> Treat both as artefacts: to revise either, recover its source first.

---

## 3. `AIMS/` — product root

| File | What it contains |
|---|---|
| `package.json` | Root scripts that install and start backend and frontend together. |
| `README.md` | Setup and run instructions. |
| `.env.example` | Template for the project-level environment. |
| `.gitignore` | Ignore rules scoped to `AIMS/`. |
| `My Collection.postman_collection final` | Legacy Postman export. |

---

## 4. `AIMS/backend/` — the REST API

**240 tracked files under `src/`.**

### 4.1 Entry points and configuration

| File | What it contains |
|---|---|
| `src/server.js` | Boots: loads env, connects the database, listens, then warms the embedding model and verifies the read-only account. Both warm-ups are **after** `listen()` and non-fatal. |
| `src/app.js` | The Express application — middleware order and every route mount. **The map of the whole API.** |
| `package.json` | Dependencies and npm scripts. |
| `.env.example` | Environment template. Documents the `DB_NAME` drift trap, the dead refresh-token variables, and the AI retrieval bug. |
| `docker-compose.qdrant.yml` | The optional Qdrant vector store for the chatbot. |

### 4.2 `src/config/` (12 files) — values that must have exactly one home

| File | What it contains |
|---|---|
| `roles.js` | The eight role IDs and the role groups every route gate is built from. Also role→portal mapping. |
| `roleProfiles.js` | What each role can and cannot do, used to steer AI answers. |
| `timetableSlots.js` | The canonical grid: four 90-minute slots from 08:30, plus the unbookable 13:00–13:30 break. |
| `roomTypes.js` | Lecture, Lab, Auditorium, Seminar — and the rule matching a room to a class's requirement. |
| `currency.js` | The PKR descriptor attached to every money response. |
| `dashboardCards.js` | Pinned analytics cards and their default layouts. |
| `searchResources.js` | Which resources each role may search, and which columns match. |
| `assistant.js` | Shared AI settings: rate limits, timeouts, and the `rag.topK`/`rag.minScore` the vector store actually uses. |
| `assistantCapabilities.js` | What the help assistant can answer, as data. |
| `chatbot.js` | Chatbot settings and the roles it serves (includes Parent). |
| `analytics.js` | Ask-the-Data settings: roles (no students), row ceilings, chart templates. |
| `groq.js` | The Groq key pool and default model, shared by both AI services. |

### 4.3 `src/middlewares/` (9 files)

| File | What it contains |
|---|---|
| `auth.middleware.js` | Verifies the JWT and cross-checks the `x-aims-acting-user` header (409 on mismatch). |
| `rbac.middleware.js` | `authorize(...roleIds)` — the 403 gate. **Compares role IDs only**; the permission tables are not consulted. |
| `selfScope.middleware.js` | Restricts a student to their own rows and a parent to their wards'. |
| `sanitize.middleware.js` | Edge-trims every incoming string except passwords and tokens. |
| `currency.middleware.js` | Attaches the PKR descriptor to money responses. |
| `cache.middleware.js` | Tag-based response cache with TTLs, plus `invalidates()` for writes. |
| `upload.middleware.js` | Multer uploaders, file-signature sniffing, 1 MB avatar / 8 MB document limits. |
| `assistantRateLimit.middleware.js` | Per-account sliding-window limiter for the two AI routes. |
| `error.middleware.js` | Turns thrown errors into JSON with the right status. |

### 4.4 `src/routes/` (37 files) — URL to handler

One file per resource. Each declares the path, role gate, validator and
controller method. `app.js` decides the prefix.

| File | Mount | What it exposes |
|---|---|---|
| `authRoutes.js` | `/api/auth` | Login, register, logout, profile, change/forgot/reset password. |
| `userRoutes.js` | `/api/users` | Own profile and preferences, avatar upload, admin user CRUD, account unlock. |
| `studentRoutes.js` | `/api/students` | Student CRUD, self-service record, documents, guardians, enrolment, restore. |
| `parentRoutes.js` | `/api/parent(s)` | Parent login, profile, children, and each child-scoped read. |
| `academicStructureRoutes.js` | `/api/departments`, `/programs`, `/batches`, `/sections`, `/semesters`, `/classrooms`, `/academics` | One CRUD router shape reused six times, plus the structure overview. |
| `subjectRoutes.js` | `/api/subjects` | Subject catalogue CRUD and search. |
| `courseOfferingRoutes.js` | `/api/terms`, `/offerings`, `/scheduling`, `/api/students/:id/classes` | Terms, classes, staffing, cohort enrolment, placement, room occupancy. |
| `timetableRoutes.js` | `/api/timetables` | Grid rows, plus the role-scoped live week. |
| `enrollmentRoutes.js` | `/api/enrollments` | Enrolment reads. |
| `attendanceRoutes.js` | `/api/attendance` | Mark, amend, delete and report on attendance. |
| `examRoutes.js` | `/api/exams` | Exam CRUD. |
| `markRoutes.js` | `/api/marks` | Enter and amend marks, per-student reads, admin verify. |
| `resultRoutes.js` | `/api/results` | Grading scale, CGPA, transcript, semester publishing. |
| `studentResultRoutes.js` | `/api/student-results` | Stored per-semester result rows. |
| `gpaRoutes.js` | `/api/gpa` | GPA record CRUD. |
| `teacherRoutes.js` | `/api/teachers` | Teacher CRUD. |
| `teacherSubjectRoutes.js` | `/api/teacher-subjects` | The qualification registry: who may teach what. |
| `teacherAssignmentRoutes.js` | `/api/teacher-assignments` | Dated teacher↔subject↔section assignments. |
| `teacherProfileRoutes.js` | `/api/teacher-profiles` | Teacher profile records. |
| `teacherScheduleRoutes.js` | `/api/teacher-schedules` | Teacher schedule records. |
| `teacherDashboardRoutes.js` | `/api/teacher-dashboard` | Single dashboard read by teacher id. |
| `facultyPortalRoutes.js` | `/api/faculty` | The teacher portal's own surface — one endpoint per screen. |
| `adminPortalRoutes.js` | `/api/admin` | The admin portal's surface, plus admission, onboarding, credentials, staff and parent management. |
| `feeRoutes.js` | `/api/fee-vouchers`, `/api/fee-payments` | Vouchers, instalments, declarations, verification. |
| `feeStructureRoutes.js` | `/api/fee-structures` | The fee catalogue. |
| `feeReportRoutes.js` | `/api/fee-reports` | Saved fee reports. |
| `announcementRoutes.js` | `/api/announcements` | Notice board CRUD with audience targeting. |
| `notificationRoutes.js` | `/api/notifications` | Own feed, mark one read, mark all read. |
| `searchRoutes.js` | `/api/search` | Role-scoped portal search and the resource list. |
| `summaryRoutes.js` | `/api/summaries` | Pre-aggregated reporting views. |
| `chatbotRoutes.js` | `/api/chatbot` | RAG documentation assistant and its conversation history. |
| `analyticsRoutes.js` | `/api/analytics` | Ask the Data, plus saved cards and surface layouts. |
| `batchRoutes.js`, `sectionRoutes.js`, `programRoutes.js`, `departmentRoutes.js`, `semesterRoutes.js` | ***not mounted*** | **Dead code, marked `DO NOT MOUNT`.** Superseded by `academicStructureRoutes.js`. Three of them declare full CRUD **without** `authenticate()` — mounting one would expose the academic structure to anonymous callers. |

### 4.5 `src/controllers/` (37 files) — request in, response out

Thin: read the request, call a service, shape the reply. Business rules live in
`services/`.

| File | Responsibility |
|---|---|
| `authController.js` | Login (with the shared failure policy), register, change/forgot/reset password. |
| `userController.js` | Own profile and preferences, avatar upload/serve/delete, admin user CRUD, unlock. |
| `studentController.js` | Student CRUD, documents, guardians, self-service edits. |
| `parentController.js` | Parent login and every child-scoped read. |
| `peopleAdminController.js` | Staff-account and parent management. |
| `academicStructureController.js` | The six structural resources and the overview tree. |
| `subjectController.js` | Subject catalogue. |
| `courseOfferingController.js` | Terms, classes, staffing, enrolment, placement, room occupancy. |
| `timetableController.js` | Grid rows and the live role-scoped week. |
| `enrollmentController.js` | Enrolment reads, including prerequisite columns *(displayed, never enforced)*. |
| `attendanceController.js` | Marking and amending registers, the 75% threshold notice, audit entries. |
| `examController.js` | Exam CRUD. |
| `markController.js` | Mark entry and the Draft→Submitted→Released gate. |
| `resultController.js` | Grading scale, GPA/CGPA, transcript, semester publishing. |
| `studentResultController.js`, `gpaController.js` | Stored result rows; GPA records. |
| `teacherController.js`, `teacherProfileController.js`, `teacherScheduleController.js`, `teacherAssignmentController.js`, `teacherSubjectController.js`, `teacherDashboardController.js` | The teacher-facing resources named in §4.4. |
| `facultyPortalController.js` | Every teacher-portal screen's read/write. |
| `adminPortalController.js` | Every admin-portal screen's read, plus admission/onboarding/credentials. |
| `feeController.js` | Vouchers, payments, declarations, verification decisions. |
| `feeStructureController.js`, `feeReportController.js` | Fee catalogue and saved reports. |
| `announcementController.js` | Notice board, with audience resolution per reader. |
| `notificationController.js` | Own feed and read flags. Drops muted categories before sending. |
| `searchController.js` | Role-scoped search. |
| `summaryController.js` | Reporting-view reads. |
| `chatbotController.js` | RAG chat turn and conversation management. |
| `analyticsController.js` | Ask-the-Data pipeline: cache → plan → validate → execute → reconcile. |
| `savedAnalyticsController.js` | Pinned cards and per-surface layouts. |
| `batchController.js`, `sectionController.js`, `programController.js` | **Dead code, marked.** Behind the unmounted routers. |

### 4.6 `src/services/` (58 files) — where the rules actually live

| File | The rules it owns |
|---|---|
| `loginSecurity.js` | One failure message for every portal, the remaining-tries countdown, the lock after five, the ghost counter for unknown addresses, the dummy hash that keeps timing uniform, and the admin unlock. |
| `provisioningService.js` | Admission and onboarding in one transaction: logins, person rows, guardian links, generated passwords, registration numbers. |
| `peopleAdminService.js` | Staff and parent administration, the Super Admin guards, and "never leave zero active Super Admins". |
| `userService.js` | Name resolution across student/parent/employee/account, and the account-health cohorts. |
| `userPreferenceService.js` | Per-account preferences (theme, density, font size, muted notification types) — stored server-side. |
| `academicStructureService.js` | The six structural tables, live child counts, and the refuse-while-referenced delete guard. |
| `programService.js`, `batchService.js`, `sectionService.js`, `subjectService.js` | Per-resource helpers. |
| `courseOfferingService.js` | Terms and their lifecycle, class creation, the one-Active-term rule, staffing, cohort enrolment. |
| `schedulingService.js` | The placement engine: which day/period/room a class may occupy, and why each option is blocked. |
| `timetableService.js` | Grid reads and writes, and the live week each portal sees. |
| `currentSemester.js` | Resolves a student's real semester from their enrolment roster. |
| `teacherSubjectService.js` | The qualification registry, and the refusal to revoke a qualification being taught. |
| `teacherService.js`, `teacherProfileService.js`, `teacherScheduleService.js`, `teacherAssignmentService.js`, `teacherDashboardService.js` | The teacher-facing resources. |
| `facultyPortalService.js`, `facultyAcademicsService.js` | Everything the teacher portal reads or writes, including per-period registers. |
| `adminPortalService.js` | Every admin screen's query — filtered and paged in SQL. |
| `feeService.js` | All fee arithmetic: settlement, overpayment carry-forward, declarations, verification, delete-vs-cancel. |
| `feeStructureService.js`, `feeReportService.js` | Fee catalogue and saved reports. |
| `gpaService.js`, `studentResultService.js` | GPA records; stored result rows. |
| `resultPublishingService.js` | Semester publishing: blockers, the stored procedure, releasing marks, notifying families. |
| `announcementService.js` | Notice-board targeting — audience rows first, `target_role` as fallback. |
| `notificationService.js` | Audiences, per-role wording and links, and never notifying the actor. |
| `auditService.js` | The audit trail: what is recorded, the credential scrubber, and the sentence each row renders as. |
| `searchService.js` | Role-scoped search. |
| `mediaService.js` | Storing and serving avatars and documents as binary rows, with `nosniff`. |
| **`analytics/`** (8) | `planner.js` (the only model call) · `prompts.js` · `catalogue.js` · `planValidator.js` · `executor.js` · `planCache.js` · `savedQueries.service.js` · `layout.service.js` |
| **`assistant/`** (6) | `scope.service.js` · `scopedSql.js` · `sqlGuard.js` · `conversation.service.js` · `groq.client.js` · `auditLog.js` — **shared by both AI services** |
| **`assistant/rag/`** (2) | `embedder.js` (local, CPU) · `vectorStore.js` (Qdrant) |
| **`assistant/tools/`** (6) | `index.js` · `admin.tools.js` · `teacher.tools.js` · `student.tools.js` · `knowledge.tools.js` · `sql.tools.js` |
| **`chatbot/`** (2) | `orchestrator.js` (one RAG turn) · `intent.js` (classify before retrieval) |

### 4.7 `src/models/` (35 files) — Sequelize definitions

One per table read through the ORM: `user`, `student`, `parent`,
`studentGuardian`, `studentDocument`, `program`, `batch`, `section`, `semester`,
`subject`, `academicTerm`, `courseOffering`, `enrollment`, `timetable`,
`attendance`, `exam`, `mark`, `grade`, `result`, `GPA`, `feeVoucher`,
`feePayment`, `FeeStructure`, `announcement`, `announcementTarget`,
`notification`, `auditLog`, `savedQuery`, `dashboardCard`, `userPreference`,
`Teacher`, `TeacherProfile`, `TeacherSubject`, `TeacherAssignment`,
`TeacherSchedule`.

### 4.8 `src/validators/` (11 files)

`authValidator.js` *(password rule: `min: 8` and nothing else)*,
`studentValidator.js`, `parentValidator.js`, `teacherValidator.js`,
`teacherModuleValidator.js`, `attendanceValidator.js`, `examValidator.js`,
`markValidator.js`, `gpaValidator.js`, `feeValidator.js`,
`timetableValidator.js` *(enforces the canonical period grid)*.

### 4.9 `src/database/`, `src/utils/`, `src/scripts/`

| File | What it contains |
|---|---|
| `database/connection.js` | The main Sequelize connection (read/write). |
| `database/readonlyConnection.js` | The `aims_ai_ro` SELECT-only pool both AI services read through. |
| `utils/apiError.js` | The error shape controllers throw, carrying its own status code. |
| `utils/cache.js` | The in-memory tag cache behind `cache.middleware.js`. |
| `scripts/ingest_knowledge_base.js` | Chunks, embeds and loads the knowledge base into Qdrant. Idempotent. |
| `scripts/generate_assistant_docs.js` | Regenerates the assistant Word document. Not needed at runtime. |

### 4.10 `src/testing/` (31 files)

| File | What it proves |
|---|---|
| `API_TEST_PLAN.md` | The plan the suites implement, including seed credentials per role. |
| `crudSuite.js` | Every CRUD resource answers correctly for each role. |
| `featureSuite.js` | Cross-cutting features (search, notifications, preferences). |
| `adminPortalSuite.js`, `adminScreenDataSuite.js` | Every admin screen's endpoint returns the columns it renders. |
| `studentSuite.js`, `parentSuite.js`, `teacherAcademicSuite.js`, `teacherTimetableSuite.js` | Each portal's own surface. |
| `feeGpaSuite.js` | Fee arithmetic and GPA figures. |
| `provisioningSuite.js` | Admission and onboarding write every row they promise. |
| `accessSweep.js` | Every route answers the right status for every role. |
| `roleSearchSuite.js` | Search returns only rows the role may see. |
| `assistant.smoke.js`, `chatbot.smoke.js`, `rag.smoke.js`, `rag.search.js` | The AI services answer and stay in scope. |
| `scopedSql.probe.js` | A teacher's generated SQL cannot escape their roster. |
| `chart.probe.js` | Analytics results render as the chart type the plan asked for. |
| `*-results.json` | Recorded output of the last run. |
| One-off repair scripts | `addGpaForeignKeys.js`, `addTeacherForeignKeys.js`, `addPaymentVerification.js`, `resetSeedPasswords.js`. |

> **There is no automated test suite.** `npm test` prints "No tests yet". These
> are run by hand against a running backend.

### 4.11 `docs/knowledge-base/` — the RAG corpus

**33 Markdown files** (`00-role-access-matrix.md` onward) describing how AIMS
works: one per module, plus per-role question banks and explicit "what I cannot
do" limits. Front matter carries a `title` and an `audience`, and **`audience`
is a permission** applied at search time.

**Editing one changes nothing until the ingest script is re-run.**

### 4.12 `src/postman/`

Postman collection and environment for manual API testing.

---

## 5. `AIMS/database/` — schema and data

| File / folder | What it contains |
|---|---|
| `schema.sql` | **Generated.** 58 tables, 21 views, 4 stored procedures. Opens with a block naming the tables no application code touches. |
| `constraints.sql` | **Generated.** 111 foreign keys, plus unique and check constraints listed for reference. |
| `reference_data.sql` | **Generated.** Roles, permissions, grading scale, and the 93-row migration ledger. The three files together rebuild a working, empty AIMS database **with no dependency on any existing one.** |
| `AIMS_ERD.dbml.txt` | **Generated.** DBML — paste into <https://dbdiagram.io>. 58 tables, 111 relationships, 45 enums. |
| `migrations/` (93) | The ordered history of the schema. Filenames are dates and read as a changelog. |
| `seeders/` (15) | Demo roles, permissions, departments, programmes, batches, sections, semesters, subjects, students, teachers, classrooms, timetables. |
| `models/` | A second Sequelize model set used by the migration tooling. |
| `config/config.js` | sequelize-cli configuration — reads `DB_NAME` from the environment. |
| `config/ca.pem` | TLS certificate authority for a managed MySQL host. |
| `connection.js` | Standalone connection used by the scripts. |
| `.env.example` | Template, documenting the `DB_NAME` drift trap. |
| `.sequelizerc` | Tells sequelize-cli where migrations and config live. |

> **The four generated files must not be hand-edited.** Change the schema with a
> migration, then regenerate. See `DATABASE_SETUP.md`.

### `database/scripts/` (24 files)

| File | What it does |
|---|---|
| `generate_schema_from_live.js` | Regenerates `schema.sql` + `constraints.sql`. Normalises `sql_mode` so the DDL is portable, orders views by dependency, and keeps checks out of the constraints file. |
| `generate_reference_data.js` | Regenerates `reference_data.sql`, including the migration ledger. |
| `generate_erd_dbml.js` | Regenerates the ERD from the live schema. |
| `generate_schema_reference.js` | Older text reference generator. |
| `create_first_admin.js` | Creates the one account you sign in with on a fresh database. Refuses if any user exists. |
| `create_ai_readonly_user.js` | Creates the `aims_ai_ro` SELECT-only account. |
| `prove_readonly_account.js` | Attempts INSERT/UPDATE/DELETE and expects all three refused. **Run this.** |
| `create_test_database.js` | Builds a test database by copying from a source database. *(Needs a live source — prefer the three SQL files.)* |
| `seed_test_baseline.js` | Seeds reference data by copying from a source database. *(Same caveat.)* |
| `backup_database.js` / `restore_database.js` | Full dump and restore. |
| `import_full_dump.js` | Imports the 2,000-student CSV dump. |
| `generate_operational_data.js` | Generates attendance, marks and fee activity. |
| `rebuild_curriculum.js` | Rebuilds subjects and semesters for every programme. |
| `snap_timetables_to_grid.js` / `preflight_slot_grid.js` | Move timetable rows onto the canonical grid, and check first. |
| `verify_assistant_views.js` | Checks the views the assistant reads exist and return rows. |
| `audit_live_db.js`, `verify_final.js`, `verify_import.js`, `verify_operational_data.js`, `fix_residual_issues.js` | Consistency checks and repairs. |
| `backfill_new_hire_hr.js` | Backfills employee records for teachers created without one. |
| `AIMS_Database_2000_Students_Full_Dump.csv.xls` | The demonstration student dataset. |

---

## 6. `AIMS/frontend/` — the React application

**248 tracked files under `src/`.** All four portals are one Vite app.

### 6.1 Entry points and configuration

| File | What it contains |
|---|---|
| `index.html` | The single page everything mounts into. |
| `src/main.jsx` | React root; imports the global stylesheets. |
| `src/App.jsx` | **The router.** Every URL in the product, with its portal guard. **Read this first.** |
| `src/index.css` | Global resets and shared tokens; scales off `data-density` and `data-font-size`. |
| `vite.config.js` | Build config and the `@/` alias. *(The dev proxy to an external AI provider was removed — nothing used it.)* |
| `jsconfig.json`, `components.json` | Path aliases and shadcn/ui configuration. |
| `.env.example` | `VITE_API_BASE_URL` and friends. **Compiled in at build time.** |
| `public/` | Favicon, icon sprite, and the landing page's media. |

### 6.2 `src/api/` (14 files) — the only place URLs are written

| File | What it contains |
|---|---|
| `endpoints.js` | Every API call, grouped by resource. **No component hardcodes a URL.** |
| `client.js` | Base URL, bearer token, acting-user header, trimming, timeouts, 401/409 sign-out. |
| `session.js` | The session store — **scoped to one browser tab**, so two portals can be open at once. |
| `queryClient.js`, `queryKeys.js` | TanStack Query client and key namespace. |
| `roles.js` | Role IDs, labels, role→portal mapping and each role's landing page. |
| `studentData.js`, `facultyData.js`, `parentData.js` | Per-portal loaders. |
| `notificationsData.js` | Feed loading and read-state updates. |
| `analytics.js` | Ask-the-Data calls. |
| `assistant.js` | Chatbot calls. |
| `avatarCache.js` | Caches authenticated avatar blobs so a list does not refetch per row. |
| `searchCatalog.js` | Client-side description of what each role can search. |

### 6.3 `src/context/` (8 files)

`AuthContext.jsx` · `ThemeContext.jsx` · `PreferencesContext.jsx` ·
`ChatbotContext.jsx` · `StudentProfileContext.jsx` · `FacultyAuthContext.jsx` ·
`FacultyDataContext.jsx` · `FacultyBadgeContext.jsx`

### 6.4 `src/pages/` (85 files) — one file per screen

**Public / cross-portal:** `Welcome.jsx` · `ChoosePortal.jsx` · `SignIn.jsx` ·
`ForgotPassword.jsx` · `ChangePassword.jsx` · `AdminSignup.jsx`

**Admin** (`pages/admin/`): `adminNav.js` (the navigation map) ·
`AdminDashboard.jsx` (the portal shell) · `AIAnalytics.jsx` + `.css` ·
`Reports.jsx` · `Settings.jsx` *(per-account preferences, stored server-side)*

**Faculty** (`pages/faculty/`): `FacultyDashboard.jsx` · `MyClasses.jsx` ·
`StudentAttendance.jsx` + `attendancePanels.jsx` *(the 75% line)* · `Marks.jsx` ·
`Assignments.jsx` · `Students.jsx` · `Reports.jsx` · `AIAnalytics.jsx` ·
`TeacherTimetable.jsx` · `Announcements.jsx` · `Notifications.jsx` ·
`Profile.jsx` · `Settings.jsx` · `Users.jsx` · `NotFound.jsx` ·
`facultyPanels.jsx`

**Student** (`pages/student/`): `StudentDashboard.jsx` *(colours courses against
80% — see the note below)* · `MyCourses.jsx` / `CourseDetails.jsx` ·
`Attendance.jsx` · `Result.jsx` · `FeeManagement.jsx` · `TimeTable.jsx` ·
`Document.jsx` · `Profile.jsx` · `Notifications.jsx` · `StudentPortal.jsx`

**Parent** (`pages/parent/`): `parentNav.js` · `ParentLayout.jsx` ·
`ParentDashboard.jsx` · `ParentOverviewPage.jsx` · `MyChildrenPage.jsx` ·
`AttendanceView.jsx` · `TimetableView.jsx` · `ResultsView.jsx` · `FeeView.jsx` ·
`NotificationsView.jsx` · `ProfileView.jsx` · `AssessmentTable.jsx` +
`assessments.js` · `parentViewRoutes.jsx` · `ParentPortalContext.jsx` ·
`ParentPortalSkeleton.jsx` · `parentTheme.js` · `useParentSearchRecords.js`

> **Known inconsistency:** the student dashboard uses **80%** as its attendance
> line; faculty and admin use **75%**. Recorded as defect D-2 in
> `GAPS_AND_LIMITATIONS.md`.

### 6.5 `src/components/` (110 files)

**`common/`** — `ProtectedRoute.jsx` (portal + forced-password-change guard) ·
`Header.jsx` · `Sidebar.jsx` · `PortalSearch.jsx` · `NotificationBell.jsx` +
`notificationMeta.js` · `ProfileDropdown.jsx` · `UserAvatar.jsx` /
`AvatarUploader.jsx` / `AvatarCropper.jsx` · `ChangePasswordDialog.jsx` ·
`AssistantWidget.jsx` + `AssistantCapabilities.jsx` · `ChartTemplates.jsx`
*(the seven fixed renderers)* · `Modal.jsx` · `Pagination.jsx` ·
`SortableHeader.jsx` · `FilterField.jsx` · `StatCard.jsx` · `Skeleton.jsx` ·
`RichText.jsx` · `DraftNotice.jsx` · `RouteLoader.jsx` · `ApiErrorNotice.jsx` ·
`ErrorBoundary.jsx`

**`admin/`** — one component per module: `StudentsList` · `StudentProfile` ·
`EnrollmentExplorer` · `AttendanceView` · `FeeManagementView` ·
`StudentFeeVouchers` · `FeePaymentApprovals` · `FeeStructuresView` ·
`ExaminationView` · `ResultPublishing` · `ParentsManagement` ·
`AcademicStructureView` · `TimetableManagement` · `FacultyView` ·
`TeacherQualifications` · `StaffAccountsView` · `UserManagement` ·
`CredentialsDialog` · `AuditTrail` · `RecentActivity` · `AnnouncementsView` ·
`NotificationsView` · `AIInsightsView` · `WelcomeBanner`

- `admin/dashboard/` — `DashboardHome`, `Panel`, `StudentRollPanel`, `FeeCollectionPanel`, `AcademicStandingPanel`
- `admin/timetable/` — `PlacementGrid.jsx` (day × period × room) and `parts.jsx`
- `admin/insights/insightPanels.jsx` — the curated AI Insights panels
- `admin/pinned/` (14) — the pinned-card system: `CardGrid`, `SavedQueryCard`, `SavedQueryStrip`, `PanelShell`, `EditPanel`, `CardMenu`, `ChartExpandDialog`, `SaveQueryDialog`, `AutoHeightCell`, `usePinnedSurface`, `dragState`, `runQueue`, `visuals`, `pinned.css`

**`faculty/`** — the teacher portal's kit: `Layout`, `Sidebar`, `Header`,
`DataTable`, `FilterBar`, `Pagination`, `Modal`, `Charts`, `DataState`,
`Avatar`, `Toast` — each with its own `.css`.

**`student/`** — `StudentTopBar.jsx` and `icons.jsx`.

**`ui/`** — shadcn/ui primitives: `button`, `badge`, `dialog`, `select`, `tabs`,
`tooltip`, `separator`, `scroll-area`.

**`stage/Stage.jsx`** — the landing page's scrolling showcase.

### 6.6 `src/hooks/` (11 files)

`useAdminPage.js` · `useAdminAlerts.js` · `useNotifications.js` ·
`useServerSearch.js` · `useLiveTimetable.js` · `useLiveRefresh.js` ·
`useFacultyLookups.js` · `useAuthedImage.js` · `useAvatarActions.js` ·
`useDraft.js` · `useScrollLock.js`

### 6.7 `src/styles/` (8) and `src/utils/` (7)

| File | What it contains |
|---|---|
| `styles/auth.css` | The Lumina design system, namespaced under `.aims-auth`. |
| `styles/home.css`, `styles/stage.css` | The landing page and its showcase. |
| `styles/indigo-glass.css` | The admin portal's palette. |
| `styles/adminTheme.js` | Admin theme values consumed from JS. |
| `styles/faculty.css` | The teacher portal's styling. |
| `styles/skeletons.css`, `styles/viewport.css` | Loading placeholders; viewport and safe-area handling. |
| `utils/currency.js` | Formats PKR amounts. |
| `utils/datetime.js` | Date, time and period formatting. |
| `utils/feePayable.js` | Client-side fee display helpers (arithmetic is server-side). |
| `utils/attendanceData.js` | Attendance shaping for charts and tables. |
| `utils/exporters.js` | CSV / Excel export. |
| `utils/pdfGenerator.js` | PDF export (transcripts, vouchers, reports). |
| `utils/helpers.js` | Small shared helpers. |
| `lib/portals.js` | The four portals described once. |
| `lib/utils.js` | The `cn()` class-name helper. |

---

## 7. Where to look when a screen surprises you

| Question | File to open |
|---|---|
| What URL is this screen? | `frontend/src/App.jsx` |
| Which menu items does this role see? | `frontend/src/pages/admin/adminNav.js` (or `parentNav.js`) |
| Why was this refused? | The matching `backend/src/services/*.js` — the rule and its reasoning are in the comment above it |
| Who is allowed to call this? | `backend/src/routes/*.js`, then `backend/src/config/roles.js` |
| What does this number mean? | The service that computes it, not the component that prints it |
| What did the system just do to this record? | `backend/src/services/auditService.js` and the Audit Trail screen |
| What columns does this table have? | `database/schema.sql` |
| What is related to what? | `database/AIMS_ERD.dbml.txt` in dbdiagram.io |
| What is missing from this system? | `GAPS_AND_LIMITATIONS.md` |
