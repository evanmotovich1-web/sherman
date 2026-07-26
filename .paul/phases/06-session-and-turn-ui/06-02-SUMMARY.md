---
phase: 06-session-and-turn-ui
plan: 02
subsystem: ui
tags: [turn-rendering, activity-trace, status-bar, ink, fake-backend, smoke]

requires:
  - phase: 06-session-and-turn-ui
    provides: text-in-border construction (06-01), sessionId on the App, sequencing on shared app.js/smoke.sh
provides:
  - Hermes turn structure — user bullets, dim-italic event-sourced activity trace, bordered Sherman reply box signed with the mark
  - Segmented red status bar (engine · model | tokens | session minutes | turn/last timer), all true sources
  - Fake-stdio scripted-turn smoke harness driving the REAL App off-TTY
affects: [claude-backend (its events will animate the same trace), app-server transport (box already fills as text arrives), board-view]

tech-stack:
  added: []
  patterns:
    - "Trace lines render event text verbatim — no mapping table, no invented activity"
    - "Timers: useAnimation elapsed for live, finally-measured ms for durable; segments without a source do not render"
    - "Scripted-turn testing via PassThrough stdin (readable+read) against the real App"

key-files:
  created: []
  modified:
    - shell/src/ui/Transcript.js
    - shell/src/ui/Thinking.js
    - shell/src/ui/StatusBar.js
    - shell/src/ui/app.js
    - smoke.sh

key-decisions:
  - "No ctx-percent segment — the transport reports no context-window figure; the segment earns its place when a transport reports one"
  - "last-turn duration measured in finally — an interrupted turn still ran for a true amount of time"
  - "Session minutes kept honest while idle by a slow 30s tick, not by pretending the bar re-renders itself"
  - "Notice/error rows keep their old forms — only the turn path was restaged"

patterns-established:
  - "StatusBar takes injectable columns — D17 now applied to every width-branching component in the shell"
  - "A committed trace line exists ONLY because the engine emitted it; the smoke check enforces this by asserting on a fake-emitted label"

duration: ~30min
started: 2026-07-26T19:10:00Z
completed: 2026-07-26T19:40:00Z
description: "Hermes turn structure and the red segmented status bar, every value true"
type: Summary
about: "sherman"
---

# Phase 6 Plan 02: The live turn UI — Summary

**The shell now stages a conversation, not just holds one.** User turns are
bullets; the wait narrates itself in dim italic straight from the engine's own
events; the reply arrives boxed and signed `●●● Sherman` (the mark at
one-character scale); and the bar underneath carries Hermes-style segments in
the red family — every one sourced from session.info, session.usage, or a real
clock.

## What shipped

- Transcript restaged: `● <text>` user bullets (blank row above for rhythm),
  reasoning/tool events committed as 2-space-indented dim italic lines worded
  exactly as emitted, replies in a rounded box (frame red 124) whose top border
  embeds the tricolour mark dots + "Sherman" (accent bold). Box width follows
  the panel rule, wraps inside, proven non-overflowing at 80.
- Thinking became the trace's live tail: indented spinner (accent) + latest
  activity or "thinking…" + elapsed, dim italic — visually flush with the
  committed trace above it.
- StatusBar: `engine · model | N tok | session Nm | turn N.Ns / last N.Ns`.
  Frame-red separators, accent-red live timer, muted values. Segment drop
  order proven at 100/46/34/22 columns via the injectable width. No
  ctx-percent, no user/vault (identity lives on the launch block now).
- app.js: sessionStart at mount, turn start at submit, last-turn ms measured
  in `finally`; StatusBar fed {busy, sessionStart, lastTurnMs}.
- smoke check 11: fake EngineSession + PassThrough stdio drive the real App —
  types into the real composer under the sandbox HOME, requires the bullet,
  the signed border, and the fake-emitted tool label. Red-then-green proven.
  Eleven checks total.

## Verification

4/4 tasks PASS, AC-1..AC-5 verified (fixture renders, escape-level colour
asserts — 196 timer, 124 separators — and the scripted turn). Checkpoint
approved by Evan.

## Deviations

- One GAP caught during qualify and fixed in-plan: the first StatusBar cut
  read `useWindowSize()` directly, making its narrow-terminal drop behaviour
  untestable off a TTY (the exact D17 failure). Rewritten with an injectable
  `columns` prop before the checkpoint.

## Commit

`f4b7518` feat(06-02): the live turn UI — bullets, an honest trace, a signed
box, a red bar
