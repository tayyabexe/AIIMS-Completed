# AIMS — AI Implementation

**What the AI features are, which files build them, and how to run them yourself.**

Written for a developer who has these files and wants to run the AI features on
their own infrastructure — their own Docker, their own API keys, their own
database — and to change or rebuild them.

---

## 1. What exists

AIMS has **two** AI features. They are separate services on purpose.

| | Ask the Data | Help Chatbot |
|---|---|---|
| Answers | “What is the number” | “How do I” |
| Route | `POST /api/analytics/ask` | `POST /api/chatbot/chat` |
| Reads | The MySQL database, read-only | 33 Markdown documentation files |
| Roles | Super Admin, Admin, Teacher | Those three, plus Student and Parent |
| Model writes | A JSON query plan | The reply text |
| Needs Docker | **No** | **Yes** — Qdrant |
| Needs a Groq key | Yes | Yes |

There is **no** `/api/assistant` route. It was replaced by these two. The folder
`services/assistant/` is **shared infrastructure** used by both — not a third
service. This trips people up, so it is worth saying twice.

> The full behavioural description — pipelines, guards, tuned numbers, failure
> paths — is in the **AIMS AI Pipelines** document. This file is about *files
> and setup*, not about how the pipelines think.

### The one rule that shapes the code

**Row data never enters the model.** The model turns a question into a plan; the
database answers the plan; the rows go to the browser without passing back
through a model. Anything you change must preserve this.

---

## 2. File count

| Group | Backend | Frontend | Other | Total |
|---|---:|---:|---:|---:|
| **Ask the Data** | 12 | 21 | — | **33** |
| **Help Chatbot** | 5 | 5 | 33 knowledge-base `.md` | **43** |
| **Shared (used by both)** | 20 | — | 2 scripts | **22** |
| **Total** | 37 | 26 | 35 | **98** |

The 33 knowledge-base Markdown files are content, not code, but the chatbot does
not work without them.

---

## 3. Ask the Data — every file

### 3.1 Backend (12 files)

All paths under `AIMS/backend/`.

| File | What it does |
|---|---|
| `src/config/analytics.js` | All settings for this service: roles allowed, row ceilings, chart limits, model, temperature. Also states the "rows never enter the model" rule and why. |
| `src/routes/analyticsRoutes.js` | Declares the URLs under `/api/analytics` and the role gate on each. Kept separate from the chatbot route deliberately. |
| `src/controllers/analyticsController.js` | The HTTP surface. Runs the pipeline in order: cache → plan → validate → execute → reconcile → respond. No conversation, no transcript. |
| `src/controllers/savedAnalyticsController.js` | HTTP surface for pinned cards and per-screen layouts. Everything is scoped to the signed-in account. |
| `src/services/analytics/planner.js` | **The only model call in this route.** Turns a question into a JSON plan. Sees no rows. |
| `src/services/analytics/prompts.js` | The planner's instructions, split into a shared block plus one block per role. |
| `src/services/analytics/catalogue.js` | Builds the compact tool-and-schema listing the planner is shown, filtered to what this role may call. |
| `src/services/analytics/planValidator.js` | Checks the plan before anything runs. Wrong presentation is corrected; wrong access is refused. Also reconciles chart axes against the real result columns. |
| `src/services/analytics/executor.js` | Runs the validated plan and returns rows. The last step before the response — no model runs after it. |
| `src/services/analytics/planCache.js` | Caches plans by asker and question, so a repeated question costs no tokens. In memory, 6-hour TTL. |
| `src/services/analytics/savedQueries.service.js` | Saving a question and asking it again later. |
| `src/services/analytics/layout.service.js` | Where pinned cards sit on each screen, per user. Written as a whole layout at once. |

### 3.2 Frontend (21 files)

All paths under `AIMS/frontend/src/`.

| File | What it does |
|---|---|
| `api/analytics.js` | Every Ask-the-Data call the browser makes: ask, saved cards, layouts. |
| `pages/admin/AIAnalytics.jsx` + `.css` | The admin query canvas — the main screen for this feature. |
| `pages/faculty/AIAnalytics.jsx` + `.css` | The same canvas for teachers, scoped to their own roster. |
| `components/common/ChartTemplates.jsx` + `.css` | The seven fixed renderers — six charts and a table. The model names one; it never writes chart code. |
| `components/admin/pinned/` (14 files) | The pinned-card system: `CardGrid`, `SavedQueryCard`, `SavedQueryStrip`, `PanelShell`, `EditPanel`, `CardMenu`, `ChartExpandDialog`, `SaveQueryDialog`, `AutoHeightCell`, `usePinnedSurface`, `dragState`, `runQueue`, `visuals`, `pinned.css`. Drag, resize, run and persist saved cards. |

---

## 4. Help Chatbot — every file

### 4.1 Backend (5 files)

| File | What it does |
|---|---|
| `src/config/chatbot.js` | Settings for this service: which roles it serves, retrieval numbers, model, temperature, history depth. |
| `src/routes/chatbotRoutes.js` | Declares the URLs under `/api/chatbot`. Holds no database tools. |
| `src/controllers/chatbotController.js` | The HTTP surface, plus conversation persistence. An answer still returns if MySQL is down. |
| `src/services/chatbot/intent.js` | Decides what kind of question this is **before** retrieval runs, so capability and off-topic questions never search. |
| `src/services/chatbot/orchestrator.js` | Runs one chat turn: retrieve, re-rank by audience, then one model call. The model gets no search tool. |

### 4.2 Frontend (5 files)

| File | What it does |
|---|---|
| `api/assistant.js` | The chatbot calls: send a turn, list conversations, read capabilities. |
| `context/ChatbotContext.jsx` | Whether the widget is open, and which roles it serves. |
| `components/common/AssistantWidget.jsx` + `.css` | The floating chat button and panel. Renders model output through a small safe formatter, never `dangerouslySetInnerHTML`. |
| `components/common/AssistantCapabilities.jsx` | The "what can you ask me" sheet. |

### 4.3 The knowledge base (33 files)

`AIMS/backend/docs/knowledge-base/*.md` — hand-written Markdown, one file per
topic, with front matter naming a `title` and an `audience`.

- `audience` is a **permission**, applied at search time. A student's query can
  never retrieve a `staff` passage.
- A file with no valid audience defaults to `staff`, the most restrictive. So
  forgetting to tag a file cannot leak it to students.
- **Editing a file changes nothing until you re-run the ingest script** (§7.4).

---

## 5. Shared infrastructure (22 files)

Used by **both** services. Do not assume a change here affects only one.

| File | What it does |
|---|---|
| `src/config/groq.js` | The Groq API key pool and the default model name, in one place. Both services read it. |
| `src/config/assistant.js` | Shared settings: rate limits, timeouts, and the `rag.topK` / `rag.minScore` defaults the vector store actually uses. |
| `src/config/assistantCapabilities.js` | What the help assistant can answer, written down as data rather than reconstructed by the model. |
| `src/config/roleProfiles.js` | What each role can and cannot do, and who owns what it cannot. Used to steer answers per role. |
| `src/middlewares/assistantRateLimit.middleware.js` | Per-account sliding-window limits for both AI routes. Per account, not per IP. |
| `src/database/readonlyConnection.js` | A second connection pool on the `aims_ai_ro` account, which holds `SELECT` and nothing else. |
| `src/services/assistant/groq.client.js` | Groq chat-completions client written on `fetch`. Rotates keys and rests one that returns 429. |
| `src/services/assistant/scope.service.js` | Resolves, per request, exactly which rows this account may see. Deliberately not read from the token. |
| `src/services/assistant/scopedSql.js` | Rewrites a teacher's SQL so 12 table names become CTEs over their own roster. The model never writes the filter. |
| `src/services/assistant/sqlGuard.js` | Validates model-written SQL before it reaches the database. `SELECT`/`WITH` only, forced `LIMIT`, 20 forbidden constructs. |
| `src/services/assistant/auditLog.js` | Records every tool call, so "did it ever return data it shouldn't" is answerable. |
| `src/services/assistant/conversation.service.js` | Chat history storage, written through the normal application pool. |
| `src/services/assistant/rag/embedder.js` | Turns text into 384-number vectors locally, on CPU. No API call, no cost. |
| `src/services/assistant/rag/vectorStore.js` | Qdrant search. Applies the audience filter **before** scoring. |
| `src/services/assistant/tools/index.js` | The tool registry and dispatcher. Deciding which tools a role may see is a security control. |
| `src/services/assistant/tools/admin.tools.js` | Institute-wide tools. Admin and Super Admin only, with no scope filter by design. |
| `src/services/assistant/tools/teacher.tools.js` | Tools a teacher may call about their own classes only. |
| `src/services/assistant/tools/student.tools.js` | Tools a student may call about themselves, plus the ones staff use to look at a named student. |
| `src/services/assistant/tools/knowledge.tools.js` | Documentation search and the hardcoded portal-navigation table. Reads no student record. |
| `src/services/assistant/tools/sql.tools.js` | The admin-only text-to-SQL escape hatch, for questions no tool covers. |
| `src/scripts/ingest_knowledge_base.js` | Chunks the documentation, embeds it, loads it into Qdrant. Run by hand. |
| `src/scripts/generate_assistant_docs.js` | Generates the assistant's technical documentation as a Word file. Not needed at runtime. |

---

## 6. Where the API keys live

**There is one place to change the Groq key.**

### 6.1 The file

```
AIMS/backend/.env
```

### 6.2 The variables

```bash
# Comma-separated pool. Keys are used in rotation, so one hitting a rate
# limit does not stop the service.
GROQ_API_KEYS=gsk_key_one,gsk_key_two,gsk_key_three

# A single key also works, for a smaller deployment.
GROQ_API_KEY=gsk_single_key

# Optional. Defaults to openai/gpt-oss-120b, set in src/config/groq.js.
GROQ_MODEL=openai/gpt-oss-120b

# Optional per-service overrides. Each falls back to GROQ_MODEL,
# then to the shared default.
ANALYTICS_MODEL=
CHATBOT_MODEL=
```

`GROQ_API_KEYS` is read first; `GROQ_API_KEY` is still honoured so a
single-key deployment keeps working without an edit.

### 6.3 Getting a key

Sign up at **<https://console.groq.com>** and create an API key. Generate
several and put them all in `GROQ_API_KEYS` — the client rotates them, which
raises the effective rate limit.

> **The keys currently in the repository are personal.** Replace them with keys
> the organisation owns before going live, and treat the old ones as
> compromised — they have been in a git history.

### 6.4 Everything else the AI features read

Also in `AIMS/backend/.env`:

```bash
# The read-only database account. Both AI services read through this.
AI_DB_USER=aims_ai_ro
AI_DB_PASSWORD=<set your own>

# Qdrant — only the chatbot needs this.
QDRANT_URL=http://127.0.0.1:6333
QDRANT_COLLECTION=aims_knowledge

# The local embedding model. Changing the model means changing the
# dimension too, and re-ingesting the whole corpus.
EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2
EMBEDDING_DIM=384

# Rate limits, per account. Admins get 3x these.
ASSISTANT_RATE_PER_MINUTE=8
ASSISTANT_RATE_PER_HOUR=60
ASSISTANT_RATE_PER_DAY=200

# Retrieval tuning. See the warning in §9.
CHATBOT_TOP_K=10
CHATBOT_MIN_SCORE=0.30
```

`AI_DB_USER` / `AI_DB_PASSWORD` must **also** be set in `AIMS/database/.env`,
because that is what `create_ai_readonly_user.js` reads when creating the
account.

---

## 7. Running it yourself

### 7.1 What you need

| | |
|---|---|
| Node.js | 18+ |
| MySQL | 8.4+, already built — see `DATABASE_SETUP.md` |
| Docker | Only for the chatbot |
| A Groq API key | Both services |

### 7.2 Ask the Data — no Docker needed

1. Build the database (`DATABASE_SETUP.md`).
2. Create the read-only account:
   ```bash
   cd AIMS/database
   node scripts/create_ai_readonly_user.js
   node scripts/prove_readonly_account.js
   ```
   The second script attempts an `INSERT`, an `UPDATE` and a `DELETE` and
   expects all three to be refused. **If any succeeds, stop and fix the grant.**
3. Put `GROQ_API_KEYS` and `AI_DB_*` in `AIMS/backend/.env`.
4. Start the backend. Sign in as an admin and open **AI Analytics**.

That is the whole setup. Ask the Data does not use Qdrant, embeddings, or Docker.

### 7.3 Help Chatbot — start Qdrant

```bash
cd AIMS/backend
docker compose -f docker-compose.qdrant.yml up -d
```

This runs `qdrant/qdrant:v1.12.4`, binds **127.0.0.1:6333** (REST) and
**6334** (gRPC), and stores data in a named Docker volume.

Check it:
```bash
curl http://localhost:6333/healthz
```

**Using your own Qdrant instead** — a managed instance, or one elsewhere on
your network — set `QDRANT_URL` in `AIMS/backend/.env` and skip the compose
file. Nothing else changes.

### 7.4 Build the embeddings

```bash
cd AIMS/backend
node src/scripts/ingest_knowledge_base.js
```

What happens:

1. Reads every `.md` in `docs/knowledge-base/`, and its front matter.
2. Splits each at its own `##` / `###` headings — no overlap, because sections
   do not bleed into each other.
3. Embeds each chunk locally with `all-MiniLM-L6-v2` (about 90 MB, CPU only).
   **The first run downloads the model** into `backend/.models/`. This takes a
   few minutes; later runs are fast.
4. Upserts into the Qdrant collection in batches of 64.

Point ids are derived from the document title and chunk index, so **re-running
overwrites a document rather than adding a second copy of it.** Re-run it
freely.

**Run this again every time you edit a knowledge-base file.** Nothing watches
the directory.

### 7.5 Confirm it works

```bash
cd AIMS/backend
node src/testing/rag.smoke.js      # retrieval returns non-empty passages
node src/testing/chatbot.smoke.js  # the chatbot answers and stays in scope
node src/testing/assistant.smoke.js
node src/testing/scopedSql.probe.js  # a teacher's SQL cannot escape their roster
```

`rag.smoke.js` is the one that matters most — see §9.

---

## 8. Changing things

| You want to | Change |
|---|---|
| Use a different model | `GROQ_MODEL`, or `ANALYTICS_MODEL` / `CHATBOT_MODEL` for one service. Verify the name against Groq's live model list first — a plausible-but-wrong name fails at request time, not at startup. |
| Use a provider other than Groq | Rewrite `services/assistant/groq.client.js`. It is deliberately written on `fetch` rather than a provider SDK, so the surface to replace is small. Both services call it. |
| Add or edit documentation | Edit `docs/knowledge-base/*.md`, then re-run the ingest script. Set the `audience` in front matter. |
| Use a different embedding model | Change `EMBEDDING_MODEL` **and** `EMBEDDING_DIM` to match, delete the Qdrant collection, and re-ingest. The vector size must match exactly. |
| Add a new data tool | Add it to the right file in `services/assistant/tools/`, declaring which roles may call it. A role not listed never sees the tool named. |
| Change who may use a service | `roles` in `config/analytics.js` or `config/chatbot.js`. **A role added to Ask the Data also needs a scope resolver** in `scope.service.js`, or it has no safe answer to "which rows are yours". |
| Change rate limits | The `ASSISTANT_RATE_*` variables. |
| Add a chart type | Add a renderer in `ChartTemplates.jsx` **and** its name to `templates` in `config/analytics.js`. A name in one but not the other is silently degraded to a table. |

---

## 9. Known bug — read this before tuning retrieval

`services/chatbot/orchestrator.js` asks the vector store for a wider candidate
pool:

```js
const hits = await store.search(question, {
    limit: config.retrieval.topK * CANDIDATE_MULTIPLE,
    audience
});
```

But `services/assistant/rag/vectorStore.js` reads a different option name:

```js
limit: options.topK ?? config.rag.topK,
score_threshold: options.minScore ?? config.rag.minScore,
```

`options.topK` is never set, so both fall through to the defaults in
`config/assistant.js`.

**The effect:** `config/chatbot.js` says top 10 at floor 0.30. What actually
runs is **top 5 at floor 0.35**. Setting `CHATBOT_TOP_K` or `CHATBOT_MIN_SCORE`
does nothing at all.

Fix by passing `topK` instead of `limit` — but note this genuinely changes
behaviour (a wider pool, a lower threshold, more tokens per question), so
re-check answer quality afterwards. Do it **before** tuning either number.

---

## 10. Handover checklist

- [ ] Replace `GROQ_API_KEYS` with keys the organisation owns; revoke the old ones.
- [ ] Create `aims_ai_ro` on your own database and run `prove_readonly_account.js`.
- [ ] Stand up Qdrant somewhere that is not a laptop, and set `QDRANT_URL`.
- [ ] Run the ingest script against that Qdrant.
- [ ] Run the four smoke tests in §7.5.
- [ ] Decide whether to fix the retrieval bug in §9.

---

## Related documents

| Document | Covers |
|---|---|
| **AIMS AI Pipelines** (artifact) | How the pipelines work, the guards, every tuned number |
| `DATABASE_SETUP.md` | Building the database the AI reads |
| `TESTING_GUIDE.md` | Testing the AI features by hand (§11.10, §18) |
