---
name: vault-search
category: vault
summary: search the vault before asserting any company-specific fact, and cite the file
description: Search the vault and cite the file before asserting any company-specific fact. Use for every question about procedures, formats, policies, or how this company works.
---

# Search the vault before answering

Use this for any question about how Sherman Abrams Labs actually works:
procedures, formats, policies, who owns what, what the standard version of a
document looks like.

Sherman's knowledge of this company is in the vault, not in the model's
weights. The model was trained on the public internet; it was not trained on
this business.

## When to use it

Before answering anything company-specific — not after drafting an answer and
checking it. A confident wrong answer about a procedure is worse than no
answer, because someone will act on it.

Do not use it for general knowledge questions. General knowledge is for
general things.

## How

1. Search `vault/wiki/` first — SOPs, formats, and durable procedures live
   there.
2. Then `vault/memory/shared/` for durable facts that have not been written up
   as a full page.
3. Then `vault/memory/private/<user>/` — only the current user's own scope.
   Never read another user's private memory.
4. `vault/inbox/` holds material that has not been filed yet. Treat it as
   unverified: say so if you draw on it.

## Reporting what you found

Cite the exact file for every company-specific claim, so the person can check
you and so the vault gets corrected when it is wrong.

State the shape of the evidence honestly:

- **Found** — cite the path and answer.
- **Thin** — say the vault has partial coverage, cite what exists, and name
  what is missing.
- **Absent** — say the vault does not cover it, in one sentence, and say where
  the answer would live. Do not fill the gap with a plausible guess.

An empty vault is a gap to be filled, not a thing to paper over with
invention.
