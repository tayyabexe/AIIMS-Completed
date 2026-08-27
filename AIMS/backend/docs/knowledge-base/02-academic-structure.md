---
title: Academic Structure
audience: all
---

# How AIMS is organised

Six levels, each contained by the one above it.

```
Department  →  Programme  →  Semester  →  Subject
                   ↓
                 Batch  →  Section  →  Student
```

## Department

The top-level academic unit. Each has a name and may have a head of department.

## Programme

A degree, belonging to one department — BS Computer Science, BS Software
Engineering, BS Data Science, BS Electrical Engineering, BBA Honors. Each
programme declares its **duration in semesters**.

## Semester

A numbered term within a programme, with a start and end date. Semesters belong
to a specific programme, so "Semester 4" of Computer Science is a different
record from "Semester 4" of Electrical Engineering.

A semester can be **archived** once it is over. Archived semesters remain
readable for historical results.

## Subject

A course taught in one semester of one programme. Each subject has:

- a **subject code**, unique across the institute (e.g. `CS202`, `EE-403`)
- a **name**
- **credit hours**
- optionally a **prerequisite subject**

Because a subject belongs to a semester, and a semester to a programme, the
curriculum is fully determined: the subjects of Semester 5 of a programme are
the subjects whose `semester_id` points at that semester.

## Batch

An intake year group within a programme, with a start and end year — for
example the 2022–2026 cohort. Batches let two groups study the same programme
on different timelines.

## Section

A subdivision of a batch, used to split a large intake into teachable class
sizes. Sections carry a name (`CS-4A`, `EE-4A`) and a capacity, defaulting to 40.

A section is what a timetable schedules and what a teacher stands in front of.

## Classroom

A physical room with a name, building and capacity. The timetable enforces that
a room, a section and a teacher can each only be in one place per time slot —
three separate uniqueness rules that prevent double-booking.

## Soft deletion

Most academic records are never truly deleted. They carry an `is_deleted` flag,
so historical results and attendance keep pointing at a subject or section that
has since been retired. Anything the assistant reports already excludes
soft-deleted records.
