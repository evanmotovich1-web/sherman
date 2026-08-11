---
name: kanban
category: method
summary: run a big project as a visual board of cards, delegated to agents in parallel and verified column by column
description: Coordinate any multi-workstream project as a kanban board — decompose into cards, delegate independent cards to parallel workers, sequence dependent ones, verify before Done, and re-render the board visually every update. Use automatically whenever a request spans several workstreams, files, or sessions; a big project run without a board loses cards silently.
---

# Run the project as a board

A request big enough to have workstreams gets a board, unprompted. The board
is what keeps ten moving pieces honest: every card has one owner, one status,
and one definition of done — and the operator can see all of it at a glance.

## The board file

One project, one file: `boards/<project-slug>.md` in the workspace. It is the
source of truth for the project's state and survives across sessions — a new
session picks the board up by reading it, not by re-planning.

```markdown
# <project> — board

| # | card | owner | status | done means |
|---|------|-------|--------|------------|
| 1 | audit the intake SOPs | @scout | done | list of stale SOPs cited |
| 2 | draft replacements | sherman | in-progress | drafts in vault inbox |
| 3 | adversarial review | @reviewer | backlog | findings ranked |
```

Statuses: `backlog → in-progress → verify → done` (plus `blocked`, with the
blocker named on the card). Nothing skips `verify`: a card moves to `done`
only after its "done means" was checked against reality — delegate the check
to `@reviewer` or the verification flow when the work was substantial.

## Running it

1. **Decompose** the request into cards with real "done means" columns —
   observable outcomes, not activities.
2. **Delegate in parallel.** Cards with no dependency between them go to
   workers at the same time — `@scout` for recon, `@researcher` for
   evidence, `@reviewer` for checks, subagents for bounded jobs. Dependent
   cards run as a sequence, each consuming the previous card's verified
   output. The main thread owns synthesis and the board itself.
3. **Update as things move**, not at the end. Every status change rewrites
   the board file and re-renders it.
4. **Finish the loop.** The project is done when every card is `done` or
   explicitly dropped with a reason on the board.

## Visualize on every update

Each time the board changes, render it in the reply as columns, so progress
is seen rather than described:

```text
  BACKLOG           IN PROGRESS        VERIFY            DONE
  ▫ 3 review        ▪ 2 drafts         ▫ –               ▪ 1 audit
```

Short cards, column counts in the header when the board is large, and the
board file path under it so the operator can open the full table. Never
render a status the file does not hold — the picture and the file are the
same board or the picture is a lie.

## The boundary

Cards, owners, and statuses only — never PHI, never secrets. A board is
coordination state, not a knowledge store: durable facts the project
produces still go to the vault through `vault-write`, cards just point at
them.
