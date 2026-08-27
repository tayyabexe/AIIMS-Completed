# AIMS Backend — API Test Plan

Base URL: `http://localhost:5000`
Total routes discovered in `src/app.js` + `src/routes/*`: **158** across **29 modules**.

---

## 1. Role Matrix

Roles come from the `roles` table (verified live):

| role_id | Role | Test account | Password |
|---|---|---|---|
| 1 | Super Admin | system.administrator@aims.edu.pk | SuperAdmin@1234 |
| 2 | Admin | admin2@aims.edu.pk | Admin@1234 |
| 3 | Teacher | teacher2@aims.edu.pk | Teacher@1234 |
| 4 | Student | student1@aims.edu.pk | Student@1234 |
| 5 | Parent | parent1@aims.edu.pk | Parent@1234 |
| 6 | HR | nadia.rehman@aims.edu.pk | Hr@1234 |
| 7 | Accountant | saima.akhtar@aims.edu.pk | Accountant@1234 |
| 8 | Library Staff | rabia.nawaz@aims.edu.pk | Library@1234 |

Grouped buckets requested for testing:

- **Student only** — role 4
- **Admin only** — roles 1, 2
- **All faculty** — roles 3, 6, 7, 8 (Teacher, HR, Accountant, Library)
- **Parents** — role 5

Every protected endpoint is exercised with **all 8 role tokens**, plus three
negative identities: **no token**, **malformed token**, **tampered token**.

---

## 2. Test Categories

Each endpoint is tested under as many of these as apply:

| ID | Category | Expected |
|---|---|---|
| A1 | No token on a protected route | 401 |
| A2 | Malformed / tampered token | 401 |
| A3 | Authorised role | 2xx |
| A4 | Unauthorised role | 403 |
| F1 | Read list | 200 + array |
| F2 | Read by valid id | 200 + object |
| F3 | Read by nonexistent id | 404 |
| F4 | Create with valid body | 201 + row in DB |
| F5 | Update own created row | 200 + change persisted in DB |
| F6 | Delete own created row | 200 + row absent from DB |
| F7 | Delete/update nonexistent id | 404 |
| F8 | Double delete | 404 |
| V1 | Empty body on create | 400 |
| V2 | Missing required field | 400 |
| V3 | Wrong type (string where int) | 400 |
| V4 | Out-of-range / invalid enum | 400 |
| V5 | Malformed date (` 2024-02-11,`) | 400 |
| V6 | Nonexistent FK reference | 404 or 400 |
| S1 | SQL injection in input | 400 / safely escaped |
| S2 | Sensitive field leakage (password_hash) | must be absent |
| D1 | Duplicate create | 409 |
| Q1 | Filter / search query params | filtered subset |
| Q2 | Pagination (page, limit) | correct slice |

---

## 3. Data-Safety Rules

1. No pre-existing row is updated or deleted. Every F5/F6 test operates only on
   a row created by the test run itself.
2. Every created row is deleted at the end; the run asserts
   `MAX(id)` and `COUNT(*)` return to their pre-run values.
3. Reference IDs are read live from the DB before the run, never hardcoded.
4. Live DB verification is a direct `SELECT` through Sequelize, independent of
   the API layer, so an API that lies about success is still caught.

---

## 4. Module Coverage

Legend for `auth`: **N** = no authentication middleware on the route at all.

### 4.1 Auth (8 routes)
| Method | Path | auth | roles | Tests |
|---|---|---|---|---|
| POST | /api/auth/register | N | any | F4, V1, V2, D1 |
| POST | /api/auth/login | N | any | F4, V2, S1, A2 |
| POST | /api/auth/logout | N | any | F1 |
| GET | /api/auth/profile | Y | any | A1, A2, A3×8 |
| PUT | /api/auth/change-password | Y | any | A1, V2 |
| POST | /api/auth/forgot-password | N | any | V2 |
| POST | /api/auth/reset-password | N | any | V2 |
| GET | /api/auth/admin | Y | 1,2 | A3 (1,2), A4 (3–8) |

### 4.2 Student (11 routes)
| Method | Path | auth | roles | Tests |
|---|---|---|---|---|
| GET | /api/students | Y | 2,3 | A1,A3,A4,F1,Q1,Q2 |
| GET | /api/students/search | Y | 2,3 | Q1 |
| GET | /api/students/:id | Y | 2,3 | F2,F3 |
| GET | /api/students/documents/:student_id | Y | any | F2 |
| GET | /api/students/guardians/:student_id | Y | any | F2 |
| POST | /api/students/register | Y | 2 | F4,V1,V2 |
| POST | /api/students/upload-document | Y | any | V2 |
| PUT | /api/students/:id | Y | 2 | F5,F7 |
| PUT | /api/students/:id/enroll | Y | 2 | F5 |
| DELETE | /api/students/:id | Y | 2 | F6,F8 |
| DELETE | /api/students/documents/:id | Y | any | F7 |

### 4.3 Attendance (8 routes)
| Method | Path | auth | roles | Tests |
|---|---|---|---|---|
| POST | /api/attendance | Y | 2,3 | F4,V1,V2,V4,V5,V6,D1 |
| GET | /api/attendance | Y | 2,3 | A3,A4,F1 |
| GET | /api/attendance/student/:id | Y | any | F2 |
| GET | /api/attendance/report/:student_id | Y | any | F2 |
| GET | /api/attendance/percentage/:id | Y | any | F2 |
| GET | /api/attendance/:id | Y | 2,3 | F2,F3 |
| PUT | /api/attendance/:id | Y | 2,3 | F5,F7,V4 |
| DELETE | /api/attendance/:id | Y | 2 | F6,F8,A4 |

### 4.4 Teacher (5) — **auth=N on all**
`POST/GET/GET :id/PUT :id/DELETE :id` → A1 must return 401 but is expected to
FAIL (no middleware). Tests: A1, F1, F2, F3.

### 4.5 Users (5) — **auth=N on all**
`POST/GET/GET :id/PUT :id/DELETE :id` → A1, S2 (password_hash leak).

### 4.6 Batches / Programs / Sections / Teacher-Subjects — **auth=N on all**
Same A1 exposure tests plus F1, F2, F3.

### 4.7 Timetable (5)
GET list/:id roles 2,3; POST/PUT/DELETE role 2. Tests A3, A4, F1–F8.

### 4.8 Fee family
- Challan (5) — role 2
- Receipt (5) — role 2
- Fee Payment (5) — role 2
- Fee Report (2, read-only) — role 2
- Fee Structure (5) — role 2
- Student Fee (7, incl. `/outstanding`, `/late-fine`) — role 2
- Payment (5) — role 2

All: A1, A3, A4×8, F1–F8, V1.
**Fee Status API is documented but not mounted — expected 404 for all.**

### 4.9 GPA / Results / Marks / Exams
- GPA (5) — role 2 — F1–F8, V4 (gpa out of range)
- Student Results (5) — role 2
- Results (5): `/calculate`, `/cgpa/:id`, `/publish/:id`, `/transcript/:id`, `/report/:exam_id` — auth only
- Marks (4): `POST /`, `/student/:id`, `PUT /:id`, `/verify/:id` — auth only
- Exams (5) — auth only, no role guard

### 4.10 Teacher family
- Teacher Assignment (5) — role 2
- Teacher Profile (5) — role 2
- Teacher Schedule (5) — role 2
- Teacher Dashboard (1, `GET /:id`) — role 2

### 4.11 Parents (11) and AI (6)
Parent routes are authenticated but ungated by role — tested with all 8 tokens
to see whether a parent can read another parent's children.

---

## 5. Named Feature Scenarios

| Feature | Endpoint | Assertion |
|---|---|---|
| User login | POST /api/auth/login | token issued, role_id correct |
| Student profile | GET /api/students/:id | matches DB row |
| Student filters | GET /api/students?program_id=&academic_status= | subset, not full table |
| Pagination | GET /api/students?page=&limit= | slice size == limit |
| CGPA calculation | GET /api/results/cgpa/:student_id | equals DB cgpa |
| Get exam by ID | GET /api/exams/:id | matches DB row |
| View student marks | GET /api/marks/student/:id | count equals DB count |
| View attendance | GET /api/attendance/student/:id | count equals DB count |

---

## 6. Execution Order

1. Boot server, confirm DB connection.
2. Snapshot DB counts for every table touched.
3. Log in all 8 roles; abort if any account fails.
4. Access-control sweep: every route × 8 roles + 3 negative identities.
5. Functional CRUD per module, creating and then removing test rows.
6. Validation and security probes.
7. Live DB verification of every write.
8. Cleanup; assert table counts match the step-2 snapshot.
