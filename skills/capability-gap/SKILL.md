---
name: capability-gap
category: agent
summary: read the session and the vault for work that wanted a skill or tool Sherman does not have
description: Find work this session did badly or not at all for want of a skill or tool Sherman lacks. Use when running /eval, at session end, or when asked what capability was missing.
---

# Find the capability that was missing

Sherman's skills are the product. This looks for the next one — not by
brainstorming what an operations agent might want, but by finding work that
already happened badly for want of it.

## What you are given

The session log (`~/.sherman/sessions/<session-id>.jsonl`), the current
`skills/` directory, `agent/capabilities.json`, and the vault. Read all four
before proposing anything: a proposal that duplicates an existing skill means
the skill was not found, which is a different and more useful finding.

## The evidence that counts

A gap is real when the session or the vault shows the work being done **without
a repeatable procedure**. Look for:

- **Repetition.** The same shape of request handled from scratch more than
  once, here or across vault history. Repetition is what a skill is for.
- **Improvisation.** Sherman inventing a structure — a document layout, an
  ordering, a checklist — where a company standard should have existed. The
  improvisation is the specification of the missing skill.
- **A refusal that should have been a procedure.** Sherman declining or
  deferring work that is inside its boundary but had no defined way to do.
- **A vault gap named twice.** If a topic came up and the vault was thin, and
  the vault is thin on it again, that is a knowledge gap; if the *handling* was
  ad hoc both times, that is a skill gap. They are different proposals.

For a **tool** rather than a skill, the bar is higher: name the capability, the
work that needed it, and what Sherman did instead. `agent/capabilities.json` is
not a roadmap — nothing goes in it that does not already work — so a tool
proposal is a request for engineering, not an entry to add.

## What does not count

- A skill you can imagine being useful. Imagination is not evidence.
- One occurrence with no sign it will recur.
- A rewording of an existing skill. Check `skills/` first; if an existing skill
  covers the work but was not followed, the finding belongs to `session-eval`,
  not here.
- Anything requiring patient-identifying data to perform. That is outside the
  boundary and no skill makes it inside. See `phi-boundary`.

## How to report

Propose at most two, and propose nothing when nothing is supported. A standing
list of speculative skills is worse than an empty one: it makes the real
proposals harder to see, and `skills/README.md` describes a starting set to
edit, not a backlog to grow.

For each proposal:

- **Name** — the directory it would live at, in the existing style.
- **Category** — an existing one from `skills/`, or a new one with a reason.
- **The evidence** — the specific turns or vault files that show the work
  happening without it. Quote the shape, never the content.
- **What it would say** — two or three sentences of the actual procedure. If
  you cannot state the procedure, the gap is not understood well enough to fill
  yet, and saying so is the honest finding.
- **Why the existing skills do not cover it** — name the closest one and the
  difference.

## What this must not do

Do not create the skill. This turn proposes; a person decides what the product
is. Write nothing to `skills/`, nothing to `agent/capabilities.json`, and
nothing to the vault.
