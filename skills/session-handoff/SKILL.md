---
name: session-handoff
category: method
summary: close a session with a paste-ready handoff the next agent can resume from
description: Use when a session is ending, a new agent must pick up the same work, or the operator asks for a session handoff, where we are, or what is next. Also use unprompted before compacting, switching engines, or leaving unfinished repo work.
---

# Leave a paste-ready close-out

A session that stops without a handoff forces the next agent to reconstruct
state from chat. That reconstruction is where work lands in the wrong clone,
skips verify, or repeats a finished step. This skill is the schema. Fill it
and stop. Do not narrate the session.

## When to use it

Use it when the operator asks for a handoff, when the work will continue in
another session or harness, or when you are about to leave unfinished cards,
a dirty tree, or a branch that is not merged. Use it unprompted at the end of
a long implementation session.

Do not use it to summarize a chat, grade the operator, or replace `kanban` /
`team` board state. The board stays the board. This is the close-out the next
*agent* pastes in.

`compact` is different: it shrinks engine context. This skill is for the next
worker, including a worker on another harness.

## Where it lives

Write it as a markdown file in the workspace handoffs directory, named for the
date and the work, not the chat. If that directory does not exist, create it
inside the generated workspace — never inside a personal home path, and never
as a substitute for editing Sherman source. An ad hoc note with no schema is
not a handoff.

## The schema — paste-ready, in this order

```markdown
# Handoff — <work name> — <date>

## Where we are
- Repo (origin remote, resolved at runtime — not a folder nickname)
- Branch and HEAD
- Working tree: only the files this session owns
- Board or card if one exists, with its real status

## Decisions
- Each decision in one line, with the reason that still matters

## Next physical command
- The exact command the next session should run first
- cwd, and what green looks like

## Blockers
- Named blocker, or "none"
- What is explicitly out of scope

## Verified artifacts
- Path + the command that proved it + the result
- Unverified work stays off this list
```

## Hard rules

- **Next physical command is a command**, not a wish. If you cannot name the
  binary, cwd, and expected output, the handoff is not done.
- **Verified artifacts require evidence from this session.** "Should be green"
  is not a row.
- **No PHI, no secrets, no vault dumps of session contents.** Cite a session
  id as a shape, never the log.
- **Do not invent slash commands.** Route through skills and real shell
  commands only.

## Done means

The next agent can start from the file alone: they know where the tree is,
what was decided, the first command to run, what is blocked, and what was
actually verified.
