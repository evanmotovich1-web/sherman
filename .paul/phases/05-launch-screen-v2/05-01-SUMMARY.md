---
phase: 05-launch-screen-v2
plan: 01
subsystem: ui
tags: [ink, react, terminal, ansi, launch-screen, wordmark]

requires:
  - phase: 04-sherman-shell
    provides: EngineSession contract (session.info), the single <Static> transcript, D12/D13
provides:
  - Layered SHERMAN wordmark in two sizes, generated from one glyph table
  - Compact three-circle mark for panel use
  - Bordered two-column launch panel with live vault counts
  - Vault stats reader (shell/src/vault.js)
  - Width-injection pattern that makes width-dependent UI testable off a TTY
affects: [board-view, skills-phase, vault-seed, any future launch-time surface]

tech-stack:
  added: []
  patterns:
    - "Injectable columns prop overriding useWindowSize, for off-TTY testability"
    - "Committed transcript items carry their own data, captured at mount"
    - "Width assertions measured in code points after ANSI strip"

key-files:
  created:
    - shell/src/ui/Wordmark.js
    - shell/src/ui/Mark.js
    - shell/src/ui/LaunchScreen.js
    - shell/src/vault.js
  modified:
    - shell/src/ui/theme.js
    - shell/src/ui/Transcript.js
    - shell/src/ui/app.js
    - shell/src/ui/Header.js
    - smoke.sh

key-decisions:
  - "D15: READMEs excluded from vault counts — the panel reports knowledge, not files"
  - "D16: 'Keys' not 'Commands' — the shell has no slash commands to list"
  - "D17: Width injected as a prop, because useWindowSize is blind under renderToString"

patterns-established:
  - "Any width-branching component takes an optional columns prop; the screen resolves width once and passes it down"
  - "A new smoke check must be proven to fail before it is trusted"

duration: ~55min
started: 2026-07-26T06:33:00Z
completed: 2026-07-26T07:28:10Z
description: "Launch screen v2 — layered 55x7 SHERMAN wordmark, bordered two-column panel with live vault counts, honest welcome line"
type: Summary
about: "sherman"
---

# Phase 5 Plan 01: Launch screen v2 Summary

**Sherman's first frame now states what it is, what it can reach and how to drive
it — with every value on it read from config, `session.info` or a readdir, and
nothing invented.**

## Performance

| Metric | Value |
|---|---|
| Duration | ~55 min |
| Started | 2026-07-26T06:33:00Z |
| Completed | 2026-07-26T07:28:10Z |
| Tasks | 4 auto + 1 checkpoint, all complete |
| Files created | 4 |
| Files modified | 5 |
| Qualify results | 4 PASS (2 reached PASS after a fix) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|---|---|---|
| AC-1: Large layered wordmark | Pass | 55 cols × 7 rows measured; lit rim 203, body 196/196/160/124/124, shadow 88 |
| AC-2: Narrow fallback | Pass | 41 cols × 5 rows below 58 columns; boundary asserted at both 57 and 58 |
| AC-3: Panel carries only true content | Pass | Every value from `session.info` or `readVaultStats`; footer shows engine · model · exit |
| AC-4: Vault counts live and honest | Pass | Real vault → all zeros; seeded temp dir → wiki:2 with README/.txt/subdir excluded |
| AC-5: Skills absent until skills exist | Pass | Output contains no "Skill" substring at any of four widths |
| AC-6: One welcome line, no exclamation | Pass | Asserted no `!` at 60/80/100/200; text adapts to empty vs unreachable vault |
| AC-7: Existing surfaces untouched | Pass | `git diff --stat` empty for `logo/`, `shell/src/engine/`, `bin/sherman`, StatusBar/Composer/Thinking/config |
| AC-8: Smoke green, exactly two new checks | Pass | 8 checks green; checks 7–8 added; proven to fail on a deliberate overflow |

## Accomplishments

- **The wordmark reads as an object rather than a stencil.** One glyph table
  renders both a 55×7 layered form (lit top edge, body darkening down a red ramp,
  cast shadow) and the existing 41×5 flat form as the narrow fallback. Because
  both come from the same table, the fallback can never drift from the mark.
- **The panel is entirely true.** Four live counts, three identity fields, the
  real key bindings, and a footer — no placeholder copy anywhere. It currently
  reads `0` across the board, which is the correct answer and now visible on
  every launch instead of buried in STATE.md.
- **Width-dependent UI became testable.** `useWindowSize()` is blind to
  `renderToString`'s `columns`; without the injection pattern found here, both
  new smoke checks would have rendered at 80 regardless of the width they claimed
  to test and proven nothing.
- **`logo/` and `shell/src/engine/` were never opened.** R12's record — a whole
  UI shipped without touching the engine seam — survives a second phase.

## Files Created/Modified

| File | Change | Purpose |
|---|---|---|
| `shell/src/ui/Wordmark.js` | Created (134) | Two wordmark sizes from one glyph table; width-based selection |
| `shell/src/ui/LaunchScreen.js` | Created (225) | Wordmark + bordered two-column panel + welcome line |
| `shell/src/vault.js` | Created (89) | Live vault counts; guarded, non-recursive, README-excluding |
| `shell/src/ui/Mark.js` | Created (73) | Three-circle mark compacted to 10×8 for the panel column |
| `smoke.sh` | Modified (+78) | Checks 7–8: launch screen renders at 80 and 200 columns without overflow |
| `shell/src/ui/app.js` | Modified (+24) | Seeds the `launch` item; reads vault stats once at mount |
| `shell/src/ui/theme.js` | Modified (+21) | Red depth ramp (`lit`/`bright`/`mid`/`deep`/`shadow`) |
| `shell/src/ui/Header.js` | Modified (+14) | Comment recording that `Banner` is no longer the shell's opener |
| `shell/src/ui/Transcript.js` | Modified (+6) | `launch` item kind; `banner` kept as a fallback |

## Decisions Made

| # | Decision | Rationale | Impact |
|---|---|---|---|
| D15 | READMEs excluded from vault counts | The panel's whole value is that its numbers are true. Counting scaffolding prints "1 wiki page" over an empty vault | Panel reads 0 until R8 lands — honest, and keeps pressure on the real gap |
| D16 | Section titled "Keys", not "Commands" | The shell has zero slash commands; `/help` does not exist. A Commands section would be empty or invented | Renaming is a one-line change the day a command ships |
| D17 | Width injected as an optional prop | `useWindowSize()` returns a fixed 80×24 under `renderToString` — the option drives layout only | Any future width-branching component must follow this or be untestable |
| D18 | `engine · model` in the footer only | The brief placed it in both the left column and the footer of the same box; printed twice inside one border it reads as a rendering bug | Left column is identity, footer is runtime — everything on screen once |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|---|---|---|
| Auto-fixed | 2 | Both essential; one changed the plan's own premise |
| Scope additions | 0 | — |
| Deferred | 1 | Logged below, not blocking |

**Total impact:** No scope creep. One fix corrected a factual error in the plan.

### Auto-fixed Issues

**1. [Correctness] `useWindowSize()` does not see `renderToString`'s `columns`**
- **Found during:** Task 1 qualify — the "small wordmark at 50 columns" assertion
  returned the large form truncated to 50.
- **Issue:** The plan's probed fact 1 was incomplete. The hook returns a hardcoded
  80×24 off a TTY; the `columns` option drives layout and truncation only. The
  consequence was worse than a failing test: AC-2's fallback branch was unprovable,
  and both new smoke checks would have silently rendered at 80 while claiming to
  test 80 and 200.
- **Fix:** `Wordmark` and `LaunchScreen` take an optional `columns` prop that
  overrides the hook. Live, nothing passes it. `LaunchScreen` resolves width once
  and passes it down, so the wordmark and panel cannot disagree.
- **Files:** `Wordmark.js`, `LaunchScreen.js`
- **Verification:** 57→small / 58→large asserted; no-prop path still selects large.
  Corrected fact recorded in STATE.md.

**2. [Quality] Vault path truncated mid-word**
- **Found during:** Task 3 qualify — all 16 assertions passed, but the render showed
  `…de/sherman/vault`.
- **Issue:** Character-exact truncation (StatusBar's approach, correct for a status
  line that must hit a total width) produces a directory-name fragment in a narrower
  column. The component's own comment promised `…/sherman/vault`.
- **Fix:** `truncatePath` drops whole path segments, falling back to character-exact
  only when a single segment exceeds the budget.
- **Files:** `LaunchScreen.js`
- **Verification:** Renders `…/sherman/vault`; all 16 assertions still pass.

### Deferred Items

- **`truncatePath` and StatusBar's `truncateLeft` are near-duplicates.** StatusBar
  is under this plan's DO-NOT-CHANGE boundary and its character-exact behaviour is
  correct for its own use, so extraction was deliberately not attempted. Worth
  revisiting only if a third caller appears.

## Issues Encountered

| Issue | Resolution |
|---|---|
| Verification scripts outside `shell/` could not resolve `react`/`ink` | Node resolves `node_modules` from the script's location, not cwd. Ran via `node --input-type=module -e` with cwd `shell/`; the smoke checks use the same form |
| A new smoke check that always passes is worthless | Forced the panel width to 300, confirmed checks 7–8 go red (16 overflowing lines at both widths), restored and re-verified |

## Next Phase Readiness

**Ready:**
- The launch surface is done and will not need revisiting when the vault fills —
  the counts are live, so knowledge appears on the panel the moment it lands.
- The width-injection pattern is established for the board view, which is the
  next UI surface and will face the same layout constraints.
- `shell/src/vault.js` is a general vault reader; any future surface that wants to
  report on vault contents has a tested, guarded starting point.

**Concerns:**
- **The panel makes R8 impossible to ignore.** Every launch now states the vault is
  empty. That is intended, but it means the empty brain is the product's first
  impression until Phase 2/3 land.
- The mark is 8 rows and the panel ~16; on a 24-row terminal the launch screen fills
  the first screen before scrolling away. Consistent with D12/D13 (it commits to
  scrollback), but it is a bigger opener than the banner it replaced.

**Blockers:**
- None for this phase. Phase 3 remains blocked on design-doc §7 Q1.

---
*Phase: 05-launch-screen-v2, Plan: 01*
*Completed: 2026-07-26*
