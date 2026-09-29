---
name: recursive-learning
category: agent
summary: finish the task by searching the llm wiki, retrying on another local model, and filing the lesson back
description: Keep going until the task is done — search the second-brain LLM wiki before retrying, inventory the models and keys already on this machine, route a blocked slice to another engine, then file a durable answer back and offer /learn. Use when work stalls on the current model, a missing API, or a failure that a second attempt could fix.
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

1. **Recall from the compiled wiki, not from chat.** Before retrying, search
   the second-brain LLM wiki through the wired `llmwiki` connector:
   `mode="search"`, `knowledge_base="second-brain"`, two to four distinctive
   keywords — never a sentence (AND-FTS; a natural-language question returns
   a fake empty wiki). Start with `wiki/sherman` and the stall's rare words.
   Then check shared memory and the last eval. `session-harvest` only if the
   same failure showed up in more than one local session. A compiled page
   that already names the fix is the first move, not a re-derivation.
   If the connector is aimed at `~/.sherman/research` (three documents) or
   the search ignores the query and dumps a list, **say wiki miss** and
   proceed — do not pretend you recalled. That mis-aim is the measured
   adoption failure; treating a scratch workspace as the vault repeats it.
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
6. **File the answer back, then offer the company command.** Chat is not
   the copy. A durable research finding or stall-fix goes onto an existing
   second-brain page (`wiki/sherman` or `inventory/QUERY-*`) through the
   llmwiki tools — fold in, do not spawn a new `wiki/` page. Company
   procedures and conduct still go through one complete `/wiki` or `/learn`
   command; do not write the company vault yourself. This file-back is a
   compile pass, not a verifier-gated optimizer: there is no automated
   keep-or-discard scorer here, and claiming one would be a lie.

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
