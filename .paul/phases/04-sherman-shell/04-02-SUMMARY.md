---
phase: 04-sherman-shell
plan: 02
subsystem: ui
tags: [ink, react, tui, node, ansi, bash, smoke]

requires:
  - phase: 04-sherman-shell
    provides: "EngineSession contract, normalized event union, Codex backend, vault-confined posture (04-01)"
  - phase: 01-launcher-chassis
    provides: "bin/sherman wizard, config, adapter assembly; install.sh; smoke.sh"
provides:
  - "Ink UI: banner header, chat transcript over native scrollback, status bar"
  - "Activity indicator with elapsed time — the perceived-speed answer to D8"
  - "Two-stage Ctrl+C: interrupt the turn, then exit"
  - "bin/sherman execs the shell; sherman --raw execs the engine"
  - "install.sh installs shell dependencies; smoke.sh at 6 checks"
affects: [board-view-phase, claude-backend-phase, v0.2-installer]

tech-stack:
  added: [ink@7.1.1, react@19.2.8]
  patterns:
    - "Single <Static> on the primary screen so the terminal owns scrollback"
    - "All turn state in app.js; every other ui/ component is presentational"
    - "Lazy import of the UI so --version/--probe survive a broken UI dependency"
    - "Two-mode handoff in bin/sherman: shell by default, engine on --raw"

key-files:
  created:
    - shell/src/ui/app.js
    - shell/src/ui/Thinking.js
    - shell/src/ui/Transcript.js
    - shell/src/ui/Header.js
    - shell/src/ui/StatusBar.js
    - shell/src/ui/Composer.js
    - shell/src/ui/theme.js
  modified:
    - bin/sherman
    - install.sh
    - smoke.sh
    - shell/bin/sherman-shell.js
    - shell/package.json
    - shell/README.md

key-decisions:
  - "D11: composer hand-rolled on useInput, no ink-text-input"
  - "D12: primary screen + <Static>, never alternateScreen"
  - "D13: banner printed once, compact header pinned"
  - "D14: missing/old Node fails loudly, never silently execs the engine"

patterns-established:
  - "A safety or feel claim is proven by a test that tries to break it"
  - "The UI renders the event contract; it never reaches into src/engine/"

duration: ~20min
started: 2026-07-26T02:17:02Z
completed: 2026-07-26T02:40:00Z
description: "Ink UI for the Sherman Shell — banner, chat pane over native scrollback, status bar, and an activity indicator with elapsed time — with bin/sherman rewired to launch it and --raw as the escape hatch."
type: Summary
about: "sherman"
---

# Phase 4 Plan 02: Sherman Shell UI + Wire-up Summary

**Typing `sherman` now opens a branded Sherman screen instead of OpenAI's chrome —
banner in house colours, chat over the terminal's own scrollback, live status bar,
and an animated indicator with elapsed time that keeps the slowest turn in the
product from reading as a hang.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~20 min (plus checkpoint review) |
| Started | 2026-07-26T02:17:02Z |
| Completed | 2026-07-26T02:40:00Z |
| Tasks | 3 auto + 1 checkpoint, all complete |
| Files created | 7 |
| Files modified | 6 |
| Lines added | ~1,433 (incl. lockfile) |
| Dependencies added | 2 (`ink`, `react`) — the project's first |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: `sherman` lands in the shell, not engine chrome | Pass | Verified in a pty: shell chrome present, zero engine-chrome markers, clean exit |
| AC-2: Header carries the mark in house colours | Pass | All four colours (196/205/135/39) intact at 41 cols; banner renders **exactly once**; missing-banner fallback produces plain text with no crash |
| AC-3: Status bar reports the live session | Pass | engine · model · user · vault · tokens; token count grew 0 → 21.2k across turns; degrades 120c→60c→45c→30c, never wraps |
| AC-4: Real conversation with scrollback | Pass | Transcript committed once per row via `<Static>`; reasoning and tool lines shown; history left in native scrollback |
| **AC-5: Thinking indicator with elapsed time** | **Pass** | Timer climbed 0.0s→4.5s in 0.1s steps; all 10 spinner glyphs cycled; label switched from `thinking` to `ran /bin/zsh -lc 'rg --files…'`; disappears on turn end |
| AC-6: Two-stage Ctrl+C | Pass | First press aborted the turn and the shell stayed up; next message answered on the same session; second press exited clean; `pgrep` showed no orphans |
| AC-7: `sherman --raw` execs the engine | Pass | Smoke check 6 asserts via a marker-writing stub that the exec actually happened |
| AC-8: Broken environments explain themselves | Pass | node missing → exit 1 + fix; node v18 → refused; `node_modules` missing → "run ./install.sh"; non-TTY stdin → sentence, not Ink's raw-mode exception |
| AC-9: smoke.sh extended without a framework | Pass | 6 checks / 17 assertions green; exactly 3 new; every prior assertion still passes; no framework, no new test dependency |

**9 of 9 Pass.**

## Accomplishments

- **Phase 4's exit condition is met.** `sherman` is Sherman's screen end to end.
  The gap Evan named after his first live run — branded up to the banner and
  unbranded after it — is closed.
- **The perceived-speed requirement was treated as load-bearing, not polish.**
  Built first in Task 2 rather than last, and proven by measurement rather than
  impression: a captured pty session shows the elapsed time advancing in 0.1s
  steps from the moment of submit. `useAnimation` supplied both the spinner frame
  and the elapsed clock, so there is no hand-rolled timer to drift.
- **The engine layer was never touched.** `shell/src/engine/` is byte-identical to
  04-01. The UI genuinely rendered the contract, which is the evidence that
  `EngineSession` is a real seam and not a decorative one.
- **Scrollback belongs to the terminal.** Choosing the primary screen over Ink's
  alternate screen means the transcript lives where users already know how to
  navigate it. The tidier fixed layout was the thing worth giving up.
- **The diagnostic survives its own subject.** `--version` and `--probe` import
  neither Ink nor React, so the tool you would use to debug a broken UI cannot be
  taken down by that UI — and smoke checks 4 and 5 pass on a machine that has
  never run `npm install`.

## Task Commits

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| Plan metadata | `879240d` | docs | 04-02 PLAN + ROADMAP + STATE, incl. probed UI facts |
| Tasks 1–3 | `fcd2b82` | feat | UI, launcher wire-up, installer, smoke |

Committed as one feature commit: the three tasks are indivisible — the chrome does
not run without the turn loop, and the launcher swap is what makes either
reachable.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `shell/src/ui/app.js` | Created (142) | Root component; all turn state, event mapping, two-stage Ctrl+C |
| `shell/src/ui/Thinking.js` | Created (42) | Activity indicator: spinner + elapsed time + live activity label |
| `shell/src/ui/Transcript.js` | Created (103) | Committed history via one `<Static>`; banner as its first item |
| `shell/src/ui/Header.js` | Created (72) | Full banner (once) and the compact pinned header |
| `shell/src/ui/StatusBar.js` | Created (77) | engine · model · user · vault · tokens, with width degradation |
| `shell/src/ui/Composer.js` | Created (81) | Input line on `useInput`; strips control chars from pastes |
| `shell/src/ui/theme.js` | Created (37) | House palette and spinner glyphs, in one place |
| `bin/sherman` | Modified | `--raw` parsing, Node/deps guards, exec the shell by default |
| `install.sh` | Modified | Installs shell dependencies; npm missing is a warning, not a failure |
| `smoke.sh` | Modified | Checks 2–3 moved to `--raw`; three new checks added |
| `shell/bin/sherman-shell.js` | Modified | Default path starts the Ink app behind a TTY guard; lazy UI import |
| `shell/package.json` | Modified | `ink` + `react`; version 0.2.0; Node >=22 |
| `shell/README.md` | Modified | How to run, Ctrl+C contract, and the UI decisions |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| **D11** Composer on `useInput` | Ink 7 has no text input; `ink-text-input` peers `ink>=5`, untested against 7 | ~40 lines, zero added risk, full control of feel |
| **D12** Primary screen + `<Static>` | Ink's alternate screen makes scrollback unavailable | Transcript lives in native scrollback; mouse wheel works |
| **D13** Banner once, compact header pinned | 18 lines pinned leaves 6 rows on a 24-row terminal | `bin/sherman` skips the banner in shell mode so it prints once |
| **D14** Node problems fail loudly | A silent fallback puts the user in engine chrome believing they are in Sherman | Guards exit non-zero and name the fix; `--raw` stays a choice |
| Lazy UI import | A broken UI dependency should not disable the tool that debugs it | `--version`/`--probe` work with no `node_modules` |
| Commit the lockfile | Reproducible installs matter once v0.2 onboards other machines | `shell/package-lock.json` tracked |
| Strip control chars from bulk input | A paste arrives as one chunk and could carry CR/LF into the prompt | Pasted newlines do not auto-send; no stray bytes reach the engine |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 2 | Both caught by verification; no scope change |
| Scope additions | 1 | Two lines in `bin/sherman`; prevented a visible regression |
| Deferred | 0 | — |

**Total impact:** None on scope. One necessary addition the plan had not anticipated.

### Auto-fixed Issues

**1. [Correctness] Status bar drop order conflated with display order**
- **Found during:** Task 1, while writing `StatusBar.js`
- **Issue:** I used one array for both "left-to-right layout" and "what to sacrifice
  first". They are different orders — the brief wants `engine · model · user · vault`,
  while the vault path is the first thing that should go. Reversing one list for the
  other produced `engine · user · model` after a drop.
- **Fix:** Split into `DISPLAY_ORDER` and `DROP_ORDER` with a comment explaining why
  they differ.
- **Verification:** Rendered at 120/80/60/45/30/20 columns; drops vault, then model,
  then user, and never exceeds the terminal width.

**2. [Hygiene] Literal control bytes written into source**
- **Found during:** Task 2, adding paste sanitisation
- **Issue:** The control-character regex went into `Composer.js` as literal
  `\x00-\x1f` *bytes* rather than escapes. Functionally valid, but invisible in an
  editor, undetectable by grep, and liable to be mangled by any tool that touches
  the file.
- **Fix:** Rewrote the file with an explicit `/[\x00-\x1f\x7f]/g` named constant.
- **Verification:** A `grep -P` scan for literal control bytes in the file returns
  nothing.

### Scope Addition

**Banner double-print, and the `wizard_header` it required**
- The plan had `bin/sherman` keep its `launch_screen` and the shell render the
  banner — which would have printed the mark twice on every launch. Not visible
  until the two halves met.
- Fix: `launch_screen` now runs only in `--raw` mode, and a small `wizard_header`
  covers the first-run wizard so it is not left unbranded when heading into the
  shell. Verified: `▄██▄` appears exactly once per launch.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Piped `\r` did not submit in the pty harness | Not a bug: piping delivers a whole line as one chunk, so Ink sees bulk text rather than a discrete Enter. Real typing arrives key by key. Harness sends Enter separately — and the finding prompted the paste sanitisation above |
| My own width measurement reported the banner at 43 columns | Test-harness bug: the `ESC` constant in the checker was an empty string, so the regex stripped `[38;5;196m` and left the bare escape byte. Re-measured with a proper escape: 41 columns, as originally probed |
| Verify scripts could not resolve `react` from the scratchpad | ESM resolves from the importing file, so verification scripts had to sit inside `shell/`. Written as dot-prefixed temp files and removed after each run |

## Skill Audit

No `.paul/SPECIAL-FLOWS.md` in this project — no required skills configured.

Repo convention honoured: `graphify update .` run after each commit per `AGENTS.md`
(263 → 288 nodes). `graphify-out/` is gitignored and was never committed.

## Next Phase Readiness

**Ready:**
- **The board view is now unblocked.** §3c gated it on "right after the chat loop is
  solid" — it is. It slots in as another region in `app.js` against the same
  contract, and `Transcript`/`StatusBar` are the pattern to copy.
- The UI/engine seam is proven by construction: this whole plan shipped without
  editing `shell/src/engine/`. A Claude backend is now genuinely a one-file job.
- `theme.js` centralises the palette, so further UI work inherits the house colours
  without rediscovering them.
- `--probe` remains the fault-isolation tool between engine and renderer.

**Concerns:**
- **The first turn is still the slowest thing a user meets** (~19,900 input tokens,
  nothing cached until turn 2). The indicator now covers it honestly, but it does
  not make it fast. If it grates, the fix is D8 — the app-server transport — not
  more UI.
- **Node 22+ is a hard dependency** for the UI, supplied on this Mac by Hermes'
  bundled runtime (`~/.local/bin/node → ~/.hermes/node/bin/node`). v0.2's installer
  has to decide: require Node, or bundle it. `--raw` is the only path without it.
- **`ink` and `react` are the project's first dependencies.** Modest, but Ink 7
  requires React ≥19.2 and Node ≥22, so a Node upgrade is now a UI compatibility
  question too.
- **No conversation history across runs.** Deliberate (thread id is in memory), but
  now that the shell looks like a chat app, users will expect the last conversation
  to still be there.
- **Composer is minimal by design** — no history recall, no multi-line editing, no
  cursor movement within the line. Fine for v1; the first thing to feel missing will
  probably be up-arrow for the previous message.

**Blockers:**
None. Phase 4 is complete.

---
*Built with PAUL Framework v1.4 · https://chrisai.cv/skool · https://youtube.com/@chris-ai-systems*
*Phase: 04-sherman-shell, Plan: 02*
*Completed: 2026-07-26*
