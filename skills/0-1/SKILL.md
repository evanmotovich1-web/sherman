---
name: 0-1
category: agent
summary: acquire the capability an idea needs — wire it silently where you can, hand over one checklist where you cannot
description: Close the gap between a request and a capability Sherman does not have yet. Use whenever an idea needs an MCP server, an API, or an external service that is not wired — verify the connector is real, add and enable it when no human is required, and hand over one precise account-and-key checklist when one is. Reach for it instead of answering that something cannot be reached.
---

# Zero to one

There is a gap between *"I want to do X"* and *"Sherman can do X"*, and until
now it was the operator's job to cross it. Sherman would establish honestly that
it could not reach something and stop there — correct, and useless.

This skill is that crossing. One idea in hand, one capability missing, closed
now.

## Where it sits among the others

Three skills look at capability and they are not the same skill.

- `capability-gap` looks **backward**: work that already went badly for want of
  a tool, found by reading what happened.
- `tool-audit` looks **across**: the whole fleet, surveyed, to say what Sherman
  should gain next.
- `0-1` looks **forward at one thing**: this request, this missing connector,
  closed in this session.

If the request is "what should we add next", that is `tool-audit`. If it is
"why does this keep going wrong", that is `capability-gap`. If it is "do X" and
X needs something that is not wired, it is this.

## First, establish what is already there

Adding is the last resort, not the first move. In order:

1. **Already wired?** Read the rendered connectors — `/connectors` shows them,
   and the engine's own tool list is the other half of the answer. The cheapest
   capability is one Sherman already has and did not think to use.
2. **Already catalogued?** `agent/connectors.json` may hold the connector
   unenabled, or enabled and blocked on a key. That is a two-line fix, not a
   research project.
3. **Not a connector at all?** A surprising amount of "we need an integration"
   is a file, a vault page, or a shell command. Check before shopping.

Only past all three does the search start.

## Shape the search as a graph

Finding the right connector is not a linear investigation, and `graph-engineering`
is how to shape it. Read that skill; this is its application to one job.

**The candidates are independent, so gather them at once.** Three or four
plausible ways to reach the capability — an official MCP server, a community
one, the service's REST API behind a thin wrapper, an existing tool that already
covers it. Each is checked without reference to the others, which makes them a
fan-out rather than a queue.

**Then a barrier, because the choice is comparative.** You cannot pick the best
option until every option is on the table; this is one of the genuine cases for
waiting on the whole set. Compare on what matters: does it exist, is it
maintained, what does it cost, what credential does it demand, and how much
reach does it hand the engine.

**Then a verifier edge, because a wrong answer here is expensive.** An
unverified connector is not a small error — it is engine config that fails at
startup, which the operator meets as one causeless error a long way from its
cause. Before writing anything, confirm from a real source that the thing
exists, that the launch recipe is the documented one, and that the package or
endpoint named is the actual one. Try to refute it before trusting it.

**Say which runtime you are in.** The shell's `/subagent` is a one-node fan-out
— one isolated read-only worker per turn — so several candidates mean several
turns, and that is an honest fleet, just a slow one. Codex has no workflow
runtime; run the candidates as separate worker conversations and do the
comparison yourself. Never promise an orchestration the running engine does not
have.

## Wire what needs no human

A request for an outcome authorizes the normal, safe, reversible work to produce
it, and adding a catalog entry is reversible. So when the connector needs no
credential — a local stdio server, a public endpoint, an unauthenticated API —
do it, and say what you did:

1. Add the entry to `agent/connectors.json` with its transport, launch recipe,
   `requiresFile`, and a `probe` that proves it answers rather than merely
   exists.
2. Enable it in `~/.sherman/connectors.json` if it is not `autoEnable`.
3. Report: what was added, what it gives, and that **a relaunch activates it**,
   because the launcher is what renders engine config.

Do not ask permission for this. Do not present the three candidates as a menu
and wait. Choose, act, and state the assumption alongside the result.

## Hand over one checklist when a human is required

An account or a key is authority the request did not give, and that is a real
stop — the one the operating contract already describes. It is **one message,
not a conversation**:

```
<service> needs an account before Sherman can use it.

  1. Sign up:  <url>
  2. Pick:     <the tier, and whether the free one is enough>
  3. Create:   <the exact credential, named the way their console names it>
  4. Send it:  reply with the key and I will put it in
               ~/.sherman/connectors.json as <SECRET_NAME>

What this unlocks: <the capability, one line>
Cost: <what it actually costs, or "free at this tier">
```

Then stop asking. No follow-up question, no menu, no "shall I proceed once you
have it" — the next move is theirs and the checklist already said what it is.

**Do everything the key does not block, first.** If four of five steps need no
credential, they are done before the checklist appears, and the checklist says
what remains. That is the contract's "make every useful, unblocked part of the
work before asking", applied here.

**Write the catalog entry now anyway**, with its `requires` and its `signup`
filled in. Then the day the key arrives it is one line in the enablement file
rather than a repeat of this whole investigation.

## Never invent a connector

The catalog's entire value is that its entries are real, and this is the skill
that writes them.

A hallucinated MCP server, a package name that is nearly right, a launch recipe
recalled rather than read — each produces config that fails at engine startup,
and the operator meets it as a broken session with no visible cause. That is
worse than no connector, because no connector is at least legible.

If it cannot be verified from a real source: **say the capability could not be
sourced, and say what you checked.** That is a complete, useful answer. A
plausible guess written into `agent/connectors.json` is not.

## The boundaries

- **Secrets are named, never echoed.** Not into the transcript, not into the
  session log, not into the repo, and never into the vault. `/connectors` prints
  names and presence; so do you. If a key appears in conversation, put it where
  it belongs and do not repeat it back.
- **No PHI crosses a connector.** A fan-out multiplies exposure and an external
  service multiplies it further. A connector whose purpose is to move patient
  data is **refused outright**, not catalogued with a caveat — the no-PHI floor
  is not a risk to be managed here, it is a line.
- **New reach is stated plainly.** Enabling a connector gives the engine
  somewhere new to send data. Say so when you add one. Nobody should learn from
  a bill, or from a log, what Sherman is now talking to.
- **Do not install software onto the operator's machine on your own
  initiative.** Adding a catalog entry is reversible; pulling unknown code onto
  a work machine is not, and it is not what "wire this connector" authorized.
  Name what needs installing and let them run it.
- **Company knowledge still goes to the vault.** A connector is plumbing. What
  Sherman learns *through* it, if it is durable and company-specific, is a vault
  fact like any other.
