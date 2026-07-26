---
phase: 06-session-and-turn-ui
plan: 01
subsystem: launcher + ui
tags: [session-id, jsonl-log, attribution, sherman-update, launch-screen, wordmark, ink]

requires:
  - phase: 05-launch-screen-v2
    provides: LaunchScreen, Wordmark glyph tables, injectable-columns pattern (D17), only-true-content rule
provides:
  - One session id per launch, minted in bin/sherman, identical in the adapter, both handoffs, the panel, and the log
  - JSONL turn log at ~/.sherman/sessions/<id>.jsonl with a may-fail-silently, may-never-crash contract
  - Memory-attribution rule in every assembled adapter ("— user · session · date")
  - `sherman update` subcommand, honest in all three repo states
  - Launch screen v3 — SHERMAN AGENT two-deck wordmark, identity block, build stamped into the panel border, full-height opener
  - Text-in-border construction (composed top line + borderTop:false), reused by 06-02's Sherman box
affects: [06-02-turn-ui, vault-seed (attribution now precedes first facts), v0.2 installer (update paths)]

tech-stack:
  added: []
  patterns:
    - "Per-launch state travels by env (SHERMAN_SESSION_ID), never config.json"
    - "Injectable rows prop joins columns — D17 now covers height"
    - "Build info read once per process, guarded, segments omitted on absence"

key-files:
  created:
    - shell/src/sessionlog.js
  modified:
    - bin/sherman
    - shell/bin/sherman-shell.js
    - shell/src/ui/app.js
    - shell/src/ui/LaunchScreen.js
    - shell/src/ui/Wordmark.js
    - shell/src/ui/Transcript.js
    - smoke.sh

key-decisions:
  - "Session id minted in the LAUNCHER, not the shell — the adapter is assembled before the shell exists, so a shell-minted id could never reach attribution"
  - "Update/smoke recursion broken by SHERMAN_UPDATE_RUNNING env guard, so the future remote-having update cannot loop"
  - "Panel footer's engine · model replaced by the identity block's model line — the one-appearance principle from D18 moves with it"
  - "AGENT rendered as a sub-deck (small glyphs full-width, spaced tag narrow), because a 7-wide AGENT would need 103 columns"

patterns-established:
  - "The session log may quietly die but may never crash a turn or print noise — one failure disables it for the session"
  - "Version segments are omitted entirely when their source is absent; no blank separators, no invented upstream"

duration: ~45min
started: 2026-07-26T18:20:00Z
completed: 2026-07-26T19:05:00Z
description: "Session identity everywhere it was promised, sherman update, and the Hermes-posture first frame"
type: Summary
about: "sherman"
---

# Phase 6 Plan 01: Session identity, lifecycle & the first frame v3 — Summary

**Every Sherman session now has a name, and the first frame wears it.** One id
minted per launch reaches the adapter's new attribution rule, both handoffs,
the launch panel, and a JSONL turn log — so the day the vault starts filling
(R8), every fact is already traceable to who learned it, in which session, on
what date.

## What shipped

- `bin/sherman` mints `YYYYMMDD_HHMMSS_<6 hex>` (bash-3.2-safe recipe), exports
  `SHERMAN_SESSION_ID`, and splices a Memory attribution section into the
  assembled body: every memory fact file ends `— <user> · <session> · <date>`.
  Templates untouched.
- `shell/src/sessionlog.js` appends `{role, at, text}` JSONL lines under
  `~/.sherman/sessions/` — proven to log a real turn (user + sherman lines,
  exact key order) and to survive a blocked `~/.sherman` silently, mid-turn.
- `sherman update`: not-a-checkout → installer message, exit 0; checkout
  without remote (today) → version + "no update source configured", exit 0;
  remote → `pull --ff-only` (never merge), npm only if the pull changed
  `shell/package.json`, then smoke. Recursion guard proven by design.
- Launch screen v3: SHERMAN deck + right-aligned AGENT sub-deck (G and T
  glyphs added to both tables), identity block (`model · Sherman Abrams Labs`,
  folder, session), and the build stamped into the panel's top border via the
  composed-line + `borderTop:false` construction. Opener fills the viewport
  through an injectable `rows` prop; 24-row terminals clamp to the old gap.
- smoke: check 3 asserts the id and attribution line; new check 10 runs
  `sherman update` live. Ten checks, all green.

## Verification

4/4 tasks PASS. AC-1..AC-6 all verified: same-id-everywhere via smoke + JSONL
test, unwritable-HOME resilience, git-absent border omission
(`╭─ Sherman Abrams v0.2.0 ─╮`, no dangling separators), non-git `update`
branch in a temp copy, renders at 50/80/200 columns and 80×40 with zero
overflow. Checkpoint approved by Evan.

## Deviations

- `Transcript.js` gained a one-line `sessionId` pass-through to LaunchScreen —
  the plan's files list missed the wiring hop. Logged during APPLY.
- The `rows` injection required `wordmarkRows()`/`LARGE_ROWS`/`SMALL_ROWS`
  exports from Wordmark.js — within the planned file set, noted for D17's
  record: the pattern now covers height as well as width.

## Commit

`99331f3` feat(06-01): a session has a name — identity, lifecycle, and the
first frame v3
