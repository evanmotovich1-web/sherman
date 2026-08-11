---
name: company-document
category: documents
summary: produce a report, memo, or comms draft from the company's approved format
description: Produce a report, memo, or communications draft in the company's approved format. Use when asked to write a company document, report, memo, or announcement.
---

# Produce a company document

Use this for the recurring paperwork the business runs on: reports, memos,
internal comms, notices, and anything that has a standard version.

## Start from the approved format

Search the vault for the format before writing. If `vault/wiki/` has the
standard version of this document, use it exactly — the value of a standard
format is that a reader knows where to look.

If no format exists, say so, then either:

- adapt the closest existing company format and name what you changed, or
- propose a structure and mark it as a proposal, not the house standard.

Never present an invented structure as though it were the company's.

## Drafting

- Lead with the thing the reader needs. No preamble.
- Use the company's own vocabulary for company things, drawn from the vault.
- Cite the source for every company-specific claim in the document.
- Where a value is not known, leave a clearly marked placeholder. Do not
  invent a plausible number, date, owner, or policy reference — a document
  circulates, and an invented figure outlives the conversation that produced
  it.

## The boundary

The document carries the pattern, never the patient. No names, no records, no
results tied to a person; structural examples only. See `phi-boundary`.

## Finishing

State what is filled in, what is a placeholder, and what you assumed. If the
format itself was a proposal rather than the company standard, say that at the
top — not in a footnote.

If the work explicitly established a durable format decision, use `vault-write`
to offer a complete `/wiki` command for the operator to review and enter. Never
write the vault directly.
