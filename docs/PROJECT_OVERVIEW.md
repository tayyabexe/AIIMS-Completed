# AIMS — Project Overview

**A high-level description of what AIMS is, who it serves, and how it is built.**

Start here. Every other document goes deeper on one part of this one.

---

## 1. Identity

| | |
|---|---|
| **Name** | AIMS — Academic Information Management System |
| **Type** | Web application — a multi-portal institute management system |
| **Status** | Working prototype, feature-complete for the modules listed in §5. **Never deployed to a server.** |
| **Users** | Institute administrators, teachers, students, parents |
| **Origin** | Built as an internship project |

---

## 2. The problem it solves

An institute's records live in places that do not agree with each other:
attendance in one register, marks in a spreadsheet, fees in a ledger, the
timetable on a noticeboard. The people who most need a straight answer —
a parent asking why their child's attendance is short, a teacher asking which
students are failing, an administrator asking what was collected this month —
are the furthest from the data.

AIMS puts one record in one place and shows each person the part of it they are
entitled to see.

The test it is built against: **the admin, the teacher, the student and the
parent should describe the same class the same way** — same subject, same
teacher, same room, same time, same attendance, same grade. If any of the four
disagrees, that is a bug.

---

## 3. Objectives

1. **One source of truth.** A figure is computed once, on the server, and every
   portal reads the same number.
2. **Role-appropriate access.** Each person sees their own rows and no one
   else's — enforced on the server, never by hiding things in the browser.
3. **A complete academic cycle.** Admission → enrolment → timetable →
   attendance → marks → results → fees, without leaving the system.
4. **An auditable trail.** Who changed what, when, and what it was before.
5. **Answers without a report writer.** Ask a question in plain language and get
   real rows back.

---

## 4. Who uses it

| Role | ID | Portal | What they do |
|---|:--:|---|---|
| **Super Admin** | 1 | Admin | Everything, plus staff-account management |
| **Admin** | 2 | Admin | Day-to-day administration of every module |
| **Teacher** | 3 | Faculty | Own classes: attendance, marks, reports |
| **Student** | 4 | Student | Own record: courses, attendance, results, fees |
| **Parent** | 5 | Parent | Their children's records, and fee declarations |
| **HR** | 6 | Admin | *Defined, but has no screens of its own* |
| **Accountant** | 7 | Admin | Fee permissions only |
| **Library Staff** | 8 | Admin | *Defined, but has no screens of its own* |

Eight roles are defined and enforced; **five have a working portal.** HR,
Accountant and Library Staff map to the admin portal. Only Accountant has
meaningful permissions of its own (fees). See `GAPS_AND_LIMITATIONS.md`.

### Four portals, one application

All four portals are one React build. Which portal a person sees is decided by
their role and the URL — not by a separate deployment.

---

## 5. Modules

### Admin portal
Dashboard · Students · Enrolment · Attendance · Fee Management · Examination ·
Parents · Academic Structure · Timetable · Teachers · Qualifications ·
AI Insights · Ask the Data · Reports · Announcements · Notifications ·
Staff Accounts · User Management · Audit Trail · Settings

### Faculty portal
Dashboard · My Classes · Attendance · Marks · Assignments · Students · Reports ·
Ask the Data · Timetable · Announcements · Notifications · Profile · Settings

### Student portal
Dashboard · My Courses · Attendance · Results · Fee Management · Timetable ·
Documents · Profile · Notifications

### Parent portal
Dashboard · My Children · Attendance · Timetable · Results · Fee Details ·
Notifications · Profile

### Cross-cutting
Authentication and account locking · role-scoped search · notifications ·
announcements with rule-based audiences · avatars and document storage ·
audit trail · the two AI features.

---

## 6. What makes it more than CRUD

A few behaviours are worth knowing about, because they are where the design
decisions live.

- **Marks have a three-step workflow.** Draft → Submitted → Released. A student
  sees nothing until an admin releases it. A teacher cannot approve their own
  entry.
- **Attendance is per period, not per day.** A class meeting twice on a Monday
  has two registers.
- **The timetable is a placement engine.** It refuses a slot that clashes with
  the teacher, the section or the room, and says which.
- **Only one academic term can be active**, enforced by a database constraint,
  not by application code.
- **Sessions are per browser tab**, so two portals can be open side by side
  without one signing the other out.
- **Accounts lock after five failed sign-ins.** Every failure returns the same
  message, whatever went wrong.
- **The AI never invents a number.** See §7.

---

## 7. The two AI features

| | Ask the Data | Help Chatbot |
|---|---|---|
| Answers | “What is the number” | “How do I” |
| Reads | The database, read-only | 33 documentation files |
| Roles | Super Admin, Admin, Teacher | Those, plus Student and Parent |

**The rule both are built around: row data never enters the model.** The model
turns a question into a query plan; the database answers it; the rows reach the
browser without passing back through a language model. A count on screen is a
count the database returned.

This exists because the earlier design did the opposite and confidently reported
200 fee defaulters when there were 1,175.

Detail: `AI_IMPLEMENTATION.md`, `AI_RUNBOOK.md`, and the **AIMS AI Pipelines**
document.

---

## 8. Technology

### Frontend
| | |
|---|---|
| Framework | React 19 |
| Build | Vite 8 |
| Routing | React Router |
| Server state | TanStack Query |
| Styling | Tailwind CSS v4, plus hand-written CSS per portal |
| Components | Radix UI primitives (shadcn/ui pattern) |
| Charts | Recharts |
| Layout | react-grid-layout — the pinned-card boards |
| Motion | Framer Motion |
| Export | jsPDF, SheetJS |
| Lint | oxlint |

### Backend
| | |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express |
| ORM | Sequelize, plus raw SQL where it is clearer |
| Driver | mysql2 |
| Auth | JSON Web Tokens (`jsonwebtoken`) |
| Passwords | bcrypt |
| Security | helmet, cors, express-validator, a sanitising middleware |
| Uploads | multer, with file-signature sniffing |
| Logging | morgan |

### Database
| | |
|---|---|
| Engine | **MySQL 8.4+** — not 5.7, not MariaDB |
| Charset | `utf8mb4` / `utf8mb4_unicode_ci` |
| Size | 58 tables · 21 views · 4 stored procedures · 111 foreign keys |
| Migrations | 92, via `sequelize-cli` |

### AI
| | |
|---|---|
| Model provider | Groq |
| Model | `openai/gpt-oss-120b` |
| Embeddings | `all-MiniLM-L6-v2`, 384-dim, **local, on CPU** |
| Vector store | Qdrant (Docker) — chatbot only |

---

## 9. How it fits together

```
                    Browser
                       │
        ┌──────────────┴──────────────┐
        │                             │
   Static files                  REST API
   (React SPA)               Node + Express
   nginx / any                  port 5000
   static host                      │
                        ┌───────────┼───────────┐
                        │           │           │
                     MySQL       Qdrant       Groq
                    (all data)  (chatbot     (both AI
                                 corpus)      features)
```

- The frontend is **static files**. It is not a Node server in production.
- Every rule, permission and calculation is on the server. The browser renders
  what it is given.
- MySQL is the only irreplaceable component. Qdrant is rebuilt from Markdown in
  minutes; Groq is a third-party API.

Detail: `ARCHITECTURE.md`.

---

## 10. Current status

**Working and exercised end to end:**
admissions and onboarding · academic structure · subjects and curriculum ·
timetable placement · per-period attendance · exams and the marks workflow ·
results, GPA and CGPA · the full fee module · announcements · notifications ·
audit trail · role-scoped search · both AI features · all four portals.

**Not done:**

- **Never deployed.** No server, no domain, no TLS, no CI. See
  `SERVER_HANDOVER.md`.
- **No automated test suite.** `npm test` prints "No tests yet". There are
  manual suites under `backend/src/testing/` that must be run by hand.
- **No monitoring, health endpoint, scheduled backups or log rotation.**
- **Several database tables have no interface** — library, payroll, leave
  requests, scholarships and others exist in the schema and are unreachable
  from any screen.

---

## 11. Known limitations

Summarised here; the full treatment is in `GAPS_AND_LIMITATIONS.md`.

| | |
|---|---|
| **Elective courses** | No election or capacity model. Enrolment is by cohort. |
| **Student choice of teacher** | Not supported. A section has one teacher per subject, assigned by an admin. |
| **Self-registration for courses** | Students cannot register themselves. |
| **Prerequisites** | Not modelled or enforced. |
| **HR, payroll, library** | Tables exist; no screens. |
| **Password policy** | Minimum 8 characters. **No complexity, reuse or dictionary check.** |
| **Rate limiting** | Only on the two AI routes. |
| **Two attendance thresholds** | The student dashboard colours courses against 80%; every other surface uses 75%. Never reconciled. |
| **No institute-wide settings** | No institute name, branding or configurable academic policy. Settings holds per-account preferences only. |
| **Permission tables are decorative** | `permissions` and `role_permissions` are seeded but nothing reads them. Access is role-level only. |
| **Prerequisites not enforced** | `subjects.prerequisite_subject_id` is stored and displayed, but never checked at enrolment. |
| **Unused dependency** | `tesseract.js` ships in the frontend bundle and nothing imports it. |

---

## 12. Document map

| Document | Read it for |
|---|---|
| `SRS.md` | What the system is required to do — functional and non-functional |
| `ARCHITECTURE.md` | How it is built — layers, data flow, auth |
| `DEPLOYMENT.md` | Installing and deploying it |
| `SERVER_HANDOVER.md` | What to provision, and credential transfer |
| `DATABASE_SETUP.md` | Building the database |
| `AI_IMPLEMENTATION.md` | The AI files, and how to change them |
| `AI_RUNBOOK.md` | Running the AI features day to day |
| `TESTING_GUIDE.md` | Verifying the whole system by hand |
| `GAPS_AND_LIMITATIONS.md` | What is missing, and what it would take |
| `AIMS User Manual.pdf` | The end-user manual |
