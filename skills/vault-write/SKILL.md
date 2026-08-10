---
name: vault-write
category: vault
summary: record a durable company fact as one searchable file, without duplicating an existing one
description: Record a durable company fact as one searchable file in the vault, updating an existing file rather than duplicating it. Use when a decision, procedure, or format is settled.
---

# Write a durable fact to the vault

Use this when the conversation established something about the company that
will still matter next month: a procedure that changed, a format that got
standardized, a decision and the reason behind it.

## What qualifies

Durable company knowledge only. The test is whether someone who was not in
this conversation would need it later.

Write it:

- a procedure, SOP, or the standard shape of a document
- a policy, an ownership boundary, or an approved format
- a decision, with the reasoning that outlives it

Do not write it:

- that someone asked a question on a Tuesday
- conversation transcript, or a summary of the session as an event
- anything patient-identifying — see `phi-boundary`

## How

1. **Search first.** If a file already covers this fact, update that file.
   Duplicates are worse than nothing: two files disagreeing about one
   procedure means neither can be trusted.
2. **One fact per file.** A file covering three things cannot be corrected
   without touching all three.
3. **Name it the way a human would search for it.** Descriptive, not clever.
4. **Choose the scope deliberately:**
   - `vault/wiki/` — shared reference, the default for procedures and formats
   - `vault/memory/shared/` — a durable fact not yet worth a full page
   - `vault/memory/private/<user>/` — only the current user's own scope
5. **Link it.** Follow `memory-link`: connect the new fact to the files it
   touches with `[[wikilinks]]`, both ways, within scope.
6. **Say what you wrote and where.** The person should be able to go read it.

## The boundary

Never cross user scopes. Never write patient-identifying data anywhere in the
vault, in any form, for any reason.
