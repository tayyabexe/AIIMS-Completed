---
title: Timetables and Classrooms
audience: all
---

# Timetables and classrooms

## What a timetable row is

One scheduled session: a **subject**, taught to a **section**, by a **teacher**,
in a **classroom**, on a **day**, from a start time to an end time.

Days run **Monday to Saturday**. There is no Sunday scheduling.

## The timetable defines who teaches whom

This is worth stating plainly, because a great deal follows from it. A teacher's
classes are their timetable rows. That determines:

- which rosters they can open
- whose attendance they can mark
- whose marks they can enter
- which students the AI assistant will discuss with them

A teacher with no timetable rows has no classes, and the assistant will say so
rather than reporting that no data exists.

## Three anti-clash rules

The database enforces that, for any given day and start time:

1. a **classroom** hosts one session
2. a **section** attends one session
3. a **teacher** takes one session

Any attempt to double-book is rejected at save time, not discovered later.

## Viewing a timetable

- **Students** — *Student → Timetable*. Their own section's weekly schedule.
- **Teachers** — *Faculty → Timetable*. Their own teaching schedule.
- **Admins** — *Admin → Academics*. Any section, plus scheduling itself.

## Classrooms

Each has a room name, a building and a capacity. A classroom can be retired,
in which case sessions scheduled in it remain on the timetable with the room
shown as unavailable rather than disappearing.

## Teacher workload

Derived from the timetable: weekly sessions, distinct subjects, distinct
sections, and total contact hours. Admins can compare workload across staff and
by department; a teacher can see their own.

## Changing the timetable

Scheduling is an administrative function. Teachers and students cannot alter it.
A clash or an error should be reported to the administration office.

## Common questions

**My timetable is empty.** Either your section has no schedule entered for this
term, or you are not assigned to a section. The administration office can
confirm.

**A room changed but the timetable is stale.** Timetables are read live — what
the portal shows is what is recorded. If it is wrong, the record is wrong, and
the administration office needs to correct it.
