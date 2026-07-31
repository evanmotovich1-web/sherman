---
name: research-wiki
category: vault
summary: fold each session's durable learnings into the personal LLM Wiki over MCP, and know what belongs there
description: Maintain the operator's personal LLM Wiki — the research memory that compounds across sessions — through the llmwiki MCP tools. Use for /wiki, at session end after the eval, or when asked to record research findings, decisions, or lessons that are not company vault facts.
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

- **At the end of every session with turns, automatically** — the shell runs
  `/wiki` after the exit eval. The two are deliberately separate turns: the
  eval judges and stays read-only; the capture records and writes only
  through the wiki's MCP. Judgment first, preservation second.
- **On `/wiki`, any time** — a deliberate mid-session capture, which also
  satisfies the exit's.
- **On request** — "put that in my wiki", "save this research".

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

- **Wiki**: research, reasoning, working knowledge, lessons — the operator's
  intellectual trail.
- **Vault, not wiki**: company procedures, formats, policies, decisions that
  other people's work depends on. Those go through `vault-write` in their
  own deliberate turn, so shared truth never depends on a personal store.
- **Neither, ever**: credentials, secrets, and patient-identifying data. The
  no-PHI rule binds the wiki exactly as it binds everything else — describe
  shapes, withhold specifics. See `phi-boundary`.

## Boundaries

- The wiki workspace is personal and per-machine. It is not synced by
  `sherman sync`, never committed to this repo, and never read as company
  truth — a wiki page is the operator's note, not a citable company source.
- Do not reorganize the wiki wholesale during a capture; fold in what this
  session learned and leave gardening for a turn the operator asks for.
