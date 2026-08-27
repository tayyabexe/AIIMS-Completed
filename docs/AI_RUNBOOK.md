# AIMS — AI Runbook: Docker, Embeddings, and Ask the Data

**The hands-on guide to standing up the AI features and keeping them running.**

This is the operational companion to `AI_IMPLEMENTATION.md`. That document
explains *what the files are and how to change them*; this one is *what to type,
in order, and what to do when it breaks*.

Work through it in order. Part A gets Ask the Data working — no Docker needed.
Part B adds the chatbot, which does need Docker.

---

## Before you start

| | |
|---|---|
| Node.js | 18 or later |
| MySQL | 8.4+, already built — see `DATABASE_SETUP.md` |
| Docker | Part B only |
| A Groq API key | Both parts — <https://console.groq.com> |
| Disk | ~500 MB: the embedding model is ~90 MB, Qdrant's image ~150 MB |

Both parts read `AIMS/backend/.env`. Start from `.env.example`.

---

# Part A — Ask the Data

Ask the Data needs **no Docker, no Qdrant and no embeddings.** It reads your
database directly through a restricted account. If the chatbot is the part
giving you trouble, everything here still works.

## A1. Create the read-only database account

Both AI features read through `aims_ai_ro`, a MySQL account that holds `SELECT`
and nothing else. This is the control that does not depend on any prompt,
validator or model behaving.

Set the credentials in **both** env files first — the creating script and the
running application read different ones:

```bash
# AIMS/database/.env   — read by the script that CREATES the account
AI_DB_USER=aims_ai_ro
AI_DB_PASSWORD=<choose a strong one>

# AIMS/backend/.env    — read by the application that USES the account
AI_DB_USER=aims_ai_ro
AI_DB_PASSWORD=<the same one>
```

Then create it:

```bash
cd AIMS/database
node scripts/create_ai_readonly_user.js
```

## A2. Prove it cannot write — do not skip this

```bash
node scripts/prove_readonly_account.js
```

It attempts an `INSERT`, an `UPDATE` and a `DELETE` and expects **all three to
be refused**.

> **If any of them succeeds, stop.** Do not run the AI features against an
> account that can write. Re-run `create_ai_readonly_user.js`, and check the
> account was not granted broader privileges by hand at some point.

It also confirms the column-level restrictions: `password_hash`, `cnic_bform`,
`salary`, the `payroll` table and the assistant's own transcript tables must all
be unreadable.

## A3. Add the Groq key

In `AIMS/backend/.env`:

```bash
GROQ_API_KEYS=gsk_key_one,gsk_key_two,gsk_key_three
```

Several keys are better than one. The client uses them in rotation, so a key
that hits a rate limit is rested rather than failing the request.

## A4. Start and check

Start the backend, sign in as an admin, and open **AI Analytics**.

Ask something small first — *"how many students are enrolled"* — before
anything expensive.

**A good answer shows a row count and a chart or table.** Open *"How this was
answered"* underneath: it names the tool or the exact SQL, the timing, and
whether the query needed a repair. If that panel is empty, the response never
reached the browser.

Ask the Data is now working. Part B is independent of it.

---

# Part B — The Help Chatbot

## B1. Start Qdrant

Qdrant is the vector database the documentation search runs on.

```bash
cd AIMS/backend
docker compose -f docker-compose.qdrant.yml up -d
```

What that gives you:

| | |
|---|---|
| Image | `qdrant/qdrant:v1.12.4` |
| Container | `aims-qdrant` |
| Ports | `127.0.0.1:6333` REST, `127.0.0.1:6334` gRPC |
| Storage | Docker **named volume** `qdrant_storage` |
| Restart | `unless-stopped` — it comes back when Docker does |

> **Bound to 127.0.0.1 deliberately.** Qdrant has no authentication in this
> setup, so it must not be reachable from the network. If you move it to its own
> host, put authentication in front of it.

> **A named volume, not a bind mount.** Qdrant's storage layout is its own
> business, and a bind mount on Windows adds a filesystem translation layer that
> has caused corruption reports.

Check it:

```bash
curl http://127.0.0.1:6333/healthz
docker ps --filter name=aims-qdrant
```

### Using your own Qdrant instead

Managed instance, or one elsewhere on your network? Set `QDRANT_URL` in
`AIMS/backend/.env` and skip the compose file entirely:

```bash
QDRANT_URL=https://your-qdrant-host:6333
QDRANT_COLLECTION=aims_knowledge
```

Nothing else changes. The collection is created automatically if absent.

## B2. Build the embeddings

```bash
cd AIMS/backend
node src/scripts/ingest_knowledge_base.js
```

What it does:

1. Reads every `.md` in `docs/knowledge-base/` and its front matter
   (`title`, `audience`).
2. Splits each file at its own `##` / `###` headings. No overlap — sections do
   not bleed into each other, so there is nothing to repair.
3. Embeds each chunk locally with `all-MiniLM-L6-v2` — 384 dimensions, CPU only,
   no API call and no cost.
4. Upserts into Qdrant in batches of 64.

> **The first run downloads the embedding model** (~90 MB) into
> `backend/.models/`. Expect a few minutes and no output while it does. Later
> runs start immediately.

**It is idempotent.** Point ids come from the document path and chunk index, so
re-running overwrites a document's chunks rather than appending a second copy.
Without that, editing one paragraph would leave the old wording in the corpus
and the chatbot would retrieve both — reporting superseded policy as current.

Re-run it freely.

### Check without changing anything

```bash
node src/scripts/ingest_knowledge_base.js --check
```

Reports status only. Use this to confirm the corpus is loaded before blaming
anything else.

## B3. Confirm retrieval actually returns text

```bash
cd AIMS/backend
node src/testing/rag.smoke.js
node src/testing/rag.search.js
node src/testing/chatbot.smoke.js
```

**Run `rag.smoke.js` after every re-ingest.** It is the test that catches the
one failure mode a health check cannot:

> Retrieval once read the wrong payload field. Every passage came back as an
> empty string and was silently dropped. Qdrant was up, scores were healthy at
> 0.44–0.64, and the chatbot still said nothing was documented — **identical to
> the index being down.** A connection check would have passed. A test asserting
> that a known question returns at least one non-empty passage catches it.

## B4. Try it

Open any portal and click the floating assistant button. Ask *"how do I change
my password"*.

- A real answer with a citation → working.
- *"I don't have that in the AIMS documentation"* → retrieval found nothing.
  Go to §D2.
- *"I can't check right now"* → Qdrant is unreachable. Go to §D1.

Those last two are deliberately different messages. **An outage must not read to
the user as "undocumented".**

---

# Part C — Routine operations

## C1. After editing any documentation file

```bash
cd AIMS/backend
node src/scripts/ingest_knowledge_base.js
node src/testing/rag.smoke.js
```

**Nothing watches the directory.** An edited file changes nothing until you
re-run this.

## C2. Adding a new documentation file

1. Create `docs/knowledge-base/NN-topic.md`.
2. Give it front matter with a `title` and an `audience`.
3. Re-ingest.

`audience` is a **permission**, applied at search time — a student's query never
retrieves a `staff` passage in the first place.

| `audience` | Who can retrieve it |
|---|---|
| `all` | Everyone |
| `student` | Students (and admins) |
| `teacher` | Teachers (and admins) |
| `parent` | Parents (and admins) |
| `staff` | Admins only |

> A file with **no valid audience defaults to `staff`** — the most restrictive.
> Forgetting to tag a file cannot leak it to students. It can, however, hide a
> file you meant everyone to read, which is the more likely mistake.

## C3. Backing up the vector store

You usually do not need to. The corpus is rebuilt from the Markdown files in
minutes, and **those** are what belong in version control.

To move it anyway:

```bash
docker run --rm -v qdrant_storage:/data -v "$PWD":/backup \
  alpine tar czf /backup/qdrant-backup.tar.gz -C /data .
```

Restore:

```bash
docker run --rm -v qdrant_storage:/data -v "$PWD":/backup \
  alpine sh -c "cd /data && tar xzf /backup/qdrant-backup.tar.gz"
```

## C4. Starting the collection over

If the corpus is in a state you do not trust:

```bash
curl -X DELETE http://127.0.0.1:6333/collections/aims_knowledge
cd AIMS/backend && node src/scripts/ingest_knowledge_base.js
```

The collection is recreated automatically.

## C5. Stopping and restarting

```bash
cd AIMS/backend
docker compose -f docker-compose.qdrant.yml stop
docker compose -f docker-compose.qdrant.yml start
docker compose -f docker-compose.qdrant.yml down     # keeps the volume
docker compose -f docker-compose.qdrant.yml down -v  # DELETES the embeddings
```

`down -v` removes the named volume. You would then need to re-ingest.

---

# Part D — Troubleshooting

## D1. The chatbot says it cannot check right now

Qdrant is unreachable.

```bash
docker ps --filter name=aims-qdrant       # is it running?
curl http://127.0.0.1:6333/healthz        # does it answer?
docker logs aims-qdrant --tail 50         # what does it say?
grep QDRANT AIMS/backend/.env             # is the URL right?
```

Most often Docker Desktop is simply not running. Start it — the container is
`restart: unless-stopped` and comes back on its own.

**Ask the Data is unaffected by this.** It does not use Qdrant.

## D2. The chatbot says nothing is documented

Retrieval ran but found nothing above the score floor.

1. `node src/scripts/ingest_knowledge_base.js --check` — is the corpus loaded?
2. `node src/testing/rag.smoke.js` — do passages come back non-empty?
3. If the corpus is loaded and passages are non-empty, the topic genuinely is
   not covered. **Add a section to the documentation rather than lowering the
   threshold.** A lower floor does not create knowledge; it returns the least
   irrelevant passage and invites the model to use it.

> Note that lowering `CHATBOT_MIN_SCORE` currently has **no effect at all** —
> see §D6.

## D3. Everything returns 429

Rate limits, per account rather than per IP — a campus shares addresses, and an
IP limit would throttle a whole computer lab as one user.

Defaults are 8/minute, 60/hour, 200/day, tripled for admins. Raise them in
`AIMS/backend/.env`:

```bash
ASSISTANT_RATE_PER_MINUTE=8
ASSISTANT_RATE_PER_HOUR=60
ASSISTANT_RATE_PER_DAY=200
```

If the `Retry-After` header names a long wait, the limit is Groq's, not ours —
add more keys to `GROQ_API_KEYS`.

## D4. 404 from the model provider

The model name does not exist. Groq retires models, and a name that is merely
plausible fails at request time rather than at startup, which looks like an
outage.

Check the live list at <https://console.groq.com>, then set `GROQ_MODEL`.

## D5. Ask the Data refuses a question at the database level

The read-only account is missing a grant. That is the grants working, not a bug
— **it is never retried**, because retrying would be an attempt to route around
them.

Whether to widen the grant is a decision for whoever owns the data, not a
default. Add it to `create_ai_readonly_user.js` if the answer is yes.

## D6. Changing CHATBOT_TOP_K or CHATBOT_MIN_SCORE does nothing

**This is a known bug, not your mistake.**

`orchestrator.js` passes the option as `limit`; `vectorStore.js` reads it as
`topK`. The value falls through to the defaults in `config/assistant.js`.

So `config/chatbot.js` says top 10 at floor 0.30, and what actually runs is
**top 5 at floor 0.35**.

Fix by passing `topK` instead of `limit`. It genuinely changes behaviour — a
wider candidate pool, a lower threshold, more tokens per question — so re-check
answer quality afterwards. See `AI_IMPLEMENTATION.md` §9.

## D7. The first ingest seems to hang

It is downloading the ~90 MB embedding model into `backend/.models/`, with no
progress output. Give it a few minutes. Later runs start immediately.

If `backend/.models/` stays empty, the machine cannot reach the model host —
check outbound network access and any proxy.

---

# Part E — Before this goes live

- [ ] **Qdrant is not on a laptop.** Give it a host that stays on. A vector store
      on a developer machine means the chatbot is down whenever that machine is.
- [ ] **The Groq keys belong to the organisation**, not to an individual. Revoke
      the old personal ones — they have been in a git history.
- [ ] **`prove_readonly_account.js` passes** on the production database.
- [ ] **Qdrant is not exposed to the network**, or has authentication in front of
      it. It has none of its own here.
- [ ] **Re-ingest is part of the release process**, so editing documentation
      without re-ingesting cannot silently ship stale policy.
- [ ] **`rag.smoke.js` runs after every ingest.** It catches the empty-passage
      failure that every health check passes.
- [ ] Decide whether to fix §D6 before tuning retrieval.

---

## Related documents

| Document | Covers |
|---|---|
| `AI_IMPLEMENTATION.md` | Every AI file, what it does, and how to change it |
| `AIMS AI Pipelines.pdf` | How the pipelines work, the guards, every tuned number — illustrated |
| `DATABASE_SETUP.md` | Building the database Ask the Data reads |
