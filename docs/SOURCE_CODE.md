# AIMS — Source Code Documentation

**How the codebase is organised, and the conventions to follow when changing
it.**

For what the system does, read `PROJECT_OVERVIEW.md`. For how it is designed,
read `ARCHITECTURE.md`. This document is for the developer about to open an
editor.

---

## 1. Repository

| | |
|---|---|
| Host | GitHub — `tayyabexe/AIMS---Integrated` |
| Owner | **A personal account.** Ownership must be transferred to the organisation. |
| Default branch | `main` |

> **Repository ownership is a handover item.** Either transfer the repository to
> an organisation account, or push a full mirror into one. Until then the
> organisation's source of truth sits under an individual's account.

### 1.1 Top level

```
AIMS Frontend-Backend/          ← repository root
├── API_specs.md                ← the API contract
├── docs/                       ← all documentation
├── .interface-design/          ← design-system notes
└── AIMS/                       ← the product
    ├── backend/                ← Node.js + Express API
    ├── frontend/               ← React 19 + Vite SPA
    ├── database/               ← schema, migrations, seeders, scripts
    └── *.md                    ← the handover documents
```

### 1.2 Handover documents, at `AIMS/`

| File | Covers |
|---|---|
| `PROJECT_OVERVIEW.md` | The system at a high level |
| `SRS.md` | Requirements, marked implemented / partial / not |
| `ARCHITECTURE.md` | Design and data flow |
| `DEPLOYMENT.md` | Installing and deploying |
| `SERVER_HANDOVER.md` | Infrastructure and credentials |
| `SECURITY.md` | Controls and weaknesses |
| `GAPS_AND_LIMITATIONS.md` | What is missing |
| `SOURCE_CODE.md` | This file |
| `AI_IMPLEMENTATION.md`, `AI_RUNBOOK.md` | The AI subsystem |
| `TESTING_GUIDE.md` | Manual verification |
| `DATABASE_SETUP.md` | Building the database |

---

## 2. Backend — `AIMS/backend/`

```
src/
├── server.js          boot: env, DB connect, listen, warm-ups
├── app.js             THE MAP — middleware order and every route mount
├── config/            values that must have exactly one home
├── routes/            URL → role gate → validator → controller
├── controllers/       read request, call service, shape reply
├── services/          ALL business rules
├── models/            Sequelize definitions
├── middlewares/       cross-cutting checks
├── validators/        request-shape checks
├── database/          two connection pools
├── utils/             error shape, cache
├── scripts/           one-off and maintenance scripts
├── testing/           manual verification suites
└── postman/           API collection
docs/knowledge-base/   33 Markdown files — the chatbot corpus
```

### 2.1 Read these first

| File | Why |
|---|---|
| **`src/app.js`** | Middleware order and every route mount. The map of the whole API. |
| **`src/config/roles.js`** | The eight role IDs and the groups every route gate is built from. |
| **`src/services/`** | Where the system actually is. Controllers are thin. |

### 2.2 The layering rule

| Layer | May contain | Must not contain |
|---|---|---|
| Route | Path, role gate, validator, controller method | Logic |
| Controller | Request reading, service call, response shaping | **Business rules** |
| Service | Every rule, calculation and refusal | HTTP concepts |
| Model | Table structure | Logic |

> **The test:** *"Why was this refused?"* must always be answerable by a file in
> `services/`, with the reasoning in a comment above the rule.
>
> If a rule is in a controller, it cannot be reused by the report that needs the
> same rule, and it gets reimplemented slightly differently.

### 2.3 `config/` — one home per value

`roles.js` · `roleProfiles.js` · `timetableSlots.js` · `roomTypes.js` ·
`currency.js` · `dashboardCards.js` · `searchResources.js` · `assistant.js` ·
`assistantCapabilities.js` · `chatbot.js` · `analytics.js` · `groq.js`

> These exist because a value written in several places rots in only some of
> them. Role IDs were once inline in every route file, which is how Super Admin
> ended up locked out of most modules. The model name was once in five places;
> when the provider retired it, four were updated.
>
> **Do not copy a value out of `config/`. Import it.**

### 2.4 Dead code, marked

Five routers and three controllers are **not mounted** and carry a
`DO NOT MOUNT` header:

`routes/{batch,section,program,department,semester}Routes.js` ·
`controllers/{batch,section,program}Controller.js`

Three of them declare full CRUD **without** `authenticate()`. Mounting one would
expose the academic structure to anonymous callers. They are superseded by
`academicStructureRoutes.js`, kept only as a record of the shape that was
replaced.

---

## 3. Frontend — `AIMS/frontend/`

```
src/
├── App.jsx            THE ROUTER — every URL, with its portal guard
├── main.jsx           React root
├── api/               the ONLY place a URL is written
├── pages/             one file per screen, grouped by portal
├── components/        common/ + one folder per portal + ui/
├── context/           app-wide state
├── hooks/             reusable behaviour
├── styles/            per-portal styling
├── utils/             formatting and export
└── lib/               small shared helpers
```

### 3.1 Read these first

| File | Why |
|---|---|
| **`src/App.jsx`** | Every URL in the product, with its guard. |
| **`src/api/endpoints.js`** | Every API call. **No component hardcodes a URL.** |
| **`src/api/client.js`** | Base URL, token, acting-user header, timeouts, 401/409 sign-out. |
| **`src/pages/admin/adminNav.js`** | Every module, its URL, and which roles may open it. |

### 3.2 Conventions

- **URLs live in `api/endpoints.js`.** A component that builds its own URL is a
  bug — when a route moves, one file should change.
- **Server state is TanStack Query's job.** Do not mirror it into `useState`.
- **Portal-specific components stay in their portal's folder.** Promote to
  `components/common/` only when a second portal genuinely needs it.
- **Styling is mixed on purpose:** Tailwind v4 for the newest screens,
  hand-written CSS per portal elsewhere. Match the file you are editing rather
  than converting it.

### 3.3 The session is per tab

`api/session.js` uses `sessionStorage`, so two portals can be open at once. A
new tab adopts a seed from `localStorage` once, then keeps its own session.
**Do not "fix" this by moving it to `localStorage`** — that is the bug it was
written to solve.

---

## 4. Database — `AIMS/database/`

```
schema.sql            generated — tables, views, routines
constraints.sql       generated — foreign keys
reference_data.sql    generated — roles, permissions, grades, migration ledger
AIMS_ERD.dbml.txt     generated — paste into dbdiagram.io
migrations/           93 files, ordered by date
seeders/              demo data
scripts/              generators, verifiers, backup/restore
config/config.js      sequelize-cli configuration
```

### 4.1 Generated files — do not hand-edit

`schema.sql`, `constraints.sql`, `reference_data.sql` and `AIMS_ERD.dbml.txt`
are **generated from the live database**. Editing one is silently discarded by
the next regeneration.

To change the schema: write a migration, apply it, then regenerate.

```bash
cd AIMS/database
DB_NAME=aims_db node scripts/generate_schema_from_live.js
DB_NAME=aims_db node scripts/generate_reference_data.js
DB_NAME=aims_db node scripts/generate_erd_dbml.js
```

> Note the explicit `DB_NAME=`. Without it they read `database/.env`, which is
> usually pointed at a test database.

### 4.2 Migrations

Named `YYYYMMDDHHMMSS-what-it-does.js`. Filenames read as a changelog.

**Convention: the header comment explains *why*.** The good ones state the bug,
the evidence, why the fix is safe, and whether it is idempotent. Follow that —
migrations are read years later by someone who was not there.

```bash
cd AIMS/database
grep DB_NAME ../backend/.env .env      # CHECK WHICH DATABASE FIRST
npx sequelize-cli db:migrate:status
npx sequelize-cli db:migrate
```

> **The trap:** `backend/.env` and `database/.env` both name a database and they
> drift. A bare `db:migrate` uses `database/.env`. If that still names
> production while you are working on a test copy, you have just migrated
> production.

---

## 5. Coding conventions

### 5.1 Comments explain *why*

The dominant convention, and the most valuable one. Comments do not restate the
code — they record the reasoning, and often the bug that produced the rule.

```js
/*
 * `query`, not `search`.
 *
 * The REST client removed client.search() at v1.13 in favour of the unified
 * query API, and this package is on 1.19. Calling the old name throws
 * "client.search is not a function" — which, because Qdrant is optional and
 * its absence is handled gracefully, surfaced as a plausible-looking
 * "documentation unavailable" message rather than as an obvious bug.
 */
```

**Follow this.** When you fix something subtle, write down what it looked like
when it was broken. That is what stops it being reintroduced.

### 5.2 Style

| | |
|---|---|
| Semicolons | Yes |
| Quotes | Double in backend, single in frontend — match the file |
| Indent | 4 spaces backend, 2 frontend — match the file |
| Backend modules | CommonJS (`require`) |
| Frontend modules | ESM (`import`) |
| Async | `async/await`, not `.then()` chains |
| Naming | `camelCase` JS, `snake_case` SQL columns, `PascalCase` components |
| Errors | Throw `ApiError` with its own status code |

### 5.3 Rules worth stating

- **Never trust model output.** Treat it as untrusted input, however good the
  prompt.
- **Refuse loudly, degrade quietly.** An access mistake is refused; a
  presentation mistake is corrected silently.
- **A failure in an optional subsystem must not fail the request.**
- **Compute a figure once**, on the server. Two portals disagreeing about a
  number is a defect.

### 5.4 Linting

```bash
cd AIMS/frontend && npm run lint      # oxlint
```

There is no backend linter configured.

---

## 6. Configuration files

| File | Purpose | In git? |
|---|---|:--:|
| `backend/.env` | Runtime config and secrets | **No** |
| `database/.env` | CLI and script config | **No** |
| `frontend/.env` | **Build-time** config | **No** |
| `*/.env.example` | Templates | Yes |
| `frontend/vite.config.js` | Build config, `@/` alias | Yes |
| `frontend/jsconfig.json` | Editor path resolution — mirrors the alias | Yes |
| `frontend/components.json` | shadcn/ui config | Yes |
| `database/config/config.js` | sequelize-cli | Yes |
| `database/config/ca.pem` | TLS CA for the database | Yes |
| `backend/docker-compose.qdrant.yml` | Qdrant container | Yes |
| `.gitignore` | Excludes `node_modules`, `dist`, `.env`, backups | Yes |

> **`frontend/.env` is compiled in at build time.** Changing it on a server does
> nothing. See `DEPLOYMENT.md` §5.3.

---

## 7. Dependencies

### Backend (17 runtime)
`express` · `sequelize` · `mysql2` · `jsonwebtoken` · `bcrypt` · `helmet` ·
`cors` · `express-validator` · `multer` · `morgan` · `cookie-parser` ·
`dotenv` · `axios` · `form-data` · `docx` · `@qdrant/js-client-rest` ·
`@xenova/transformers`

`bcrypt` is native and compiles on install — a bare Linux host needs
`build-essential` and `python3`.

### Frontend (18 runtime)
`react` · `react-dom` · `react-router-dom` · `@tanstack/react-query` ·
`recharts` · `react-grid-layout` · `framer-motion` · `radix-ui` ·
`lucide-react` · `@phosphor-icons/react` · `class-variance-authority` ·
`clsx` · `tailwind-merge` · `tw-animate-css` · `jspdf` · `jspdf-autotable` ·
`xlsx` · `tesseract.js`

> **`tesseract.js` is unused.** Nothing in `src/` imports it. It is not small.
> Removing it is safe and shrinks the bundle.

Two icon libraries are in use (`lucide-react` and `@phosphor-icons/react`)
because different screens were built at different times. Consolidating is
optional tidying.

---

## 8. Build

### Development
```bash
cd AIMS
npm run install:all
npm run dev:backend      # nodemon, port 5000
npm run dev:frontend     # vite, port 5173
```

Vite uses 5173 if free, otherwise 5174 or 5175 — all three are in the default
CORS list. **Read the port it prints.**

### Production
```bash
cd AIMS
npm run build:frontend   # → frontend/dist/, ~6.6 MB static files
npm run start:backend    # node src/server.js
```

`dist/` is static output. **Never commit it** — and check what you built:

```bash
grep -ro "localhost:5000" AIMS/frontend/dist/assets/*.js
```

Any output means the wrong `VITE_API_BASE_URL` was compiled in.

---

## 9. Branching

**As inherited:** two branches, `main` and `timetable-and-qualifications`, with
feature work done on the second. Commit messages are descriptive sentences in
the imperative — *"Rewrite the testing guide against the code that runs today"*.
Worth keeping.

**There is no enforced strategy** — no protected branches, no PR requirement, no
CI gate. For a team, the minimum worth adopting:

| | |
|---|---|
| `main` | Always deployable. Protect it. |
| `feature/<name>` | One branch per change, from `main` |
| Merge | Pull request with at least one review |
| Before merge | Lint passes; the affected suites in `backend/src/testing/` were run |

---

## 10. Testing

**There is no automated test suite.** `npm test` prints `"No tests yet"`.

What exists is a set of **manual verification suites** under
`backend/src/testing/`, run individually against a running backend:

| Suite | Proves |
|---|---|
| `crudSuite.js` | Every CRUD resource answers correctly per role |
| `accessSweep.js` | Every route returns the right status for every role |
| `adminPortalSuite.js`, `adminScreenDataSuite.js` | Each admin screen gets the columns it renders |
| `studentSuite.js`, `parentSuite.js`, `teacherAcademicSuite.js`, `teacherTimetableSuite.js` | Each portal's surface |
| `feeGpaSuite.js` | Fee arithmetic and GPA figures |
| `provisioningSuite.js` | Admission writes every row it promises |
| `roleSearchSuite.js` | Search returns only permitted rows |
| `rag.smoke.js`, `chatbot.smoke.js`, `assistant.smoke.js` | The AI services answer and stay in scope |
| `scopedSql.probe.js` | A teacher's SQL cannot escape their roster |

```bash
cd AIMS/backend
node src/testing/accessSweep.js
```

`*-results.json` files hold the last recorded run.

**The whole-system test is manual:** `TESTING_GUIDE.md`,
walked end to end.

> Building a real automated suite is the highest-value engineering investment
> available here — see `GAPS_AND_LIMITATIONS.md` §7. Start with fees, GPA and
> access control: the places where a silent regression is most expensive.

---

## 11. Making a change safely

1. **Find the rule.** It is in `services/`, not the controller.
2. **Read the comment above it.** It usually says why it is the way it is.
3. **Change the service**, not the screen. One rule, one place.
4. **Schema change? Write a migration**, then regenerate the four files (§4.1).
5. **Check which database** you are pointed at before migrating.
6. **Run the affected suite** in `backend/src/testing/`.
7. **Walk the affected section** of the testing guide.
8. **Write down why**, in a comment, if the fix was subtle.

---

## Related documents

| Document | Covers |
|---|---|
| `ARCHITECTURE.md` | The design these conventions serve |
| `PROJECT_STRUCTURE.md` | Every file, one line each |
| `API_specs.md` | The API contract |
| `DATABASE_SETUP.md` | Schema and migrations |
| `GAPS_AND_LIMITATIONS.md` | What is missing, including tests |
