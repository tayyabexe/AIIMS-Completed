---
title: Audit Logs
audience: staff
---

# Audit logs

## What the audit log records

Administrative actions: who did what, to which record, and when. Reached at
**Admin → Audit Logs**.

Each entry carries the actor, the action, the module, the entity affected, and
the state after the change. Where a change replaced an existing value, the
prior state is recorded too, so an entry answers "what did this actually
change" rather than only "something was changed".

## What it does not record

- **Reads.** Viewing a record is not logged. The log is about change.
- **Passwords.** Anything password-shaped is stripped before the entry is
  written. A credential reissue is logged as having happened; the password it
  produced is not in the log, and never was.
- **Ordinary academic entry.** A teacher marking attendance for their class is
  routine work, not an administrative action.

## Can an entry be deleted or edited?

No. The audit log is append-only by design. There is no delete on the screen
and no route behind it — a log that the powerful can edit records nothing
useful about the powerful.

If an entry is wrong, the correction is a new entry, not an amendment.

## What gets logged

Broadly, anything that changes who can do what or what a record says at the
administrative level:

- Account creation, deactivation, role change and credential reissue
- Student admission and teacher onboarding
- Enrolment, section, batch and programme changes
- Result publication
- Fee structure changes, voucher generation, payment verification
- Deletion or restoration of a record

## Reading the log

Filter by actor, module, action and date range. Entries are newest first.

An entity reference like `users#412` names the table and the row, so an entry
can be traced to the record it touched even after that record has changed
again.

## Why is a self-registration attributed to the account it created?

Because the registration route is unauthenticated — there is no other actor to
name. Attributing it to the new account is a true statement about a
self-registration, and it keeps the entry insertable against a column that
cannot be null.

## Common questions

**Who can read the audit log?** Administrative roles. It is not visible to
teachers, students or parents.

**How long is it kept?** Retention is an institutional policy decision, not an
AIMS setting. Confirm it with the administration office.

**Can I export it?** Where the screen offers an export, it exports the filtered
view, like any other report.

**Someone changed a record and I need to know who.** Filter by module and date
range, then by entity. If nothing appears, the change was not an administrative
action — a mark or an attendance correction is made by the subject teacher on
their own screen.
