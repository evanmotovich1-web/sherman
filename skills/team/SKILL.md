---
name: team
category: method
summary: work as one of several sherman sessions on a shared board — claim cards, leave a trail, never collide
description: Coordinate with other Sherman sessions running on this machine through a shared team board. Use whenever the operator says to work with another Sherman session or agent, join a team, split a project across sessions, or report to the other Shermans — the board is how parallel sessions divide work, hand off results, and stay visible without stepping on each other.
---

# Work as a team of Shermans

Every Sherman session on this machine runs in the same workspace. That shared
floor is the whole coordination mechanism: a team of sessions works off one
board file, and the board — not chat, not memory — is where the team exists.
A session that works off-board is invisible to its teammates and to the
operator watching.

## The team board

One team, one file: `boards/team-<slug>.md` in the workspace. It is the
`kanban` skill's board (read that skill; its card, status, and "done means"
contract applies unchanged) with two additions that make it multi-session:
an **Agents** roster and a **Messages** lane.

```markdown
# <project> — team board

## Agents

| session | engine | working on | last seen |
|---------|--------|------------|-----------|
| 20260811_160210_a1b2c3 | codex | #2 | 2026-08-11T21:04Z |
| 20260811_160455_d4e5f6 | zai | #4 | 2026-08-11T21:02Z |

## Cards

| # | card | owner | status | done means |
|---|------|-------|--------|------------|
| 1 | survey physics-based training methods | 20260811_160210_a1b2c3 | done | sources cited in vault inbox |
| 2 | draft training-data pipeline | 20260811_160210_a1b2c3 | in-progress | script runs on sample |
| 4 | research why kimi 3 works | 20260811_160455_d4e5f6 | blocked: needs zai recharge | findings note in workspace |

## Messages

- 21:03 · …a1b2c3 → …d4e5f6: pipeline expects JSONL, one example per line — schema in handoff-pipeline.md
```

## Joining

When the operator names a team ("work with the other Sherman on X"), look for
`boards/team-*.md` matching the project. Found: read the WHOLE board before
anything else, add yourself to the Agents roster, and continue from board
state — never re-plan work another session already decomposed. Not found: you
are the first; create the board from the `kanban` decomposition and say where
it lives, so the operator can point the other sessions at it.

Identify yourself everywhere by your session id (the launch screen and log
carry it). Names like "sherman" mean nothing on a team of Shermans.

## Claiming — the one rule that prevents collisions

Only a `backlog` card can be claimed. To claim: re-read the board file NOW
(not your memory of it), and only if the card still shows `backlog`, write
your session id as owner and `in-progress` as status, then re-read once more.
If the owner that came back is not you, another session won the race — leave
their claim standing and pick a different card. The double-read is the whole
locking protocol; it is imperfect and it is enough, because losing a race
costs one re-read and colliding silently costs duplicated work.

Never edit a card another session owns — not its status, not its text. The
exceptions are append-only: a `note:` line under their card, or a message in
the lane.

## Working

- **Heartbeat.** Update your `last seen` and `working on` in the roster
  every time you touch the board. A teammate whose `last seen` is stale by
  more than an hour is presumed gone; its `in-progress` cards may be
  reclaimed — move them back to `backlog` with a note saying so first.
- **Hand off through files.** A card's output goes where its "done means"
  says; anything a teammate needs to continue from goes in a named handoff
  file in the workspace, referenced from the card. Chat dies with the
  session; files are the team's memory.
- **Message when it changes someone's work.** The Messages lane is for facts
  a specific teammate needs ("schema changed", "vault file moved") — newest
  last, timestamped, addressed by session id. It is not a diary.
- **Blocked names its blocker.** `blocked: needs zai recharge` tells the
  operator what to fix; bare `blocked` tells nobody anything.
- **Verify before done**, exactly as `kanban` requires — and a teammate is
  the natural verifier. Mark the card `verify` and stop. The session that
  did the work never writes `done`. Another session, or an assigned
  reviewer, re-reads the artifact and only then promotes it. A completion
  report that arrives before that check is a miss, even if the work later
  proves fine.

## The operator is watching

`sherman board` renders the team board live in a terminal. That view is the
operator's window into the whole team, which is one more reason the board
must be updated as things move, not at the end: an hour of silent progress
looks identical to an hour of hang from the outside, and the operator has
already had the hang.

## Boundaries

The board is coordination state, not knowledge. Durable facts still go to
the vault under the vault skills; lessons still go through
`self-improvement`; and nothing patient-identifying ever appears on a board,
in a message lane, or in a handoff file — the no-PHI floor stands on every
surface the team writes.
