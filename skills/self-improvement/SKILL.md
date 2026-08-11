---
name: self-improvement
category: agent
summary: identify a durable correction and offer an explicit /learn command
description: Identify a durable correction to Sherman's behavior and offer a shell-validated /learn command for the operator to enter. Never write shared memory directly.
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

Identify the durable lesson, but do not persist it yourself. Offer one complete
`/learn <name> | <lesson>` command for the operator to review and enter.

`/learn <name> | <lesson>` is explicit-only; exit runs the read-only eval but
never starts an authoritative retention command. No model rereads the session or
generates the lesson. The shell validates the complete operator-provided text,
normalizes surrounding whitespace and a final newline, and confines an accepted
file to shared memory.

Do not use it for:

- what you were asked to do — that is a task, not a lesson
- a fact about the company — that is `vault-write`
- the fact that a session happened
- anything a fresh Sherman would already know from `SYSTEM.md`. Restating the
  operating contract back into the vault dilutes it.

## The test

Recommend it only if it would change what a Sherman who never saw this session
would DO. If the lesson cannot be stated as a behavior, it is an observation,
and observations do not go in the vault.

Weak: "The operator prefers concise answers."
Strong: "Weekly ops summaries open with the exception list, not the totals —
the totals are already on the dashboard."

## How

1. **Search first.** If a lesson already exists, propose its filename so the
   operator intentionally replaces it rather than creating a duplicate.
2. **One lesson per command.** Name it for the behavior it changes, not for the
   session it came from — `weekly-ops-summary-opens-with-exceptions`, never
   `session-notes-july-28`.
3. **State the correction, not the conclusion alone.** Explain what to do and
   why, without quoting the session.
4. **Offer the command; do not execute it.** Never write directly to
   `vault/memory/shared/`, invoke `vault-write`, or claim the lesson was saved.

## What must never go in

The session log holds whatever was typed, and that may include things the vault
must never hold. A lesson is written in your own words about your own conduct —
never by quoting the conversation.

Never carry patient-identifying data into a lesson, in any form, including as an
illustrative example. If the correction concerned a request that contained PHI,
record the *shape* of the lesson and state that the specifics were omitted for
that reason. See `phi-boundary`.

## Stored form

The shell stores only the complete lesson the operator submits, normalized for
surrounding whitespace and a final newline. It does not append attribution or
other model-authored metadata, so include any durable context that belongs in
the fact itself before offering the command.
