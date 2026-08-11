---
name: vault-write
category: vault
summary: offer an explicit /wiki or /learn command for a durable fact
description: Identify durable knowledge, search for its existing filename, and offer a complete shell-validated /wiki or /learn command for operator review. Never write the vault directly.
---

# Propose an explicit durable fact

Use this when the conversation established something about the company that
will still matter next month: a procedure that changed, a format that got
standardized, a decision and the reason behind it.

## What qualifies

Durable company knowledge only. The test is whether someone who was not in
this conversation would need it later.

Propose it:

- a procedure, SOP, or the standard shape of a document
- a policy, an ownership boundary, or an approved format
- a decision, with the reasoning that outlives it

Do not propose it:

- that someone asked a question on a Tuesday
- conversation transcript, or a summary of the session as an event
- anything patient-identifying — see `phi-boundary`

## How

1. **Search read-only first.** If a file already covers this fact, propose that
   filename for replacement. Duplicates are worse than nothing.
2. **One fact per file.** A file covering three things cannot be corrected
   without touching all three.
3. **Name it the way a human would search for it.** Descriptive, not clever.
4. **Choose the command deliberately:**
   - `/wiki <name> | <fact>` — company procedures, formats, policies, decisions
   - `/learn <name> | <lesson>` — corrections to Sherman's behavior
5. **Link it.** Include relevant `[[wikilinks]]` in the proposed complete fact.
   A reciprocal-file change is a separate explicit command for operator review.
6. **Offer, never execute.** Give the complete command to the operator to review
   and enter. Never write directly to the vault, invoke a file-editing tool on
   it, or claim that the proposed fact was saved.

## The boundary

Never cross user scopes. Never write patient-identifying data anywhere in the
vault, in any form, for any reason.
