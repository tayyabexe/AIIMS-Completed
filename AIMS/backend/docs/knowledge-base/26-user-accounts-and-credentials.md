---
title: User Accounts, Provisioning and Credentials
audience: staff
---

# User accounts, provisioning and credentials

Administrative procedure. This document describes what administrators do; the
rules students and teachers need are in *Accounts, Credentials and Passwords*.

## What an account is

A row in `users`: an email, a hashed password, a role, and a display name. Most
accounts also have a **person record** — a student, an employee or a parent —
holding the fuller detail.

Administrator accounts are the exception. An admin may have no employee record
at all, which is why the account itself carries a name.

## Admitting a student

**Admin → Students → Admit**. One action creates, in a single transaction:

- the student's login, with a generated password
- the student record, with a registration number
- the parent's login and record, if a parent email was supplied
- the link between student and parent

If the parent's email already belongs to a parent account, that account is
**linked** to the new student rather than duplicated, and its password is left
untouched. A parent with two children at the institute keeps one login and sees
both. The response says which happened, so you know whether there are parent
credentials to hand over.

## Onboarding a teacher

**Admin → Teachers → Onboard**. Creates the login, the employee record and the
teacher record together, and optionally assigns classes.

A teacher is three rows: `users` for the login, `employees` for the HR detail,
`teachers` for the academic detail. Creating them separately is how you end up
with an employee who cannot teach or a teacher with no personnel file.

## Creating an administrator

**Admin → Users**. Requires a first and last name and a role.

A department is **optional**, and this matters: without one, no employee record
is created, and the account's own name field is the only place the person's
name exists. Always supply the name — an account created without one is
displayed by whatever can be derived from its email address, which is how
administrators end up being greeted by a mangled version of their login.

## Generated credentials

A password generated here is shown **once**, on screen, to the administrator
who created the account. It is not stored in readable form and it is not in the
audit log — the log strips anything password-shaped.

The account is flagged to change it at first sign-in, and the flag clears when
they do. That flag is what distinguishes a password a second person has seen
from one the user chose.

## Reissuing credentials

**Admin → Users → Reissue**, when a user cannot receive the reset email.

Reissuing generates a new password and re-raises the change-at-next-sign-in
flag. It does not recover the old one, because nothing can: passwords are
hashed, and no role — including Super Admin — can read one back.

Prefer **Forgot Password** wherever the user can still receive email. Reissuing
puts a password through a second person.

## Deactivating an account

Deactivating blocks sign-in and leaves every record intact. Prefer it to
deletion: an account that owns marks, attendance or audit entries should stop
working, not vanish.

You cannot deactivate your own account, or change your own role. The row that
would undo it is the one you just changed.

## Super Admin protections

- A Super Admin cannot be edited or deleted by a non-Super-Admin
- Nobody can promote themselves to Super Admin
- The last remaining Super Admin cannot be deactivated or demoted

These are enforced by the server, not by the screen.

## Common questions

**Can I see a user's password?** No. Nobody can. Reissue instead.

**Can I change someone's email?** Yes, from the account screen. It must be
unique, and it becomes their sign-in name immediately.

**Why can a deleted account's email not be reused?** The old row still holds
it, and reusing the address would attach an existing history to a new person.

**Does an admin's name change follow through everywhere?** Yes — it is written
to the account as well as to the employee record, so the portal and the AI
assistant both pick it up.
