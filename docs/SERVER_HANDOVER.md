# AIMS — Server & Deployment Handover

**What infrastructure exists today, what the organisation needs to provision,
and how credentials are transferred.**

---

## 1. Current state — read this first

> ### There is no server to hand over.
>
> AIMS has never been deployed. It has only ever run on a developer's laptop
> against a managed MySQL instance on a **personal** account.
>
> Nothing in this document describes an existing production environment,
> because there is not one.

### What exists today

| Component | Where it runs now | Owned by | After handover |
|---|---|---|---|
| Backend API | Developer laptop, `localhost:5000` | The developer | **Must be provisioned** |
| Frontend | Vite dev server, `localhost:5173` | The developer | **Must be provisioned** |
| MySQL database | Managed instance, personal cloud account | The developer, personally | **Being decommissioned** |
| Qdrant (chatbot) | Docker Desktop on the laptop | The developer | **Must be provisioned** |
| Groq API keys | Personal account | The developer, personally | **Must be replaced** |
| Domain name | None | — | **Must be registered** |
| TLS certificate | None | — | **Must be obtained** |

### What is being handed over

- The source code, in full.
- The database **structure** — `schema.sql`, `constraints.sql`,
  `reference_data.sql` — which rebuilds an empty, working AIMS database on any
  MySQL 8.4+ server, with no dependency on the developer's instance.
- The documentation set, including this file.

### What is *not* being handed over

- **The database instance.** It is on a personal cloud account that is being
  closed. Its contents are demonstration data, not real records.
- **The API keys.** They are personal and must be reissued.
- **Any running service, server, domain or certificate.** None exist.

The organisation is therefore doing a **first deployment**, not taking over a
running system. `DEPLOYMENT.md` is the guide for that.

---

## 2. What to provision

### 2.1 Sizing

The demonstration dataset is roughly:

| | |
|---|---|
| Students | ~2,000 |
| User accounts | ~4,000 |
| Attendance rows | ~60,000 |
| Marks rows | ~20,000 |
| Total rows | ~121,000 |
| Full SQL dump | ~12 MB |

This is a small dataset. The figures below are sized for an institute of a few
thousand students, with headroom.

### 2.2 Minimum, single-server

Everything on one host. Adequate for a pilot or a small institute.

| | |
|---|---|
| vCPU | 2 |
| RAM | **4 GB** |
| Disk | 40 GB SSD |
| OS | Ubuntu 22.04 LTS or 24.04 LTS |

> **4 GB is a floor, not a preference.** The chatbot loads a ~90 MB ONNX
> embedding model into the Node process, and Qdrant wants its own memory. On
> 2 GB the two together will be tight.
>
> **Not running the chatbot? 2 GB is fine.** Ask the Data needs no embedding
> model and no Qdrant.

### 2.3 Recommended, separated

| Host | Role | vCPU | RAM | Disk |
|---|---:|---:|---:|---:|
| Web / API | nginx + Node backend | 2 | 4 GB | 40 GB |
| Database | MySQL 8.4 | 2 | 4 GB | 100 GB |
| Qdrant *(optional)* | Docker | 1 | 2 GB | 20 GB |

A managed MySQL service is a reasonable substitute for the database host, and
removes backup and patching from your workload. **It must be MySQL 8.4 or
later** — see §2.5.

### 2.4 Software to install

| | Version | For |
|---|---|---|
| Node.js | 18+ (24.x used in development) | Backend |
| npm | 9+ | Both |
| MySQL | **8.4+** | Database |
| nginx | Any current | Static files + reverse proxy |
| Docker + Compose | Any current | Qdrant only |
| certbot | Any current | TLS |
| `build-essential`, `python3` | — | `bcrypt` compiles at install |

### 2.5 Database requirements — not negotiable

- **MySQL 8.4 or later.** The schema uses generated columns, `CHECK`
  constraints and window functions.
- **MySQL 5.7 will not work.**
- **MariaDB is not a substitute.** It differs on generated columns and on the
  `information_schema` views the tooling reads.
- Character set **`utf8mb4`**, collation **`utf8mb4_unicode_ci`**. Names in the
  data contain characters `latin1` cannot store.

---

## 3. Network and ports

| Port | Service | Internet-facing | Notes |
|---|---|---|---|
| 443 | HTTPS (nginx) | **Yes** | The only port users need |
| 80 | HTTP | **Yes** | Redirect to 443 only |
| 22 | SSH | Restricted | Allowlist, key auth only |
| 5000 | Backend API | **No** | Bind to localhost; reach via proxy |
| 3306 | MySQL | **No** | Private network or allowlist |
| 6333 / 6334 | Qdrant | **No** | Bound to 127.0.0.1 by the compose file |

### Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

> **Qdrant has no authentication in this setup.** If you move it off the
> application host, put authentication or a private network in front of it.
> Never expose 6333 to the internet.

### Outbound access required

| Destination | Why | Optional? |
|---|---|---|
| `api.groq.com` | Both AI features | Yes — without it, AI features fail; nothing else does |
| Hugging Face CDN | Downloads the embedding model, **once** | Yes — chatbot only |
| Your MySQL host | Everything | No |

There is **no** telemetry, analytics, or licensing call-home.

---

## 4. Where things live

A conventional layout. Adapt to your standards.

| | Path |
|---|---|
| Application root | `/opt/aims` |
| Backend | `/opt/aims/AIMS/backend` |
| Backend entry point | `src/server.js` |
| Frontend build output | `/opt/aims/AIMS/frontend/dist` |
| Frontend web root | `/var/www/aims` |
| Database scripts | `/opt/aims/AIMS/database` |
| Backups | `/opt/aims/AIMS/database/backups` — **contains personal data** |
| Embedding model cache | `/opt/aims/AIMS/backend/.models` |
| Qdrant data | Docker named volume `qdrant_storage` |

### Configuration files — none are in version control

| File | Read by |
|---|---|
| `AIMS/backend/.env` | The running API |
| `AIMS/database/.env` | `sequelize-cli` and the database scripts |
| `AIMS/frontend/.env` | The **build**, not the runtime |

> `frontend/.env` is consumed at build time. Editing it on a server changes
> nothing — the value is already compiled into the JavaScript. See
> `DEPLOYMENT.md` §5.3.

---

## 5. Services and processes

| Service | Manager | Restart policy |
|---|---|---|
| `aims-api` | systemd or PM2 — **you must create this**, none is provided | Always |
| `nginx` | systemd | Always |
| `aims-qdrant` | Docker Compose | `unless-stopped` |
| MySQL | systemd, or managed | Always |

### Scheduled jobs

**There are none.** Nothing is scheduled today.

You should add at least:

| Job | Suggested schedule | Command |
|---|---|---|
| Database backup | Daily, off-peak | `cd /opt/aims/AIMS/database && DB_NAME=aims_db node scripts/backup_database.js` |
| Backup retention | Weekly | Prune `database/backups/` to your policy |
| TLS renewal | Automatic | certbot installs its own timer — verify with `certbot renew --dry-run` |

The database also contains four stored procedures, including
`sp_mark_overdue_fees` and `sp_calculate_book_fines`. **Nothing calls them on a
schedule.** Decide whether they should run periodically; if so, add a job.

---

## 6. Backups

### What must be backed up

| | Why |
|---|---|
| **The MySQL database** | The only irreplaceable thing. All student, staff, attendance, marks and fee data. |
| `backend/.env`, `database/.env` | Secrets. Back these up to a **secret store**, not to a file share. |
| Uploaded documents | Stored **inside** the database, so a database backup covers them. |

### What does not need backing up

- The source code — it is in git.
- `node_modules/`, `frontend/dist/` — rebuilt from source.
- The Qdrant volume — rebuilt from the Markdown files in minutes (`AI_RUNBOOK.md` §B2).
- `backend/.models/` — re-downloaded automatically.

### Taking a backup

```bash
cd /opt/aims/AIMS/database
DB_NAME=aims_db node scripts/backup_database.js
```

Writes a timestamped `.sql` into `database/backups/`.

### Restoring

```bash
cd /opt/aims/AIMS/database
node scripts/restore_database.js <path-to-backup.sql> <target-database>
```

**Restore into a scratch database first and check it**, then swap. Never restore
straight over a working database.

> ### Backups contain personal data
>
> Names, addresses, guardian contacts, fee records. `database/backups/` is
> git-ignored deliberately. Never commit a backup, attach one to a ticket, or
> put one on a shared drive without encryption. Apply whatever retention and
> protection policy governs student records at your institution.

---

## 7. Monitoring

**Nothing is instrumented.** No metrics, no alerting, no error tracking, no
structured logs.

There is also **no unauthenticated health endpoint** to point a load balancer or
uptime monitor at. Both AI routes expose `/capabilities`, but they require a
valid token.

Adding a small unauthenticated `/healthz` that checks database connectivity is
the first thing worth doing.

### What to watch in the meantime

| Signal | How |
|---|---|
| Backend alive | `systemctl status aims-api` or `pm2 status` |
| Backend logs | `journalctl -u aims-api -f` or `pm2 logs aims-api` |
| Database reachable | The backend logs `Database Connected Successfully` at boot |
| AI read-only account | Logged at boot: `assistant read-only account OK on <db>` |
| Qdrant | `curl http://127.0.0.1:6333/healthz` |
| Disk | Backups accumulate; nothing prunes them |
| TLS expiry | certbot's timer, plus an external expiry check |

Logging is `morgan("dev")` to stdout — human-readable, unstructured, unrotated.
Your process manager decides where it goes. Configure rotation, or the disk
fills eventually.

---

## 8. Credentials — how to transfer them

> ### Do not put secrets in this document, or any document.
>
> Not in the repository, not in a PDF, not in email or chat.

### What must change hands

| Secret | Where it is used | Action at handover |
|---|---|---|
| MySQL application user + password | `backend/.env`, `database/.env` | **Create new** on the organisation's server |
| `aims_ai_ro` password | Both `.env` files | **Create new** |
| `JWT_ACCESS_SECRET` | `backend/.env` | **Generate new** — `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | `backend/.env` | **Generate new**, independently |
| `GROQ_API_KEYS` | `backend/.env` | **Reissue** on an organisation-owned Groq account |
| First admin password | Created by script | Set at install, changed at first sign-in |

### How to transfer

Use a proper secret-management process — an organisational password manager, a
vault, or an encrypted one-time-secret link. Not email. Not chat. Not a
document.

### ⚠ The old secrets must be treated as compromised

The `.env` files were **committed to git**. Every secret they contained is in
the repository history and must be assumed exposed:

- the Groq API keys
- both JWT signing secrets
- the database password

They have been removed from tracking, but **git history still contains them**.

**Therefore:**

1. Generate entirely new secrets for the production deployment. Do not reuse any
   value from the repository.
2. Revoke the old Groq keys at <https://console.groq.com>.
3. The old database instance is being decommissioned, so its password ceases to
   matter — but do not reuse it.

Rotating the JWT secrets invalidates every existing session. On a first
deployment that costs nothing.

---

## 9. Domain and TLS

Neither exists. To set up:

1. Register or choose a hostname, e.g. `aims.yourdomain.edu`.
2. Point an `A` record at the web host.
3. Issue a certificate:
   ```bash
   sudo certbot --nginx -d aims.yourdomain.edu
   ```
4. Confirm renewal works:
   ```bash
   sudo certbot renew --dry-run
   ```
5. Set `CORS_ORIGIN` in `backend/.env` to that exact origin.
6. Set `VITE_API_BASE_URL` and **rebuild the frontend** — it is compiled in.

**Serving the API from `/api/` on the same domain is simpler**, because it
removes CORS from the picture entirely. See `DEPLOYMENT.md` §7.3.

---

## 10. Handover checklist

**Infrastructure**
- [ ] Host(s) provisioned to §2
- [ ] MySQL 8.4+ installed, `utf8mb4` / `utf8mb4_unicode_ci`
- [ ] Node.js 18+, nginx, Docker installed
- [ ] Firewall configured to §3; 5000, 3306, 6333 not internet-facing
- [ ] Domain registered, DNS pointed
- [ ] TLS issued, auto-renewal verified

**Application**
- [ ] Database built from the three SQL files (`DATABASE_SETUP.md`)
- [ ] `aims_ai_ro` created, `prove_readonly_account.js` **passes**
- [ ] First admin created; credentials in the secret store
- [ ] All three `.env` files written with **new** secrets
- [ ] `DB_NAME` matches in `backend/.env` and `database/.env`
- [ ] Frontend built with the **production** `VITE_API_BASE_URL`
- [ ] `grep -ro "localhost:5000" frontend/dist/assets/*.js` returns **nothing**
- [ ] Backend running under a process manager, enabled on boot
- [ ] nginx serving `dist/` **with the SPA fallback**
- [ ] Qdrant running and corpus ingested — if the chatbot is wanted

**Security**
- [ ] Old Groq keys revoked
- [ ] New JWT secrets generated independently
- [ ] No `.env` file in version control
- [ ] Read `SECURITY.md` and accept or remediate the items listed there

**Operations**
- [ ] Daily backup job scheduled
- [ ] Backup restore tested at least once, into a scratch database
- [ ] Log rotation configured
- [ ] Someone named as owner of the Groq account and the server

**Verification**
- [ ] Sign in as each of the five roles
- [ ] Walk `TESTING_GUIDE.md` end to end

---

## Related documents

| Document | Covers |
|---|---|
| `DEPLOYMENT.md` | The step-by-step deployment |
| `DATABASE_SETUP.md` | Building the database |
| `AI_RUNBOOK.md` | Docker, embeddings, AI operations |
| `TESTING_GUIDE.md` | Verifying a deployment |
