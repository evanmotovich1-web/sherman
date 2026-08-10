---
name: memory-link
category: vault
summary: link every memory and vault fact to the facts it touches, so knowledge compounds as a graph
description: Connect vault and memory files with [[wikilinks]] whenever a fact is written or updated, and run maintenance passes that link related existing facts. Use after any vault-write, and when asked to organize, connect, or de-silo the vault.
---

# Link memory into a graph

A vault of unlinked files is a pile: every lookup starts from zero, and two
related facts can drift apart without anyone noticing. This skill makes every
write also a connection, so what Sherman learns compounds across sessions.

## On every write

When writing or updating any file under `vault/wiki/`, `vault/memory/shared/`,
or `vault/memory/private/<user>/`:

1. **Search for neighbors first.** Before saving, search the vault for the
   procedures, decisions, formats, and people the new fact touches. The search
   you would do to avoid a duplicate (`vault-write` step 1) is the same
   search; spend it twice.
2. **Link with `[[wikilinks]]`.** Reference each related file by its filename
   without extension: `[[specimen-labeling-format]]`. Two or three strong
   links beat ten weak ones; link because a reader of this fact would need
   that one, not because the words match.
3. **Link back.** Add the reciprocal link to each neighbor you cited, under a
   `Related` line at the end of that file. A one-way link is half a
   connection, and the half that decays first.
4. **Never link across privacy scopes.** A shared file must not link into
   `vault/memory/private/`, and private files link only within their own
   user's scope and into shared knowledge — never into another user's.

## Maintenance pass

When asked to organize or connect the vault — or when a session's eval notes
that lookups kept missing related facts — sweep a lane of the vault, propose
links between existing files, and apply the clear ones. Report what was
linked and why in one line per connection.

## Done

Done is the new fact saved with its links in place, the neighbors updated with
their back-links, and one line telling the operator what got connected. No
link is a fine outcome for a genuinely novel fact; an invented connection is
worse than none.
