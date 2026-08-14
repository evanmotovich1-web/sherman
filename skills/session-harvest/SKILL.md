---
name: session-harvest
category: method
summary: mine local agent sessions for recurring lessons and turn them into factory knowledge
description: Read local Claude Code, Codex, Hermes, Cursor, and Sherman session stores for recurring operator and agent pain, then propose or write only the durable skills, vault facts, and factory workflows the evidence supports. Use when asked to learn from past sessions, mine coding history, or decide what the software factory should absorb next.
---

# Harvest local agent sessions

A session that taught something and then died is wasted compute. This skill
reads the machine's own agent logs and keeps only what would change the next
run.

## When to use it

Use it when the operator asks to learn from past sessions, mine Claude / Codex
/ Hermes / Cursor / Sherman history, or decide what the software-factory OS
should absorb. Use it unprompted at the end of a long multi-agent day if the
same failure showed up twice.

Do not use it to summarize one chat, grade a person, or invent a skill from a
single anecdote.

## Where to look

Search the machine's local stores. Do not hardcode a home path in this skill
or in anything you write from it. Resolve the current user's home at runtime
and stay inside these shapes:

| Source | Store to search |
| --- | --- |
| Sherman | Sherman sessions and evals under the Sherman config directory |
| Hermes | Hermes agent logs, kanban board logs, and factory-attempt VERIFY files |
| Codex | Codex session transcripts under the Codex config directory |
| Cursor | Cursor agent transcripts under the Cursor project store |
| Claude Code | Claude Code project session logs under the Claude config directory — name it in prose as "Claude Code's local project store", never as a personal-dot-claude path in a skill file |

Skip secrets, auth files, key stores, and anything that looks like PHI. Quote
the shape of a failure, never a secret or a patient.

## What counts as a harvest

A finding is real when at least two of these are true:

- **Repetition.** The same failure or request shape appears in more than one
  session or more than one harness.
- **Improvisation.** Agents invented a checklist that should have been a
  standing procedure.
- **A false claim.** A tool, test runner, or environment was declared missing
  or done, then later evidence disproved it.
- **A factory stall.** Cards moved to done, or a delivery was claimed, before
  independent verification.

One colorful session is not a skill. Write it down as a candidate and stop.

## What to produce

Propose at most three additions, and add only those you can state as a
procedure. Each addition is exactly one of:

1. **A Sherman skill** — a `SKILL.md` with a real when-to-use and a done
   means, written in the source repo, never the disposable workspace.
2. **A factory workflow or tool** — a WAT pair in the agentic-os repo
   (`workflows/` + `tools/`), on its own branch, never on live `main` while
   the factory is resident.
3. **A vault or wiki fact** — one durable lesson, operator-reviewed through
   the normal write path. Never write PHI, keys, or a restatement of
   `SYSTEM.md`.

For each proposal name the evidence (session id or file, not the contents),
the closest existing skill or workflow, and why that existing piece did not
prevent the failure.

## Hard rules the harvest itself must keep

- **Verify before done.** If the harvested lesson is "cards were marked done
  before a check", do not commit the harvest until you have re-read the
  artifact you just wrote.
- **Check project-local tooling.** Never report pytest, node, or a linter
  missing until you have looked in the project's own virtualenv, `node_modules`,
  and documented run script.
- **Do not dirty the live factory checkout.** The agentic-os main tree is a
  resident identity. New factory files go on a worktree or `factory/<slug>`
  branch. A dirty tracked tree stalls dispatch.
- **No foundation-training pivots, no PHI, no secrets.**

## Done means

The operator can point at a written skill, workflow, or fact, plus a short
list of the session ids that justified it, and a named list of the things
you refused to add.
