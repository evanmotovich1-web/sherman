---
name: wayfinder
category: method
summary: chart work too big for one session as a map of decision tickets, and clear them one at a time
description: Plan a large, foggy effort as a shared map of decision tickets on an issue tracker, resolving them one per session until the route to the destination is clear. Use when an idea is too big for one session to hold and the way from here to there is not visible yet — not for work that can simply be planned and built.
---

A loose idea has arrived — too big for one session, and wrapped in fog: the way
from here to the **destination** is not visible yet. Wayfinding is about finding
that way, not charging at the destination. This skill charts the route as a
**shared map** on an issue tracker, then works its **decision tickets** —
questions whose resolution is a decision, not slices of a build — one at a time,
until nothing is left to decide.

The destination varies per effort, and naming it is the first act of charting:
it shapes every ticket. It might be a spec to hand off, a decision to lock before
planning starts, or a change made in place. The map is domain-agnostic — a
process redesign, a systems change, a body of documents.

**When not to use it.** If the way is already clear, you do not need a map — you
need a plan, which is `evan`. Charting an effort that could have been three
phases is pure overhead.

## Plan, don't do

Wayfinder is **planning** by default: each ticket resolves a decision, and the
map is done when nothing remains to decide before someone goes and does the
thing. The pull to just do the work is usually the signal you have reached the
edge of the map and it is time to hand off — to `evan`, as phases. An effort can
override this in its **Notes**, but absent that, produce decisions, not
deliverables.

## Refer by name

Every map and ticket is an issue, so it has a **name** — its title. In everything
a person reads, refer to it by that name, never by a bare id or number. A wall of
`#42, #43, #44` is illegible; names read at a glance. The id and URL do not
vanish — a name wraps its link — but they ride inside the name, never stand in
for it.

## Where the map lives

Two trackers, in order of preference:

**GitHub issues**, when the repository has a remote and `gh` authenticates
(`gh auth status`). This is the better home: blocking relationships render in
the tracker's own UI, so a person sees what is takeable without opening the map.

```
gh issue create --title "<map name>" --label "wayfinder:map" --body-file <file>
gh issue create --title "<ticket>" --label "wayfinder:research" --body-file <file>
gh issue list --label "wayfinder:map" --state open
gh issue edit <n> --add-assignee @me          # this IS the claim
gh issue close <n> --comment "<the answer>"
```

Sub-issues and native blocking are `gh api` calls against the repository's issue
relationships; where they are unavailable, record blockers as a `Blocked by:`
line in the ticket body and treat that as the edge.

**Local markdown**, otherwise — no remote, no `gh`, or a private effort. Under
`.wayfinder/` in the repository:

```
.wayfinder/MAP.md                    the map (below)
.wayfinder/tickets/NNN-<slug>.md     one file per ticket
```

Each ticket file opens with front matter carrying its state, so the frontier is
derivable by reading the directory:

```markdown
---
id: 003
title: <the ticket name>
type: research | prototype | grilling | task
state: open | closed
blocked_by: [001, 002]
claimed_by: <name, or empty>
---

## Question

<the decision or investigation this ticket resolves>

## Answer

<written on resolution; empty while open>
```

A ticket is **unblocked** when every ticket blocking it is closed. The
**frontier** is the open, unblocked, unclaimed tickets — the edge of the known.
A session **claims** a ticket first, before any work, so concurrent sessions skip
it.

## The map

The whole effort at low resolution, loaded once per session. Open tickets are
**not** listed — they are found by query.

```markdown
## Destination

<what reaching the end looks like. One or two lines; every session orients to
it before choosing a ticket.>

## Notes

<domain; skills every session should consult; standing preferences>

## Decisions so far

- [<closed ticket title>](link) — <one-line gist of the answer>

## Not yet specified

<in-scope fog you cannot ticket yet; graduates as the frontier advances>

## Out of scope

<work ruled beyond the destination; closed, never graduates>
```

The map is an **index**, not a store. A decision lives in exactly one place — its
ticket — so the map gists and links, and never restates.

## Ticket types

Every ticket is either **HITL** — worked *with* a person who speaks for
themselves — or **AFK**, driven alone. A HITL ticket resolves only through that
live exchange. **Never stand in for the person's side of it.** An agent that
answers its own grilling questions has broken the method, and the map it produces
records agreement that never happened.

- **Research** (AFK). Reading documentation, external sources, or the vault to
  surface a fact a decision waits on. In the Sherman shell, resolve it with
  `/subagent` — one isolated read-only worker. On Codex, run it as a separate
  worker conversation. Where several research tickets are open at once, that is
  a fan-out: see `graph-engineering` for how to shape it and what it costs.
- **Prototype** (HITL). Raise the fidelity of the discussion by making something
  cheap and concrete to react to — an outline, a rough draft, a stub. Link it
  from the ticket. Use when "how should it look" or "how should it behave" is
  the question.
- **Grilling** (HITL). Conversation, one question at a time. The default case.
  See `references/grilling.md`.
- **Task** (HITL or AFK). Manual work that must happen before a *decision* can
  be made — nothing to decide, but the discussion is blocked until it is done.
  Signing up for a service so its API can be judged, provisioning access, moving
  data so its shape can be seen. This is the one type that *does*, and it earns
  its place by unblocking a decision. Where a task needs an external service,
  `0-1` is what wires it. Resolved when the work is done; the answer records
  what was done and any facts later tickets depend on.

**Pin the vocabulary while charting.** Before writing tickets, settle what the
recurring nouns mean in this effort. Tickets written in drifting vocabulary
produce decisions that do not compose.

## Fog of war

The map is *deliberately* incomplete: do not chart what you cannot yet see.
Beyond the live tickets lies the fog — decisions you can tell are coming but
cannot pin down, because they hang on questions still open. Resolving a ticket
clears the fog ahead of it, graduating whatever is now specifiable into fresh
tickets, one at a time, until the way is clear.

**Not yet specified** is where that dim view is written down. Everything there
is in scope, just not sharp enough to ticket.

**Fog or ticket?** The test is whether you can state the question precisely now
— *not* whether you can answer it now. Ticket when the question is already
sharp, even if it is blocked. Leave it in the fog when you cannot yet phrase it
that sharply, and do not pre-slice fog into ticket-sized pieces: one patch may
graduate into several tickets, or none.

## Out of scope

Fog only gathers *toward* the destination. Work beyond the destination is not
fog — it is out of scope, and it gets its own section. Scope, not sharpness,
lands it there.

Out-of-scope work never graduates. When a ticket turns out to sit past the
destination, **close it** — a closed ticket is unambiguously off the frontier —
and leave one line in **Out of scope**: the gist, why it is out, and a link. It
stays out of **Decisions so far**, which records the route actually walked; a
scope boundary is not a step on it.

## Charting a map

Invoked with a loose idea.

1. **Name the destination.** Grill until what this map is finding its way *to*
   is pinned down. The destination fixes the scope, so it settles first.
2. **Map the frontier.** Grill again, **breadth-first** — fan out across the
   whole space rather than deep on one thread, surfacing the open decisions and
   the first steps takeable now. **If this surfaces no fog**, the way is already
   clear and the effort does not need a map. Say so and route to `evan`.
3. **Create the map**, labelled `wayfinder:map`: Destination and Notes filled
   in, Decisions-so-far empty, the fog sketched into Not yet specified.
4. **Create the tickets you can specify now**, then wire the blocking edges in a
   **second pass** — issues need ids before they can reference each other.
5. **Fire the research tickets** in parallel, each as its own worker.
6. **Stop.** Charting is one session's work; it resolves nothing by hand.

## Working through a map

Invoked with a map. A ticket is optional — without one, *you* pick the next
decision, not the operator.

1. Load the **map** — the low-resolution view, not every ticket body.
2. Choose the ticket. If one was named, use it; otherwise take the first
   frontier ticket in order. **Claim it before any work.**
3. Resolve it, zooming as needed: fetch the full body of any related or closed
   ticket on demand, and consult whatever the Notes block names.
4. Record the resolution: post the answer, close the ticket, and append its
   one-line gist to the map's Decisions so far.
5. Add newly-surfaced tickets and graduate any fog the answer made specifiable,
   clearing each graduated patch from Not yet specified so it lives only as its
   new ticket. If the answer reveals a ticket sits beyond the destination, rule
   it out of scope. If it invalidates other tickets, update or delete them.

**Never resolve more than one ticket per session** — research tickets excepted,
since they are read-only and return facts rather than decisions. Other sessions
may be working the same map concurrently, so expect the tracker to move under
you and re-read before writing.

## The boundaries

**No PHI on a map, in a ticket, or in a resolution comment.** A ticket is
exactly the kind of place a case detail gets pasted without thinking, and on
GitHub it is a permanent, potentially public artifact. The rule is the same one
that binds everything else and it does not soften because the tracker feels like
scratch space.

A ticket that would require patient-identifying data to resolve is refused, not
resolved carefully.
