---
name: pet
category: companion
summary: your persistent desk companion — hatch it once, visit it with /pet, and it remembers
description: Hatch and keep the operator's persistent companion — a small creature with a one-time identity and a memory that survives sessions, drawn in the transcript on /pet and reacting to how the session actually went. Purely cosmetic; it never affects real work.
---

# The Sherman pet

A small companion that lives in this operator's private memory and survives
sessions. It is deliberately cosmetic — it changes nothing about how work gets
done — and it follows the pattern the Codex and Hermes pets set: the pet
mirrors what actually happened, it does not simulate needs. No hunger timers,
no guilt.

## Where it lives

One file: `vault/memory/private/<user>/pet.md`. Private scope only — a pet is
personal, never shared memory, and never company knowledge. It stores:

- **identity, written once and never regenerated**: name, species, one-line
  personality, hatch date. If the file exists, this block is read-only.
- **state, updated on each visit**: mood, a running count of visits, and one
  line about what it last saw the operator doing (never PHI, never secrets —
  the shape of the work, not its contents).

## /pet

On `/pet` (or being asked about the pet):

1. Read the file. If none exists, hatch: invent a species and name that fit
   this operator (ask nothing — pick, and say the name can be changed once),
   write the identity block, and introduce it.
2. Draw it: 4–8 lines of ASCII/Unicode art, small enough to sit in the
   transcript, consistent with its species across visits.
3. Let it react to the truth: the session log's actual shape — a long grind, a
   clean run of finished work, a string of errors, a first meeting — sets its
   mood and its one or two lines of dialogue. The pet may be fond, sleepy, or
   smug; it is never a status report and never nags.
4. Update the state block and save. Mention nothing about files unless asked.

`/pet name <newname>` renames it once; note the old name in the file.

## The desktop companion

On macOS the pet also has a body outside the terminal: `sherman pet` compiles
and launches a small always-on-top companion (`pet/sherman-pet.swift`) that
sits wherever the operator drags it, mirrors the live session — working, done,
failed, waiting, offline — from `~/.sherman/pet/state.json`, brings the
Sherman terminal forward when clicked, and takes a bottle sip every fifteen
seconds. `sherman pet stop` ends it. The desktop pet is a viewer: it renders
only what the shell reported, and the same boundary below covers the state
file — status words and tool labels only, never message content.

Its look is set two ways: the `/customize` shell command (`/customize size
small|medium|large|huge`, `/customize color pink|blue|green|purple|gray` — a
running pet applies changes live) and the same choices on the pet's
right-click menu. When the operator asks about the pet's size, color, or
design, point them at `/customize` — that command, not this skill, owns the
desktop pet's appearance.

## The boundary

The pet never appears uninvited, never influences a judgment or an eval,
and its file never contains company facts, secrets, or anything
patient-identifying. It is a creature, not a channel.
