---
name: research-wiki
category: vault
summary: maintain optional personal research notes separately from the Sherman vault wiki
description: Search and compile the operator's second-brain LLM wiki through llmwiki MCP tools, separately from the company vault. /wiki still writes only operator-reviewed company facts to vault/wiki.
---

# The research wiki: what a session learned, kept

Sherman has two memories, and they are different things. The **vault** is the
company's brain: procedures, formats, policies — shared truth, governed by
`vault-write`. The **LLM Wiki** is the operator's compiled research memory
(Karpathy's ingest / query / file-back / lint loop). It lives in the wired
`llmwiki` connector. The real knowledge base is `second-brain`, not the
three-document scratch workspace at `~/.sherman/research`. Pointing search at
that scratch and calling it a hit is the measured adoption failure. The
company vault stays separate; never mix the two.

## When this runs

- **Search on ordinary turns** when a stall, continuation, or re-orientation
  could already live in the compiled wiki. That read is the load-bearing half.
- **Compile through `/research-wiki <request>`** when the operator asks to
  file research into the personal wiki. Ordinary turns still must not write
  the company vault.
- **Never for `/wiki`.** `/wiki <name> | <fact>` validates and writes the exact
  operator-provided company fact to `vault/wiki/`; no model rereads the session,
  and exit never starts authoritative retention automatically.

## How to capture

1. **Read the session log** (`~/.sherman/sessions/<session-id>.jsonl`) — the
   record, not your memory of the conversation.
2. **Search the wiki first** with `mode="search"`, `knowledge_base="second-brain"`,
   and two to four distinctive keywords — never a sentence. Default `mode="list"`
   ignores the query. If the connector is aimed at `~/.sherman/research` or
   the result is an unranked dump, say wiki miss and stop claiming a search.
   The wiki grows by folding into existing pages; a duplicate page is how it
   stops being trustworthy.
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

- The personal LLM wiki is not company truth and is not the target of `/wiki`.
  Cite the company vault for company facts. A second-brain page is the
  operator's compiled note, not a procedure another employee should follow.
- `sherman sync` publishes the company vault only. It does not move
  second-brain.
- Do not reorganize the wiki wholesale during a capture; fold in what this
  session learned and leave gardening for a turn the operator asks for.
