# AIMS — Database Setup

**How to build the AIMS database on your own MySQL server, from nothing.**

This needs no access to any existing AIMS database. Everything required ships
with the repository.

> **Where the files are.** This guide lives in `docs/`, but the SQL files and
> scripts it refers to live in **`AIMS/database/`**. Every command below assumes
> you are there:
>
> ```bash
> cd AIMS/database
> ```
>
> A bare filename in this document — `schema.sql`, `scripts/backup_database.js` —
> means a path relative to that directory.

---

## What you need

| | |
|---|---|
| **MySQL** | 8.4 or later. The schema uses generated columns, `CHECK` constraints and window functions, so 5.7 will not work. |
| **Node.js** | 18 or later — only for the last step, which creates the first account. |
| **A MySQL account** | One that can `CREATE DATABASE`, create tables, views and stored procedures, and grant privileges. |

MariaDB is **not** a substitute. It differs on generated columns and on the
`information_schema` views the tooling reads.

---

## The three files

Run them in this order. The order is not optional.

| Order | File | What it creates | Contains personal data? |
|---|---|---|---|
| 1 | `schema.sql` | 58 tables, 21 views, 4 stored procedures | No |
| 2 | `constraints.sql` | 111 foreign keys | No |
| 3 | `reference_data.sql` | Roles, permissions, grading scale, migration ledger | No |

**Why they are separate.** Foreign keys are kept out of `schema.sql` so the
tables can be created in any order without a dependency failure. Reference data
is kept separate again because it is rows, not structure — you may want the
structure without it.

All three are generated from a real database, not written by hand. If they ever
disagree with a running system, regenerate them (see *Keeping these files
current* below) rather than editing them.

---

## Step 1 — Create an empty database

```sql
CREATE DATABASE aims_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

**Use `utf8mb4`.** Student and staff names contain characters that `latin1`
cannot store, and the collation affects how uniqueness on names and codes
behaves.

The name `aims_db` is a convention, not a requirement. Whatever you choose must
match `DB_NAME` in `backend/.env` and `database/.env`.

---

## Step 2 — Load the three files

```bash
cd AIMS/database

mysql -u <user> -p aims_db < schema.sql
mysql -u <user> -p aims_db < constraints.sql
mysql -u <user> -p aims_db < reference_data.sql
```

On Windows without the `mysql` client on your PATH, use the full path to it,
or run the files through MySQL Workbench (**File → Run SQL Script**), one at a
time, in the same order.

### Check it worked

```sql
USE aims_db;

SELECT COUNT(*) FROM information_schema.tables
 WHERE table_schema = 'aims_db' AND table_type = 'BASE TABLE';   -- expect 59
SELECT COUNT(*) FROM information_schema.views
 WHERE table_schema = 'aims_db';                                  -- expect 21
SELECT COUNT(*) FROM information_schema.routines
 WHERE routine_schema = 'aims_db';                                -- expect 4
SELECT COUNT(*) FROM information_schema.table_constraints
 WHERE table_schema = 'aims_db' AND constraint_type = 'FOREIGN KEY';  -- expect 111

SELECT COUNT(*) FROM roles;            -- expect 8
SELECT COUNT(*) FROM permissions;      -- expect 18
SELECT COUNT(*) FROM role_permissions; -- expect 35
SELECT COUNT(*) FROM grades;           -- expect 5
SELECT COUNT(*) FROM SequelizeMeta;    -- expect 93
```

> **59, not 58.** The 58 in the table above counts the application's tables.
> `reference_data.sql` adds `SequelizeMeta`, the migration ledger, making 59.

And prove a view that depends on another view resolves:

```sql
SELECT * FROM vw_at_risk_students LIMIT 1;
```

If that errors, the views were created in the wrong order — reload `schema.sql`
from the top rather than patching individual views.

---

## Step 3 — Create the read-only AI account

The two AI features (Ask the Data, and the assistant's SQL tools) never use the
application's database account. They connect through a separate MySQL user that
holds `SELECT` and nothing else, so a generated query cannot write even if
everything above it fails.

```bash
cd AIMS/database
node scripts/create_ai_readonly_user.js
```

It reads `AI_DB_USER` and `AI_DB_PASSWORD` from `database/.env`. Set both before
running it, and set the same pair in `backend/.env`.

Prove the account really cannot write:

```bash
node scripts/prove_readonly_account.js
```

That attempts an `INSERT`, an `UPDATE` and a `DELETE` and expects all three to
be refused. **If any succeeds, stop and fix the grant** — do not run the AI
features against an account that can write.

Skipping this step is allowed. The AI features will refuse to start, and
everything else works.

---

## Step 4 — Create the first account

A database with no user cannot be signed into, and the admin screens are the
only way to create the second account. So exactly one account is made from the
command line.

```bash
cd AIMS/database
DB_NAME=aims_db node scripts/create_first_admin.js --password '<choose one>'
```

Optionally `--email <address>` (default `superadmin@aims.edu.pk`).

**On password strength:** the application currently enforces only a **minimum
of 8 characters** (`backend/src/validators/authValidator.js`). There is no
complexity, dictionary or reuse check anywhere in the codebase. This is a known
weakness, recorded in the security documentation. Until it is fixed, the
strength of this account's password is entirely your choice — use a long,
random one from a password manager.

What the script does:

- refuses to run if the database already holds a user, so it cannot add a
  second administrator to a working system
- bcrypt-hashes the password, then reads the stored hash back and verifies it,
  rather than assuming bcrypt worked
- sets `must_change_password = 1`, because the password you just typed is in
  your shell history

Record the credentials in whatever your organisation uses to hold secrets. The
script writes them nowhere.

Every other account — admins, teachers, students, parents — is created through
the application.

---

## Step 5 — Point the application at it

Two files name a database, and different tools read each one:

| File | Read by |
|---|---|
| `backend/.env` | the running API |
| `database/.env` | `sequelize-cli`, and every script in `database/scripts/` |

Set `DB_NAME` to the same value in both, along with `DB_HOST`, `DB_PORT`,
`DB_USER`, `DB_PASSWORD` and `DB_SSL`. Start from the `.env.example` files.

> **Check both, every time.** They drift, and they fail differently. If the
> backend is pointed at a test database while `database/.env` still names the
> production one, a bare `npx sequelize-cli db:migrate` runs against production
> data. Confirm with:
>
> ```bash
> grep DB_NAME backend/.env database/.env
> ```

### If your server requires TLS

Set `DB_SSL=true` and put the certificate authority file at
`database/config/ca.pem`. Managed MySQL providers give you this file. For a
server you run yourself on a private network, leave `DB_SSL=false`.

---

## Viewing the ERD

`AIMS_ERD.dbml.txt` is the entity-relationship diagram. It is **DBML**
(Database Markup Language) — not SQL, and not Mermaid. It will not run against
a database, and it is not meant to.

To see the diagram:

1. Open **<https://dbdiagram.io>**
2. Paste the **entire contents** of `AIMS_ERD.dbml.txt` into the left-hand
   editor
3. The diagram renders on the right. Drag tables to rearrange them, and use
   **Export** to save a PNG or PDF

It shows all 58 tables, their columns and types, 111 relationships and 45
enums. DBML has no syntax for views or stored procedures, so those are listed
by name in a comment at the end of the file — their definitions are in
`schema.sql`.

---

## Using these files as the database reference

There is no separate table-by-table reference document, deliberately. A
hand-written one drifts from the database within weeks. **`schema.sql` and
`AIMS_ERD.dbml.txt` are the reference**, and both are generated, so neither can
disagree with what is deployed.

Here is how to read them.

### To answer "what columns does this table have?"

Open `schema.sql` and search for the table name. You get the real `CREATE TABLE`
— every column with its exact type, nullability, default and comment, plus the
primary key, unique keys, indexes and check constraints.

```bash
grep -A 40 'CREATE TABLE `students`' schema.sql
```

Many columns carry a `COMMENT` explaining what they are for. Those comments are
part of the schema, not documentation about it.

### To answer "what is related to what?"

Two ways:

**Visually** — paste `AIMS_ERD.dbml.txt` into <https://dbdiagram.io>. All 58
tables, 111 relationships and 45 enums, laid out and draggable.

**Textually** — the `Ref:` lines at the end of `AIMS_ERD.dbml.txt` list every
relationship in one place, with its delete and update behaviour:

```
Ref: enrollments.student_id > students.student_id [delete: cascade]
```

Or find every foreign key pointing at one table:

```bash
grep 'REFERENCES `students`' constraints.sql
```

### To answer "what does this view or procedure do?"

Views and stored procedures are at the **end** of `schema.sql`, after the
tables, with their full definitions. The 21 view names and 4 procedure names are
also listed in a comment block at the end of `AIMS_ERD.dbml.txt` — DBML has no
syntax for them, so they are named there and defined in `schema.sql`.

The views are worth reading before writing any report query. Each one carries a
definition rather than leaving you to reconstruct it: `vw_fee_defaulters`
already knows what a defaulter is, `vw_student_gpa_summary` already knows how
GPA is weighted. Using them is how two screens avoid computing the same figure
two different ways.

### What each file answers

| Question | File |
|---|---|
| What columns, types, keys and indexes? | `schema.sql` |
| What relationships, and what happens on delete? | `AIMS_ERD.dbml.txt`, or `constraints.sql` |
| What does the whole thing look like? | `AIMS_ERD.dbml.txt` in dbdiagram.io |
| What fixed data must exist? | `reference_data.sql` |
| What changed, and when? | `migrations/` — filenames are dates and read as a changelog |

---

## Keeping these files current

`schema.sql`, `constraints.sql`, `reference_data.sql` and `AIMS_ERD.dbml.txt`
are all **generated**. Do not hand-edit them: the next regeneration silently
discards your change.

Change the schema by writing a migration in `database/migrations/`, applying it,
and then regenerating:

```bash
cd AIMS/database

DB_NAME=aims_db node scripts/generate_schema_from_live.js   # schema.sql + constraints.sql
DB_NAME=aims_db node scripts/generate_reference_data.js     # reference_data.sql
DB_NAME=aims_db node scripts/generate_erd_dbml.js           # AIMS_ERD.dbml.txt
```

All three are read-only against the server — they issue `SHOW CREATE` and
`information_schema` queries only, and never DDL or DML.

> **Note the explicit `DB_NAME=`.** Without it they read `database/.env`, which
> is often pointed at a test database — and you would regenerate the schema from
> the wrong one.

### Why the migration ledger matters

`schema.sql` already contains everything the migrations produce.
`reference_data.sql` stamps every one into `SequelizeMeta` so that
`npx sequelize-cli db:migrate:status` reads all-`up`.

Without that stamp, `sequelize-cli` sees a database with zero migrations
applied and the next `db:migrate` tries to re-apply every one onto a schema that
already has them — which fails partway through, leaving the database in a state
that is neither the old one nor the new one.

---

## Backups

```bash
cd AIMS/database
DB_NAME=aims_db node scripts/backup_database.js
```

Writes a timestamped `.sql` file into `database/backups/`.

**That folder is git-ignored deliberately.** A backup of a working AIMS
database contains real student and staff personal data — names, addresses,
guardian contacts, fee records. Never commit one, and never attach one to a
ticket or an email.

To restore into a scratch database (never over a working one):

```bash
node scripts/restore_database.js <path-to-backup.sql> <new-database-name>
```

Take a backup before any migration you have not run before, and before any
restore.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `You have an error in your SQL syntax near '"table_name"'` | Your server runs with `ANSI_QUOTES`, or the file was generated from one that did | Regenerate with `generate_schema_from_live.js`, which normalises the session mode. Do not hand-edit the quotes. |
| `Table 'vw_...' doesn't exist` while loading `schema.sql` | Views loaded out of dependency order | Reload `schema.sql` from the top. If it recurs, regenerate it — the generator sorts views by dependency. |
| `Duplicate check constraint name` | `constraints.sql` was loaded before `schema.sql`, or a `CHECK` was added to both | Load in the documented order. Checks belong in `schema.sql` only. |
| `db:migrate` tries to run every migration | `reference_data.sql` was not loaded, so `SequelizeMeta` is empty | Load `reference_data.sql`. Do not let the migrations run. |
| `Email or password is incorrect` on a database you just built | The backend is pointed at a different database | `grep DB_NAME backend/.env database/.env` |
| AI features fail with a database error | The read-only account does not exist or was not granted | `node scripts/create_ai_readonly_user.js`, then `prove_readonly_account.js` |
| `Access denied` creating views or procedures | The MySQL account lacks `CREATE VIEW` / `CREATE ROUTINE` | Grant them, or use an account that has them. |

---

## Related documents

| Document | Covers |
|---|---|
| `TESTING_GUIDE.md` | Walking the whole system by hand once it is running |
