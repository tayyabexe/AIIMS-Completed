# AIMS — System Architecture & Technical Design

**How AIMS is built: the layers, the request path, and the decisions behind
them.**

For *what* it does, read `PROJECT_OVERVIEW.md`. For *what it must do*, read
`SRS.md`.

---

## 1. Shape of the system

Three tiers, plus two external services.

```
┌──────────────────────────────────────────────────────────────┐
│  BROWSER                                                     │
│  React 19 SPA — all four portals in one build                │
│  Static files. Not a Node server in production.              │
└───────────────────────────┬──────────────────────────────────┘
                            │  HTTPS · JWT in Authorization header
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  APPLICATION                                                 │
│  Node.js + Express — port 5000                               │
│                                                              │
│    routes/       URL → role gate → validator → controller    │
│    controllers/  read request, call service, shape reply     │
│    services/     ALL business rules live here                │
│    models/       Sequelize definitions                       │
└──────┬──────────────────────┬─────────────────────┬──────────┘
       │                      │                     │
       ▼                      ▼                     ▼
┌─────────────┐      ┌────────────────┐    ┌────────────────┐
│   MySQL     │      │    Qdrant      │    │   Groq API     │
│   8.4+      │      │  (chatbot      │    │  (both AI      │
│ 58 tables   │      │   corpus)      │    │   features)    │
│ 21 views    │      │   OPTIONAL     │    │   EXTERNAL     │
│ 4 procs     │      └────────────────┘    └────────────────┘
│             │
│ 2 accounts: │
│  app (RW)   │
│  ai_ro (R)  │
└─────────────┘
```

**MySQL is the only irreplaceable component.** Qdrant is rebuilt from Markdown
in minutes. Groq is a third-party API whose absence costs the AI features and
nothing else.

---

## 2. The governing principle

> **Every rule, permission and calculation is on the server. The browser
> renders what it is given.**

A control missing from a screen is a convenience, not a security measure. The
refusal always exists on the server, and is testable by calling the API
directly — which the testing guide does deliberately, with real tokens.

The corollary: **a figure is computed once.** If two portals disagree about a
number, one of them is computing it locally, and that is a defect.

---

## 3. Backend architecture

### 3.1 Layers

| Layer | Directory | Responsibility | Rule |
|---|---|---|---|
| **Routes** | `src/routes/` | URL, role gate, validator, controller method | Declarative only. No logic. |
| **Controllers** | `src/controllers/` | Read the request, call a service, shape the reply | Thin. **No business rules.** |
| **Services** | `src/services/` | Every business rule, every calculation | The real system lives here. |
| **Models** | `src/models/` | Sequelize table definitions | Structure only. |
| **Middlewares** | `src/middlewares/` | Cross-cutting concerns | Applied in a deliberate order — §3.3. |
| **Config** | `src/config/` | Values that must have exactly one home | Role IDs, slots, room types, currency. |
| **Validators** | `src/validators/` | Request-shape checks | Reject malformed bodies before a controller sees them. |

> **Why rules live in services.** Controllers are HTTP-shaped and hard to reuse.
> The same rule is often needed by an admin screen, a teacher screen and a
> report. Putting it in a service means one implementation and one place to fix.
>
> The practical test: *"why was this refused?"* is always answered by a file in
> `services/`, with the reasoning in a comment above the rule.

### 3.2 Request lifecycle

```
Request
  │
  ├─ helmet                    security headers
  ├─ cors                      explicit origin allowlist (403 if not listed)
  ├─ morgan                    request logging
  ├─ express.json              body parsing
  ├─ sanitizeRequest           edge-trim every string except passwords/tokens
  ├─ cookieParser
  │
  ├─ authenticate              verify JWT, cross-check the acting-user header
  ├─ authorize(...roles)       403 if the role is not listed
  ├─ selfScope                 student → own rows; parent → wards' rows
  ├─ validator                 422 if the body is malformed
  ├─ cache / invalidates       tag-based response cache
  │
  ├─ CONTROLLER ──► SERVICE ──► MODEL / SQL
  │
  ├─ attachCurrency            PKR descriptor on money responses
  └─ errorHandler              thrown errors → JSON with the right status
```

Each stage can only narrow access, never widen it.

### 3.3 Two details worth knowing

**The acting-user header.** Every request carries `x-aims-acting-user` alongside
the bearer token. The server cross-checks it against the token's subject and
returns **409** on a mismatch.

This exists because sessions are per browser tab. Without the check, a stale tab
could act with a token belonging to a different account than the UI is showing —
the user believes they are one person and the server believes another.

**Static uploads.** `/uploads` is served statically for a few legacy files.
Current media — avatars and documents — is stored **as binary rows in the
database**, served through authenticated routes with `nosniff`. That means a
database backup captures uploaded documents, and there is no separate file store
to back up or lose.

---

## 4. Frontend architecture

### 4.1 One build, four portals

All four portals are a single Vite build. Which portal a person sees is decided
by their role and the URL, not by a separate deployment.

| Directory | Holds |
|---|---|
| `src/pages/` | One file per screen, grouped by portal |
| `src/components/common/` | Shared across every portal |
| `src/components/{admin,faculty,student}/` | Portal-specific |
| `src/api/` | **The only place a URL is written** |
| `src/context/` | App-wide state |
| `src/hooks/` | Reusable behaviour |
| `src/utils/` | Formatting and export helpers |
| `src/styles/` | Per-portal styling |

### 4.2 Key files

| File | Why it matters |
|---|---|
| `src/App.jsx` | **The router.** Every URL in the product is declared here with its portal guard. Read this first. |
| `src/api/endpoints.js` | Every API call, grouped by resource. **No component hardcodes a URL.** |
| `src/api/client.js` | The fetch wrapper: base URL, bearer token, acting-user header, trimming, timeouts, 401/409 sign-out. |
| `src/api/session.js` | The session store — **scoped to one browser tab**. |
| `src/pages/admin/adminNav.js` | The navigation map: every module, its URL, and which roles may open it. |

### 4.3 State

| Kind | Handled by |
|---|---|
| Server data | **TanStack Query** — caching, refetch, invalidation |
| Authentication | `AuthContext` |
| Appearance | `ThemeContext` |
| Preferences | `PreferencesContext` |
| Portal-local | Per-portal contexts (faculty, student, parent) |

There is no Redux. Server state is TanStack Query's job; the rest is React
context.

### 4.4 Session, deliberately per tab

The session lives in `sessionStorage`, not `localStorage`.

- **Why:** `localStorage` is shared by every tab of an origin, so opening a
  second portal overwrote the first.
- **Consequence:** closing a tab signs you out. Two portals can be open side by
  side.
- **New tabs:** a brand-new tab adopts a seed kept in `localStorage`, so
  "open in new tab" still works. Once adopted, the tab keeps its own session.

---

## 5. Database architecture

### 5.1 Shape

| | |
|---|---|
| Engine | MySQL **8.4+** |
| Tables | 58 |
| Views | 21 |
| Stored procedures | 4 |
| Foreign keys | 111 |
| Check constraints | 10 |
| Migrations | 92 |

### 5.2 Design decisions

**Views carry the definitions.** `vw_fee_defaulters` knows what a defaulter
*is*. Because the definition lives in one view, the admin screen, a report and
an AI query cannot each reconstruct it slightly differently.

**Constraints over application logic where possible.** "Only one active term" is
a generated column plus a unique index — not a service check. It therefore holds
against a migration, a script, or a direct SQL session.

**Soft delete.** `is_deleted` preserves history. Deleting a referenced record is
refused, naming what references it.

**Money is `DECIMAL`**, never floating point.

**Media as rows.** Avatars and documents are `mediumblob` columns with mime,
size, checksum and timestamp beside them — so the checksum serves as an ETag and
the timestamp as Last-Modified.

### 5.3 Two database accounts

| Account | Privileges | Used by |
|---|---|---|
| Application user | Read/write | Every normal route |
| `aims_ai_ro` | **`SELECT` only**, with column-level restrictions | Both AI features, exclusively |

`aims_ai_ro` cannot read `password_hash`, `cnic_bform`, `salary`, the `payroll`
table, or the assistant's own transcript tables.

> This is the load-bearing AI security control. If every check above it were
> deleted, a generated `DELETE` would still be refused. Grants are **per
> database** — pointing `DB_NAME` at a different database leaves the account
> able to connect and unable to read, which the backend now reports at boot.

---

## 6. Authentication and authorisation

### 6.1 Authentication

1. `POST /api/auth/login` with email and password.
2. Password compared against a bcrypt hash.
3. On success, a JWT carrying user ID and role ID is returned.
4. The client stores it in `sessionStorage` and sends it as
   `Authorization: Bearer <token>` on every request, plus the acting-user
   header.
5. `authenticate` verifies the signature and cross-checks the header.

**Tokens are not cookies.** There is therefore no CSRF surface from ambient
credentials — and, in exchange, a successful XSS could read the token. See
`SECURITY.md`.

### 6.2 The sign-in failure policy

Every failure — wrong password, unknown address, disabled account, valid
password on the wrong portal — returns the **same** message. A countdown warns
from three attempts remaining. Five consecutive failures lock the account, and
only an administrator can unlock it.

Unknown addresses are tracked with a ghost counter, so an attacker cannot tell
an existing address from a non-existent one by watching the countdown appear.

### 6.3 Authorisation, three levels

| Level | Mechanism | Answers |
|---|---|---|
| **Route** | `authorize(...roleIds)` | May this *role* call this endpoint? |
| **Record** | `selfScope` middleware | May this *user* touch this *record*? |
| **Query** | `scope.service.js` | Which rows may this user's query return? |

The third exists for the AI features, where the query is not written in advance.
A teacher's SQL has its table names rewritten into CTEs restricted to their own
roster — so the model never writes the filter and cannot forget it.

---

## 7. Data flow

### 7.1 A normal read

```
Component
  └─▶ TanStack Query
       └─▶ endpoints.js  (the only place the URL is written)
            └─▶ client.js  (base URL, token, acting-user header, timeout)
                 └─▶ Express route
                      └─▶ authenticate → authorize → selfScope → cache
                           └─▶ Controller → Service → SQL / view
                                └─▶ JSON  ─▶ cached by tag ─▶ rendered
```

Filtering, sorting and paging happen **in SQL**. The browser never receives rows
it will not display.

### 7.2 A write

```
Form → validator → controller → service (rules) → transaction
                                     ├─▶ audit entry
                                     ├─▶ notifications (never to the actor)
                                     └─▶ cache invalidated by tag
```

Multi-row operations are transactional: admission writes login, person,
guardian link and registration number together, or not at all.

### 7.3 Ask the Data

```
Question
  └─▶ role gate + rate limit
       └─▶ catalogue built for THIS role
            └─▶ ✱ MODEL: question → JSON plan   (sees no rows)
                 └─▶ plan validated (presentation corrected, access refused)
                      └─▶ SQL guard → teacher scope rewrite
                           └─▶ aims_ai_ro executes
                                └─▶ rows ─▶ browser ─▶ fixed chart template
```

**The model exits before the data arrives.** ✱ marks the only model call. See
the **AIMS AI Pipelines** document.

### 7.4 Help Chatbot

```
Question
  └─▶ role gate → intent check (capability/off-topic answered here)
       └─▶ Qdrant search, audience filter applied BEFORE scoring
            └─▶ re-rank by role affinity
                 └─▶ ✱ MODEL: passages → prose answer + citations
```

The model has no search tool, so it cannot skip retrieval and answer from
memory.

---

## 8. Caching

| Layer | Mechanism | Invalidation |
|---|---|---|
| Server responses | Tag-based in-memory cache with TTLs | `invalidates()` on writes |
| Client server-state | TanStack Query | Query-key invalidation |
| Avatars | Client-side blob cache | On upload or removal |
| AI query plans | In-memory map, 6-hour TTL | Time only |

All caches are **in-process**. Running more than one backend instance means each
has its own, and an invalidation on one does not reach the others. Single
instance today; a shared cache would be needed to scale out.

---

## 9. Third-party integrations

| Service | Used by | Required? | Failure mode |
|---|---|---|---|
| **Groq** | Both AI features | No | AI features fail; everything else works |
| **Qdrant** | Chatbot only | No | Documentation search unavailable, reported honestly |
| **Hugging Face CDN** | Embedding model, **first run only** | No | Chatbot cannot start; one-time |

There is **no** payment gateway, email service, SMS gateway, telemetry, or
licensing call-home.

---

## 10. Error handling

Errors are thrown as an `ApiError` carrying its own status code, and converted
to JSON by one error middleware.

**The response body explains itself.** A refusal says what was refused and why —
which is why the testing guide tells the reader to open the Network tab and read
the `message` field rather than guessing.

**Optional subsystems degrade rather than fail the request:**

| Failure | Cost |
|---|---|
| Qdrant unreachable | Documentation search only |
| Transcript store slow | Answer still returns, flagged `saved:false` |
| Embedding model absent | Chatbot only; retries on next use |
| Read-only account ungranted | AI features only; reported at boot |

An outage is never reported to a user as "not documented" — those are different
messages on purpose.

---

## 11. Scaling considerations

**As built, AIMS is a single-instance application.** Nothing prevents it running
that way for an institute of a few thousand students, but running more than one
backend instance needs work:

| Concern | Today | For multiple instances |
|---|---|---|
| Response cache | In-process | Needs Redis or similar |
| AI plan cache | In-process | Same |
| Rate limiting | In-process counters | Needs shared state |
| Sessions | Stateless JWT | ✔ Already fine |
| Uploads | In the database | ✔ Already fine |
| Embedding model | Loaded per process | ~90 MB of RAM per instance |

Sessions and uploads are already stateless-friendly. The caches and limiters are
what would need moving.

---

## 12. Where to look when something surprises you

| Question | Open |
|---|---|
| What URL is this screen? | `frontend/src/App.jsx` |
| Which menu items does this role see? | `frontend/src/pages/admin/adminNav.js` |
| Why was this refused? | The matching `backend/src/services/*.js` — the rule and its reasoning are in the comment above it |
| Who is allowed to call this? | `backend/src/routes/*.js`, then `backend/src/config/roles.js` |
| What does this number mean? | The service that computes it, not the component that prints it |
| What did the system just do to this record? | `backend/src/services/auditService.js` and the Audit Trail screen |
| What shape is this endpoint? | `API_specs.md` |

---

## Related documents

| Document | Covers |
|---|---|
| `PROJECT_OVERVIEW.md` | What the system is |
| `SRS.md` | What it must do |
| `PROJECT_STRUCTURE.md` | Every file, one line each |
| `API_specs.md` | The API contract |
| `DATABASE_SETUP.md` | Building the database |
| `AI_IMPLEMENTATION.md` | The AI subsystem in detail |
| `SECURITY.md` | Authentication, authorisation and known weaknesses |
