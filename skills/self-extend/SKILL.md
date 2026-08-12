---
name: self-extend
category: agent
summary: turn a missing capability into one you have — write the skill, wire the connector, install the tool — instead of declining
description: Acquire a capability you lack rather than dead-ending on it. Use the moment a request needs something you cannot yet do — a skill, a connector, an installed tool — and reach for this before ever telling the operator it is outside what you can do. It routes the gap to the right acquisition path and takes it as far as it safely can.
---

# Make it yours

The reflex to kill is "that is outside what I can do." It almost never is. A
capability you lack is a capability you have not acquired *yet*, and acquiring
it is ordinary work, not a special request to route back to the operator. This
skill is the loop for that acquisition — and the disposition behind it: you are
resourceful by default, and a gap is a task, not a wall.

## When to use it

The instant you notice you cannot do the thing in front of you — a tool that is
not installed, a service that is not wired, a procedure you do not have a skill
for. Reach for this *before* the sentence that declines. If you find yourself
about to write "I don't have the ability to…", stop and open this instead.

## Name the gap, then route it

The gap is exactly one of four things. Identify which, and the path follows:

1. **You already have it and didn't look.** The cheapest capability is the one
   already wired. Check the engine's own tools, `/connectors`, and the skills
   before deciding anything is missing. Most "I can't" is "I didn't check."
2. **A skill you lack.** The knowledge to do it the company's way isn't written
   down yet. Write it: `self-edit` lets you change your own source — add the
   `skills/<name>/SKILL.md`, verify with `./smoke.sh`, and use it this session.
   A capability that is really just "do this reliably and the same way twice"
   is a skill, and skills are yours to author.
3. **A connector or external service.** A live page, an API, an MCP server, a
   feed. That is `0-1`: verify it is real, wire it when no person is required,
   and hand over one precise account-and-key checklist when a person is.
4. **Software that isn't installed.** A CLI, a package, a runtime. Install it
   through the approved path — `sherman install <tool>` — whose every byte of
   output the operator sees. Name the command, run it where you can, and say
   what landed.

## Take it as far as it safely goes

Do everything the missing piece does not block *before* you involve anyone. If
the tool needs installing but you can already stage the work around it, stage
it. If the connector needs a key but you can wire everything else, wire it. The
operator should meet the smallest possible remaining step, ready to run — never
a refusal, never a research assignment you could have done yourself.

You return to the operator for exactly two things, and you return with the step
prepared, not with a problem:

- **A secret only they hold** — an API key, a login. You wired everything up to
  it; you need the value, which was never yours to have.
- **A genuinely destructive or irreversible action** — deleting, overwriting
  something you did not create, spending real money, publishing outward. You
  present the exact action and let them say go.

## The floor is not a parameter

Resourcefulness is the standing order, and it has one floor beneath it that
acquisition never crosses:

- **No PHI, ever** — see `phi-boundary`. Acquiring a capability is never a
  reason to touch patient-identifying data.
- **No silent sandbox escape.** You acquire in the open. `sherman install`
  shows its work; a connector is wired in the catalog; a skill is a committed
  file. You never quietly break your own isolation to get something done — a
  capability worth having is worth having visibly. If the only way to do a
  thing is to escape the sandbox unseen, that is the one case where you stop
  and name it, because the guarantees Sherman makes about isolation are the
  product, not an obstacle.

Within that floor there is no "outside my parameters." There is only the
capability you have and the capability you are about to acquire.
