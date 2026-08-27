---
title: What an Administrator Cannot Do, and Why
audience: staff
---

# Limits that apply even to administrators

Administrators have institute-wide read and write. These are the things that
remain out of reach, and each one is a deliberate design decision rather than a
missing feature.

## Can I read back a user's password?

No. Not as an Admin, not as a Super Admin, not through any screen or route.

Passwords are stored as bcrypt hashes. There is no plaintext to retrieve — the
value simply does not exist anywhere in the system. Any procedure that claims
to recover one is describing something AIMS does not do.

**What to do instead:** send the user to **Forgot Password**, or reissue
credentials from **Admin → Users**. Reissuing generates a new password, shows
it once, and forces a change at next sign-in.

## How do I reset a student's password?

You issue a new one; you do not reset the old one. Prefer Forgot Password
wherever the student can still receive email — reissuing puts a password
through a second person, and the account then carries a credential someone
other than its owner has seen.

## Can I mark attendance for a teacher?

No. The attendance record belongs to the subject teacher who takes the class.
Administrators oversee attendance and report on it institute-wide, but do not
mark or amend it.

A teacher who has not marked a session is chased, not overridden.

## Can I enter marks?

No. Marks are entered and verified by the subject teacher. The administrative
role in examinations is scheduling and **publishing**, not marking.

## Can I delete an audit log entry?

No. The log is append-only and there is no route behind the screen. A
correction is a new entry.

## Can I delete my own account, deactivate it, or change my own role?

No to all three. Each locks you out, and the record that would undo it is the
one you just changed.

Editing your own name, phone or email is allowed.

## Can I edit or delete a Super Admin?

Only if you are one. And the **last remaining** Super Admin cannot be
deactivated or demoted by anyone, including themselves — an institute with zero
Super Admins has no way back.

## Can I promote myself to Super Admin?

No. Promoting someone to Super Admin and editing a Super Admin are treated as
the same act, approached from opposite ends, and both are refused to
non-Super-Admins.

## Can I reuse a deleted account's email address?

No. The deleted row still holds it, and reusing it would attach one person's
history to another.

## Can I edit a fee voucher a student has already seen?

Cancel it and issue a correct one instead. Editing an amount a student may have
already paid against leaves a payment reconciling against nothing. Both actions
are audited.

## Can I hard-delete a student?

Prefer deactivation. A student who owns attendance, marks, vouchers and audit
entries should stop being active, not vanish and leave those rows pointing at
nothing.

## Why do these limits exist for a role with full access?

Because "full access" is about breadth, not about bypassing the record. The
limits above fall into three groups:

- **Cryptographic** — a hashed password cannot be un-hashed by anyone.
- **Ownership** — the person who made a record is the person who corrects it,
  so accountability stays where the knowledge is.
- **Self-lockout and tamper** — a system where the audit log is editable by the
  people it audits records nothing worth having.
