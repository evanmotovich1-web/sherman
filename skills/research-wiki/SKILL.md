---
name: research-wiki
category: vault
summary: maintain optional personal research notes separately from the Sherman vault wiki
description: Maintain the optional personal research LLM Wiki through llmwiki MCP tools. Invoke /research-wiki explicitly to admit those tools; Sherman's /wiki writes to vault/wiki instead.
---

# The research wiki: what a session learned, kept

Sherman has two memories, and they are different things. The **vault** is the
company's brain: procedures, formats, policies — shared truth, governed by
`vault-write`. The **LLM Wiki** is the operator's research memory: what was
read, tried, decided, and learned along the way — a personal Wikipedia that
compounds across sessions, months after the original context fades. The
shell installs it at `~/.sherman/llmwiki` with its workspace at
`~/.sherman/research`, and reaches it through the `llmwiki` MCP tools.

## When this runs

- **Only through an explicit `/research-wiki <request>` invocation.** Ordinary
  turns cannot access the personal wiki MCP tools.
- **Never for `/wiki`.** `/wiki <name> | <fact>` validates and writes the exact
  operator-provided company fact to `vault/wiki/`; no model rereads the session,
  and exit never starts authoritative retention automatically.

## How to capture

1. **Read the session log** (`~/.sherman/sessions/<session-id>.jsonl`) — the
   record, not your memory of the conversation.
2. **Search the wiki first** (the MCP's search tool) for each thing worth
   keeping: the wiki grows by folding into existing pages, and a duplicate
   page is how a wiki stops being trustworthy.
3. **Write or update pages** for what is durable: research findings and the
   sources behind them, decisions with their reasons, techniques that
   worked, dead ends worth not repeating. Cross-link related pages — the
   links are what make it a wiki rather than a pile.
4. **Say what you did**: pages created, pages updated, or — a fine result —
   "nothing durable this session" in one line. Never invent an entry to have
   something to show.

If the MCP tools are not reachable, say so in one line and stop. A capture
that was not performed is not described as performed.

## What belongs where

- **Personal research wiki**: research, reasoning, working knowledge — the operator's
  intellectual trail.
- **Sherman vault wiki**: company procedures, formats, policies, decisions that
  other people's work depends on. `/wiki <name> | <fact>` validates and writes
  only the complete operator-authored fact supplied in that command, with
  surrounding whitespace and the final newline normalized by the shell.
- **Neither, ever**: credentials, secrets, and patient-identifying data. The
  no-PHI rule binds the wiki exactly as it binds everything else — describe
  shapes, withhold specifics. See `phi-boundary`.

## Boundaries

- The wiki workspace is personal and per-machine. It is not synced by
  `sherman sync`, never committed to this repo, and never read as company
  truth — a wiki page is the operator's note, not a citable company source.
- Do not reorganize the wiki wholesale during a capture; fold in what this
  session learned and leave gardening for a turn the operator asks for.
