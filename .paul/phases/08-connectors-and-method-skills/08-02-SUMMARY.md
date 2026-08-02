---
phase: 08-connectors-and-method-skills
plan: 02
status: complete
commit: 210b45a
date: 2026-08-01
---

# 08-02 — The `0-1` skill

**3/3 tasks PASS · AC 1–5 Pass · commit `210b45a`**

## What shipped

`skills/0-1/SKILL.md`, one paragraph in `agent/SYSTEM.md` making capability
acquisition part of the operating contract, its row in `skills/README.md`, and
smoke check 26.

## Acceptance criteria

| AC | Verdict | Evidence |
|---|---|---|
| AC-1 `/0-1` invokes it, engine reaches it unprompted | Pass | Check 26 asserts `parseSubmission('/0-1 …')` yields name `0-1` with args intact and `typedSkillName` resolves it; the description names the trigger condition and `SYSTEM.md` routes to it |
| AC-2 wires what it can | Pass | The skill directs add-enable-report with no permission pause, and states that a relaunch activates it |
| AC-3 one checklist, not an interview | Pass | A single fixed block — sign up, pick, create, send — followed by an explicit instruction to stop asking, with unblocked work completed first |
| AC-4 never invents a connector | Pass | Check 26 asserts the "Never invent a connector" section is present; the skill's fallback is naming what was checked |
| AC-5 boundaries hold | Pass | Check 26 asserts the PHI and secret boundaries are both present in the body |

## Deviations from plan

**The smoke check is 26, not 25.** 08-03 landed first and took 25.

**One boundary was added beyond the plan:** do not install software onto the
operator's machine on your own initiative. The plan's scope limit said `0-1`
may add a catalog entry but not `npm install -g` unknown code; writing the
skill made clear that belongs in the skill's own text, not only in the plan
that produced it. 08-03 then found the seed skill doing exactly this, which
confirms it was worth stating.

## The composition with graph-engineering

The plan required a real composition rather than a citation, and the shape it
took is worth recording: candidate connectors are a fan-out because they are
independently checkable; the comparison is one of the genuine barrier cases,
since you cannot pick the best option before every option is on the table; and
verification is a verifier edge because the cost of a wrong connector is engine
config that dies at startup, far from its cause. The skill also names which
runtime the session is in — `/subagent` is a one-node fan-out, Codex has no
workflow runtime — so it never promises orchestration the engine lacks.

## Open

The catalog still holds one entry. `0-1` has not yet been exercised against a
real acquisition — the first live run is the real test of AC-2 and AC-3, and it
has not happened.
