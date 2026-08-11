---
name: llm-wiki
category: vault
summary: offer a reviewed retention command, then publish confirmed shared knowledge with sherman sync
description: Keep company knowledge current across machines without model Vault writes. Offer a complete operator-reviewed /wiki or /learn command; after the operator enters it, publish with sherman sync and report verified results.
---

# The shared wiki, kept current everywhere

The vault travels with the repo, so every machine that installs Sherman gets
the same wiki — but only what has been **published**. A fact written here and
never synced exists on one computer and nowhere else, which is how a fresh
install ends up knowing one fact while the founder's machine knows a week
more. This skill closes that gap: offer the exact reviewed command, then publish
only after the operator enters it.

The vault is plain Markdown, so it is also an Obsidian vault: open the
`vault/` folder in Obsidian and every page is there. Nothing about this skill
depends on Obsidian; it works on the files.

## When to use

- A fact, procedure, or decision should be known by Sherman on **every**
  machine, not just this one.
- Someone asks why another computer's Sherman "doesn't know" something this
  one knows — the answer is almost always an unpublished fact; fix it by
  syncing, then say so.

## How

1. **Offer an explicit command** the way `vault-write` teaches: one complete
   `/wiki` company fact or `/learn` behavioral lesson for the operator to
   review and enter. Never edit the shared vault directly.
2. **After the operator enters it, publish it**: run `sherman sync`. It pulls what other machines
   published, commits only the shared lanes (wiki, shared memory, inbox),
   and pushes. Private memory never travels — it is gitignored, and sync
   fences it out a second time.
3. **Report what actually happened**, from the command's own output: pushed,
   pulled-only (no write access on this machine), or blocked. Never claim
   "published" unless sync said so.

## Boundaries

- **No PHI, anywhere in the wiki, ever.** The vault is shared and — in this
  repo — public. The no-PHI rule from the operating contract applies with no
  exceptions.
- Private memory (`vault/memory/private/<user>/`) is out of scope: it stays
  on this machine and this skill never moves it.
- If `sherman sync` reports a conflict or refuses (someone else's staged
  work), stop and tell the person; never resolve someone else's work by
  guesswork.
