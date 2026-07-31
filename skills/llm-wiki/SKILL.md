---
name: llm-wiki
category: vault
summary: keep the shared wiki current across every machine — write the fact, then publish it with sherman sync
description: Maintain the shared company wiki so every Sherman on every machine reads and writes the same knowledge. Write or update the wiki file, then publish with sherman sync and report what actually happened. Use when knowledge should reach other machines, not just this one.
---

# The shared wiki, kept current everywhere

The vault travels with the repo, so every machine that installs Sherman gets
the same wiki — but only what has been **published**. A fact written here and
never synced exists on one computer and nowhere else, which is how a fresh
install ends up knowing one fact while the founder's machine knows a week
more. This skill closes that gap: write the fact, then publish it.

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

1. **Write or update the page** the way `vault-write` teaches: one durable
   fact per file in `vault/wiki/` (company knowledge) or
   `vault/memory/shared/` (business memory), descriptive searchable filename,
   update the existing file instead of duplicating, end with the attribution
   line.
2. **Publish it**: run `sherman sync`. It pulls what other machines
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
