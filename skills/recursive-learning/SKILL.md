---
name: recursive-learning
category: agent
summary: finish the task by recalling, retrying on another local model, and writing the lesson
description: Keep going until the task is done — recall prior lessons, inventory the models and keys already on this machine, route a blocked slice to another engine, and offer a /learn when the loop taught something. Use when work stalls on the current model, a missing API, or a failure that a second attempt could fix.
---

# Finish it — recall, reroute, retry

A blocked turn is not a finished task. This skill is the loop that keeps
Sherman moving when the current engine cannot, by using what this machine
already has and writing down what the next session must not re-learn.

It is not a second operating contract. The no-PHI floor, the operator-gated
`/learn` and `/wiki` path, and the rule that models never write the vault
still hold. It is the disposition to use them instead of stopping.

## When it fires

Use it unprompted when any of these is true:

- the current engine rate-limits, refuses, or is the wrong strength for the slice
- a step needs an API or model this session has not used yet
- the same kind of failure already happened once this session
- a prior eval or shared-memory lesson is about this exact stall

Do not use it to rewrite the harness, to scan the disk for secrets, or to
swap the parent session's engine. The wizard already chose that engine.

## The loop

Bound it. Three attempts at the same blocked slice, then report what
remains and stop. A fourth try without new evidence is a hang.

1. **Recall.** Before retrying, search shared memory and the last eval for
   this stall. `session-harvest` if the same failure has shown up in more
   than one local session. A lesson that already names the fix is the
   first move, not a re-derivation.
2. **Inventory this machine.** Run `/models` (or read what it would print).
   That is a local, names-only snapshot: which engine binaries are on
   PATH, which key NAMES are in `~/.sherman/keys.json` or the environment,
   and the `/subagent --engine` line each ready engine unlocks. It does
   not open `.env` files, does not print values, and does not walk the
   home directory.
3. **Route the blocked slice.** If another engine is ready, send only that
   slice with `/subagent --engine <name> <task>` (or `@learner --engine
   <name>`). Keep the parent session on its own engine. Say which engine
   the result came from. Prefer the engine whose strength matches the
   slice — code, prose, or the one that is simply present.
4. **Acquire only what inventory cannot give.** A missing binary is an
   install the operator can see (`sherman install` or the engine's own
   installer). A missing secret is one `/key NAME` line, or the `0-1`
   checklist if the account does not exist yet. Do everything the key
   does not block first. Never ask for a key that `/models` already
   lists as present.
5. **Retry with the new evidence.** One changed input per attempt — a
   different engine, a newly stored key, or a lesson just recalled. If
   the slice still fails, name the failure and go to the next attempt
   or stop at the bound.
6. **Write the lesson.** When the loop taught a durable behavior, offer
   one complete `/learn <name> | <lesson>` command. A new company fact
   is `/wiki`. Do not write the vault yourself.

## What "done" means

The original task is finished and verified, or the bound is hit and the
operator has a named remaining step — install this binary, hand over
this key, or accept that the floor stopped the work. A report of why
it could not be done, with no next step, is the failure this skill
exists to prevent.

## The floor

- **No PHI**, including in a lesson or a worker prompt.
- **No secret values** in the transcript, the vault, a commit, or a
  worker task. Names only.
- **No silent sandbox escape** and no parent-engine swap.
- **No disk-wide secret hunt.** `/models` is the inventory. If it does
  not list the key, ask for it — do not go looking in other projects'
  env files.
