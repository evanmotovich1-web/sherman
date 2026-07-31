---
name: tool-audit
category: agent
summary: sweep the vault and every recorded session, and recommend the tools, skills, or MCP servers actually worth adding
description: Read the vault, every session log, and every eval verdict, and recommend the best tools, skills, or MCP servers to add — each grounded in observed friction and cited to its evidence. Use when asked to run a tool audit or to say what Sherman should gain next.
---

# Audit what Sherman should gain next

`capability-gap` reads one session and proposes what that session was missing.
This is the fleet-level version: read everything this machine has recorded —
every session, every verdict, the whole vault — and say what the *pattern*
shows Sherman should gain. One session improvising is an anecdote; five
sessions improvising the same shape is a specification.

## The evidence

All of it is on this machine, and all of it is read-only for this turn:

- `~/.sherman/sessions/*.jsonl` — every recorded session, one JSON object per
  line, `{role, at, text}` with role `user`, `sherman`, or `worker`. What
  people actually asked for, and what happened next.
- `~/.sherman/evals/*.md` — the persisted verdicts. What the judges kept
  flagging is a repetition signal that no single session shows.
- `vault/` — what the company knows, and where it is thin. A vault gap that
  sessions keep hitting is evidence about tooling as much as knowledge.
- `skills/` and `agent/capabilities.json` — what exists today. Every
  recommendation is a delta against these; recommending what exists means the
  existing thing was not findable, which is its own finding.

This sweep is wide, so do not grind it through the main thread: run it as an
isolated read-only worker (`/subagent` in the shell), or as a fan-out per
`graph-engineering` — one worker per evidence lane, a reduce in code, one
synthesis. Judge only from these files. Never from memory of conversations,
which you do not have.

## What counts as friction

Recommendations rest on **observed friction**, never on what an operations
agent might plausibly want:

- **Repetition without a procedure** — the same shape of work done from
  scratch in several sessions. The repeated improvisation is the spec of the
  missing skill.
- **Manual bridging** — a person copying things in or out by hand (data from
  another system, output into another tool) session after session. That is
  the shape of a missing tool or MCP server: a system Sherman keeps needing
  and cannot reach.
- **Declines that recur inside the boundary** — work refused for want of a
  defined way to do it, more than once. (Work refused because of PHI is the
  boundary working; it is never friction to engineer around.)
- **Judges repeating themselves** — the same miss named across several eval
  verdicts. The eval loop found it; this audit is where it becomes a
  recommendation.

One occurrence is an anecdote. Count occurrences and name them.

## How to report

Rank recommendations by evidence weight — occurrences times cost of the
workaround — and cap the list at five; fewer is fine, and a machine whose
record shows no real friction should be reported as exactly that, not
furnished with inventions. For each:

- **What to add** — and which kind it is: a *skill* (a procedure, cheap, the
  default), a *tool* (a capability entry backed by real engineering —
  `agent/capabilities.json` is not a roadmap, so this is a request for work,
  not an edit), or an *MCP server* (an external system Sherman keeps needing;
  name the system and what access it would grant).
- **The evidence** — session ids, eval files, or vault paths, with counts.
  Describe the shape of what people asked; quote nothing sensitive. An
  uncited recommendation is an opinion and does not belong on the list.
- **What happens today instead** — the workaround being paid for.
- **The first test of success** — what a future session does differently the
  week after it lands.

State the sweep's own coverage honestly: how many session logs and verdicts
were actually read, and whether any were unreadable or skipped. A truncated
sweep that reads as a full one is the confident gap this system exists to
prevent.

## What this must not do

- **Do not build anything.** This turn recommends; a person decides what the
  product is. Write nothing to `skills/`, `agent/capabilities.json`, or the
  vault.
- **Do not quote session content.** The evidence is cited by id and described
  by shape. Session logs are other people's work; verbatim excerpts do not
  belong in a report that travels.
- **Never propose anything that needs patient-identifying data to work.** No
  volume of observed friction moves the PHI boundary. See `phi-boundary`.
