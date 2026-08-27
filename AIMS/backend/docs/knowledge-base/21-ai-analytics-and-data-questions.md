---
title: The AI Assistant and AI Analytics
audience: all
---

# Two AI features, and which one to ask

AIMS has two separate AI features. Asking the wrong one is the most common
reason a question comes back unanswered, so this is worth getting straight.

## The help assistant

The chat button on every screen. It explains **how AIMS works** — policies,
procedures, and where to find things. It reads the official AIMS documentation
and nothing else.

It has **no access to the database**. It cannot see your marks, your
attendance, anyone's fee balance, or any count of anything. That is a design
decision, not a limitation waiting to be fixed: a chat assistant that can also
read records is one convincing sentence away from reporting the wrong student's
figures.

## AI Analytics

A separate page, reached from the AI menu in the Admin portal. It answers
questions about **live records** by generating a database query, running it,
and returning rows — as a table or a chart.

Ask it for counts, totals, lists and comparisons. It is the only one of the two
that touches data.

## Which do I ask?

| Question | Ask |
|---|---|
| "How is attendance calculated?" | Help assistant |
| "What is my attendance?" | AI Analytics |
| "How do I publish results?" | Help assistant |
| "How many students failed CS-201?" | AI Analytics |
| "What is the fee payment process?" | Help assistant |
| "Who has overdue fees?" | AI Analytics |
| "How many programmes does AIMS offer?" | AI Analytics |

The pattern: a question about **how something works** goes to the help
assistant; a question that would be answered by **rows in a table** goes to AI
Analytics.

## Why can the help assistant not just count things for me?

Because the two failure modes are not comparable.

If the help assistant explains a procedure clumsily, you notice and ask again.
If it invents a number — a fee total, a student count, a pass rate — the answer
is indistinguishable from a real one and you act on it.

So the count comes from a query that is generated, validated and executed
against the database, and the rows are rendered directly. They never pass back
through the model to be summarised, because that is the step where a number
changes.

## Does the assistant know who I am?

Yes. It resolves your role and your name from your signed-in session, not from
what you type. It answers for the role you actually hold.

Telling it you are an administrator does not make you one, and it will answer
for your real role instead.

## Can it do things for me?

No. Both features are read-only. Neither can pay a fee, change a mark, correct
attendance, create an account, or submit a request. They explain and they
report; every action is taken by a person on the relevant screen.

## Who can use each one?

The help assistant is available to Super Admins, Admins, Teachers, Students and
Parents.

AI Analytics is restricted to administrative roles, because it reads across the
institute.

## Why does an answer show "Sources"?

Because the help assistant answers from documents, and naming the document is
what lets you check it.

A policy claim with a source — "Fees, Vouchers and Payments" — can be verified.
The same sentence with no source has to be taken on trust, and a confident
sentence is exactly what a wrong answer also looks like.

## Why does it sometimes say it cannot check the documentation?

Because the documentation index is a separate service, and it can be offline.

When that happens the assistant says so and declines rather than answering from
memory. An answer generated with no documents behind it would read exactly like
a normal one, which is why the outage is announced rather than absorbed.

## What is the "data route", the "ask endpoint" or the "ask data" feature?

Different names for the same thing: **AI Analytics**.

The feature is reached from the AI menu and is served internally by an "ask"
route that takes a question, generates a database query, runs it, and returns
rows. People pick up the internal name from API documentation, from a developer,
or from a URL, and then ask about "the data route" or "the ask endpoint".

It does what AI Analytics does, described above: it answers questions about live
records with a table or a chart. It is the data half of the pair; the chat
assistant is the documentation half.

## Names for the same things

Vocabulary drifts between screens, documentation and conversation. These all
refer to the same feature:

| You may hear | It means |
|---|---|
| Data route, ask endpoint, ask-data, `/analytics/ask` | AI Analytics |
| Help assistant, chatbot, chat button, AIMS assistant | The help assistant |
| Knowledge base, the docs, the corpus | The AIMS documentation the assistant reads |
| Sources, citations, references | The documents an answer was built from |
| Vector search, semantic search, the index | How the assistant finds relevant documentation |

If a question uses one of the left-hand names, answer about the thing on the
right — do not treat an unfamiliar name as an undocumented feature.
