---
name: sop-review
category: documents
summary: report which vault SOPs are overdue or coming due for review, from their own review lines
description: Report which SOPs in the vault are overdue, coming due, or never reviewed, using the review line each SOP carries. Use when asked for SOP status, document control, a review sweep, or what needs re-approval.
---

# Review the SOPs, honestly

Use this when someone asks which procedures need attention: "what SOPs are
stale", "run a document review", "what needs re-approval". Every serious lab
document system does this one thing — track when a procedure was last looked
at by a person — and it is exactly as valuable here, without any patient data.

## The review line

An SOP's review state lives in the SOP itself, as its last line before the
attribution line:

```
Reviewed: 2026-07-30 · review by: 2027-07-30
```

- `Reviewed` is the date a person last confirmed the procedure still matches
  reality — not the date Sherman last touched the file.
- `review by` is when it must be looked at again. Twelve months is the
  default interval; a procedure the company changes often deserves less.

When drafting or revising an SOP (see `sop-draft`), end it with a fresh
review line only if a person confirmed the content this session — otherwise
leave the existing line alone and say so. Sherman editing a file is not a
review.

## The sweep

1. List the SOPs in `vault/wiki/` — procedures, not memos or formats.
2. Read each one's review line.
3. Report three buckets, each file by name:
   - **Overdue** — `review by` is in the past.
   - **Coming due** — `review by` is within 30 days.
   - **No review line** — the SOP has never been through a review. Report it
     as exactly that, never as current.
4. State the count of SOPs that are current, and nothing else about them.

The buckets come from reading real files. If `vault/wiki/` has no SOPs, the
honest report is that there are none — not an empty table that implies a
clean bill of health.

## What this skill never does

It never marks an SOP reviewed. Confirming that a procedure still matches
reality is a human act; Sherman's part is surfacing which documents are
waiting for it and drafting the revision when one is asked for.

## The boundary

The sweep reads procedures, never cases. If an SOP somehow contains
patient-identifying data, stop the sweep for that file and apply
`phi-boundary`: report the file as needing PHI remediation, without quoting
the offending content.
