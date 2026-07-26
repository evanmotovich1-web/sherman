---
phase: 04-sherman-shell
plan: 01
subsystem: engine
tags: [codex, node, esm, jsonl, child-process, seatbelt-sandbox, tui]

requires:
  - phase: 01-launcher-chassis
    provides: "~/.sherman/config.json (wizard) and the assembled adapter at ~/.sherman/workspace/AGENTS.md"
provides:
  - "EngineSession contract + engine-agnostic normalized event stream"
  - "Working Codex backend over `codex exec --json` + `exec resume`"
  - "Claude stub backend implementing the full contract"
  - "Vault-confined permissions posture, proven by an escape test"
  - "--probe headless harness for isolating engine faults from UI faults"
affects: [04-02-shell-ui, claude-backend-phase, v0.3-vault-service]

tech-stack:
  added: []
  patterns:
    - "Normalized event union as the UI/engine seam"
    - "One argv builder shared by first-turn and resume so posture cannot drift"
    - "Tolerant parsing: unknown event types ignored, malformed JSON skipped"

key-files:
  created:
    - shell/src/engine/session.js
    - shell/src/engine/codex.js
    - shell/src/engine/claude.js
    - shell/src/engine/index.js
    - shell/src/config.js
    - shell/bin/sherman-shell.js
    - shell/README.md
  modified:
    - .gitignore

key-decisions:
  - "D8: codex exec --json + exec resume, not the [experimental] app-server protocol"
  - "D9: vault boundary via the macOS seatbelt sandbox, not by disabling shell_tool"
  - "Model name read best-effort for display; never forced with -m"

patterns-established:
  - "Engine specifics quarantined in one backend file; session.js holds zero vendor detail"
  - "Safety claims must be proven by a test that tries to break them"

duration: ~11min
started: 2026-07-26T01:42:30Z
completed: 2026-07-26T01:53:12Z
description: "Headless engine layer: EngineSession contract, real Codex backend over exec --json + resume, Claude stub, and a vault boundary proven by escape test."
type: Summary
about: "sherman"
---

# Phase 4 Plan 01: Sherman Shell — Engine Layer Summary

**A real multi-turn conversation with Sherman now runs from the command line
through one engine-agnostic interface, with the engine sealed inside the vault by
the OS — proven, not asserted.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~11 min |
| Started | 2026-07-26T01:42:30Z |
| Completed | 2026-07-26T01:53:12Z |
| Tasks | 3 of 3 completed |
| Files created | 7 (+1 modified) |
| Lines added | 993 |
| npm dependencies added | 0 |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Entry point runs and reports version | Pass | `--version` → `0.1.0`, exit 0, no engine contacted |
| AC-2: Backend selection respects config engine | Pass | codex → `CodexSession`; claude → stub, one error event, no stack trace; `gemini` → throws naming value + valid options |
| AC-3: Real Codex turn yields normalized events | Pass | `--probe` returned PONG via `turn-start` → `message` → `turn-end`; no raw codex shape leaked |
| AC-4: Second turn remembers the first | Pass | "BANANA" recalled on turn 2, same thread id, `cachedInput: 19200` |
| AC-5: Token usage per turn and per session | Pass | Per-turn `turn-end.usage`; session total accumulated (60,258 across 2 turns) |
| AC-6: Engine confined to the vault | Pass | Inside vault: succeeded. `$HOME`: **denied**. Network: **denied** (curl exit 6, DNS unresolvable). No `--dangerously-*` in argv |
| AC-7: Interrupt without ending the session | Pass | `interrupted` emitted, thread retained, next `send()` answered ALIVE on the same thread, `pgrep` clean, exit 0 |
| AC-8: Transport + posture documented | Pass | `shell/README.md` carries the decision, evidence, cost accepted, exact flags, and both traps |

**8 of 8 Pass.**

## Accomplishments

- **The either-engine promise moved to the UI seam.** `session.js` defines the
  contract and holds zero vendor detail; `codex.js` is the only file in `shell/`
  that knows Codex exists. A UI written against the event union cannot tell which
  engine answered — which is what makes the Claude backend a later file rather
  than a later rewrite.
- **The vault boundary is real and was tested adversarially.** The engine ran
  `/bin/zsh` during the test and *still* could not write to `$HOME` or resolve
  DNS. Shell execution and data confinement turned out to be separable, which is
  what made D9 possible.
- **Sherman is Sherman through the headless path.** Asked who it is, it answers
  "Sherman Abrams, the operations agent for Sherman Abrams Labs" and names its own
  vault paths — confirming the Phase 1 adapter is picked up via cwd, the detail
  most likely to have silently failed.
- **Zero dependencies.** The whole engine layer is stdlib Node, so it is
  verifiable without a `node_modules` tree. Ink arrives only in 04-02.
- **Free token accounting.** `turn.completed.usage` feeds the 04-02 status bar
  with no extra bookkeeping.

## Task Commits

Committed as one feature commit rather than per-task, because the three tasks form
a single indivisible unit — the skeleton does not run without the backend, and the
README documents a posture only Task 3 proved.

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| Plan metadata | `7a9b4dd` | docs | 04-01 PLAN + ROADMAP Phase 4 + STATE |
| Tasks 1–3 | `1f75e0a` | feat | Engine layer: contract, Codex backend, stub, config, harness, README |
| State after APPLY | `7536aa2` | docs | Execution record and deviations |

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `shell/src/engine/session.js` | Created (125) | `EngineSession` contract, normalized event union, usage helpers. The seam. |
| `shell/src/engine/codex.js` | Created (312) | Codex backend: spawn per turn, JSONL parsing, posture argv, interrupt |
| `shell/src/engine/claude.js` | Created (55) | Stub implementing the full contract; points at `sherman --raw` |
| `shell/src/engine/index.js` | Created (31) | `selectBackend()` from the config's engine field |
| `shell/src/config.js` | Created (84) | Reads `~/.sherman/config.json`; resolves `$HOME` live; maps snake_case at the boundary |
| `shell/bin/sherman-shell.js` | Created (143) | `--version`, `--help`, `--probe` harness |
| `shell/README.md` | Created (229) | Transport decision, posture, both traps, the contract |
| `shell/package.json` | Created (13) | ESM, no dependencies |
| `.gitignore` | Modified | `node_modules/` ahead of 04-02 |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| **D8** `codex exec --json` + `exec resume`, not app-server | Stable CLI verified working end-to-end; app-server is `[experimental]` with 39+ message types and would break on `codex update` | No typewriter streaming in v1. 04-02 must carry perceived responsiveness. Swap stays a one-file change |
| **D9** Boundary via seatbelt sandbox, not by disabling `shell_tool` | On Codex, file access is delivered *through* shell; disabling it strips the capability Sherman needs. The kernel cannot be talked around | Stronger boundary than a tool allow-list. Shell runs but is sealed |
| Model read best-effort for display; never `-m` | Forcing a model to make a label easier would hijack the user's own choice | Status bar shows `gpt-5.6-sol` (Evan's actual model); no override risk |
| One argv builder for turn 1 and resume | `exec resume` accepts a narrower flag set; two code paths would silently drift | Posture verified byte-identical across turn kinds |
| `threadId` in memory only | `~/.sherman/workspace/` is disposable by design (R10) | No cross-run history in v1; nothing to lose on relaunch |
| Tolerant parsing | The codex event set will grow | An unknown `type` cannot take the shell down |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 2 | Both mechanical; no scope or behavior change |
| Scope additions | 0 | — |
| Deferred | 0 | — |

**Total impact:** None on scope or behavior. One was a task-ordering artifact, the
other an imprecise verify command in the plan I wrote.

### Auto-fixed Issues

**1. [Ordering] `codex.js` created in Task 1, not Task 2**
- **Found during:** Task 1 (skeleton)
- **Issue:** `selectBackend` imports `codex.js`, so Task 1's own verify could not
  resolve the module. The plan listed the file only under Task 2.
- **Fix:** Created a minimal skeleton in Task 1 (constructor, `info`, `usage`,
  inheriting the base class's throwing `send`/`interrupt`); Task 2 replaced it with
  the real implementation.
- **Files:** `shell/src/engine/codex.js`
- **Verification:** Task 1 verify passed with the skeleton; Task 2 verify passed
  against real Codex.
- **Commit:** `1f75e0a`

**2. [Verify precision] `grep -rn "dangerously" shell/` cannot return nothing**
- **Found during:** Task 2 qualify
- **Issue:** The plan required that grep return no matches. It returns two — both
  inside the comment that *forbids* those flags. The check was imprecise, not the
  code; satisfying it literally would have meant deleting useful safety guidance.
- **Fix:** Replaced with a precise pair of checks — no `--dangerously` outside
  comment lines, and the built argv for both turn 1 and resume asserted free of it.
- **Files:** none (verification only)
- **Verification:** Both checks pass; AC-6's actual requirement (no invocation
  passes the flags) holds.
- **Commit:** `1f75e0a`

### Deferred Items

None.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| `codex exec` hung reading stdin during pre-plan probing | Root-caused before planning: codex reads stdin when it is not a TTY. Encoded as `stdio: ['ignore','pipe','pipe']` and documented as Trap 1 |
| `codex exec resume` rejected `-s/--sandbox` | Found before planning. Resume takes a narrower flag set, so all posture travels as `-c` overrides and cwd comes from spawn. Documented as Trap 2 |
| Sandbox wanted `cwd` = vault; Codex reads `AGENTS.md` from `cwd` = workspace | Resolved at plan time: cwd stays the workspace, vault reaches writability via `sandbox_workspace_write.writable_roots`. Verified by the persona answering correctly |
| Parallel Codex session committed `4e2bca4` mid-APPLY | Checked for overlap with `shell/` and every protected file: none. Its in-flight `logo/` edits left uncommitted and untouched |

## Skill Audit

No `.paul/SPECIAL-FLOWS.md` in this project — no required skills configured, so no
audit applies.

## Next Phase Readiness

**Ready:**
- `EngineSession` + the normalized event union are stable and documented. 04-02's
  Ink UI can be written against `shell/README.md` without reading `codex.js`.
- Status-bar inputs all exist: `info.engine`, `info.model`, `info.user`,
  `info.vaultPath`, `info.threadId`, and `usage.total`.
- Interrupt semantics settled: `interrupt()` aborts the turn and the session
  survives on the same thread. 04-02 wires first Ctrl+C → `interrupt()`,
  second → clean exit.
- `--probe` stays as the diagnostic that separates engine faults from render faults.
- Every event kind that the UI must render is enumerated, including `tool` and
  `reasoning`, which real turns do emit.

**Concerns:**
- **No token deltas (D8).** A single short answer lands all at once after a
  multi-second pause. 04-02 must ship an activity indicator and elapsed timer or
  the shell will *feel* slower than raw Codex while being no slower.
- **First turn is cold.** ~19,900 input tokens on turn 1 with 0 cached; caching
  only kicks in from turn 2 (19,200 cached). The first response is the slowest one
  a user sees, which is the worst place for it.
- **`bin/sherman` is still untouched**, by design. Until 04-02, typing `sherman`
  goes straight to Codex chrome — the engine layer is not reachable from the
  command a user actually types.
- **The Claude backend is a stub.** Anyone whose config says `claude` gets a clear
  refusal, not a session. Fine for Evan (codex), blocking for an Anthropic user.
- **Codex-version coupling.** The posture depends on `sandbox_mode`,
  `sandbox_workspace_write.writable_roots` and `approval_policy` keeping their
  names. Re-run the boundary test after any `codex update`; the README says so.

**Blockers:**
None for 04-02.

---
*Built with PAUL Framework v1.4 · https://chrisai.cv/skool · https://youtube.com/@chris-ai-systems*
*Phase: 04-sherman-shell, Plan: 01*
*Completed: 2026-07-26*
