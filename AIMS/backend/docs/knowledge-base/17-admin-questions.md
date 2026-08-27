---
title: Common Administrator Questions
audience: staff
---

# Common administrator questions

## How do I get a list of fee defaulters?

Two routes, and they answer different needs:

- **Fees** (`/admin/fees`) for the working view — vouchers, balances, payment
  verification, and who is outstanding right now.
- **Reports** (`/admin/reports`) for an exportable list to send on or file.

For an ad-hoc question — a specific programme, batch or threshold — use the **AI
Analytics** page, which runs the query against live data and returns rows. The
help assistant in the chat widget cannot produce that list itself; it has no
database access and will point you at Analytics.

## Where do I find the AI features?

There are two, and they are deliberately separate:

- The **help assistant** is the chat button on every admin screen. It explains
  how AIMS works — policies, procedures, where a screen is. It has no database
  access at all.
- **AI Analytics** answers questions about actual records and returns tables and
  charts.

If you ask the chat assistant for data, it will tell you to use AI Analytics.
That is the split working, not a failure. See *What the AI Assistant Can and
Cannot Do*.

## How do I change a user's password?

You cannot read or set anyone's existing password — passwords are stored hashed
and no role can retrieve them.

What you can do from **Students** (`/admin/students`) or **Teachers**
(`/admin/teachers`) is **reissue credentials**, which issues a fresh temporary
password. The user is then forced to change it on first sign-in.

For your own password: **Profile → Change Password** in the admin portal.

## How do I add a student?

**Students** (`/admin/students`), which covers admissions, student records and
credential reissue. See *Admissions and Enrollment*.

## How do I enroll students in subjects?

**Enrollment** (`/admin/enrollment`), which controls subject enrolment per
semester. Programmes, batches, sections, semesters and subjects themselves are
managed under **Academics** (`/admin/academics`).

## How do I publish results?

**Examination** (`/admin/examination`), which covers exam scheduling and result
publication. Publication is what makes marks visible to students and parents —
until then they are Draft or Verified and are not released.

## How do I see who changed something?

**Audit Logs** (`/admin/audit-logs`). Administrative actions are recorded there,
including mark corrections made after publication.

## What reports can I export?

**Reports** (`/admin/reports`) generates exportable operational reports across
attendance, results, fees and enrolment. See *Admin Portal Guide*.

## Why does the assistant refuse to give me data when I am an admin?

Because it is the wrong service, not because of your permissions. The chat
assistant is a documentation assistant with no database tools compiled into it
— there is no query it could run for anyone. AI Analytics is the service with
data access, and as an admin you are unrestricted there.

## Can the assistant change anything?

No. Both AI services are read-only. The analytics side connects through a
database account that has no write permission at all, so a request to update,
delete or insert cannot succeed even if it were somehow generated.

## A parent is asking for their child's marks. What can they see?

A linked parent sees published results, attendance, fees, timetable and
notifications for their own children only. They do not see unpublished marks.
See *Parent Portal Guide*.
