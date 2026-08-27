# AIMS — Security Documentation

**How AIMS protects data, and where it does not.**

Written for whoever becomes responsible for running this system. It describes
the controls that exist, states the weaknesses plainly, and says what to do
about each.

> **No secrets appear in this document.** Where a credential is needed, it says
> which variable holds it and where an authorised administrator obtains it.

---

## 1. Security posture in one page

**Strong:**
- Every rule and permission is enforced on the server. The browser hides nothing
  that matters.
- Passwords are bcrypt-hashed, never stored or logged in plaintext.
- Sign-in failures are uniform, with account locking after five attempts.
- The AI features run on a `SELECT`-only database account with column-level
  restrictions — a control that holds even if everything above it fails.
- Uploads are verified by file **signature**, not by extension or content type.
- Significant actions are audited, with credentials scrubbed.

**Weak:**
- **No password complexity policy.** Eight characters, nothing else.
- **No rate limiting** on any route except the two AI ones.
- **Secrets were committed to git** and must be treated as compromised.
- **No MFA.**
- The permission tables are decorative; access is role-level only.

Full detail below; the gaps are §8.

---

## 2. Authentication

### 2.1 Mechanism

| | |
|---|---|
| Method | Email + password |
| Password storage | **bcrypt**, cost factor **10** |
| Token | JSON Web Token, signed with `JWT_ACCESS_SECRET` |
| Token lifetime | `ACCESS_TOKEN_EXPIRES` — **8h** in the current configuration |
| Transport | `Authorization: Bearer <token>` |
| Client storage | `sessionStorage`, scoped to one browser tab |

Passwords are never stored, logged, or returned in plaintext. A generated
password is displayed **once**, at the moment of creation, for an administrator
to pass on.

### 2.2 Refresh tokens are configured but not implemented

`JWT_REFRESH_SECRET` and `REFRESH_TOKEN_EXPIRES=7d` exist in `.env`. **Nothing
reads them.** There is no refresh token anywhere in the backend.

The practical behaviour: one access token, valid 8 hours. When it expires the
client receives 401 and signs the user out. There is no silent renewal.

> **Do not assume a refresh flow exists** when reasoning about session
> lifetime. Either implement it or remove the variables — leaving them invites
> a false assumption in a future security review.

### 2.3 The sign-in failure policy

Deliberately uniform. **Every** failure returns the same message:

> *"Email or password is incorrect"*

That covers a wrong password, an unknown address, a disabled account, and a
valid password used on the wrong portal. Anything more specific tells an
attacker which addresses exist.

| Control | Behaviour |
|---|---|
| Attempt counter | Per account |
| Warning | Countdown shown from **3** attempts remaining |
| Lock | After **5** consecutive failures |
| Locked response | HTTP **423** |
| Unlock | **Administrator only** — there is no timed auto-unlock |
| Unknown addresses | Tracked by a **ghost counter**, 30-minute TTL |

**The ghost counter matters.** Without it, an attacker could distinguish a real
address from an invented one by whether the countdown appeared. Made-up
addresses get a counter too, so both behave identically.

A dummy bcrypt hash is compared against when no account matches, so response
timing does not reveal whether the address exists either.

### 2.4 Password lifecycle

| | Status |
|---|---|
| Admin-issued passwords force a change at first sign-in | ✔ |
| Users may change their own password from any portal | ✔ |
| Reset is performed by an administrator | ✔ |
| Self-service reset by email | ✗ No mail transport is configured |
| Password expiry | ✗ |
| Password history / reuse prevention | ✗ |

---

## 3. Authorisation

Three independent layers, all server-side.

### 3.1 Route gate

```js
// middlewares/rbac.middleware.js
if (!allowedRoles.includes(req.user.role_id)) return 403;
```

Every protected route declares `authorize(...roleIds)`. Role IDs come from
`config/roles.js`, which is the single source of truth and mirrors the `roles`
table.

### 3.2 Record scope

`selfScope.middleware.js` restricts a student to their own rows and a parent to
their wards'. It guards student-addressed and document-addressed routes, so
changing an ID in a URL does not reach another person's record.

### 3.3 Query scope

For the AI features, where the query is not written in advance,
`scope.service.js` resolves per request which rows the caller may see. A
teacher's generated SQL has its table names rewritten into CTEs restricted to
their own roster — see §6.3.

### 3.4 The permission tables are not used

`permissions` (18 rows) and `role_permissions` (35 rows) are populated and look
like a permission system. **Nothing reads them.** `authorize()` compares role
IDs and nothing else.

Consequences:
- Access is **role-level only**. There is no way to grant one extra capability
  to one role without changing code.
- A security review that reads the schema will overestimate the granularity.

Both tables now carry a table `COMMENT` in the database stating this, so it
cannot be missed by someone reading the DDL.

### 3.5 Privilege rules

- An Admin cannot promote an account to Super Admin.
- A user cannot change their own role.
- The number of active Super Admins may never reach zero.

---

## 4. Session handling

Sessions live in `sessionStorage`, **not** `localStorage` and **not** cookies.

**Why:** `localStorage` is shared by every tab of an origin, so opening a second
portal overwrote the first. Per-tab storage lets an administrator keep four
portals open side by side — which is how the system is demonstrated and tested.

**The acting-user header.** Every request carries `x-aims-acting-user` alongside
the token. The server cross-checks it against the token's subject and returns
**409** on mismatch, rather than answering confidently for the wrong account.

**Trade-off:** because the token is not in an `HttpOnly` cookie, there is no
CSRF surface from ambient credentials — but a successful XSS could read the
token. See §8.5.

---

## 5. Input handling and injection

| Control | Implementation |
|---|---|
| SQL injection | **Parameterised queries throughout** — Sequelize bindings and named replacements. No string-concatenated user input reaches SQL. |
| Request validation | `express-validator` chains reject a malformed body **before** a controller sees it |
| Whitespace | `sanitize.middleware.js` edge-trims every incoming string except passwords and tokens |
| XSS | React escapes by default. Model output is rendered through a small deliberate formatter — **never** `dangerouslySetInnerHTML` |
| Security headers | `helmet`, with `crossOriginResourcePolicy: cross-origin` for assets |
| CORS | Explicit origin allowlist from `CORS_ORIGIN`; a disallowed origin gets **403**, not a 500 |

> **Passwords are exempt from trimming on purpose.** Trimming a password would
> silently change it, and a leading or trailing space is a legitimate character.

### File uploads

| | |
|---|---|
| Avatars | **1 MB**, cropped to 512×512 |
| Documents | **8 MB** |
| Type check | **File signature (magic bytes)**, not extension or `Content-Type` |
| Storage | As binary rows **in the database**, not on disk |
| Serving | Through authenticated routes, with `nosniff` |

Renaming an HTML file to `.png` does not get it past the signature check.
Storing media in the database means a backup captures it and there is no
separate file store to secure.

---

## 6. AI-specific security

The AI features are the only place where a language model influences what runs
against the database. They are built accordingly.

### 6.1 The governing rule

> **Row data never enters the model.**

The model converts a question into a plan; the database answers it; rows reach
the browser without passing back through a model. Nothing is pasted into a
prompt, so nothing can be truncated, averaged or editorialised into a wrong
figure.

### 6.2 Layered guards

| Layer | Control |
|---|---|
| 1 | **Tool registry** — a role is never *shown* a tool it may not call. The name is absent from the prompt, so there is nothing to argue it into. |
| 2 | **SQL guard** — single statement, must begin `SELECT`/`WITH`, under 5,000 chars, 20 forbidden constructs, forced `LIMIT`. Comments and string literals are stripped first, so `SELECT '-- DROP TABLE'` is not refused for text it merely quotes. |
| 3 | **Scope rewrite** — a teacher's 12 table names become CTEs over their own roster. |
| 4 | **`aims_ai_ro`** — the database account itself. |
| 5 | **Timeout** — 10 seconds. |

**Layer 4 is the security property.** Layers 1–3 catch honest mistakes early and
produce auditable refusals; a SQL guard written in regular expressions is not a
SQL parser and was never meant to be the thing standing between a model and the
data.

### 6.3 The read-only account

`aims_ai_ro` holds `SELECT` and nothing else, with column-level restrictions:

| Withheld | Why |
|---|---|
| `users.password_hash` | Credential material |
| `users.profile_picture_data` | Binary bulk |
| `students.cnic_bform` | National identity number |
| `employees.basic_salary` | Compensation |
| `payroll` (whole table) | Compensation |
| `assistant_conversations`, `assistant_messages` | Other people's conversations |

> **Grants are per database.** Pointing `DB_NAME` at a different database leaves
> the account able to connect and unable to read. The backend reports this at
> boot rather than surfacing it as a 500 later.

**Verify, do not assume:**
```bash
cd AIMS/database && node scripts/prove_readonly_account.js
```
It attempts an `INSERT`, `UPDATE` and `DELETE` and expects all three refused.

### 6.4 Prompt-injection posture

- The chatbot has **no database access at all** — there is nothing for a crafted
  question to reach.
- The analytics planner is given only tools the caller may use, so a successful
  injection still cannot name a tool that is not there.
- `SHOW` and `DESCRIBE` are refused despite being read-only, so an injected
  prompt cannot enumerate the schema first.
- Every AI call is written to an audit log.

### 6.5 Data sent to third parties

Questions and retrieved documentation passages are sent to **Groq**. Student
rows are not — that is what §6.1 guarantees.

**A question can still contain personal data if a user types it** (*"why is
Ali Raza failing"*). Treat Groq as a third-party processor and check that
against your institution's data-protection obligations.

Embeddings are computed **locally on CPU**; documentation text is never sent
anywhere for embedding.

---

## 7. Auditing

`auditService.js` records **acts, not reads**: account creation, password
issuance and reissuance, role changes, mark amendments, fee decisions,
enrolment changes.

| Property | Behaviour |
|---|---|
| Credential scrubbing | `record()` strips any key that looks like a password — the trail **cannot** hold one, even by mistake |
| Rendering | Each row renders as a readable sentence |
| Who | The acting account, always |
| AI calls | Logged separately, including refused plans |

**Not audited:** ordinary reads. Who *viewed* a student record is not recorded.
If your institution requires read auditing, that is a gap.

---

## 8. Known weaknesses

Stated plainly, with what to do.

### 8.1 No password complexity policy — **High**

`validators/authValidator.js` enforces:

```js
body("password").isLength({ min: 8 })
```

That is the entire policy. No uppercase, digit, symbol, dictionary or reuse
check, anywhere — not on registration, not on change, not on reset.

`password` and `12345678` are both accepted.

**Mitigation now:** issue long random passwords administratively; brief users.
**Fix:** add complexity rules to the validator and a check against a common-password list. **Effort: small.**

### 8.2 No global rate limiting — **High**

Only `/api/chatbot` and `/api/analytics` are limited. **Sign-in is not
rate-limited.**

Account locking after five failures blunts password guessing against a *known*
account, but nothing limits request volume across many accounts, and nothing
limits any other endpoint.

**Fix:** add `express-rate-limit` globally, with a tighter limit on
`/api/auth/login`. **Effort: small.**

### 8.3 Secrets were committed to git — **Critical, until rotated**

`backend/.env`, `database/.env` and `frontend/.env` were tracked in version
control. **Everything they contained is in the git history:**

- `GROQ_API_KEYS`
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`
- the database password

Removing them from tracking does **not** remove them from history.

**Required before production:**
1. Generate entirely new JWT secrets — `openssl rand -base64 48`, independently.
2. Revoke the old Groq keys at <https://console.groq.com> and issue new ones on
   an organisation-owned account.
3. Use a new database password.
4. Reuse **no** value that appears anywhere in the repository.

Optionally purge history with `git-filter-repo`. Rotation is what actually
matters; purging only reduces exposure of values that are already dead.

### 8.4 No multi-factor authentication — **Medium**

Not supported for any role, including Super Admin. A compromised administrator
password is full administrative access.

### 8.5 Token readable by XSS — **Medium**

The JWT lives in `sessionStorage`, so any successful XSS can read it. The
mitigations are React's default escaping, the deliberate avoidance of
`dangerouslySetInnerHTML`, and helmet's headers.

The alternative — an `HttpOnly` cookie — would reintroduce CSRF and break the
per-tab sessions the product depends on. **This is a considered trade-off, not
an oversight**, but it should be a conscious one for whoever owns the system.

**Fix if required:** a Content-Security-Policy tight enough to make inline
script execution impossible.

### 8.6 Permission tables unused — **Medium**

See §3.4. Access is role-level. Granting a single extra capability requires a
code change.

### 8.7 Refresh tokens configured but absent — **Low**

See §2.2. Dead configuration that invites a false assumption.

### 8.8 No read auditing — **Low, context-dependent**

See §7.

### 8.9 Qdrant has no authentication — **Medium if exposed**

The container binds `127.0.0.1` in the supplied compose file, so it is not
reachable from the network by default. If moved to its own host, it must be put
behind authentication or a private network.

### 8.10 No encryption at rest — **Depends on host**

Nothing in AIMS encrypts stored data. Backups are plain SQL and contain personal
data. Encryption at rest is the database host's responsibility.

---

## 9. Security configuration checklist

**Before production**
- [ ] New `JWT_ACCESS_SECRET`, generated independently — 32+ random bytes
- [ ] Old Groq keys revoked; new organisation-owned keys issued
- [ ] New database password
- [ ] No `.env` file tracked in git — confirm with `git ls-files | grep .env`
- [ ] `prove_readonly_account.js` passes on production
- [ ] HTTPS enforced; HTTP redirects
- [ ] `CORS_ORIGIN` lists **only** the real frontend origin
- [ ] Backend port 5000 not internet-facing
- [ ] MySQL port not internet-facing
- [ ] Qdrant not internet-facing
- [ ] Firewall default-deny inbound
- [ ] SSH key-only, no password auth
- [ ] Database backups encrypted at rest and access-controlled

**Accepted risks — record a decision on each**
- [ ] No password complexity policy (§8.1)
- [ ] No rate limiting outside AI routes (§8.2)
- [ ] No MFA (§8.4)
- [ ] Token readable by XSS (§8.5)
- [ ] Role-level permissions only (§8.6)
- [ ] No read auditing (§8.8)

**Ongoing**
- [ ] `npm audit` on a schedule; patch dependencies
- [ ] Review the audit trail periodically
- [ ] Rotate secrets on a defined cycle
- [ ] Review accounts when staff leave
- [ ] Keep MySQL and Node patched

---

## 10. Where credentials come from

**No credential is stored in the repository or in any document.**

| Secret | Variable | Where an authorised admin gets it |
|---|---|---|
| Database password | `DB_PASSWORD` | Organisation's secret store |
| AI read-only password | `AI_DB_PASSWORD` | Chosen at install; secret store |
| JWT signing secret | `JWT_ACCESS_SECRET` | Generated at install; secret store |
| Groq API keys | `GROQ_API_KEYS` | Organisation's Groq account |
| First admin password | — | Set by `create_first_admin.js`; recorded in the secret store, changed at first sign-in |

Transfer through an organisational password manager, a vault, or an encrypted
one-time-secret link. **Not email. Not chat. Not a document.**

---

## 11. If something goes wrong

**Suspected account compromise**
1. User Management → disable the account
2. Reissue credentials; the new password must be changed at first sign-in
3. Read the audit trail for that account
4. If administrative, rotate `JWT_ACCESS_SECRET` — this signs out everyone

**Suspected key leak**
1. Revoke at <https://console.groq.com> immediately
2. Issue replacements; update `GROQ_API_KEYS`; restart the backend
3. Only the AI features are affected; nothing else stops

**Suspected data breach**
1. Preserve the audit trail and server logs **before** changing anything
2. Take a database backup for forensics
3. Rotate every secret in §10
4. Follow your institution's breach-notification obligations

---

## Related documents

| Document | Covers |
|---|---|
| `SERVER_HANDOVER.md` | Credential transfer and infrastructure |
| `DEPLOYMENT.md` | TLS, firewall, ports |
| `GAPS_AND_LIMITATIONS.md` §6 | The same weaknesses, with effort estimates |
| `ARCHITECTURE.md` §6 | How authentication and authorisation are built |
| `AI_IMPLEMENTATION.md` | The AI subsystem in detail |
