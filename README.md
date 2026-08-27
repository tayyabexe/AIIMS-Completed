# AIMS — Academic Information Management System

A multi-portal web application for managing an educational institute's academic
and administrative record: **administration, faculty, student and parent**.

It covers the full cycle — admission → enrolment → timetabling → per-period
attendance → examinations and the marks workflow → results and GPA → fees —
plus announcements, notifications, an audit trail, role-scoped search, and two
AI features.

---

## Start here

| If you want to… | Read |
|---|---|
| Understand what this is | **[docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md)** |
| Deploy it | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Build the database | [docs/DATABASE_SETUP.md](docs/DATABASE_SETUP.md) |
| Know what infrastructure to provision | [docs/SERVER_HANDOVER.md](docs/SERVER_HANDOVER.md) |
| Change the code | [docs/SOURCE_CODE.md](docs/SOURCE_CODE.md) |
| Know what it does **not** do | [docs/GAPS_AND_LIMITATIONS.md](docs/GAPS_AND_LIMITATIONS.md) |
| Secure it | [docs/SECURITY.md](docs/SECURITY.md) |
| Use it, as an end user | [docs/AIMS User Manual.pdf](docs/AIMS%20User%20Manual.pdf) |

Full index: **[docs/](docs/)** — thirteen documents, plus the user manual PDF.

---

## Layout

```
├── docs/           ALL documentation — thirteen documents + the user manual PDF
└── AIMS/           the product
    ├── backend/    Node.js + Express REST API          (port 5000)
    ├── frontend/   React 19 + Vite SPA — all four portals, one build
    └── database/   MySQL schema, migrations, seeders, scripts
```

The frontend builds to **static files**. It is not a Node server in production.

---

## Quick start

**Requires Node.js 18+ and MySQL 8.4 or later.** Not MySQL 5.7, and not
MariaDB — the schema uses generated columns, `CHECK` constraints and window
functions.

```bash
# 1. Install
cd AIMS
npm run install:all

# 2. Build the database — see docs/DATABASE_SETUP.md for the full procedure
cd database
mysql -u <user> -p aims_db < schema.sql
mysql -u <user> -p aims_db < constraints.sql
mysql -u <user> -p aims_db < reference_data.sql
DB_NAME=aims_db node scripts/create_first_admin.js --password '<choose one>'

# 3. Configure — copy each .env.example to .env and fill it in
#    AIMS/backend/.env   AIMS/database/.env   AIMS/frontend/.env

# 4. Run
cd .. && npm run dev:backend     # port 5000
         npm run dev:frontend    # port 5173
```

Those three SQL files rebuild a complete, empty AIMS database on any MySQL 8.4+
server, with **no dependency on any existing database**.

---

## Before you deploy this

Read [docs/SECURITY.md](docs/SECURITY.md) §8 and
[docs/GAPS_AND_LIMITATIONS.md](docs/GAPS_AND_LIMITATIONS.md). The short version:

- **Generate new secrets.** Do not reuse any value found in any repository or
  document. The earlier development history contained committed `.env` files;
  every credential in it must be treated as compromised.
- **There is no password complexity policy** — eight characters is the whole
  rule.
- **There is no rate limiting** outside the two AI routes.
- **There is no automated test suite, CI, monitoring, health endpoint, or
  scheduled backup.** The manual verification suites are in
  `AIMS/backend/src/testing/`.
- **This has never been deployed to a server.** `docs/DEPLOYMENT.md` tells you
  what to create; it is not a description of an existing environment.

---

## Status

Feature-complete for the modules documented, and never deployed. Known defects
and missing features are catalogued with effort estimates in
[docs/GAPS_AND_LIMITATIONS.md](docs/GAPS_AND_LIMITATIONS.md) rather than left to
be discovered.
