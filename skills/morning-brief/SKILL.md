---
name: morning-brief
category: routine
summary: open the day with a short brief built from the vault, yesterday's sessions, and the user's own configuration
description: Build the user's morning brief from what this machine actually recorded — vault inbox, recent shared knowledge, yesterday's sessions and verdicts — shaped by their personal configuration in private memory. Use when the user asks for their brief, their morning, or what happened since they were last here.
---

# The morning brief

One short read that starts the day: what arrived, what changed, what
yesterday's work left behind. Every line of it comes from something recorded
on this machine — a brief is a digest of evidence, not a horoscope, and a
morning with nothing in it should read as exactly that in three lines, not
be padded into importance.

## Their brief, not the brief

Each user shapes their own. The configuration lives in the user's private
memory scope — `vault/memory/private/<user>/morning-brief.md` — because how
someone starts their day is theirs, not company knowledge:

- **If it exists, follow it.** It names the sections they want, the order,
  and the depth. Honor omissions as decisions: a config without a sessions
  section means they do not want one, not that it was forgotten.
- **If it does not exist, build the default below** without pausing to ask how
  to configure it. If the user later reacts with a durable preference —
  "shorter", "skip the inbox", "lead with sessions" — apply it in the current
  response but do not persist it directly. Sherman has no shell-validated
  private-memory retention command yet; say that plainly if persistence matters.

Never read another user's brief configuration. Scopes do not cross.

## The default sections, and where each comes from

1. **Inbox** — `vault/inbox/`: what has arrived and not yet been filed.
   Item count and one line each; flag anything that looks like it has waited
   more than a few days, because the inbox is a queue, not a shelf.
2. **What changed in shared knowledge** — recently modified files under
   `vault/wiki/` and `vault/memory/shared/`: the facts and procedures that
   moved since the user last looked. Name the file; one line on what changed.
3. **Yesterday's work** — the most recent session logs under
   `~/.sherman/sessions/` and their verdicts under `~/.sherman/evals/`: what
   was worked on, and the single highest-value change the judge proposed, if
   one stands. Sessions are cited by id; content is described by shape, and
   another person's session detail is summarized at the level they would be
   comfortable with a colleague reading aloud.
4. **Open threads** — anything the above shows as started and unfinished: an
   inbox item mid-filing, a session that ended on a question, a proposed
   skill nobody decided on. Only threads the evidence actually shows.

Order the brief so the most actionable thing is first, and keep the whole
thing under a screen. Cite the source for anything the user might act on —
a brief line someone acts on is a claim, and claims carry citations here.

## The boundaries

- **Evidence only.** Nothing in the brief that a file on this machine does
  not show. No industry news, no guesses at priorities, no filler. Thin
  mornings are said plainly.
- **No PHI, as everywhere.** If anything in the inbox or a session log
  brushes patient-identifying data, describe the shape, say the specifics
  are withheld, and point to the approved system. See `phi-boundary`.
- **The brief reads; it does not tidy.** Building it writes nothing — not
  filing inbox items, not updating the wiki. If the brief surfaces work
  worth doing, doing it is the user's next ask, made deliberately.

## Scheduling it

`sherman brief` is the schedulable form: one headless turn that builds this
brief, prints it, and — when the machine has a Telegram bot token and a
paired chat — delivers it to the phone. That command, in the operating
system's own scheduler (Windows Task Scheduler, cron), IS the scheduled
morning brief; there is no other delivery path, and the bridge alone cannot
send one (it only answers incoming messages).

If a user asks to schedule their brief, that is the answer to give — along
with its two prerequisites, checked, not assumed: a token saved via
`sherman telegram --token <token>` and a chat paired by running
`sherman telegram` once and texting it the pairing code. A missing half is
reported by `sherman brief` itself as a sentence naming the repair command.
