---
name: memory-link
category: vault
summary: propose explicit linked facts and reciprocal operator-reviewed commands
description: Search related vault facts read-only and include [[wikilinks]] in explicit /wiki or /learn proposals. Reciprocal changes require separate operator-reviewed commands; never edit the vault directly.
---

# Link memory into a graph

A vault of unlinked files is a pile: every lookup starts from zero, and two
related facts can drift apart without anyone noticing. This skill makes every
write also a connection, so what Sherman learns compounds across sessions.

## On every proposal

When proposing an explicit `/wiki` or `/learn` command:

1. **Search for neighbors first.** Before saving, search the vault for the
   procedures, decisions, formats, and people the new fact touches. The search
   you would do to avoid a duplicate (`vault-write` step 1) is the same
   search; spend it twice.
2. **Link with `[[wikilinks]]`.** Reference each related file by its filename
   without extension: `[[specimen-labeling-format]]`. Two or three strong
   links beat ten weak ones; link because a reader of this fact would need
   that one, not because the words match.
3. **Propose the link back separately.** A reciprocal neighbor replacement is
   its own complete command for operator review; never mutate it directly.
4. **Never link across privacy scopes.** Shared facts must never link into
   `vault/memory/private/`. There is no private retention command yet.

## Maintenance pass

When asked to organize or connect the vault, sweep a lane read-only and propose
the complete commands needed for clear links. The operator enters each accepted
replacement explicitly.

## Done

Done is a bounded set of complete operator-reviewable commands with links in the
fact and separate reciprocal replacements where needed. Never claim a proposal
was saved. No link is better than an invented connection.
