---
title: What the AI Assistant Can and Cannot Do
audience: all
---

# The AIMS AI Assistant

## What it is

An assistant built into AIMS that answers questions about your own academic
information and about how the system works. It reads live data — the figures it
gives you are the same ones your portal shows, not a cached copy.

## Who can use it

There are two AI services and they have different role lists, which is the most
common source of confusion.

The **help assistant** — the chat button in the corner of every screen —
explains how AIMS works from official documentation. It has no database access
at all. Administrators, teachers, students and **parents** can use it. Because
it never reads a record, there is no scope to get wrong, which is why parents
are included here.

**AI Analytics** answers questions about actual records and returns tables and
charts. Administrators and teachers only, each restricted to what their role may
already see. Parents, HR, Accountant and Library accounts cannot reach it: each
would need its own correctly-scoped access built first, and answering from the
wrong scope is worse than not answering.

So a parent can ask "why can I not see my child's marks" and get a proper
explanation, but must open the portal to see the marks themselves.

## What it can do

**Everyone** — explain how AIMS works, where to find a screen, and what a
policy or procedure says, based on official documentation.

**Students** — your own attendance, marks, GPA and CGPA, timetable, exams, fee
balance, and enrolled subjects.

**Teachers** — your class rosters, class attendance and performance, marks
sheets, at-risk students, your schedule and workload — all limited to the
classes on your timetable.

**Administrators** — institute-wide statistics: enrolment, fee collection and
defaulters, attendance by programme, result distributions, teacher workload,
and student lookups.

## What it cannot do

**It cannot change anything.** It reads through a database account that holds
read permission only. It cannot mark attendance, enter or publish marks, record
a payment, reset a password, or edit any record. This is enforced by database
privileges, not by instructions, so it is not something that can be talked
around.

**It cannot exceed your access.** A student reaches their own records only; a
teacher reaches their own classes only. Your permissions are resolved from the
database on every question, so an assignment that changed a minute ago is
already reflected.

**It cannot read certain data at all.** Password hashes, CNIC and B-Form
numbers, employee salaries, payroll, stored document files, and other users'
conversations are unreadable to it regardless of who is asking.

**It will not invent an answer.** Every figure comes from a lookup. If nothing
matches, it says so. If the documentation does not cover something, it says it
could not be verified rather than guessing. If a result has not been published,
it says that instead of reporting no marks.

## Asking good questions

Plain English works. Be specific about the subject, semester or date range when
it matters.

Good: *"What is my attendance in Database Systems this semester?"*
Good: *"Which students in CS202 section A are below 75%?"*
Good: *"How many students are enrolled in each programme?"*

## Things it will decline

- Another person's records
- Anything outside your role's access
- Requests to change data
- Instructions to ignore its rules, adopt another role, or reveal its
  configuration — these are treated as ordinary messages and do not change what
  your account can reach

## If it gets something wrong

The database is the authority. If an answer disagrees with your portal, trust
the portal and report it. The assistant records every lookup it performs, so a
disputed answer can be traced back to exactly what was read.
