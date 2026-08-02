---
name: evan
category: method
summary: plan a body of work as a loop that closes, and leave a written trail across sessions
description: Run multi-phase work through a plan → apply → unify loop with a written record in .evan/ — PROJECT, ROADMAP, STATE, and one PLAN and SUMMARY per phase. Use when work spans more sessions than one context can hold, when a decision needs to survive the session that made it, or when someone will ask later why something was built the way it was.
---

# The loop

Three moves, in order, forever.

**PLAN** writes an executable plan — objective, acceptance criteria, tasks with
files and verification, and explicit boundaries around what must not change.
**APPLY** executes that plan. **UNIFY** reconciles what was planned against what
actually happened, records the difference, and closes the loop.

The value is not the ceremony. It is the written trail: six months on, the
reason a thing was built a particular way is in a file rather than in someone's
memory of a session nobody logged.

## Where to go

`references/commands.md` is the routing table — what someone might ask for, and
which workflow file answers it. Read it first when the request does not obviously
name a phase.

The three that matter most:

| Request | Read |
| --- | --- |
| plan the next phase | `workflows/plan-phase.md` |
| execute this plan | `workflows/apply-phase.md` |
| close the loop | `workflows/unify-phase.md` |

## Where the record lives

In the project, under `.evan/`:

- `PROJECT.md` — what this is, what it must do, the constraints that bind it
- `ROADMAP.md` — milestones and phases, in order
- `STATE.md` — where the loop is right now, the decisions made, the concerns open
- `phases/NN-name/NN-PP-PLAN.md` and `-SUMMARY.md` — one pair per plan

**The legacy name.** A project already carrying a `.paul/` directory keeps it —
read and write that one, unchanged. This repository is such a project, with
several phases of record cross-referencing that path. Renaming a live project's
state directory orphans every reference inside it, which is a worse outcome than
an inconsistent name. New projects get `.evan/`.

## Paths in these files

A bare path in any vendored file means **read this file**. Paths beginning
`workflows/`, `templates/`, or `references/` resolve inside this skill directory.
Paths beginning `.evan/` or `.paul/` resolve in the project.

They are written this way because the original framework used Claude Code's
`@file` expansion, which Codex does not have. A path that reads the same on both
engines is the only version that works on both.

## Autonomy — read this before following any workflow

The vendored workflows were written for an interactive session, and they are
full of "confirm with user", "wait for response", and "proceed?" gates.

**Under Sherman those are decision material, not questions to hand over.**
Resolve them from the request, the files, and reasonable reversible defaults,
and carry the work through. The operating contract in `agent/SYSTEM.md` and the
autonomy contract in `skills/README.md` both govern here and neither is suspended
by a vendored gate.

Stop for one focused question only under the contract's existing rule: an
essential fact that cannot be found or safely inferred where a wrong choice
would materially change the outcome, or an action needing authority the request
did not give. An approval checkpoint written into a plan's task list is a real
checkpoint and does bind — the operator put it there deliberately. A workflow's
routine "shall I continue?" is not.

## Sizing

Two to three tasks per plan. Past that, split — quality degrades once a plan
outgrows the context that has to hold it. Prefer vertical slices (one feature
end to end) over horizontal ones (all the models, then all the APIs), because a
vertical slice can be verified and a horizontal one cannot.

A task that cannot state its files, its action, its verification, and its done
condition is too vague to execute. That is the test, and it is worth applying
before the plan is approved rather than during APPLY.

## Where this meets the other skills

- `graph-engineering` for any plan whose tasks are actually independent. The
  loop is sequential by default and most plans do not need to be; that skill is
  how you find the false edges.
- `wayfinder` when the work is too big to plan in one pass — when the way to the
  destination is not visible yet, chart it as decision tickets first, then bring
  the resolved route back here as phases.
- `0-1` when a phase needs a capability that does not exist yet.

## The boundaries

No PHI in a PROJECT, ROADMAP, STATE, PLAN, or SUMMARY — the same rule that binds
everything else, and these files are committed, which makes them permanent.

`.evan/` records decisions about work. Durable company knowledge still belongs
in the vault; a decision about how a project is built is not a company procedure.
