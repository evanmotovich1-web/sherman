---
name: sop-draft
category: documents
summary: draft or revise a standard operating procedure in the company's own shape
description: Draft or revise a standard operating procedure in the company's own shape. Use when someone needs a procedure written down or an existing SOP brought up to date.
---

# Draft or revise an SOP

Use this when someone needs a procedure written down, or an existing one
brought up to date.

## Before drafting

Search the vault for two things:

1. **An existing SOP on this topic.** If one exists, this is a revision, not a
   new document. Revise it in place and say what changed and why.
2. **The company's existing SOP shape.** Match the structure other SOPs in
   `vault/wiki/` already use. A document in a different shape reads as a
   different kind of document and gets trusted less.

If the vault has no SOP shape to match yet, say so and propose one rather than
silently inventing a house style.

## What an SOP has to answer

- **Purpose** — what this procedure is for, in one or two sentences.
- **Scope** — when it applies, and explicitly when it does not.
- **Owner** — the role accountable for it. If the vault does not say, infer a
  role only when the procedure or request supports it and mark that inference;
  otherwise write `Owner: To be assigned` and continue rather than stopping to
  ask.
- **Steps** — ordered, each one an action someone can actually perform.
- **Verification** — how the person doing it knows it worked.
- **Exceptions** — what to do when a step cannot be completed, and who to
  escalate to.

## Writing the steps

Write for someone doing this for the first time under time pressure. One
action per step. Name the actual system, form, or file — not "the relevant
system". If a step depends on a judgment call, say what the call is and what
governs it.

## The boundary

An SOP describes the procedure, never a case. It contains no patient-
identifying data, and its examples are structural — field names and formats,
never a filled-in record. See `phi-boundary`.

## Finishing

Say plainly what is settled and what is still assumed. An SOP with an
unverified step is more dangerous than an incomplete one, because the reader
cannot tell which parts to check.

End the SOP with its review line — `Reviewed: <date> · review by: <date>` —
following the rule in `sop-review`: a fresh `Reviewed` date only if a person
confirmed the content this session.

When the request establishes a durable, sufficiently grounded company SOP,
return the complete SOP and, through `vault-write`, offer a complete `/wiki`
command for the operator to review and enter. Never write `vault/wiki/`
directly. If a material fact remains unknown, keep a visible placeholder.
