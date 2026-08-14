# Self-direction loop — design

**Date:** 2026-08-13
**Status:** draft, awaiting operator review

## What this is

Sherman gains the ability to direct itself: a loop that reads a standing
direction layer in the vault, picks the highest-value next task on its own,
executes it, writes what it learned and what comes next back into the
direction layer, and iterates — with **no per-iteration human checkpoint**.
The agents author and maintain their own goals; the operator can read and
edit the direction layer at any time but is not required to.

## What this is not — the gates stay

The loop's freedom is bounded by the same four gates that bound every
Sherman session today. These are design invariants, not options, and the
operator's request to remove them is explicitly declined on record:

| Gate | What the loop may do | What it may not do |
| --- | --- | --- |
| **Merge** | Branch, commit, push, open PRs | Merge to `main`. The merge reaches the fleet via `sherman update`; a human confirms it. |
| **Money** | Tee up spends inside the caps | Execute a spend without the Issuing gate; touch anything but the capped virtual-card float. |
| **External** | Draft messages, prepare sends | Send anything outward (email, WhatsApp, posts) without the existing per-send approval paths. |
| **Sandbox** | Work in the workspace + operator-granted writable roots | Escape the sandbox, open the network beyond what the posture allows, or use PHI — ever. |

The reasoning, once: a self-goaling loop with no checkpoints is safe *only
because* its actions are reversible until a human gate passes them. Remove
the gates and a bad goal executes irreversibly at machine speed. The gates
are not friction on the loop; they are the license for it.

## Architecture

Three parts, smallest that works:

### 1. The direction layer — `vault/direction/`

A new top-level vault area, plain Markdown, one concern per file:

```
vault/direction/
  goals.md          # 3–7 standing goals, ranked. One line each + why.
  threads/          # open work threads, one file per thread
    <slug>.md       # status: open|blocked|done, next step, evidence links
  log.md            # append-only: each loop iteration's pick + outcome, one line
```

- **Agents self-populate.** At the end of any session (loop or normal), the
  existing retention/eval path may propose direction updates through the same
  validated writer used by `/learn` and `/wiki` — the vault stays writable
  only through the shell-owned path, never by raw engine file writes.
- `goals.md` carries a header comment telling the operator they may edit or
  delete anything; operator edits always win (agents must not revert them —
  enforced by prompt contract and by the writer refusing to modify lines
  marked `[operator]`).
- No PHI, ever — the standing vault rule applies unchanged.

### 2. The loop — `sherman loop [n]`

A new launcher verb, same bash-3.2 dispatch pattern as `sherman money`:

- **Iteration shape:** read `vault/direction/` → prompt the engine (normal
  posture, unchanged) with the direction layer and a pick-one-task
  instruction → the engine does the work in-sandbox → the shell harvests the
  outcome → the validated writer applies proposed direction updates → append
  one line to `log.md` → next iteration.
- **Bounds:** `n` iterations (default 3, max 10 per invocation). A wall-clock
  cap per iteration (default 20 min) kills a wedged turn. `Ctrl-C` and a
  `STOP` file in `~/.sherman/loop/` both halt the loop between iterations —
  the same shape as the money engine's `KILL`.
- **Publishing:** when an iteration produces a code change, the loop's
  standing instruction is the existing contract: smoke-green branch + PR,
  never `main`. When it produces knowledge, it lands as direction-layer
  updates through the writer.
- **Selection honesty:** the pick (which task, why) is written to `log.md`
  *before* execution, so the operator can always audit what the loop chose
  and on what grounds.

### 3. Gate enforcement — nothing new to build

The loop deliberately adds **zero** new privilege. It runs the same engine
postures, same sandbox, same money code paths, same vault writer as an
interactive session. Enforcement is inherited, not reimplemented — the loop
is a scheduler, not a new capability surface. That is the core design bet:
self-direction is a *prompting and state* problem, not a *permissions*
problem.

## Failure handling

- An iteration that errors marks its `log.md` line `failed:` with the reason
  and moves on; two consecutive failures halt the loop.
- A direction proposal the validator rejects is dropped and logged, never
  retried blind.
- If `vault/direction/` is missing or empty, the first iteration's only task
  is to draft `goals.md` from the vault, session logs, and repo state — the
  bootstrap is the loop's own first job.

## Testing

- Unit: direction-writer validation (operator-line immunity, PHI refusal,
  schema of `threads/*.md` front matter), loop bounds (iteration cap, STOP
  file, consecutive-failure halt).
- Smoke: a check that `sherman loop` exists, honors `STOP`, refuses to run
  with an engine posture other than the standard ones, and that no loop code
  path can invoke a merge, a spend outside the money engine, or a raw vault
  write.
- Live proof before merge: one supervised 3-iteration run on this machine
  whose only outputs are direction-layer updates and at most one PR.

## Rollout

Phase 1 (this spec): direction layer + loop verb + gates inherited.
Phase 2 (separate spec, later): scheduling (launchd timer), multi-agent
lanes, cross-machine direction sync via the existing vault path.
