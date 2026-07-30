---
name: self-improvement
category: agent
summary: record a durable lesson about how Sherman should work, learned from being corrected
description: Record a durable lesson about how Sherman should work, learned from being corrected. Use when the user corrects Sherman's behavior, a format it used, or a fact it asserted.
---

# Record what you learned about working here

Sherman's knowledge of the company lives in the vault. So does Sherman's
knowledge of *how to work here* — and that second kind only ever comes from
being corrected.

A model that is corrected and forgets makes the same mistake next week, and the
person who corrected it stops bothering. This skill is how a correction
survives the session it happened in.

## When to use it

Use it when the session produced a durable lesson about Sherman's own conduct:

- a correction to how you answered — you asserted a company fact without
  checking the vault, or cited the wrong file
- a preference stated about form, not content — how a report should open, what
  the operator never wants to see again
- a repeated question, which means the vault is thin somewhere and the gap is
  worth naming
- a refusal that turned out to be wrong, or one that turned out to be right for
  a reason worth writing down

Do not use it for:

- what you were asked to do — that is a task, not a lesson
- a fact about the company — that is `vault-write`
- the fact that a session happened
- anything a fresh Sherman would already know from `SYSTEM.md`. Restating the
  operating contract back into the vault dilutes it.

## The test

Write it only if it would change what a Sherman who never saw this session
would DO. If the lesson cannot be stated as a behavior, it is an observation,
and observations do not go in the vault.

Weak: "The operator prefers concise answers."
Strong: "Weekly ops summaries open with the exception list, not the totals —
the totals are already on the dashboard."

## How

1. **Search first.** A lesson that contradicts one already recorded is the more
   important write: correct the old file rather than adding a second one that
   disagrees with it. Two files disagreeing about how to work here is worse
   than neither.
2. **One lesson per file**, in `vault/memory/shared/`. Name it for the behavior
   it changes, not for the session it came from — `weekly-ops-summary-opens-
   with-exceptions.md`, never `session-notes-july-28.md`.
3. **Record the correction, not the conclusion alone.** What was done, what was
   wrong with it, what to do instead. The reasoning is what lets a later
   Sherman tell whether the lesson still applies.
4. **Say you wrote it**, and where, so the operator can disagree.

## What must never go in

The session log holds whatever was typed, and that may include things the vault
must never hold. A lesson is written in your own words about your own conduct —
never by quoting the conversation.

Never carry patient-identifying data into a lesson, in any form, including as an
illustrative example. If the correction concerned a request that contained PHI,
record the *shape* of the lesson and state that the specifics were omitted for
that reason. See `phi-boundary`.

## Attribution

A lesson is a claim about how this company wants its work done, so it carries
the same attribution the vault uses elsewhere: who corrected you, the session
id, and the date. A lesson nobody can trace is a lesson nobody can overturn.
