# AIMS — full system testing guide

**For:** walking the whole system by hand, from an empty database to a running
academic term, across all four portals — and being able to show a stakeholder,
at every step, *what you typed* and *everywhere it turned up*.

**Database:** a test database you build yourself in §0.1 — a structural copy of
the live schema with no people, no academic records and no fees in it. The live
database is never written to by this guide.

Every step below has been checked against the source that actually runs. Where
a step does something surprising, the guide says so rather than leaving you to
find out.

---

## How to use this document

There are three ways in, depending on why you opened it.

| You want to… | Read |
|---|---|
| Run the whole cycle end to end | §0 → §22, in order. Roughly a full day. |
| Show a stakeholder what the system does | Appendix A (the traceability map), then demo §2, §5, §11, §12, §16 |
| Check one screen | Appendix C — every URL in all four portals |

Sections marked **▶ DEMO** are the ones worth showing a non-technical audience:
they produce a visible change somebody else can see from another account.

---

## 0. Before you start

### 0.1 Build the test database

Do not test against a database that holds real records. Build your own, from
the three SQL files in `AIMS/database/`. They need no other database to copy
from, so this works on a laptop, a server, or a fresh MySQL container.

Full instructions are in **`DATABASE_SETUP.md`**. The short
version, once MySQL 8.4 is running and you have created an empty database:

```bash
cd AIMS/database

mysql -u <user> -p aims_test1 < schema.sql          # tables, views, routines
mysql -u <user> -p aims_test1 < constraints.sql     # foreign keys
mysql -u <user> -p aims_test1 < reference_data.sql  # roles, permissions,
                                                    # grading scale, migration ledger

DB_NAME=aims_test1 node scripts/create_first_admin.js --password '<choose one>'
```

That is a complete, empty AIMS institute with one account in it.

To start over, drop the database and run the four steps again. That is the
intended way to recover: a test run that has gone sideways is thrown away, not
repaired.

After this, the database holds only:

| Table | Rows | Why it is not empty |
|---|---|---|
| `roles` | 8 | Role numbers are hardcoded in the source. Role 1 *is* Super Admin. |
| `permissions` | 18 | Read by the permission layer. |
| `role_permissions` | 35 | Same. |
| `grades` | 5 | The grading scale: A ≥85 = 4.0, B ≥70 = 3.0, C ≥60 = 2.0, D ≥50 = 1.0, F = 0. GPA is computed from these. |
| `SequelizeMeta` | one row per migration | The migration ledger, stamped so `sequelize-cli` knows the schema is current and does not re-apply every migration over it. |
| `users` | 1 | The super admin you sign in with. |

Everything else — students, teachers, parents, programmes, subjects, timetable,
fees — starts at **zero rows** and you create it all by hand.

### 0.2 Point the application at it — do this before anything else

Two files name a database, and they are read by different tools:

| File | Read by | Set it to |
|---|---|---|
| `AIMS/backend/.env` | the running API | `DB_NAME=aims_test1` |
| `AIMS/database/.env` | `sequelize-cli`, and the scripts in `database/scripts/` | `DB_NAME=aims_test1` |

> **Check both, every time.** They drift, and they fail differently. If the
> backend is pointed at the test database but `database/.env` still names the
> live one, a bare `npx sequelize-cli db:migrate` runs against **live data**.
> Confirm with:
>
> ```bash
> grep DB_NAME AIMS/backend/.env AIMS/database/.env
> ```

Then confirm the schema is fully migrated:

```bash
cd AIMS/database
npx sequelize-cli db:migrate:status
```

Every row must read `up`. If any reads `down`, run `npx sequelize-cli db:migrate`
— having first confirmed, above, which database that will hit.

### 0.3 Start the two servers

Open two terminals.

```bash
# Terminal 1 — backend
cd AIMS/backend
npm start
```
Wait for `Database Connected Successfully` and `Server running on http://localhost:5000`.

```bash
# Terminal 2 — frontend
cd AIMS/frontend
npm run dev
```
Read the line it prints. It uses **port 5173 if free, otherwise 5174 or 5175** —
all three are in the backend's CORS list. Use the address it actually shows.

### 0.4 The one login you have

The account you created in §0.1:

```
Email:    superadmin@aims.edu.pk   (or whatever you passed to --email)
Password: the one you passed to --password
```

This is the only account that exists. Every other account in this guide, you
create through the application.

> **It will force a password change on the first sign-in.** That is deliberate
> — the password was typed on a command line and is in a shell history. Change
> it, then carry on. §2.4 covers the same flow for accounts an admin creates,
> so you will see this screen again.

### 0.5 How to tell a real failure from a misunderstanding

Open your browser's developer tools (F12) and keep the **Network** tab open.
When something does not look right, find the red request and read the JSON
response — this system almost always explains itself in the `message` field.

Five things that will confuse you if you do not know them:

1. **Auth is a token in `sessionStorage`, not a cookie.** Closing the tab signs
   you out. Opening a second tab means signing in again. That is also how you
   run two portals side by side: one normal window, one private window.
2. **Screens are cached.** A list you have already opened comes back instantly
   and then refreshes behind you. If you changed something in another window,
   give the screen a second. A stale figure that corrects itself a moment later
   is the cache, not a bug.
3. **A grey pulsing outline is the loading state**, not a broken screen. Every
   list draws a skeleton shaped like the thing arriving.
4. **Numbers that look wrong are often correct.** "3/3 periods" and "0 complete"
   mean different things — see §10.5.
5. **Failed sign-ins are deliberately vague.** "Email or password is incorrect"
   is the *only* answer, for a wrong password, an unknown address, a disabled
   account, or a valid password on the wrong portal. By design — see §1.3.

---

## 1. Sign in as the super admin

1. Go to `http://localhost:5173` (or whichever port Vite printed).
2. You land on the welcome page. Click **Admin Portal**, or go straight to
   `/sign-in/admin`.
3. Enter the address and password from §0.4.
4. Click **Sign In**.

**You should see:** the forced password-change screen first. Set a new password,
then the admin dashboard at `/dashboard`, greeting you as **Super Admin**, with
every figure at zero.

**Behind it:** `POST /api/auth/login` returns a JWT holding your `user_id` and
`role_id`. The role decides which portal you land in.

**If it fails:**
- *"Email or password is incorrect"* — most likely the backend is pointed at
  the wrong database. Check `AIMS/backend/.env` says `DB_NAME=aims_test1`, and
  restart it.
- Nothing happens at all — the backend is not running. Check terminal 1.

> **Note:** you have just tested the forced password change once. Every account
> you create below is forced through the same screen — §2.4 tests it from the
> admin's side, where the password was issued by somebody else.

### 1.1 The portal chooser

Go to `/choose-portal`. Four cards: Admin, Faculty, Student, Parent. Each opens
`/sign-in/<portal>`.

**Worth knowing:** the sign-in page always states which portal you are on, and
says an account belonging to another portal will not be accepted here. That
notice is shown *before* you fail, not after — a message that appeared only on
a wrong-portal failure would confirm the password was correct.

### 1.2 Legacy sign-in URLs

Type each of these. Every one should redirect, not 404.

| Old URL | Goes to |
|---|---|
| `/admin-login` | `/sign-in/admin` |
| `/faculty-login`, `/faculty/login` | `/sign-in/faculty` |
| `/student-login`, `/student/login` | `/sign-in/student` |
| `/faculty-dashboard` | `/faculty/dashboard` |
| `/student-profile` | `/students` |
| `/student-profile/42` | `/students/42` |
| `/parent-dashboard?tab=fees` | `/parent/fees` |

### 1.3 The sign-in failure policy — test it now, on a made-up address

Quick, and the clearest single demonstration that this system was built with an
adversary in mind.

1. At `/sign-in/admin`, enter `nobody@nowhere.test` and any password. Fail it
   **five times**, reading the message each time.

**You should see:**

| Attempt | Message |
|---|---|
| 1 | Email or password is incorrect. |
| 2 | Email or password is incorrect. **3 more tries** before the account is locked. |
| 3 | … **2 more tries** … |
| 4 | … **1 more try** … |
| 5 | This account is locked after 5 failed sign-in attempts. Ask an administrator to unlock it. (HTTP **423**) |

2. Now do the same with a **real** address and a wrong password.

**You should see:** exactly the same five messages, in the same order.

**Why that matters:** an address with no account behind it is counted in memory
and produces an identical countdown and an identical lock notice. A real
account and an invented one are indistinguishable at every step — including in
*timing*, because the unknown-email path hashes against a dummy value rather
than returning instantly.

**Behind it:** `services/loginSecurity.js`. Both the admin login and the parent
login report through it, so both portals share one counter, one threshold and
one set of words.

> **Do not lock an account you need.** Locking is real and stays until an admin
> lifts it (§20.1). Use throwaway addresses here, or an account you have
> finished with. Unlocking is itself worth testing — §20.1 does exactly that.

### 1.4 Forgot password

Click **Forgot password?** on any sign-in page.

**You should see:** not a form — an instruction naming who to contact, which
differs per portal (admin accounts are reset by a Super Admin; everyone else by
the admin office).

**Why:** there is no email delivery configured, so there is no way to prove
somebody owns an address without a person in the loop. Resets are done by an
admin, in User Management (§20.1).

---

## 2. Create the admin account ▶ DEMO

You will do the rest of this guide as a normal Admin, not the super admin, so
that the Admin role gets tested too.

### 2.1 Open Staff Accounts

1. In the left sidebar, under **ADMIN**, click **Staff Accounts**
   (URL: `/staff-accounts`).

**You should see:** a table with one row — the Super Admin — and an
**Add staff account** button at the top right. The search box searches by name,
email, phone, role, employee code, designation *or* department; the filters
beside it narrow by role and by active/inactive.

### 2.2 Create it

1. Click **Add staff account**.
2. Fill in:
   - First name: `Imran`
   - Last name: `Sheikh`
   - Role: **Admin**
   - Email: *leave blank* — one is generated for you
   - Phone, Department, Designation: optional
3. Click **Save**.

**You should see:** a credentials dialog with the email
(`imran.sheikh@aims.edu.pk`) and a generated password.

> **This is the only time that password is ever shown.** Copy it now. There is
> no way to read it back. If you lose it, use **Reissue password** on the row
> (§2.5) — it generates a new one and shows it once.

**Behind it:** `POST /api/admin/admins` creates a `users` row plus an
`employees` row, in one transaction.

**There is no password field on this form, deliberately.** An admin typing a
password means the admin knows it forever. The server generates one, shows it
once, and the account must replace it at first sign-in.

### 2.3 The Super Admin restriction

Reopen **Add staff account** and look at the Role dropdown. **Super Admin** is
selectable now because you *are* one. Signed in as a plain Admin, that option is
disabled and labelled "— Super Admin only". The same rule governs editing: only
a Super Admin may edit a Super Admin.

### 2.4 Sign in as the new admin, and change the password

1. Click your name (top right) → **Sign out**.
2. Sign in at `/sign-in/admin` with Imran's email and generated password.

**You should see:** you are sent to `/change-password`, not the dashboard, and
you cannot navigate away.

3. Enter the issued password, then a new one twice. Use `Admin@1234`.
4. Click **Set password and continue**.

**You should see:** the admin dashboard.

**Behind it:** the account carried `must_change_password = 1`; setting a
password clears it.

**Worth trying:**
- Re-typing the *issued* password as the new one → refused: "The new password
  must be different from the issued one."
- Navigating back to `/change-password` afterwards → you are sent to your
  portal instead. The route is reachable only while the request it answers is
  open. That is what stops the notification announcing the change from
  re-opening the form that made it.
- Check **Notifications** — there is an Account notice recording the change.

### 2.5 Reissuing a password

Every row in Staff Accounts, and every row in User Management (§20.1), carries a
**Reissue password** action.

1. Reissue a password on a throwaway account.

**You should see:** the same one-time credentials dialog. The account goes back
into the forced-change state, so its next sign-in lands on `/change-password`.

**Behind it:** `POST /api/admin/credentials/:userId/reissue`. It also writes an
audit entry, which you will find in §19.

**From here on, everything is done as Imran (Admin).**

---

## 3. Build the academic structure

One screen, seven tabs, in this order. Each tab depends on the one before it.

Click **Academic Structure** in the sidebar (`/academic-structure`).

**You should see:** four tiles (all zero) and a row of tabs: Departments,
Programmes, Batches, Sections, Rooms, Semesters, Subjects — each with a count
badge.

> Every tab works the same way: a search box, a table, an **Add …** button at the
> top right, and **Edit** / **Delete** on each row. Deletes are refused while
> anything still points at the row, and the refusal names what is in the way.

### 3.1 Department

1. Tab **Departments** → **Add department**.
2. Department name: `Computer Science`
3. **Save**.

**You should see:** one row, "No head assigned", `0 programmes 0 employees 0 students`.

**Behind it:** `POST /api/departments`.

### 3.2 Programme

1. Tab **Programmes** → **Add programme**.
2. Fill in:
   - Programme name: `BS Computer Science`
   - Department: `Computer Science`
   - Length in semesters: `8`
3. **Save**.

### 3.3 Semesters

A semester here is a **curriculum stage** ("the 3rd semester of BSCS"), not a
calendar term. It is shared by every batch. The calendar lives in §9.

Create at least two, so you can test progression later.

1. Tab **Semesters** → **Add semester**.
2. Fill in:
   - Programme: `BS Computer Science`
   - Semester number: `1`
   - Start date: `2026-09-01`
   - End date: `2027-01-31`
3. **Save**.
4. Repeat for semester number `2`, dates `2027-02-01` to `2027-06-30`.

**You should see:** two rows, both marked **Open**, each showing
`0 subjects 0 enrolments 0 vouchers 0 students in it`.

**Watch for:** the semester number cannot exceed the programme's length. Try
`9` — refused.

### 3.4 Batch

1. Tab **Batches** → **Add batch**.
2. Fill in:
   - Batch name: `BSCS-2026`
   - Programme: `BS Computer Science`
   - Start year: `2026`
   - End year: `2030`
3. **Save**.

### 3.5 Section

1. Tab **Sections** → **Add section**.
2. Fill in:
   - Section name: `CS-1A`
   - Batch: `BSCS-2026`
   - Capacity: `30`
3. **Save**.

**You should see:** `0 / 30 — 30 free`.

> **Known oddity:** the section *name* embeds a semester digit that never
> updates. `CS-1A` still reads "1" after the students move to semester 2. Treat
> the name as a fixed cohort label, not a live fact — the real semester is
> derived from the student's enrolments (§21.1).

### 3.6 Rooms — and read this before you click

1. Tab **Rooms** → **Add room**.
2. Create the first:
   - Room name: `R-101`
   - Building: `Main Block`
   - **Room type: `Lecture room`**
   - Seats: `40`
3. **Save**.
4. Create a second:
   - Room name: `LAB-1`
   - Building: `Main Block`
   - **Room type: `Laboratory`**
   - Seats: `30`
5. **Save**.

**You should see:** a **TYPE** column with a badge on each row.

> **Why the type matters more than it looks.** A subject that requires a Lab can
> **only** be placed in a room whose type is exactly Lab. If you make every room
> a Lecture room, your lab subjects will be unplaceable later and the timetable
> grid will say "No room fits" on every single period without telling you why.
> **Create at least one Laboratory now.**

### 3.7 Subjects — the curriculum

1. Tab **Subjects** → **Add subject**.
2. Create the first:
   - Subject code: `CS-101`
   - Subject name: `Programming Fundamentals`
   - Semester: `Semester 1 · BS Computer Science`
   - Credit hours: `3`
   - Room required: `Lecture room`
3. **Save**.
4. Create a second:
   - Subject code: `CS-102`
   - Subject name: `Computing Lab`
   - Semester: `Semester 1 · BS Computer Science`
   - Credit hours: `1`
   - Room required: `Laboratory`
5. **Save**.

**You should see:**

| Code | Subject | Programme · Semester | Credit | Room needed |
|---|---|---|---|---|
| CS-101 | Programming Fundamentals | BS Computer Science · Semester 1 | **3** CH · meets 2×/wk | Lecture |
| CS-102 | Computing Lab | BS Computer Science · Semester 1 | **1** CH · meets 1×/wk | Lab |

**Note there is no "how often it meets" field.** It is worked out from the
credit hours, because a period on this timetable is 90 minutes:

| Credit hours | Meets per week |
|---|---|
| 1–2 | once |
| 3 | twice |
| 4 | three times |

**Things worth testing here:**
- Add a subject with a code that already exists → refused, "Subject code already exists".
- Delete a subject that is in use → refused, naming what uses it ("1 class, 3 enrolments").
- Delete an unused subject, then create it again with the same code → it works.
- **Come back after §10 and move a subject to a different semester.** Its
  enrolment rows must follow it. Confirm on the student's My Courses screen
  (§15.2): the course appears under the subject's new semester, and no empty
  semester is left behind holding it.

### 3.8 The four tiles at the top

They count departments, programmes, sections and subjects across the institute.
After §3.7 they should read `1 / 1 / 1 / 2`. If a tile disagrees with the tab
badge beside it, that is a real bug — the two are counted by different queries
and they are supposed to agree.

---

## 4. Teachers

### 4.1 Onboard a teacher ▶ DEMO

1. Sidebar → **Teachers** (`/teachers`).
2. Click **Add Teacher** (top right).

> **This form changed.** It takes one **Full Name** field, not first and last.
> There is no hire-date field, and no password field. There *is* an "Assign
> classes" section, because a teacher with no assignment has an empty faculty
> portal and reports zero workload everywhere.

3. Fill in:
   - **Full Name \***: `Ayesha Khan`
   - Department: `Computer Science`
   - **Designation \***: `Assistant Professor`
   - Email: *leave blank* — one is generated
   - Phone: optional
   - Specialization: `Software Engineering`
   - Status: `Active`
   - **Assign classes**: leave empty for now — you will staff her properly
     through the timetable in §10.2, which is the path that creates a real
     course offering.
4. **Save**.

**You should see:** a credentials dialog showing the employee code
(`EMP-0001`), the email (`ayesha.khan@aims.edu.pk`) and a one-time password.
**Copy both — you sign in as this teacher in §11.**

**Behind it:** `POST /api/admin/teachers/onboard` creates the `users`,
`employees` and `teachers` rows in one transaction.

**You should see** on the directory: `Ayesha Khan · Active · EMP-0001`, and a
**Weekly load** of `0 h`. That figure grows once you place the timetable (§10).

**Also check:** Academic Structure → Departments now reads `1 employee` against
Computer Science.

### 4.2 The teacher directory

Still on `/teachers`:

- **Search** by name, department, designation, specialization, email, employee
  code *or* course.
- **Status filter**: Active / On Leave / Terminated / Retired.
- **Edit** a teacher — change the designation and confirm it sticks after a
  reload.
- Open a teacher to see their subjects, sections and weekly load.

### 4.3 Record what she is allowed to teach

The staffing shortlist in §10.2 is built from this. Skip it and the shortlist is
empty.

1. Sidebar → **Qualifications** (`/qualifications`).
2. In the left rail, click **Ayesha Khan**.
3. On the right, tick `CS-101` and `CS-102`.
4. Save.

**You should see:** the header count rise to `2 qualifications recorded`, and
the rail entry show `2`.

> **A qualification is not batch-scoped.** It is a standing fact about a person
> — "this teacher may teach this subject" — with no term, section or batch
> attached. That is why the screen lives beside Teachers rather than under
> Academic.

---

## 5. Students and parents ▶ DEMO

### 5.1 Admit a student

This one action creates **five things**: the student, the student's login, the
parent, the parent's login, and the link between them.

1. Sidebar → **Students** (`/students`).
2. Click **Add Student**.
3. Fill in the Student half:
   - First Name \*: `Bilal`
   - Last Name \*: `Ahmed`
   - CNIC / B-Form \*: `12345-1234567-1`
   - Phone, Date of Birth, Address: optional
   - Program \*: `BS Computer Science`
   - Batch \*: `BSCS-2026`
   - Section: `CS-1A`
   - Gender: `Male`
4. Fill in the Parent / Guardian half:
   - Guardian First Name: `Tariq`
   - Guardian Last Name: `Ahmed`
   - **Guardian Email: `tariq.ahmed@example.com`**
   - Guardian Phone: optional
   - Relationship: `Father`
5. Click **Admit & Create Accounts**.

**You should see:** a dialog with **two** sets of credentials — STUDENT and
PARENT — each with an email and password, plus the generated registration
number `2026-AIMS-REG-0001`. **Copy all of it.**

> **There is no Semester field on this form any more.** A student's semester is
> now *derived*: it is `students.current_semester_id` if set, otherwise the
> highest semester among their non-dropped enrolments. So Bilal will read
> "No semester" until you enrol him in §10.3, and will then read Semester 1
> without anybody typing it. This is the fix for students who were correctly
> registered but reported under a bucket labelled with the absence of a
> semester. See `services/currentSemester.js`.

> **The guardian email is not optional if you supply any guardian detail at
> all.** Give a first name and no email and the whole admission is refused —
> "A parent needs first name, last name and email." Nothing is created; it is
> one transaction, so you never get a half-built student.

**Repeat twice more**, so you have three students to work with:
- `Sana Iqbal`, guardian `Nadia Iqbal`, `nadia.iqbal@example.com`
- `Usman Tariq`, guardian `Kamran Tariq`, `kamran.tariq@example.com`

**You should see:** Academic Structure → Sections now reads `3 / 30 — 27 free`,
and the admin dashboard's Students tile reads `3`.

**Also check Notifications:** each student and each parent got a Registration
notice on their own account.

### 5.2 Reusing an existing parent

Admit a fourth student and give the guardian email **`tariq.ahmed@example.com`**
— one already used.

**You should see:** the credentials dialog shows the student's password but
**no parent password**, because the parent already exists and keeps their
current password. The new child is simply added to that account.

### 5.3 The students list, and everything on it

Still on `/students`:

| Control | What to check |
|---|---|
| Search | By name, registration number or CNIC. |
| Program / Batch / Semester / Status filters | The Batch list narrows to the chosen programme. |
| Column sort | Click a header; the sort is done by the server, so it sorts the whole set and not just the page. |
| Pagination | Page 2 keeps your filters. |
| Click a row | Opens `/students/:id` — the profile, §5.4. |
| **Export** | Downloads the filtered set, not the page. |

### 5.4 A student's profile

Click **Bilal Ahmed**.

**You should see** one screen with:
- personal details and the **Guardian** card,
- attendance, GPA/CGPA and fee metrics,
- the **Enrolled Courses** table (empty until §10.3),
- the **Fee vouchers** section (used in §14.1),
- his avatar, if one has been uploaded (§20.3).

The URL is `/students/1` — bookmark it, reload it, open it in a second tab. A
profile lives underneath the list it is reached from, not as a sidebar module
of its own.

### 5.5 Bulk import from CSV

1. On `/students`, find **Import**.
2. The dialog names the columns: registration number, first name, last name,
   CNIC, programme, batch.
3. Programme and batch are matched **by name** against the live tables, so a
   typo is rejected rather than silently creating anything.

**Try:** a file with one bad row. **You should see** a per-line error naming the
line number and the missing field, and nothing imported.

### 5.6 The Parents screen

1. Sidebar → **Parents** (`/parents`).

**You should see:** your parents listed, with **Edit**, **Link child** and
**Delete** on each row. If you did §5.2, Tariq Ahmed shows two children.

**Try:**
- **Link child** on another parent and attach a second student.
- **Unlink** one, and confirm the parent portal's child picker loses it.
- **Delete** a parent who still has a child linked → refused.

---

## 6. Fee structure

What a semester costs. Set this once and every voucher can bill it
automatically.

1. Sidebar → **Fee Management** (`/fee-management`).
2. Scroll to the bottom, to **Fee structure**.
3. Click **Add fee line** and create three:

| Programme | Semester | Category | Amount |
|---|---|---|---|
| BS Computer Science | Semester 1 | Tuition | `55000` |
| BS Computer Science | Semester 1 | Examination | `5000` |
| BS Computer Science | Semester 1 | Laboratory | `8000` |

**You should see:** each row showing its own amount, and a **Semester total** of
**Rs. 68,000** repeated on all three — that total is what a voucher will bill.

**Try:** adding Tuition for the same programme and semester twice → refused,
"Fee structure already exists". One row per category.

> **Who can see this section.** Only Super Admin and Admin. An Accountant gets
> the rest of Fee Management but not the structure — tested in §20.5.

---

## 7. The academic term

A **term** is the calendar year (Fall 2026). A **semester** (§3.3) is the
curriculum stage. They are different things and the system keeps them apart.

1. Sidebar → **Timetable** (`/timetable`).

**You should see:** a near-empty screen with one thing on it —
*"No academic terms yet"* and a **Create the first term** button. Every other
panel on this screen is scoped to a term, so there is nothing truthful to draw
until one exists.

2. Click **Create the first term** (or the **calendar-plus** icon in the command
   band, **New academic term**).
3. Fill in:
   - Code: `FALL-2026`
   - Name: `Fall 2026`
   - Starts: `2026-09-01`
   - Ends: `2027-01-31`
4. Click **Create term**.

**You should see:** the term appear in the dropdown, marked **PLANNED**.

5. Activate it (the status control in the command band → **Active**).

**You should see:** the badge change to **ACTIVE**.

### 7.1 Only one term can be active — test it

1. Create a second term: `SPRING-2027` / `Spring 2027` / `2027-02-01` to `2027-06-30`.
2. Try to make it Active as well.

**You should see:** it is **refused**, with:

> *Fall 2026 is already the active term. Close it first — two active terms would
> leave the portals and the timetable editor disagreeing about which year is
> current.*

That is correct behaviour, not a bug. The database enforces it too (migration
`20260822130000`), so it cannot be worked around through the API.

---

## 8. Build the term's classes

A **class** (a "course offering") is: *this section studies this subject with
this teacher, this term*. Everything downstream hangs off it.

### 8.1 Create the classes

1. On `/timetable`, click **Build classes**.
2. Fill in:
   - Section: `CS-1A`
   - Curriculum semester: `Semester 1` (it lists only this section's programme,
     with each stage's subject count)
3. Confirm.

**You should see:** the left rail fill with one entry per subject in that
semester — `CS-101` and `CS-102` — each showing `CS-1A`, no teacher, and a
periods counter of `0/2` and `0/1`.

**Behind it:** `POST /api/offerings/section`.

### 8.2 Assign teachers

1. Click **CS-101** in the rail.
2. Click **Assign teacher** — it is in the class header, and also on each row of
   the class list, so a class with no teacher is not a dead end.

**You should see:** a dialog that **names the class first** (subject, section,
batch), then lists candidates. Each shows their specialization and what they
already teach this term. A teacher who holds the same subject for another
section is flagged **ALREADY TEACHES IT**.

> If the list is **empty**, you skipped §4.3. Go and record the qualification.

3. Choose `Ayesha Khan`. Confirm.
4. Do the same for **CS-102**. The button now reads **Change teacher** on a
   staffed class.

**Behind it:** `GET /api/offerings/:id/teachers` builds the shortlist,
`PUT /api/offerings/:id/teacher` commits it.

### 8.3 Enrol the students

Students do not pick courses in this system (see §21.3). The admin enrols the
whole section in one action.

1. With a class selected, click **Enrol section**.

**You should see:** the enrolled count go to `3` for every class in the section
(4 if you did §5.2 and put that student in CS-1A).

**Behind it:** `POST /api/offerings/section/enrol` writes one `enrollments` row
per student per class. Only students with `academic_status = 'Active'` are
enrolled.

**Now go back and look at two things:**
- `/students` — the Semester column reads **Semester 1** for everyone you just
  enrolled. Nobody typed that (§5.1).
- `/students/1` — the **Enrolled Courses** table has two rows.

---

## 9. Place the timetable

### 9.1 The grid

Periods are fixed at 90 minutes:

| Slot | Time |
|---|---|
| 1 | 08:30 – 10:00 |
| 2 | 10:00 – 11:30 |
| 3 | 11:30 – 13:00 |
| — | 13:00 – 13:30 **break, not bookable** |
| 4 | 13:30 – 15:00 |

### 9.2 Place a period

1. Select **CS-101** in the rail.

**You should see:** a Monday–Saturday grid, each day showing its four periods.
Cells are marked **Free**, or **No room fits**, or already carry a room plate.

2. Click a **Free** cell — say Monday, slot 1.

**You should see:** a room picker that **names the class first** (subject,
section, batch, teacher), then lists rooms that legally fit, with capacity.

3. Choose `R-101`. Confirm.

**You should see:** the cell fill with an `R-101` plate, and the counter go
`1/2`.

4. Place the second period of CS-101 — put it on **Wednesday, slot 1**, so the
   week is spread.
5. Select **CS-102** and place its single period on **Monday, slot 2**.

> **Place two periods of CS-101 on the same day** if you want to test the
> per-period register properly in §11.2. Monday slot 1 and Monday slot 3 gives
> the attendance screen two registers to choose between on one date.

**Watch this:** CS-102 requires a Lab, so the picker offers **only `LAB-1`**.
This is the room-type rule from §3.6 doing its job.

### 9.3 What the grid refuses, and why

A cell is closed when placing there would double-book. Hover it and the reason
is given. The three hard rules:

- the **section** cannot be in two places at once,
- the **teacher** cannot be in two places at once,
- the **room** cannot hold two classes at once.

**Test all three:** try to place CS-102 in the same Monday slot 1 that CS-101
occupies (section clash), then create a second section, staff it with Ayesha
too, and try to place it opposite her existing period (teacher clash).

### 9.4 Moving a period

Drag a placed period to another free cell, or remove and re-place it. The same
three rules are checked at the destination.

**Behind it:** `PUT /api/scheduling/sessions/:timetableId`.

### 9.5 Reading the progress figures

The command band shows two different things:

- **`3/3 periods`** — periods placed out of periods required across the term.
- **`2 complete`** — classes that have all their periods placed.

A term can read `40/69 periods` and that is honest, not broken: it means 29
periods still need placing.

### 9.6 Removing a period

Click a placed cell's **Remove**.

**Important:** once attendance has been marked against a period, **Remove is
disabled**, with the reason in a tooltip. That is deliberate — attendance rows
are deleted along with their period, so the system refuses rather than
destroying register history. Come back and test this *after* §11.2, and you
will see it disabled.

---

## 10. The rest of the Timetable screen

### 10.1 The term switcher

The dropdown in the command band lists every term. Switch to `SPRING-2027`.

**You should see:** an empty rail — classes belong to a term, and you have not
built any for Spring. Switch back.

### 10.2 The class list

The **Classes** tab lists every offering in the term with its section, teacher,
enrolled count and placement progress. This is where you staff a class you have
not selected in the grid.

### 10.3 A class with no teacher, and a class with no periods

Both are shown, not hidden. A staffed-but-unplaced class still appears in the
teacher's own portal (§11.1) with no slots, so it is never invisible to the
person who is supposed to teach it.

### 10.4 The Rooms tab

Click **Rooms** in the command band.

**You should see:** occupancy per room across the week — which periods of
`R-101` and `LAB-1` are taken, and by what.

**Why it is worth checking:** it is the same underlying data as the grid, read
from the room's side rather than the class's. If a room shows a booking the
grid does not, or the reverse, that is a real inconsistency.

**Behind it:** `GET /api/scheduling/rooms`.

### 10.5 Cross-check the placement

At this point, four screens should agree about the same period. Check them:

| Screen | Should say |
|---|---|
| Admin `/timetable` | CS-101, CS-1A, Ayesha Khan, R-101, Monday slot 1 |
| Teacher `/faculty/timetable` | the same period, naming the **section** rather than the teacher |
| Student `/student/time-table` | the same period |
| Parent `/parent/timetable` | the same period |

If any of the four disagrees, that is a real bug worth reporting. This is also
the single most convincing thing to put in front of a stakeholder — one action,
four audiences, one answer.

---

## 11. The teacher portal

1. Sign out (or use a second browser). Go to `/sign-in/faculty`.
2. Sign in with Ayesha Khan's email and one-time password from §4.1.
3. Change the password when prompted. Use `Teacher@1234`.

**You should see:** the faculty dashboard at `/faculty/dashboard`.

### 11.0 The dashboard

**You should see:**
- **At-Risk** — students below the 75% attendance threshold, in her classes only.
- **Excelling** — students at or above the marks threshold.
- **Average Attendance** and **Registers Pending Today**.
- Today's schedule, with the day named.
- A notifications strip with **View all →**.
- Attendance % and Marks % trend charts.

**Every figure is scoped to her roster by the server**, not by the browser. She
cannot see another teacher's students at all.

**Try:** the dashboard is a board — press **Customise**, move a panel, resize
one, hide one, then reload. The arrangement is saved per account.

### 11.1 My Classes

1. Sidebar → **My Classes** (`/faculty/my-classes`).

**You should see:** both classes, `CS-101 · CS-1A` and `CS-102 · CS-1A`, with
their weekly slots and `3` students each.

2. Click one. The URL becomes `/faculty/my-classes/:subjectId/:sectionId` —
   addressable, bookmarkable.

**You should see:** the roster, each student with their own attendance rate and
marks in this subject.

> A class that is staffed but **not yet timetabled** still appears here, with no
> slots. That is intentional: a teacher must be able to see a class they have
> been given before it has been placed.

### 11.2 Mark attendance — now per period

1. Sidebar → **Attendance** (`/faculty/attendance`).
2. Choose the class `CS-101` and a date that the class actually meets — with the
   placement in §9.2, a **Monday**. Use `2026-09-07`.

**You should see:** the three students listed, all unmarked, and — if the class
meets more than once that day — a **period selector** naming each slot by its
time.

> **This is the change.** A register belongs to a *period*, not a day. On a day
> with one period the server opens the only one and the selector does not
> appear. On a day with two, you pick. Saving names the period back to you in
> the confirmation, so you can tell which of the two you just filed.

> Pick a day the class does not meet and the sheet tells you so rather than
> offering an empty register.

3. Mark `Bilal` **Present**, `Sana` **Late**, `Usman` **Absent**.

The five statuses are **Present, Absent, Late, Leave, Holiday**. Use all five at
some point — they are counted differently everywhere downstream (§13.3).

4. Save.

**You should see:** a saved confirmation naming the class and the period, and
the attendance rate update.

**What just happened elsewhere — check these:**
- **Usman's notifications** (student portal): *"You were marked absent in
  Programming Fundamentals on 7 September."*
- **Kamran Tariq's notifications** (Usman's parent): the same event, phrased
  about his ward.
- Mark Usman absent enough times to drop him below 75%, and the notice changes
  to **"Attendance below 75%"**, at HIGH priority, naming the percentage and
  the rule. That is `notifyAbsence` in `attendanceController.js`.
- Amend the absence to Present. **A correction notice is sent too** — it is the
  only way a family learns a dispute went their way without ringing up.
- Admin `/attendance` — the roster and the cohort tiles have moved.

**Now go back to `/timetable` as the admin** and try to remove that Monday
period. It is disabled, with the reason on hover (§9.6).

### 11.3 The analytics board below the register

Scroll past the register on `/faculty/attendance`.

**You should see:** six panels — trend line with the 75% rule drawn on it, an
average tile, status breakdown, late-arrival count, and so on.

**All six are driven by one request** (`GET /api/faculty/attendance/trend`),
so changing the class or the period re-renders every panel from the same
response. There is no per-panel cache to fall out of step.

**Try:** **Customise** — move, resize, hide. Note that the class picker, the
register and Submit **cannot** be moved: they are a task with an order, and a
Submit button that can be dragged away from the table it submits is a hazard.

### 11.4 Create an exam

1. Sidebar → **Marks** (`/faculty/marks`).
2. Create an exam:
   - Subject: `CS-101`
   - Exam name: `Midterm`
   - **Exam type: `Mid-Term`** — must be one of Quiz, Assignment, Mid-Term,
     Final, Practical, Viva. Typing "Midterm" as the *type* is rejected.
   - Date: `2026-11-10`
   - Total marks: `50`
3. Save.

**What happened elsewhere:** every enrolled student got an Exam notification.
Check Bilal's Notifications.

**Try:** start typing a second exam, navigate away, come back. The half-typed
form is restored, with a notice saying so. That is the draft-protection layer —
it saves work *before* it reaches the server, which is a different thing from
the Draft status below.

### 11.5 Enter marks — the three-step workflow ▶ DEMO

This is the part that changed most, and it is worth demonstrating deliberately.

1. With the exam selected, enter:
   - Bilal Ahmed: `45`
   - Sana Iqbal: `38`
   - Usman Tariq: `22`
2. Click **Save Draft**.

**You should see:**
- a receipt reading *"Stored on the server, visible only to you. Submit for
  approval when the sheet is complete."*
- each row badged **Draft** — *"Saved. Not visible to the student."*
- the status counter at the top reading `Draft 3 · Submitted 0 · Released 0`.

3. **Go and check Bilal's Result page now.** It shows nothing. That is the
   whole point: a Draft mark must never reach the student's screen, because a
   number nobody has approved would drag a displayed grade from A to B and back
   as the teacher typed.

4. Click **Submit for Approval**.

**You should see:** every row badged **Submitted** — *"Awaiting approval. Not
visible to the student yet."* The counter reads `Draft 0 · Submitted 3 ·
Released 0`.

**Check Bilal's Result page again.** Still nothing. Submitted is not released.

5. There is also a per-row **Submit** button, for handing in one student's mark
   without touching anyone else's sheet.

| Status | Badge | Who can see it |
|---|---|---|
| Draft | grey — "Draft" | The teacher, and admins. |
| Verified | amber — **"Submitted"** | The teacher, and admins. |
| Published | green — **"Released"** | Everyone, including the student and their guardian. |

> **Why the badge says "Submitted" and not "Verified".** The database column is
> `Verified`, but what the teacher did was *hand it in*. The two words describe
> the same row from opposite ends, and the screen uses the teacher's.

**Behind it:** `getStudentMarks` in `markController.js` now filters on
`m.status`, and *who is asking* decides what that means — staff see every
status, a student and their parent see `Published` only. The response says which
(`scope: "all" | "published"`), so a caller can tell "nothing released yet"
apart from "no marks exist".

### 11.6 Assignments

1. Sidebar → **Assignments** (`/faculty/assignments`).

**An assignment *is* an exam with `exam_type = 'Assignment'`.** That is the only
thing it has ever been.

2. Create one: title, subject, due date, total marks.
3. **Save.**
4. **Reload the page.** It must still be there — this screen writes to the
   database, not to component state.

**You should see:** it appear here, **and** in the Marks screen's exam list,
because both read the same `exams` table.

4. Click through to grade it — the button navigates to
   `/faculty/marks?exam=<id>` with the sheet already open.

**Also check:** the sidebar badge on Assignments counts the ones needing
grading.

### 11.7 Students

Sidebar → **Students** (`/faculty/students`).

**You should see:** only the students in her own classes. Search, filter by
section and subject, and open one to see attendance and marks in her subjects
only.

### 11.8 Reports

Sidebar → **Reports** (`/faculty/reports`).

Five tabs, every one generated by `GET /api/faculty/reports` — so the table on
screen and the CSV it exports cannot disagree, and a report is not limited to
whatever the browser happened to have downloaded.

**Check each tab and export one:**

| Tab | Columns |
|---|---|
| Attendance | Roll number, student, section, subject, Present / Absent / Late |
| Class summary | Per class: roster size, average attendance, average marks |
| Marks | Per student per exam |
| At-risk | Below the attendance or marks threshold |
| Roster | The full class list |

> **Two tabs are gone rather than kept as empty tables:** *Fee Reports*
> (teachers are refused the fee endpoints by design) and *Teacher Performance*
> (it listed every colleague from a directory a teacher cannot read).

### 11.9 Users — read-only, and why

Sidebar has no entry for it; go to `/faculty/users` directly.

**You should see:** a read-only list of colleagues with the subjects each one
teaches. No Add User, no role dropdown, no Assign Subjects.

**Why:** those controls wrote only to in-memory state. The change looked applied
and was gone on the next reload, and it could not have persisted — a teacher is
refused `/api/users` by design, and there is no faculty endpoint for adding
accounts or reassigning subjects. Rather than keep buttons that lie, the screen
is now what it honestly is.

### 11.10 Ask the Data (faculty)

Sidebar → **Ask the Data** (`/faculty/ai-analytics`).

Type a question in plain English: *"which of my students are below 75%
attendance"*.

**You should see:** rows, in a table or a chart. No prose summary.

> **The scoping is in the database, not the screen.** A teacher's generated SQL
> is rewritten so every table name resolves to a CTE pinned to their own
> roster. A question phrased about the whole institute comes back about their
> students and nobody else's. The question box and the renderer are literally
> the same component the admin portal uses — the response envelope is identical
> for both roles because the boundary is server-side.

**Try:** ask something about a class she does not teach and confirm the answer
is empty rather than forbidden.

### 11.11 Timetable

Sidebar → **Timetable** (`/faculty/timetable`).

**You should see:** her week. Cells name the **section** rather than the
teacher, because the teacher is the same on every row. The live period is
highlighted — that is decided server-side, in the institute's timezone, not by
the browser's clock.

**Behind it:** `GET /api/timetables/current` — the same endpoint the student
page calls, which resolves the person from the token.

### 11.12 Announcements

Sidebar → **Announcements** (`/faculty/announcements`).

**You should see:** notices addressed to Teachers or to everyone. That filtering
is applied server-side from her token.

1. Create one.
2. Confirm it survives a reload, and that a student in the audience can see it.
   Every row on this screen must come from the database, not from component
   state.

> There is no Draft/Published state and no "target class" column. An
> announcement is published by existing, and the audience is a role, not a
> section. Rule-based targeting is an admin capability — §17.

### 11.13 Notifications, Profile, Settings

| Screen | What to check |
|---|---|
| `/faculty/notifications` | Everything raised for her. Mark read; the sidebar badge drops. |
| `/faculty/profile` | Her details, subjects, weekly load. Upload an avatar (§20.3). Change her password (§20.2). |
| `/faculty/settings` | Theme, row density, text size, and which notification types reach her. |
| `/faculty/anything-else` | The portal's own 404, not the app-wide redirect to the landing page. |

**Every save on this portal raises a toast.** Ten faculty screens call
`showToast()` from 32 places, including the messages that say a save was
**rejected**. If a save on this portal is silent, that is a bug worth
reporting.

---

## 12. Publish the results ▶ DEMO

This is the step that turns marks into a GPA — **and releases the marks
themselves**. Until you do it, every Result screen in the student and parent
portals is empty, and every CGPA figure in the admin portal reads nothing.

1. Sign back in as **Imran (Admin)**.
2. Sidebar → **Examination** (`/examination`).
3. Scroll to the bottom, to **Publish semester results**.

**You should see:** a row per semester that has marks:

| Programme | Semester | Marks | Students | State | Action |
|---|---|---|---|---|---|
| BS Computer Science | Semester 1 | 3 | 3 | Not published **(3 to release)** | **Publish** |

The `(3 to release)` is new: it counts the marks in **Submitted** status that
this publish will make visible.

### 12.1 Publish

1. Click **Publish**.
2. The confirmation names the class, how many students are affected, and —
   in bold — that **3 marks will become visible** to students and guardians.
   Confirm.

**You should see:** *"Published 3 result(s) for Semester 1. 3 mark(s) are now
visible to students."*

3. Click the **▸** arrow on the row to expand it.

**You should see:**

| Registration | Student | GPA | CGPA |
|---|---|---|---|
| 2026-AIMS-REG-0001 | Bilal Ahmed | 4.00 | 4.00 |
| 2026-AIMS-REG-0002 | Sana Iqbal | 3.00 | 3.00 |
| 2026-AIMS-REG-0003 | Usman Tariq | 0.00 | 0.00 |

Check the arithmetic against the grade scale in §0.1: 45/50 = 90% → A → 4.0.
38/50 = 76% → B → 3.0. 22/50 = 44% → F → 0.0. Correct.

**Scroll up the same screen.** The Examination dashboard — grade distribution,
average CGPA, pass rate, the student roster — has now filled in. All of it reads
the rows you just published.

### 12.2 What else just happened — check all four

| Where | What you should find |
|---|---|
| Teacher's Marks sheet | Every row now badged **Released**, green: *"Released by an administrator — visible to the student."* Counter reads `Draft 0 · Submitted 0 · Released 3`. |
| Student `/student/result` | GPA, CGPA, and the CS-101 grade. |
| Student `/student/notifications` | *"Semester 1 result published — GPA 4.00. Your marks for this semester are now available on your Results page."* |
| Parent `/parent/notifications` | The same event, phrased about the ward. |
| Admin `/audit` | An entry naming who released them. |

> **Why the marks and the GPA are released together.** Compiling a GPA and
> letting the student see the marks it was compiled from are the same decision,
> so they are the same gesture. Until this change they were neither: the GPA was
> released here and the marks were released by nobody, because the student's
> read path never looked at `marks.status`.

### 12.3 The draft gate — test it

1. Go back to the teacher portal and re-save the marks as **Draft**.
2. Return to **Examination** as the admin.

**You should see:** the Publish button replaced by a **Marks in draft** warning,
with the reason on hover: *"3 marks still in Draft. The teacher must submit them
for approval from the faculty Marks screen first."*

The database enforces the same thing: `sp_publish_semester_results` raises
*"some marks are still in Draft for this semester"* if it is called anyway. A
GPA computed from half an entry is worse than no GPA at all.

Set them back to Submitted, and publish again, before continuing.

### 12.4 Republishing is safe — test it, and check the arithmetic

1. Change one mark in the teacher portal (Usman `22` → `30`), submit it.
2. Publish the semester results again.

**You should see:** *"Recalculated 3 result(s)"* — and **still exactly 3 rows**,
with Usman's GPA now 30/50 = 60% → C → 2.0. Publishing again corrects; it does
not duplicate.

> **Check the CGPA deliberately here.** Three rules govern it, and each one
> fails quietly rather than loudly if it is broken:
>
> - **A re-publish replaces a semester, it does not add one.** The CGPA must not
>   count the row being overwritten alongside its replacement. This only
>   diverges when the mark actually changes — which is the one case anybody
>   re-publishes for — so an unchanged re-publish will not reveal it.
> - **The credit basis is the same on both sides.** Prior semesters and the
>   current semester are both weighted by the credits of **not-dropped**
>   enrolments. If dropped courses are counted on one side only, dropping a
>   course inflates the semester you dropped it from.
> - **No subject may silently leave the GPA.** Percentages are clamped to 0–100,
>   so a bonus mark above 100 still lands in a band. If a subject matches no
>   band at all, the publish is refused with *"the grading scale has a gap"*
>   rather than dropping the subject and its credit hours from the calculation.

**Worth testing that last one:** edit the `grades` table to leave a hole (say,
delete the C band), and try to publish a mark that lands in it. The publish is
refused rather than quietly excluding the subject.

### 12.5 The rest of the Examination screen

Above the publishing panel:

| Panel | What to check |
|---|---|
| Grade distribution | A bar per grade band. Bands come from the `grades` table — add one and it appears without a code change. |
| Average CGPA / pass rate | Against `PASS_GPA`. |
| Student roster | Filter, sort, page. Click through to a profile. |
| Semester and programme filters | Narrow everything above. |

---

## 13. The admin's own read screens

Five screens that create nothing and are therefore easy to skip. They are also
the five an administrator actually lives in, and every figure on them is counted
in SQL over the whole institute — nothing is derived from the rows currently
visible, and nothing is hardcoded.

### 13.1 The dashboard (`/dashboard`)

Three tiers, in decreasing urgency, and each is a different *shape* because it
answers a different kind of question.

| Tier | What | Check |
|---|---|---|
| Four figures | Students, Pass rate, Fees collected, Attendance | Each should reconcile with the module behind it. |
| Three panels | Student roll, Academic standing, Fee collection — each built around a proportion bar | "Compared to what?" — the question a bare figure cannot answer. |
| The feed | Recent activity | A twelve-row window onto the Audit Trail (§19). |

**A tile only takes colour when its supporting line is asking for something**, so
a healthy row is monochrome and a problem is the only coloured thing on it. If
everything is red, that is a finding, not a style.

**Try:**
- Press **Customise**, move a panel, reload. The arrangement persists per
  account.
- Try to delete one of the four figure tiles or the feed → refused. They are
  what the screen is *for*. The server enforces the same rule, so a crafted
  request cannot step around it (§18.2).
- Drop a card pinned from Ask the Data between two built-in panels and watch
  them push aside.

### 13.2 Enrolment (`/enrollment`)

How many students sit at every level of the structure, and who they are.

**The one thing to understand here:**

| Figure | Counts | With your test data |
|---|---|---|
| **Students** | People | 3 |
| **Course enrolments** | Registrations — one per student per subject | 6 |

They are drawn in visibly different places, each labelled with the thing it
counts, and **never summed together**. On the live database the two are 2,003
and 9,650 — putting one under the other's label overstates the institute
fivefold, and this screen exists to prevent exactly that.

**Test:**
1. Click any figure. It opens the roster behind it, filtered the same way, so
   the list and the number cannot disagree.
2. Confirm **empty levels are shown, not hidden.** Create a section and put
   nobody in it — it should appear, drawn muted, with a readable `0`. The
   toggle collapses empty rows but **defaults to showing them**, because an
   explorer that hides empty containers cannot be used to find one. This is the
   bug that made this screen report 5 programmes while the dashboard reported 6.
3. Note that the count is not recomputed from the roster page — the roster is
   paged, the count is not.

**Behind it:** one request, `GET /api/admin/enrollment`, returning department,
programme, batch, section *and* semester counts. That is a correctness
requirement rather than an optimisation: five endpoints answering five questions
from five moments can add up to different totals, and a screen whose levels
disagree with each other cannot be used to reconcile anything.

### 13.3 Attendance (`/attendance`)

The screen an administrator opens to decide **who sits the exams**. The rule is
75%, the consequence is somebody's semester, and the question is never "what is
the average" — it is "who is short, and is this list actually complete".

**Four bands, in the order the question is asked:**

1. What am I looking at, and over what period.
2. **Four cohort tiles** — and each tile *is* the filter that opens it.
3. Two analyses side by side: the roll against the 75% rule, and the rate month
   by month.
4. The roster.

**Test the signature behaviour:** click **Below 75%**. The table beneath becomes
exactly those students — the same query that produced the figure, not a second
one that agrees with it by luck.

**Five statuses, each in its own column:**

| Status | Counts toward the 75%? | Counts as a session? |
|---|---|---|
| Present | Yes | Yes |
| **Late** | **Yes** — a student who arrived late was there | Yes |
| Absent | No | Yes |
| Leave | No | Yes |
| **Holiday** | No | **No** — excluded throughout |

> **Check this deliberately.** Each of the five states gets its own column, and
> the row must reconcile. Mark one student in each of the five states in §11.2,
> then come here and confirm **the row adds up**: Present + Late + Absent +
> Leave = Sessions, with Holidays excluded from both sides. A table that folds
> Late into Present, or omits Leave, will still look plausible — so add the
> columns up rather than eyeballing them.

**A session is a timetable slot.** Not a day. A class meeting twice on a Monday
contributes two sessions, which is why §11.2 marks per period.

Also test: search, the programme/section/semester filters, remote column sort,
paging, and the URL — the cohort selection is in the query string, so a filtered
view is a link you can send to somebody.

### 13.4 Reports (`/reports`)

Six PDF reports, each generated on demand:

| Report | Contains |
|---|---|
| Attendance | Per student, against the 75% rule |
| Fee | Billed, collected, outstanding |
| Examination | Grades and GPA distribution |
| Enrolment | The structure, level by level |
| Faculty | Teachers, load, subjects |
| AI Analytics | The risk cohorts from §18.1 |

**Press each one and open the PDF.** Confirm the figures match the module they
came from.

**Behind it:** the headline figures on screen come from
`GET /api/admin/reports`, which is **aggregates only** — no student row crosses
the wire, because this screen never lists an individual. The report *bodies* do
need per-student rows, so each generator fetches them from
`/api/admin/students/export` when its button is pressed. That is the right
trade: a report is an explicit, occasional action, and the rows it needs are
fetched then rather than on every sign-in for everyone.

### 13.5 Settings (`/settings`)

Three categories.

| Category | Contains | Test |
|---|---|---|
| **Appearance** | Theme, row density, text size | Change the density and watch table padding change on `/students`. It is a `data-density` attribute on `<html>` that the stylesheet scales off, so it applies everywhere at once. |
| **Notifications** | The unread badge, and a switch per notification type | §17.4. |
| **Account** | Profile, password, profile picture | §20.2, §20.3. |

**Note what is deliberately absent:** a Language setting. There is no
translation layer, so a language choice would change nothing — and a setting
that changes nothing is worse than no setting.

---

## 14. Fees, end to end ▶ DEMO

### 14.1 Issue a voucher

1. Sidebar → **Students**, click **Bilal Ahmed** to open his profile.
2. Find the **Fee vouchers** section. Create a voucher:
   - Semester: `Semester 1`
   - Issue date / due date: your choice
   - Leave the amount blank
3. Save.

**You should see:** a voucher billed **Rs. 68,000** — the sum of the three fee
lines from §6. That is the fee structure doing its job.

> Type an amount instead and it wins. The structure is the fallback, not a
> ceiling.

**Check:** Bilal's Notifications — a Fee notice naming the voucher and the due
date. And his guardian's.

### 14.2 The three numbers that must never be conflated

Read this before testing the payment flow, because every bug this area ever had
came from mixing two of them up.

| Number | Means | Moves when |
|---|---|---|
| `settled_due` | What the institute is still owed. **The balance.** | Only when the office **verifies** money. |
| `pending_amount` | What has been declared and not yet decided. **A claim about money, not money.** | On a declaration. |
| `claimable` | `settled_due − pending_amount`. What may still be declared. | On either. |

**The balance a family sees stays `settled_due`**, because that is what they owe
until the office says otherwise. **`claimable` governs the Submit button**,
never the figure. A voucher whose whole balance is already sitting in a Pending
declaration still has `settled_due > 0` — and if the button read that number it
would stay on screen after the family had just used it, then be correctly
refused by the server, which reads to the user as a broken feature.

### 14.3 The student submits a payment

1. Sign in as **Bilal** at `/sign-in/student` (change password when prompted;
   use `Student@1234`).
2. Sidebar → **Fee Management**.

**You should see:** the voucher, its amount and its due date.

3. Submit a payment — declare an amount, a method
   (Cash / Bank Transfer / Card / Mobile Wallet / Online / Cheque / Other) and a
   date. **A future date is refused.**

**You should see:**
- the declaration listed as **Awaiting verification**,
- the balance **unchanged**,
- the **Submit payment** button gone for that voucher, because `claimable` is
  now zero.

**Try:** declaring more than the balance → refused, "This voucher is already
settled or fully claimed."

**Try:** starting a declaration, reloading the page mid-way. The part-filled
form comes back — the draft key carries the voucher, so a declaration started
against one voucher does not reappear against another.

### 14.4 The parent can declare too

1. Sign in as Tariq at `/sign-in/parent` → **Fee Details**.

**You should see:** the same voucher, the same pending declaration, and — if
anything is still claimable — a **Submit payment** button of his own.

Declare a partial payment against a second voucher and confirm both the student
and the parent see the same Pending row.

### 14.5 The admin verifies it

1. Sign back in as Imran. Sidebar → **Fee Management**.
2. Find the **payment approvals** queue. Each row names the student, the
   voucher, the declared amount, the method, and **who declared it**.
3. **Approve** it.

**You should see:** the voucher's paid amount and balance update, a receipt
number issued, and the status move to Partial or Paid.

4. Declare a second payment and **Reject** it.

**You should see:** the balance unmoved, and the row visible under the
`Rejected` filter — the decision history is kept, not deleted.

**Check the ledger.** Every payment row carries **three separate moments**, and
they are deliberately not conflated:

| Field | Means |
|---|---|
| `claimedPaidOn` | What the family says the date was |
| `declaredAt` | When they said it |
| `approvedAt` | When the institute agreed |

Pending rows sort to the top: an undecided claim is the thing on the screen
somebody has to act on.

### 14.6 The rest of Fee Management

| Panel | What to check |
|---|---|
| Collection summary | Billed, collected, outstanding, for the whole institute. |
| Voucher list | Filter by status, semester, programme; page; export. |
| Payment approvals | 14.5. |
| Fee structure | §6. Admin-only. |

---

## 15. The student portal

Sign in as Bilal at `/sign-in/student`. Walk every screen.

### 15.1 Dashboard (`/student/dashboard`)

**You should see:** attendance %, GPA, fee summary, today's classes, the ten
most recent announcements addressed to him, and an insight panel. Every figure
should reconcile with what you entered.

### 15.2 My Courses (`/student/my-courses`)

**You should see:** both subjects, with credit hours, the instructor's name, and
his own attendance and marks in each.

Click one → `/student/my-courses/CS-101` — the course detail screen: the
timetable slots, the register, the exams, and the marks that have been
**released**.

> **The check that matters here.** Both courses must appear under **Semester 1**.
> If one of them appears under a semester of its own that nobody created, the
> `enrollments.semester_id` denormalisation has drifted from `subjects` —
> migration `20260824100000` exists for exactly this, and it is idempotent, so
> re-running it is safe.

### 15.3 Attendance (`/student/attendance`)

**You should see:** the Monday you marked, per subject. Present / Absent / Late
/ Leave / Holiday are all distinguished — not collapsed into two columns.

Check that a **Holiday** row does not drag his percentage down. A holiday is not
a session anybody could attend, so it is excluded from the denominator
everywhere.

### 15.4 Time Table (`/student/time-table`)

**The key check.** A student's timetable shows **only the subjects he is
enrolled in**, not his section's whole grid.

**How to test it now that there is no un-enrol action** (see §21.4): admit a
fourth student into `CS-1A` *after* you have enrolled the section, and do not
run **Enrol section** again. That student's timetable should be empty while the
section's grid is full, and the admin grid should be unchanged.

### 15.5 Result (`/student/result`)

**You should see:** GPA, CGPA and the grade for CS-101 as released in §12.

**Before §12 it must read "Result not published yet"** — an explanation, not a
zero. A GPA of 0.00 and "not published yet" are different facts and the screen
must not print the first when it means the second: a zero has the authority of a
result and none of the checking.

**Also check:** the CGPA footer says **"Not published"** rather than a number,
for a semester that has not been released.

### 15.6 Fee Management (`/student/fee-management`)

§14.3. The voucher, the declarations, the balance, the payment history.

### 15.7 Documents (`/student/document`)

1. Choose a category — CNIC, B-Form, Photo, Certificate, Transcript, Medical,
   Admission Form, Fee Challan, Result Card, Other. These are exactly the
   values of the `doc_type` enum, so an upload cannot be rejected for a
   category the database does not have.
2. Upload a **PDF** and confirm it appears, badged **Pending**.

> **A mismatch worth reporting.** The upload panel says *"Supports PDF, JPG,
> PNG, DOC, DOCX, XLS (max 10 MB)"* and the file picker accepts
> `.doc .docx .xls .xlsx .csv`. **The server accepts PDF and images only
> (JPEG, PNG, WEBP, GIF), and caps the file at 8 MB.** It also verifies the
> file by its *signature*, not by its claimed content type, so renaming a `.docx`
> to `.pdf` will not get it through either. Try a `.docx` and a 9 MB file and
> confirm you get a readable 400 — not a 500, and not a silent success.

3. Confirm the **Verified / Pending** badge reflects `student_documents.verified`.

### 15.8 Profile (`/student/profile`)

His details, registration number, guardian, avatar (§20.3), and the routine
change-password dialog (§20.2).

### 15.9 Notifications (`/student/notifications`)

By the time you get here he should have collected: Registration, Exam,
Attendance (if marked absent), Fee, Result, and Account (after his password
change). Mark one read and confirm the badge drops.

### 15.10 Legacy student URLs

`/my-courses`, `/result`, `/time-table`, `/document`, `/profile` — all still
work at the top level, for anything already bookmarked.

---

## 16. The parent portal

Sign in as Bilal's parent (`tariq.ahmed@example.com`) at `/sign-in/parent`.
Change the password when prompted.

> **The parent portal is eight real URLs**, not one route with tabs. That
> matters for what you test: every screen must survive a reload, be reachable
> by Back, be bookmarkable, and be linkable from a notification. A fee notice
> must be able to point at the fee page.

### 16.1 Every screen

| Screen | URL | What to check |
|---|---|---|
| **Dashboard** | `/parent/dashboard` | The ward's attendance, CGPA, fee position. |
| **My Children** | `/parent/my-children` | Every linked ward. Two of them, if you did §5.2. **View full dashboard** carries the child through in the query string, so the dashboard opens showing *that* child — not the first one. |
| **Attendance** | `/parent/attendance` | Matches what the teacher marked, status by status. |
| **Timetable** | `/parent/timetable` | Matches the student's own — the ward's enrolments, not the section's grid. |
| **Results** | `/parent/results` | Matches what you released in §12. Nothing before that. |
| **Fee Details** | `/parent/fees` | The voucher, the payment history, and his own Submit payment control (§14.4). |
| **Notifications** | `/parent/notifications` | Everything raised about his wards, phrased about them by name. |
| **Profile** | `/parent/profile` | His details, the linked wards, avatar, change password. |

### 16.2 The child picker

With two wards linked, switch between them in the header.

**You should see:** every screen re-scope. The URL carries `?child=` so a
particular ward's screen is addressable.

### 16.3 Addressability — the thing that was broken

1. Open `/parent/results`, reload. You stay there.
2. Press Back. You go to the previous *screen*, not out of the portal.
3. Type `/parent/nonsense`. You land on `/parent/dashboard`, not the app-wide
   landing page — an unknown parent URL must not sign the parent out of their
   own portal.
4. Open the old `/parent-dashboard?tab=fees`. It redirects to `/parent/fees`.
   Nine notification rows in the database still carry that shape.
5. Check every one of the eight legacy `?tab=` values redirects, not just the
   common ones. `/parent-dashboard?tab=my-children` is the one most likely to
   be missing from the redirect list.

### 16.4 The cross-check that proves the system is consistent

Admin, teacher, student and parent should all describe the *same* class the same
way — same subject, same teacher, same room, same time, same attendance, same
grade. If any of the four disagrees, that is a real bug worth reporting.

---

## 17. Announcements and notifications

### 17.1 Announcements with rule-based targeting ▶ DEMO

1. As Imran: sidebar → **Announcements** (`/announcements`).
2. Click **New announcement**. Write a title and a body.
3. Set the audience to **Targeted**, and add a rule.

**The dimensions a rule can filter on:**

| Field | Example |
|---|---|
| Role | Students, Teachers, Parents, Accountants… |
| Programme | BS Computer Science |
| Batch | BSCS-2026 |
| Section | CS-1A |
| Semester | Semester 1 |
| Individual | one named user |

**How the rules combine — this is the part to demonstrate:**

- **Within one rule, every filter set must match.** `BSCS-2026` + `CS-1A`
  reaches that section and nobody else.
- **Rules OR together.** A second rule naming the Teacher role adds every
  teacher without narrowing the first.
- **No rules at all means everyone** — that is what the "Everyone" mode sends.

4. Build: rule 1 = Role *Students* + Section *CS-1A*; rule 2 = Role *Teachers*.
5. Save.

**Test the reach:**

| Sign in as | Should see it |
|---|---|
| Bilal (student in CS-1A) | ✅ |
| A student in another section | ❌ |
| Ayesha (teacher) | ✅ — rule 2 |
| Tariq (parent) | ❌ |

6. Switch the audience back to **Everyone** and confirm all four see it.

**Try:** switching to Targeted and adding no rules → refused, "Choose at least
one filter, or switch the audience to Everyone."

### 17.2 The announcements list

Search, filter by audience, filter by author, set a date window, sort
(newest / oldest / title A–Z), page. **Grouped by audience** is a useful view for
checking your targeting at a glance.

### 17.3 Notifications

`/notifications` in every portal. The bell in the header carries the unread
count.

| Event | Who is notified |
|---|---|
| Student admitted | The student, and their guardian |
| Teacher onboarded | The teacher |
| Staff account created | The account holder |
| Password changed or reissued | The account holder (HIGH) |
| Account locked | The account holder, and the audit trail |
| Exam created | Every student enrolled in the subject |
| Marked absent | The student and their guardian |
| Attendance drops below 75% | The same, at HIGH priority, naming the percentage |
| An absence is amended | The same — this one exists so a family learns a dispute went their way |
| Voucher issued, payment declared, payment verified or rejected | The student and their guardian |
| Semester results published | Every student with a result, and their guardians |

### 17.4 Muting a type

1. **Settings → Notifications** (any portal).
2. Untick a type — `Attendance`, say.
3. Trigger one (mark that student absent).

**You should see:** nothing arrives for that type, while the others still do.

The twelve types offered are Result, Registration, Library, Attendance,
Document, Fee, Scholarship, Academic, HR, Payroll, Leave, Meeting.

---

## 18. The AI features

Three separate things, in the sidebar under **INSIGHTS**.

### 18.1 AI Insights (`/ai-analytics`)

A workspace of prepared panels: at-risk cohorts, attendance trend, fee
position, and the worst 25 named students with the reason beside each.

**Risk is scored on four signals the database actually carries** — attendance
below 75%, a published CGPA below the pass mark, an exam average below 50%, and
an outstanding fee balance. **Nothing here is a prediction.** Every reason shown
beside a student is a fact already recorded against them.

On a three-student dataset most panels will be sparse. That is correct.

**Every panel here can be removed** — unlike the Dashboard, this screen is a
workspace rather than a readout. Anything hidden is one click from returning,
from the hidden-panels menu in the toolbar.

### 18.2 Ask the Data (`/ask-the-data`) ▶ DEMO

Type a question in plain English, e.g. *"how many students are in each section"*.

**What happens:** the question is turned into a database query, and the **rows
come back and are rendered directly** by a fixed template chosen server-side.
The language model plans the query and then stops — **it never sees a result
row**, so it cannot miscount or summarise wrongly. Anything you see in a table
came from the database.

> This is the difference worth explaining to a stakeholder. The old assistant
> replied in prose, which is how a 1,175-row result came to be described as
> "200 students, all with 0 PKR paid". Here the count is the length of the array
> beside it, and the table below is the whole array.

**When you asked for a chart and got a table**, the reason is stated rather than
swallowed:

| Reason shown | Means |
|---|---|
| "The requested columns were not in the result" | The planner named a column the query did not return |
| "No numeric column to plot" | Nothing to put on an axis |
| "Too many rows to chart legibly" | Every row is listed below instead |
| "Too many categories for a pie chart" | Shown as bars |
| "These are separate totals rather than parts of one whole" | Shown as bars, not a pie |

**Then do this, in order — it is the best two minutes of demo in the product:**

1. Ask a question that returns a chart.
2. **Pin it to the dashboard.**
3. Go to `/dashboard`. The card is there, between the built-in panels.
4. Drag it, resize it, and reload. The arrangement persists.
5. Try to delete one of the four built-in figure tiles → you cannot. They are
   what the screen is *for*; an account that removed them would be looking at a
   dashboard that no longer answers "what is the state of the institute". The
   server enforces this too, so a crafted request cannot step around it.
6. **Save the query** and confirm it appears in the saved-query strip, runnable
   again later.

### 18.3 The assistant widget

The floating button, bottom right. It answers questions about how AIMS works,
from the documentation. **It holds no database access at all**, and it renders
nothing for roles it does not serve.

> If 18.1 or 18.2 fail with a database error, the read-only AI account has not
> been granted on the test database. Fix:
> `cd AIMS/database && node scripts/create_ai_readonly_user.js`.

---

## 19. The audit trail

1. Sidebar → **Audit Trail** (`/audit`).

**You should see:** a record of everything you did in this guide — the accounts
created, the records changed, the results released, the passwords reissued, the
account locked and unlocked — with who did it and when.

**The controls:**

| Control | Notes |
|---|---|
| Search | Free text across the entry. |
| Module filter | The list is built **from the table itself**, so a filter can never offer a value with no rows behind it. |
| Action filter | Same. |
| From / To | A date window. |
| Click a row | The full entry, including the before/after where one was recorded. |

Every administrative action above should be findable here. Anything missing is
worth reporting.

**Also:** the dashboard's activity card is a twelve-row window onto this same
list. Click through from it.

---

## 20. Accounts, security and self-service

### 20.1 Lock an account, and unlock it ▶ DEMO

1. Sign out. At `/sign-in/student`, fail Bilal's sign-in five times.

**You should see:** the countdown from §1.3, then the lock, with HTTP **423**.

2. Try again with the **correct** password. Still refused — the lock is not a
   timeout and cannot be waited out.
3. Sign in as Imran → **User Management** (`/user-management`).
4. Find Bilal. He carries a red **Locked out** flag, which reads before every
   other flag on the row.
5. Open him. The detail panel shows **Locked out: \<date\>**.
6. Click **Unlock this account**.

**You should see:** the flag clear, and the failed-attempt count reset to zero
alongside it. That second half matters: a lock lifted with five attempts still
on the clock would re-lock on the next typo.

7. Sign in as Bilal again. It works.

**Behind it:** `POST /api/users/:id/unlock`, Admin and Super Admin only. There
is deliberately no timer that expires a lock and no route a signed-out user can
reach — the lock exists precisely so that somebody guessing at an account
cannot simply wait.

### 20.2 The routine password change

Distinct from the forced first change (§2.4). Every portal has it, from the
account's own profile or settings screen.

| Portal | Where |
|---|---|
| Admin | Settings → Account |
| Faculty | Profile, and Settings |
| Student | Profile |
| Parent | Profile |

The dialog requires the current password and enforces three rules, ticking each
as you satisfy it:

- at least 8 characters,
- upper and lower case,
- at least one number.

**Try:**
- The new password equal to the current one → refused.
- Mismatched confirmation → the Save button stays disabled.
- Escape, then reopen → the fields are empty. Leaving the previous attempt's
  values behind would mean re-opening the dialog showed a typed-in password.
- After a successful change, check Notifications — there is a HIGH-priority
  Account notice.

All four portals call the same endpoint, `PUT /api/auth/change-password`, which
is role-independent.

### 20.3 Profile pictures ▶ DEMO

Available on every portal's profile screen, and on Settings → Account for the
admin.

1. Click the avatar. **It is a menu, not a picker** — Upload, Take a photo,
   Remove.
2. Choose a file. **You should see the cropper**: drag to reposition, zoom, and
   a square frame.
3. Save.

**You should see** the new picture everywhere that person is named — the header,
the student list, the class roster, the teacher directory, the parent's ward
card.

**The rules, and how to test each:**

| Rule | Test |
|---|---|
| JPEG, PNG or WebP only | Try a `.gif` from the picker → rejected client-side with the type named. |
| **1 MB on the source file** | Try a 2 MB photo → *"That image is 2.04 MB. Choose one under 1 MB."* Two decimals, deliberately: rounding 1,079,752 bytes to "1.0 MB" produced the sentence *"That image is 1.0 MB. Choose one under 1 MB"*, which reads as a contradiction. |
| The server enforces the same 1 MB independently | Not reachable from the UI — worth a curl if you want to prove it. |
| The file is verified by **signature**, not content type | Rename an HTML file to `.png` and upload → rejected. |
| Whatever goes in, a **512×512 JPEG** comes out | Upload a wide photo and confirm the stored avatar is square and framed where you put it, not centre-cropped by the browser at display time. |
| Remove | Puts the initials placeholder back. |

**Behind it:** the image is stored **in the database row**, not on disk
(migration `20260822160000`). `POST /api/users/me/profile-picture`,
`GET /api/users/:id/avatar`, `DELETE /api/users/me/profile-picture`.

### 20.4 The global search

Every portal's header has a search box. Keyboard: ↑/↓ to move, Enter to open,
Escape to close.

**Two kinds of result:**
- **Jump to a module** — only the screens the signed-in role may open. A portal
  can never surface another portal's screens.
- **Records** — each portal searches its own data by whatever identifies things
  there: roll number, subject code, challan number, and so on.

**Test the boundary:** search for "students" as an Accountant. The module does
not appear, because the Accountant cannot open it.

### 20.5 Roles that should be refused

Create these from Staff Accounts (§2.2) and sign in as each:

| Role | What it should see |
|---|---|
| **Accountant** | Lands on **Fee Management**. Sees only Fee Management, Notifications, Settings. Does **not** see the Fee structure section — that is admin-only. |
| **HR** | Lands on Notifications. Has **no** permissions of its own anywhere in the backend. |
| **Library Staff** | Lands on Notifications. There is no library module. |

The menu deliberately shows these roles only what they can actually open, rather
than a full sidebar where twenty items return "forbidden". **The menu is
descriptive, not authoritative** — it grants nothing; the server remains the
authority and this is the menu agreeing with it.

The one special case anywhere in the backend: `feeController` explicitly admits
role 7 (Accountant) alongside the two admin roles. Everything else is
`authorize(...ADMINS)`.

### 20.6 URL tampering

| Signed in as | Type this | Should |
|---|---|---|
| Accountant | `/students` | Kept out — the portal will not render a screen whose every request the server would refuse. |
| Student | `/faculty/dashboard` | Refused. |
| Parent | `/dashboard` | Refused. |
| Teacher | `/api/users` (in the address bar) | 403 from the server. |
| Student | `/api/marks/verify/1` (POST, via devtools) | 403. **Test this one properly, with a real student token.** Entering and correcting a mark is teacher-and-admin; **verifying is admins only**, because a teacher countersigning their own entry is not a check. Try all three as a student — enter 50/50, verify a Mid-Term, and amend an existing mark — and confirm each is refused. A route carrying `authenticate` but no role gate would make every signed-in account a marks clerk, and returns 200 rather than an error, so it will not announce itself. |

---

## 21. Known gaps and limits

Things that are genuinely not there. Not bugs to chase.

### 21.1 No promotion workflow
Nothing moves a student from Semester 1 to Semester 2. The student's semester is
now *derived* from their non-dropped enrolments, so in practice "promotion"
means building the next term's classes and running **Enrol section** again — the
displayed semester follows. But there is no fee-gate, no results-gate, no batch
promotion action, and no record of a promotion decision. There is no Semester
field on either the admission form or the student editor.

### 21.2 The section name drifts
As in §3.5 — `CS-1A` keeps its digit for ever. Read the semester from the
student record, never from the section name.

### 21.3 Students cannot register for courses
Enrolment is entirely an admin action (§8.3). There is no add/drop, no course
selection, no prerequisite checking. See Appendix D.

### 21.4 There is no un-enrol
`/api/enrollments` is **read-only**. Enrolment writes exist only as
`POST /api/offerings/:id/enrol` and `POST /api/offerings/section/enrol`, both of
which add. There is no endpoint, and no button, that removes one student from
one class. 15.4 tells you how to test the student-timetable scoping without
one.

### 21.5 The document upload panel over-promises
The student Documents screen offers `.doc .docx .xls .xlsx .csv` and says 10 MB;
the server accepts PDF and images and caps at 8 MB. See 15.7.

### 21.6 Roles with no permissions
HR and Library Staff have accounts and land somewhere, but the backend grants
them nothing. They are placeholders.

### 21.7 Attendance is tied to timetable periods
Deleting a timetable period deletes its attendance. The system refuses the
delete rather than doing this silently (§9.6), but it is the reason the
timetable becomes hard to restructure once a term is under way.

### 21.8 No email delivery
No password reset by email (§1.4), no announcement by email, no fee reminder by
email. Everything is in-app.

---

## 22. A one-hour smoke test

When you do not have a day, this is the shortest path that touches every layer.

| # | Step | Proves |
|---|---|---|
| 1 | Sign in as super admin | Auth, DB connection |
| 2 | Fail a sign-in 3 times on a fake address | Lockout policy, uniform messaging |
| 3 | Create an admin, sign in as them, change the password | Provisioning, forced change |
| 4 | Department → programme → semester → batch → section → room → subject | The whole structure chain |
| 5 | Onboard a teacher, record two qualifications | Teacher provisioning |
| 6 | Admit one student with a guardian | The five-row transaction |
| 7 | Fee structure: three lines | Fee configuration |
| 8 | Create a term, activate it, try to activate a second | The single-active-term rule |
| 9 | Build classes, assign the teacher, enrol the section | Offerings, cohort enrolment, derived semester |
| 10 | Place all three periods | Placement, room-type rule, clash rules |
| 11 | As the teacher: mark a register, create an exam, enter marks, Save Draft | Per-period attendance, the Draft state |
| 12 | As the student: confirm the Result page is empty | The release gate |
| 13 | As the teacher: Submit for Approval | The Verified state |
| 14 | As the admin: publish semester results | GPA arithmetic, mark release, notifications |
| 15 | As the student and the parent: Result, Notifications | The whole downstream chain |
| 16 | Issue a voucher, declare a payment, approve it | The fee lifecycle and the three-number rule |
| 17 | Post a targeted announcement, check it reaches one section and not another | Rule-based audiences |
| 18 | Ask the Data → pin a chart → dashboard | The AI path and the pinned surface |
| 19 | Audit Trail | That all of the above was recorded |

---

## Appendix A — what you enter, and everywhere it shows up

This is the table to put in front of a stakeholder. Left column: the one thing
you type. Right columns: every screen that changes as a result.

| You enter | Admin sees it in | Teacher sees it in | Student sees it in | Parent sees it in |
|---|---|---|---|---|
| **Department** | Academic Structure tiles and tab, Enrolment explorer, Teacher directory filter, Reports | — | — | — |
| **Programme** | Structure, Enrolment, Students filter, Fee structure, Announcement rules | — | Profile | Ward profile |
| **Semester (stage)** | Structure, Subjects, Fee structure, Result publishing, Announcement rules | Marks and exam scoping | Result, My Courses grouping | Results |
| **Batch / Section** | Structure (capacity, free seats), Enrolment, Students, Announcement rules | My Classes, Students | Profile | Ward profile |
| **Room + its type** | Structure, Timetable room picker, Timetable Rooms tab | Timetable | Timetable | Timetable |
| **Subject + credit hours** | Structure, Build classes, Fee structure, Examination | My Classes, Marks, Attendance, Reports | My Courses, Result, Timetable | Results, Timetable |
| **Staff account** | Staff Accounts, User Management, Audit | — | — | — |
| **Teacher onboarding** | Teachers, Department employee count, Qualifications rail, Audit | The whole faculty portal exists | Instructor name on My Courses | Instructor name |
| **Qualification** | Qualifications, the staffing shortlist | — | — | — |
| **Student admission** | Students, Section occupancy, Dashboard tile, Enrolment, Parents, Audit | Students, class rosters | The whole student portal exists | The ward appears |
| **Cohort enrolment** | Enrolment counts, student profile courses, derived semester on the list | My Classes roster, Attendance sheet, Marks sheet | My Courses, Timetable, Result | Timetable, Results |
| **Timetable period** | Timetable grid, Rooms tab, teacher weekly load | Timetable, Attendance day/period | Timetable | Timetable |
| **Attendance mark** | Attendance roster, cohort tiles, monthly trend, AI Insights risk | Dashboard at-risk, trend panels, Reports | Attendance, Dashboard %, notification | Attendance, notification |
| **Exam** | Examination | Marks, Assignments | Notification, Course detail | — |
| **Mark (Draft)** | Result publishing shows it as blocking | Marks sheet | **Nothing** | **Nothing** |
| **Mark (Submitted)** | Result publishing shows `n to release` | Marks sheet | **Nothing** | **Nothing** |
| **Results published** | Examination dashboard, grade distribution, CGPA, pass rate, Audit | Marks sheet turns green | Result, notification | Results, notification |
| **Fee structure line** | Fee structure, voucher default amount | — | — | — |
| **Voucher** | Fee Management, student profile, Reports | — | Fee Management, notification | Fee Details, notification |
| **Payment declaration** | Approvals queue, `totals.pending` | — | Fee Management (balance unchanged) | Fee Details |
| **Payment verified** | Balance, receipt number, collection summary | — | Balance, notification | Balance, notification |
| **Announcement** | Announcements list | Announcements, if in the audience | Dashboard, Notifications, if in the audience | Notifications, if in the audience |
| **Any of the above** | **Audit Trail** | — | — | — |

### The order things must be created in

```
department
  └── programme
        ├── semesters (curriculum stages)
        │     └── subjects
        └── batch
              └── section
                    └── students ──> parents
rooms          (independent, but needed before placement)
teachers ──> qualifications
academic term (the calendar year)
  └── classes = section × subject × teacher
        ├── enrolment  (whole cohort, one action) ──> derived semester
        └── timetable periods
              └── attendance  (per period)
exams ──> marks (Draft ──> Submitted) ──> published results
                                            ├──> marks Released
                                            └──> GPA / CGPA
fee structure ──> vouchers ──> declarations ──> verification
```

---

## Appendix B — managing the two databases

### B.1 Which database am I on?

Check **both** files. They are allowed to disagree, and that is the trap.

| File | Read by | Should say, for this guide |
|---|---|---|
| `AIMS/backend/.env` | The running application | `DB_NAME=aims_test1` |
| `AIMS/database/.env` | `sequelize-cli`, and the scripts below | `DB_NAME=aims_test1` while migrating |

If `database/.env` says `aims_db` and you run `db:migrate`, **you have just
migrated the live database.**

### B.2 Switch back to the live data
Edit **both** files — the backend and the migration tooling must agree:

- `AIMS/backend/.env` → `DB_NAME=aims_db`
- `AIMS/database/.env` → `DB_NAME=aims_db`

Restart the backend. Then re-grant the AI account:
`cd AIMS/database && node scripts/create_ai_readonly_user.js`.

### B.3 Start the test database over
When you want a clean slate:

```bash
cd AIMS/database
mysql -u <user> -p -e "DROP DATABASE IF EXISTS aims_test1; CREATE DATABASE aims_test1 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u <user> -p aims_test1 < schema.sql
mysql -u <user> -p aims_test1 < constraints.sql
mysql -u <user> -p aims_test1 < reference_data.sql
DB_NAME=aims_test1 node scripts/create_first_admin.js --password '<choose one>'
```

That drops `aims_test1`, rebuilds its structure, restores the reference data
(`roles`, `permissions`, `role_permissions`, `grades`) and the migration ledger,
and creates one super admin. It takes about a minute.

**Stop the backend first** — its connection pool holds handles to the database
being dropped.

`create_first_admin.js` refuses to run against a database that already holds a
user, so it cannot quietly add a second administrator to a working system. It
sets `must_change_password = 1`, because the password you typed is in your
shell history.

### B.4 Backup and restore
Take a full backup before anything destructive:

```bash
cd AIMS/database
DB_NAME=aims_db node scripts/backup_database.js
```

It writes a timestamped `.sql` file into `database/backups/`. That folder is
**git-ignored on purpose** — the dumps carry real student and staff personal
data and must never be committed.

To restore one into a scratch database (never over the live one):

```bash
cd AIMS/database
node scripts/restore_database.js <path-to-backup.sql> <some-new-db-name>
```

### B.5 If the schema changes
Re-generate the schema files from whichever database is authoritative, then
rebuild the test database from them:

```bash
cd AIMS/database
DB_NAME=aims_db node scripts/generate_schema_from_live.js   # schema.sql + constraints.sql
DB_NAME=aims_db node scripts/generate_erd_dbml.js           # AIMS_ERD.dbml.txt
```

Both are read-only against the server. Note the explicit `DB_NAME=` — without
it they read `database/.env`, which is usually pointed at the test database.

---

## Appendix C — every URL, all four portals

### Sign-in
| Portal | URL |
|---|---|
| Chooser | `/choose-portal` |
| Admin | `/sign-in/admin` |
| Faculty | `/sign-in/faculty` |
| Student | `/sign-in/student` |
| Parent | `/sign-in/parent` |
| Forced password change | `/change-password` |
| Forgot password | `/forgot-password` |

### Admin (`ADMIN_NAV`)
| Section | Module | URL |
|---|---|---|
| MAIN | Dashboard | `/dashboard` |
| ACADEMIC | Students | `/students` |
| | Student profile *(no sidebar entry)* | `/students/:studentId` |
| | Enrolment | `/enrollment` |
| | Attendance | `/attendance` |
| | Fee Management | `/fee-management` |
| | Examination | `/examination` |
| | Parents | `/parents` |
| | Academic Structure | `/academic-structure` |
| | Timetable | `/timetable` |
| FACULTY | Teachers | `/teachers` |
| | Qualifications | `/qualifications` |
| INSIGHTS | AI Insights | `/ai-analytics` |
| | Ask the Data | `/ask-the-data` |
| | Reports | `/reports` |
| ADMIN | Announcements | `/announcements` |
| | Notifications | `/notifications` |
| | Staff Accounts | `/staff-accounts` |
| | User Management | `/user-management` |
| | Audit Trail | `/audit` |
| | Settings | `/settings` |

### Faculty
| Module | URL |
|---|---|
| Dashboard | `/faculty/dashboard` |
| My Classes | `/faculty/my-classes` |
| One class | `/faculty/my-classes/:subjectId/:sectionId` |
| Attendance | `/faculty/attendance` |
| Marks | `/faculty/marks` |
| Assignments | `/faculty/assignments` |
| Students | `/faculty/students` |
| Reports | `/faculty/reports` |
| Ask the Data | `/faculty/ai-analytics` |
| Timetable | `/faculty/timetable` |
| Announcements | `/faculty/announcements` |
| Notifications | `/faculty/notifications` |
| Users *(read-only, no sidebar entry)* | `/faculty/users` |
| Profile | `/faculty/profile` |
| Settings | `/faculty/settings` |

### Student
| Module | URL |
|---|---|
| Dashboard | `/student/dashboard` |
| My Courses | `/student/my-courses` |
| One course | `/student/my-courses/:courseCode` |
| Attendance | `/student/attendance` |
| Results | `/student/result` |
| Fee Management | `/student/fee-management` |
| Timetable | `/student/time-table` |
| Documents | `/student/document` |
| Profile | `/student/profile` |
| Notifications | `/student/notifications` |

### Parent
| Module | URL |
|---|---|
| Dashboard | `/parent/dashboard` |
| My Children | `/parent/my-children` |
| Attendance | `/parent/attendance` |
| Timetable | `/parent/timetable` |
| Results | `/parent/results` |
| Fee Details | `/parent/fees` |
| Notifications | `/parent/notifications` |
| Profile | `/parent/profile` |

### The API behind it, by area
| Area | Mount |
|---|---|
| Auth | `/api/auth` |
| Users, avatars, preferences, unlock | `/api/users` |
| Students, documents | `/api/students` |
| Parents | `/api/parents`, `/api/parent` |
| Structure | `/api/departments` `/api/programs` `/api/batches` `/api/sections` `/api/semesters` `/api/classrooms` `/api/subjects` `/api/academics` |
| Terms, offerings, scheduling | `/api/terms` `/api/offerings` `/api/scheduling` |
| Timetables | `/api/timetables` |
| Enrolments *(read-only)* | `/api/enrollments` |
| Attendance | `/api/attendance` |
| Exams, marks, results | `/api/exams` `/api/marks` `/api/results` `/api/student-results` `/api/gpa` |
| Teachers | `/api/teachers` `/api/teacher-subjects` `/api/teacher-assignments` `/api/teacher-profiles` `/api/teacher-dashboard` `/api/teacher-schedules` |
| Faculty portal | `/api/faculty` |
| Admin portal | `/api/admin` |
| Fees | `/api/fee-structures` `/api/fee-vouchers` `/api/fee-payments` `/api/fee-reports` |
| Search, summaries | `/api/search` `/api/summaries` |
| Notifications, announcements | `/api/notifications` `/api/announcements` |
| AI | `/api/analytics` `/api/chatbot` |

### Accounts you will have created
| Role | Email | Password |
|---|---|---|
| Super Admin | `superadmin@aims.edu.pk` | *(the one you chose in §0.1, then changed at first sign-in)* |
| Admin | `imran.sheikh@aims.edu.pk` | *(as issued, then changed)* |
| Teacher | `ayesha.khan@aims.edu.pk` | *(as issued, then changed)* |
| Student | `bilal.ahmed@aims.edu.pk` | *(as issued, then changed)* |
| Parent | `tariq.ahmed@example.com` | *(as issued, then changed)* |

> Every account in this system is created with a password somebody else issued,
> and every one of them is forced to change it at first sign-in. Record what you
> set as you go — nothing here writes credentials to a file.

---

## Appendix D — what student course registration would take

Requested as a scope note, not built.

**What exists:** `enrollments` already carries `(student, subject, semester,
offering)`, so the table can represent a student-chosen enrolment. What is
missing is everything around it.

**What would be needed:**

1. **A student-scoped read** — offerings open to *this* student's programme and
   semester, with seats remaining. No endpoint answers that today.
2. **An add/drop endpoint** authorised so a student can only enrol *themselves*.
   Every write endpoint on offerings is currently admin-only, and there is no
   un-enrol endpoint at all (§21.4).
3. **Capacity enforcement** against both `sections.capacity` and the room, at
   the moment of enrolling rather than when the timetable is built.
4. **Prerequisites.** `subjects.prerequisite_subject_id` exists but nothing
   reads it. There are no credit-hour limits per semester either.
5. **An add/drop window** on `academic_terms` — dates outside which the student
   cannot change anything.
6. **A decision on approval** — does an advisor confirm, or is it immediate?

**What it would break.** Cohort auto-enrol assumes every student in a section
takes the same classes, and the timetable is built on that assumption: one
period, one section, one room. Once students choose individually, "the section's
timetable" stops being meaningful and clashes become per-student. That is the
real cost — not the endpoints, the scheduling model underneath them.

It would also unsettle the derived semester (§5.1), which reads the highest
non-dropped enrolment: a student registered across two stages would need a rule
for which one they are "in".

**Recommendation:** decide this before building the promotion workflow (§21.1),
because they touch the same rows.
