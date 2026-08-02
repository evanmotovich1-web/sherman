# The command surface

Every entry below is a way in. The method is the same one; these are the doors.

In the original framework each of these was its own slash-command file whose
whole job was to point at a workflow. Twenty-eight near-identical stubs are
ceremony that does not survive a port — what survives is the routing table.

Say what you want in plain words. `/evan plan the next phase`, `/evan close
this loop`, `/evan what's the state` all land in the right place.

## The loop

These three are the spine. Everything else supports them.

| Ask for | Reads | Does |
| --- | --- | --- |
| `plan` | `workflows/plan-phase.md` | Write an executable PLAN for the next phase |
| `apply` | `workflows/apply-phase.md` | Execute an approved PLAN |
| `unify` | `workflows/unify-phase.md` | Reconcile plan against actual and close the loop |

## Before planning

| Ask for | Reads | Does |
| --- | --- | --- |
| `discuss` | `workflows/discuss-phase.md` | Explore and articulate a phase's vision |
| `assumptions` | `workflows/phase-assumptions.md` | Surface what is being assumed, before it is built on |
| `discover` | `workflows/discovery.md` | Research technical options before planning |
| `research` | `workflows/research.md` | Research a topic, or a phase's unknowns |
| `map-codebase` | `workflows/map-codebase.md` | Build the codebase context files |
| `audit` | `workflows/audit-plan.md` | Architectural audit of the current plan |

## After building

| Ask for | Reads | Does |
| --- | --- | --- |
| `verify` | `workflows/verify-work.md` | Guide acceptance testing of what was built |
| `plan-fix` | `workflows/plan-phase.md` | Plan fixes for issues that verification found |
| `consider-issues` | `workflows/consider-issues.md` | Triage deferred issues against the codebase |
| `debug` | `workflows/debug.md` | Work a defect systematically |
| `quality-gate` | `workflows/quality-gate.md` | Run the quality checks before closing |

## Roadmap and milestones

| Ask for | Reads | Does |
| --- | --- | --- |
| `add-phase` / `remove-phase` | `workflows/roadmap-management.md` | Change the roadmap's shape |
| `transition-phase` | `workflows/transition-phase.md` | Move from one phase to the next |
| `milestone` | `workflows/create-milestone.md` | Create a milestone |
| `discuss-milestone` | `workflows/discuss-milestone.md` | Explore the next milestone's vision |
| `complete-milestone` | `workflows/complete-milestone.md` | Close a milestone out |

## Session

| Ask for | Reads | Does |
| --- | --- | --- |
| `init` | `workflows/init-project.md` | Set up `.evan/` in a project |
| `resume` | `workflows/resume-project.md` | Restore context and continue |
| `pause` | `workflows/pause-work.md` | Write a handoff and stop cleanly |
| `handoff` | `workflows/pause-work.md` | Produce the handoff document |
| `progress` | `references/loop-phases.md` | Where the loop is, and the one next action |
| `flows` | `workflows/configure-special-flows.md` | Configure which skills a work type requires |

## What did not come across

- **The manifest subsystem** — `evan.toml`, `ledger.toml`, and their sync
  steps. Its purpose was feeding an external graph product that Sherman does
  not ship, so the files would have been written and never read. `STATE.md` is
  the record, and a human reads it.
- **The framework's own authoring rules.** A skill ships the method, not the
  method's style guide.
