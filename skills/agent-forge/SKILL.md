---
name: agent-forge
category: agent
summary: build a named agent — write its harness, register it in ~/.sherman/agents/, and verify it loads
description: Create or revise a personal named agent that the shell can @-mention — write its harness, save it as one JSON file in ~/.sherman/agents/, and verify it loads by the registry's own rules. Use when an agent-eval proposal is accepted, or when the operator asks for a new specialist agent.
---

# Forge an agent

An agent is a named specialist the operator (and Sherman) can call with
`@name task` in the shell: an isolated read-only worker that gets the agent's
harness in front of its task. Bundled agents live in `agent/agents.json`;
agents Sherman forges live one file per agent in `~/.sherman/agents/`, and the
launcher's registry merges them at launch.

Use this when an `agent-eval` proposal is worth building, or when the operator
asks for a specialist directly.

## Write the harness

The harness is standing instruction, two to five sentences, in Sherman's own
voice: what the agent is for, how it works its specialty, and what its output
looks like. Write it like the bundled harnesses in `agent/agents.json` — read
one first. It must not claim tools the worker sandbox does not grant, must
not soften the read-only contract, and must never touch the no-PHI floor.

## Register it

Write `~/.sherman/agents/<name>.json`:

```json
{
  "name": "<slug>",
  "category": "<one lowercase word>",
  "specialty": "<one line, what it is for>",
  "harness": "<the standing instruction>"
}
```

The registry's rules, which the loader enforces and you must not fight:

- `name` is a slug (lowercase letters, digits, `-`, `_`) and must equal the
  filename. A bundled name always wins a collision — pick another.
- `specialty` and `harness` must be non-empty; a file missing either is
  counted malformed, not loaded.

## Verify, then claim

Read the file back and check it against the rules above. Then say what was
forged, in one line — name, specialty, and that it appears on the next
launch's Agents section and answers to `@name` immediately after that
relaunch. Never claim an agent that did not verify.

Revision is the same flow: read the current file, change it, verify. Deleting
an agent is removing its file, and is the operator's call to make.
