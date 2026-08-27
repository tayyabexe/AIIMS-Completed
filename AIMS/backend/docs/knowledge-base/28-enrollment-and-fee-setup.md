---
title: Enrolment Operations and Fee Setup
audience: staff
---

# Enrolment operations and fee setup

Administrative procedure. The student-facing rules are in *Admissions and
Enrolment* and *Fees, Vouchers and Payments*.

## Enrolment

**Admin → Enrolment**. Enrolment attaches a student to the subjects of a
semester. Until it exists, that student has no attendance to mark, no marks to
enter, and no rows on any report for that subject.

Enrolment is per student, per subject, per semester. A student's section
determines which timetable rows apply to them; enrolment determines which
subjects are theirs.

## Enrolling a cohort

Enrol by batch and section for a semester rather than one student at a time.
The screen offers the subjects attached to that semester, so the common case —
a whole section taking the same subject list — is one action.

Enrolling someone already enrolled is rejected rather than duplicated.

## Why a student sees no subjects

In order of likelihood:

1. They are not enrolled for the current semester
2. The semester itself is not the current one
3. Their section has no timetable rows for those subjects

The first is by far the most common at the start of a term.

## Moving a student between sections

Change the section on the student record. Attendance and marks already recorded
stay attached to the student, not to the section, so history is not lost.

What does change is which timetable applies to them from that point on.

## Fee structures

**Admin → Fees → Structures**. A fee structure is the template: what is
charged, to whom, for which semester. It is not a bill.

Defining a structure charges nobody. It becomes real when vouchers are
generated from it.

## Generating vouchers

From a structure, for a semester and a cohort. Each voucher gets a number, an
issue date, a due date, and a total payable.

Generation is the point of no return in the sense that matters: from here a
student owes money, sees a balance, and can be counted as a defaulter after the
due date. Check the structure before generating, not after.

## Payments and verification

A student pays through the channel printed on the voucher. The accounts office
then records and **verifies** the payment.

Between those two moments the payment shows as **pending** — not unpaid, and
not paid. A pending amount is not counted as outstanding. Students ask about
this constantly and it is normal, not an error.

Currency throughout AIMS is **PKR**.

## Adjusting a voucher

A voucher that was generated wrongly is cancelled rather than edited, and a
correct one issued. Editing an amount a student has already seen — and may
already have paid against — leaves a payment that reconciles against nothing.

Cancellation and reissue are both written to the audit log.

## Common questions

**Can a teacher see fee records?** No. Teachers receive an error on fee
endpoints by design.

**Can a student pay inside AIMS?** No. AIMS records payment; it does not take
it.

**Why is a paid voucher still showing a balance?** The payment is almost
certainly pending verification. Check the payment trail on the voucher.

**Can I generate vouchers twice for the same semester?** You can, and you will
get two sets. Check before generating.
