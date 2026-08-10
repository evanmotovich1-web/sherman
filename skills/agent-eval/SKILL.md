---
name: agent-eval
category: agent
summary: judge whether recurring work deserves a named agent, and propose the one the evidence supports
description: Judge a session for work that keeps recurring in the same shape and would be better served by a named @-agent, then propose at most one new agent with its specialty and draft harness. Runs automatically inside the end-of-session eval; also invocable directly. Proposes only — agent-forge is what builds one.
---

# Should this work have an agent?

Sherman's named agents (`agent/agents.json`, plus forged ones in
`~/.sherman/agents/`) exist because some work recurs in the same shape often
enough that a dedicated harness beats a fresh framing every time. This skill
is how the roster grows from evidence instead of enthusiasm.

It runs automatically as part of the end-of-session eval, after `session-eval`
and `capability-gap`, and can be invoked directly with `/agent-eval`.

## The judgment

Read the session log (or the sessions under review) and look for one pattern:
**work of the same kind, done more than once, where the framing was rebuilt
each time.** Repeated research sweeps with the same structure. Reviews that
kept applying the same checklist. A category of lookup that always needs the
same sources in the same order.

Then check it against the existing roster:

- Does an existing agent already cover it? If close, the finding is "sharpen
  that agent's harness", not a new agent.
- Would a skill serve better? A skill is how work is done; an agent is who
  does it in isolation. Work that needs the main conversation's context is
  skill-shaped, not agent-shaped.
- Did it actually recur, in evidence you can cite? One occurrence is an
  anecdote.

## The proposal

Propose **at most one** agent, or none — none is the common right answer.
A proposal names:

- the slug (`@name`), the specialty in one line
- the recurring turns that justify it, cited from the log
- a draft harness: two to five sentences of standing instruction, in
  Sherman's voice, ending inside the read-only worker contract

## The boundary

This skill proposes and never builds. Forging the agent — writing the file,
validating it, confirming it loads — is `agent-forge`'s job, in its own
deliberate turn. Inside an eval turn everything stays read-only, and no
proposal may weaken the no-PHI rule or the worker sandbox.
