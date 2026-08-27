# AIMS — Installation & Deployment Guide

**How to deploy AIMS from nothing, on your own infrastructure.**

Written so that a developer who has never seen this project can take it from a
git clone to a running system.

---

## Read this first

**AIMS has never been deployed to a server.** It has only ever run on a
developer machine against a managed MySQL instance.

That means the repository contains **no** deployment infrastructure:

| | |
|---|---|
| Dockerfile for the application | ✗ none |
| Reverse-proxy config (nginx, Caddy, Apache) | ✗ none |
| Process manager config (PM2, systemd) | ✗ none |
| CI/CD pipeline | ✗ none |
| TLS/SSL configuration | ✗ none |

This guide tells you what to create. Nothing here is a matter of restoring a
previous setup, because there was not one. Sample configs below are starting
points to adapt, not files copied out of a working production system.

The one Docker file that *does* exist, `backend/docker-compose.qdrant.yml`, runs
the chatbot's vector store — not the application.

---

## 1. What AIMS is made of

Three pieces, plus one optional fourth.

| Piece | What it is | Where it runs |
|---|---|---|
| **Database** | MySQL 8.4+ | Its own host, or managed |
| **Backend** | Node.js + Express REST API | A Node process, port 5000 by default |
| **Frontend** | React 19 + Vite — a **static** single-page app | Any static file host |
| **Qdrant** *(optional)* | Vector store for the help chatbot | Docker container |

The frontend is **not** a Node server in production. `npm run build` produces
plain static files. Everything else is optional detail.

```
Browser  ──▶  Static host (frontend files)
   │
   └────────▶  Node/Express API  ──▶  MySQL
                     │
                     └────────────▶  Qdrant  (chatbot only)
```

---

## 2. Prerequisites

| Software | Version | Notes |
|---|---|---|
| **Node.js** | 18+ (developed on 24.x) | No `engines` field is declared, so npm will not warn you on a wrong version. |
| **npm** | 9+ | Ships with Node. |
| **MySQL** | **8.4+** | Generated columns, `CHECK` constraints and window functions are used. **5.7 will not work. MariaDB is not a substitute.** |
| **Docker** | Any current version | Only for the chatbot. |
| **Git** | Any | |

Native modules — `bcrypt` compiles on install. On a bare Linux host you will
need `build-essential` (or `gcc-c++ make`) and `python3` before `npm install`.

---

## 3. Get the code and install

```bash
git clone <your-repository-url> aims
cd aims/AIMS

npm run install:all      # installs backend and frontend
```

That is equivalent to:

```bash
npm --prefix backend install
npm --prefix frontend install
```

> `node_modules/` and `frontend/dist/` should **not** be in the repository. If
> your clone contains them, delete both and run the install yourself — a
> committed `node_modules` is almost always stale or platform-wrong.

---

## 4. Set up the database

Follow **`DATABASE_SETUP.md`** in full. In short:

```bash
cd AIMS/database

# 1. Create an empty database (utf8mb4 / utf8mb4_unicode_ci)
# 2. Load the three files, in this order
mysql -u <user> -p aims_db < schema.sql
mysql -u <user> -p aims_db < constraints.sql
mysql -u <user> -p aims_db < reference_data.sql

# 3. Create the read-only AI account
node scripts/create_ai_readonly_user.js
node scripts/prove_readonly_account.js

# 4. Create the one account you sign in with
DB_NAME=aims_db node scripts/create_first_admin.js --password '<choose one>'
```

`reference_data.sql` also stamps the migration ledger, so `sequelize-cli` knows
the schema is current and does not try to re-apply every migration over it.

---

## 5. Environment variables

Three `.env` files. **None of them belong in version control.** Start from the
matching `.env.example`.

### 5.1 `AIMS/backend/.env`

```bash
PORT=5000

# Comma-separated. Must list the EXACT origin the browser loads the frontend
# from, including scheme and port. A wildcard will not work: the browser
# rejects one on credentialed requests.
CORS_ORIGIN=https://aims.yourdomain.edu

# Database
DB_HOST=your-mysql-host
DB_PORT=3306
DB_NAME=aims_db
DB_USER=aims_app
DB_PASSWORD=<secret>
DB_SSL=true                 # false for a private network

# JWT. Generate each independently:  openssl rand -base64 48
JWT_ACCESS_SECRET=<secret>
JWT_REFRESH_SECRET=<secret>
ACCESS_TOKEN_EXPIRES=15m
REFRESH_TOKEN_EXPIRES=7d

# Read-only account the AI features use
AI_DB_USER=aims_ai_ro
AI_DB_PASSWORD=<secret>

# AI — see AI_IMPLEMENTATION.md and AI_RUNBOOK.md
GROQ_API_KEYS=<key1,key2,key3>
GROQ_MODEL=openai/gpt-oss-120b
ASSISTANT_RATE_PER_MINUTE=8
ASSISTANT_RATE_PER_HOUR=60
ASSISTANT_RATE_PER_DAY=200
QDRANT_URL=http://127.0.0.1:6333
QDRANT_COLLECTION=aims_knowledge
EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2
EMBEDDING_DIM=384
```

### 5.2 `AIMS/database/.env`

Read by `sequelize-cli` and every script in `database/scripts/`.

```bash
DB_HOST=your-mysql-host
DB_PORT=3306
DB_NAME=aims_db
DB_USER=aims_app
DB_PASSWORD=<secret>
DB_SSL=true
AI_DB_USER=aims_ai_ro
AI_DB_PASSWORD=<secret>
```

> **`DB_NAME` must match `backend/.env`.** These two files drift, and they fail
> differently: if the backend points at a test database while this one still
> names production, a bare `npx sequelize-cli db:migrate` runs **against
> production**. Check both before any migration:
>
> ```bash
> grep DB_NAME AIMS/backend/.env AIMS/database/.env
> ```

### 5.3 `AIMS/frontend/.env`

```bash
VITE_API_BASE_URL=https://api.aims.yourdomain.edu
VITE_API_TIMEOUT=30000
```

> ## ⚠ The single most important deployment fact
>
> **`VITE_API_BASE_URL` is compiled into the JavaScript at build time.** It is
> not read at runtime. Changing the `.env` file on the server does nothing —
> the value is already inside the bundle.
>
> Change the API URL → **rebuild the frontend and redeploy the files.**
>
> Verify before you ship:
> ```bash
> grep -ro "localhost:5000" AIMS/frontend/dist/assets/*.js
> ```
> Any output means you built with the wrong value, and the deployed app will try
> to call the visitor's own machine.

### 5.4 If your MySQL requires TLS

Set `DB_SSL=true` and put the CA certificate at `AIMS/database/config/ca.pem`.
Managed providers give you this file.

---

## 6. Build the frontend

```bash
cd AIMS/frontend
npm run build
```

Output goes to `AIMS/frontend/dist/` — about 6.6 MB of static files.

Sanity check before deploying:
```bash
npm run preview        # serves dist/ locally
```

---

## 7. Deploy

### 7.1 Backend

The backend is a plain Node process. It needs a **process manager** so it
restarts on crash and on boot. There is no config for one in the repository —
create it.

**systemd** (`/etc/systemd/system/aims-api.service`):

```ini
[Unit]
Description=AIMS Backend API
After=network.target

[Service]
Type=simple
User=aims
WorkingDirectory=/opt/aims/AIMS/backend
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/opt/aims/AIMS/backend/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now aims-api
sudo systemctl status aims-api
```

**Or PM2:**

```bash
npm install -g pm2
cd /opt/aims/AIMS/backend
pm2 start src/server.js --name aims-api
pm2 save
pm2 startup           # prints a command to run so it survives reboot
```

### 7.2 Frontend

Copy `dist/` to your web root and serve it as static files.

**The SPA fallback is mandatory.** Every AIMS URL — `/dashboard`,
`/students/1`, `/parent/fees` — is handled by the browser router. Without a
fallback, a reload or a bookmark on any of them returns 404.

**nginx** (adapt; this is a starting point, not a running config):

```nginx
server {
    listen 443 ssl http2;
    server_name aims.yourdomain.edu;

    ssl_certificate     /etc/letsencrypt/live/aims.yourdomain.edu/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/aims.yourdomain.edu/privkey.pem;

    root /var/www/aims;
    index index.html;

    # The SPA fallback. Without this, a reload on any route 404s.
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Hashed asset filenames, so they can be cached hard.
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # index.html must NOT be cached, or users keep an old bundle
    # pointing at old asset hashes after a deploy.
    location = /index.html {
        add_header Cache-Control "no-cache";
    }
}

server {
    listen 80;
    server_name aims.yourdomain.edu;
    return 301 https://$host$request_uri;
}
```

### 7.3 Backend behind the same domain (recommended)

Serving the API from a path on the same origin avoids CORS entirely.

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Document uploads are capped at 8 MB by the application.
    client_max_body_size 10M;
}
```

Then set `VITE_API_BASE_URL=https://aims.yourdomain.edu` and rebuild.

If you instead put the API on its own subdomain, `CORS_ORIGIN` must list the
frontend origin exactly.

### 7.4 TLS

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d aims.yourdomain.edu
```

Certbot installs a renewal timer. Confirm it:
```bash
sudo certbot renew --dry-run
```

**Use HTTPS.** Sign-in credentials and JWTs cross this connection on every
request.

### 7.5 Chatbot (optional)

```bash
cd /opt/aims/AIMS/backend
docker compose -f docker-compose.qdrant.yml up -d
node src/scripts/ingest_knowledge_base.js
```

Full detail, including troubleshooting, is in **`AI_RUNBOOK.md`**.

Skip this and everything except the help chatbot still works.

---

## 8. Ports and firewall

| Port | Service | Exposed to the internet? |
|---|---|---|
| 443 | HTTPS (nginx) | **Yes** |
| 80 | HTTP → redirect | **Yes** |
| 5000 | Backend API | **No** — bind to localhost, reach it through the proxy |
| 3306 | MySQL | **No** — private network or allowlist only |
| 6333 / 6334 | Qdrant | **No** — bound to 127.0.0.1 by the compose file |

Qdrant has **no authentication** in this setup. It must never be reachable from
the internet.

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp
sudo ufw enable
```

---

## 9. Start, stop, restart

| Action | systemd | PM2 |
|---|---|---|
| Start | `sudo systemctl start aims-api` | `pm2 start aims-api` |
| Stop | `sudo systemctl stop aims-api` | `pm2 stop aims-api` |
| Restart | `sudo systemctl restart aims-api` | `pm2 restart aims-api` |
| Logs | `sudo journalctl -u aims-api -f` | `pm2 logs aims-api` |
| On boot | `sudo systemctl enable aims-api` | `pm2 save && pm2 startup` |

Frontend, nginx, Qdrant:
```bash
sudo systemctl reload nginx
docker compose -f docker-compose.qdrant.yml restart
```

**A healthy backend boot prints:**

```
Database Connected Successfully
🚀 Server running on http://localhost:5000
   embedder ready in NNNNms
   assistant read-only account OK on aims_db
```

The last two lines are **non-fatal warnings** if they fail. The backend still
serves every non-AI route.

---

## 10. Deploying an update

```bash
cd /opt/aims
git pull

cd AIMS
npm run install:all

# Only if new migrations arrived — CHECK WHICH DATABASE FIRST
grep DB_NAME backend/.env database/.env
cd database && npx sequelize-cli db:migrate && cd ..

npm run build:frontend
sudo cp -r frontend/dist/* /var/www/aims/

sudo systemctl restart aims-api

# Only if knowledge-base files changed
cd backend && node src/scripts/ingest_knowledge_base.js
```

**Take a database backup before any migration:**
```bash
cd AIMS/database && DB_NAME=aims_db node scripts/backup_database.js
```

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Every request fails with a CORS error | `CORS_ORIGIN` does not list the exact frontend origin | Add it, scheme and port included. Restart the backend. |
| The app calls `localhost:5000` in production | Frontend built with the wrong `VITE_API_BASE_URL` | Rebuild and redeploy. It is baked in at build time. |
| Reload on `/dashboard` gives 404 | No SPA fallback | Add `try_files $uri $uri/ /index.html`. |
| `Database Connected Successfully` never appears | Wrong DB credentials, host unreachable, or TLS missing | Check `backend/.env`; set `DB_SSL` and `config/ca.pem` if the server requires TLS. |
| Sign-in always fails on a fresh install | No account exists yet | `node scripts/create_first_admin.js --password '...'` |
| `assistant read-only account UNUSABLE` | `aims_ai_ro` not granted on this database | `node scripts/create_ai_readonly_user.js` — grants are per database. |
| Chatbot says it cannot check right now | Qdrant is down | See `AI_RUNBOOK.md` §D1. |
| `bcrypt` fails to install | No compiler on the host | Install `build-essential` and `python3`, then reinstall. |
| Users are signed out when they close the tab | Working as designed | The session lives in `sessionStorage`, per tab. |
| 413 on a document upload | Proxy body limit below the app's 8 MB | Raise `client_max_body_size`. |

---

## 12. Things this deployment does not have

Be aware of these before going live. They are recorded in the security and gaps
documents as well.

- **No global rate limiting.** Only the two AI routes are limited. Sign-in is
  protected by account locking after five failures, not by a request limit.
- **No application-level health endpoint.** Nothing to point a load balancer or
  uptime monitor at. Both AI routes expose `/capabilities`, but they require
  authentication.
- **No structured logging or log rotation.** `morgan("dev")` writes
  human-readable lines to stdout. Your process manager decides what happens to
  them.
- **No automated backups.** `backup_database.js` exists but nothing schedules it.
- **No monitoring or alerting** of any kind.
- **No CI/CD.** Every deployment is the manual sequence in §10.

---

## Related documents

| Document | Covers |
|---|---|
| `DATABASE_SETUP.md` | Building the database from the three SQL files |
| `AI_RUNBOOK.md` | Docker, embeddings, and the AI features in operation |
| `AI_IMPLEMENTATION.md` | Every AI file and how to change it |
| `TESTING_GUIDE.md` | Verifying a deployment by hand |
