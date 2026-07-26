---
phase: 01-launcher-chassis
plan: 01
subsystem: infra
tags: [bash, cli, launcher, adapters, claude-code, codex, awk, jq]

requires: []
provides:
  - "`sherman` command on PATH"
  - "Launch-time adapter assembly from a single persona source"
  - "Two-tier memory wiring (shared vault + per-user private)"
  - "No-PHI compliance rule injected on every launch"
  - "Engine-agnostic contract: Claude Code and Codex adapters"
affects: [logo-vault-seed, skills, installer-v0.2, vault-service-v0.3]

tech-stack:
  added: []
  patterns:
    - "One persona + N thin adapters — engine-specific text confined to adapters/"
    - "Adapter regenerated every launch; workspace is disposable, repo is truth"
    - "awk splice for multi-line markdown injection (never sed)"
    - "vault_path as config field so backend swap stays a config change"

key-files:
  created:
    - bin/sherman
    - install.sh
    - smoke.sh
    - agent/SYSTEM.md
    - adapters/claude-code/CLAUDE.md
    - adapters/codex/AGENTS.md
  modified: []

key-decisions:
  - "Vault at <repo>/vault, recorded as config field (brief overrides design-doc §2)"
  - "PATH priority ~/.local/bin → ~/bin → /usr/local/bin (machine reality)"
  - "Adapter templates hold only wrapper + {{SHERMAN_BODY}} token"
  - "awk not sed for the splice"
  - "jq not python3 in smoke (pyenv shim is HOME-dependent)"
  - "Real first run left to Evan — the provider question is his"

patterns-established:
  - "Every launch: rm both adapter files, write one — no stale sibling on engine switch"
  - "All runtime state under $HOME read live, never hardcoded — makes HOME-override testing real"
  - "smoke.sh sandboxes with mktemp HOME + stub engine on PATH, and cleans its own vault litter"

duration: ~8min
started: 2026-07-26T01:00:10Z
completed: 2026-07-26T01:08:32Z
description: "`sherman` launcher chassis: banner, two-question wizard, launch-time adapter assembly from one persona, two engine adapters, 3-check smoke"
type: Summary
about: "sherman"
---

# Phase 1 Plan 01: Launcher chassis — Summary

**`sherman` is a working command: banner → two-question wizard → an engine session whose context carries the persona, both vault tiers, the operator's name, and the no-PHI rule — assembled fresh from the repo on every launch.**

## Performance

| Metric | Value |
|---|---|
| Duration | ~8 min |
| Started | 2026-07-26T01:00:10Z |
| Completed | 2026-07-26T01:08:32Z |
| Tasks | 3 of 3 completed |
| Files created | 7 (656 lines) |
| Qualify results | 3 PASS, 0 GAP, 0 DRIFT |
| Escalation statuses used | None (all DONE) |

## Acceptance Criteria Results

| Criterion | Status | Evidence |
|---|---|---|
| AC-1: Command exists, install idempotent | **Pass** | `./install.sh` twice → identical report, one symlink at `~/.local/bin/sherman`, `command -v sherman` resolves |
| AC-2: First run asks exactly two questions | **Pass** | Piped `1` + `Smoke Tester` → `{"version":1,"engine":"claude","user":"smoke-tester","vault_path":"…/vault"}`, private dir created, engine exec'd |
| AC-3: Missing engine fails loudly | **Pass** | Answer `2` with empty PATH → `npm install -g @openai/codex`, exit 1, **no config written** |
| AC-4: Every launch reassembles adapter | **Pass** | Second run silent; config flipped to `codex` → `AGENTS.md` written and `CLAUDE.md` removed |
| AC-5: Adapter carries persona, vaults, user, PHI rule | **Pass** | All six greps present, `{{SHERMAN_BODY}}` absent, full persona text spliced |
| AC-6: Banner degrades gracefully | **Pass** | Both branches: real `banner.ans` rendered; logo-less copy printed placeholder and continued |
| AC-7: smoke.sh proves it, no framework | **Pass** | 3 checks / 12 assertions, exit 0, real `~/.sherman` never touched |

## Accomplishments

- **`sherman` works end to end.** Installed, on PATH, symlink-resolved from outside the repo, launches the engine with cwd `~/.sherman/workspace/`.
- **The one-definition/two-adapters shape is real, not aspirational.** Persona and all three memory blocks are generated in exactly one place (`bin/sherman`) and spliced into whichever wrapper applies. Proven by flipping the config to `codex` mid-test and getting a correct `AGENTS.md` with no stale `CLAUDE.md`.
- **The no-PHI rule is unavoidable.** It appears twice in every assembled adapter — once in the persona, once restated as the closing block — and is asserted by smoke check 3.
- **The parallel Codex track integrated without a single conflict.** `logo/banner.ans` landed mid-execution and was picked up automatically.

## Task Commits

| Task | Commit | Type | Description |
|---|---|---|---|
| Tasks 1–3 (chassis) | `2f59775` | feat | Skeleton, persona, adapters, launcher, installer, smoke |
| Plan metadata | `a1c10a4` | docs | SUMMARY + STATE after APPLY |

Committed as one unit rather than per-task: the three tasks form a single
non-functional-until-complete artifact (the launcher cannot be verified without
the installer and the smoke suite), so atomic-per-task would have produced two
commits that fail their own verify step.

## Files Created

| File | Lines | Purpose |
|---|---|---|
| `bin/sherman` | 281 | Banner → wizard → adapter assembly → `exec` engine |
| `smoke.sh` | 140 | 3 checks, 12 assertions, self-cleaning sandbox |
| `install.sh` | 92 | chmod + PATH symlink, idempotent, detect-and-report |
| `agent/SYSTEM.md` | 84 | The persona — one definition |
| `adapters/claude-code/CLAUDE.md` | 28 | Claude Code wrapper + splice token |
| `adapters/codex/AGENTS.md` | 28 | Codex wrapper + splice token |
| `.gitignore` | 3 | `.DS_Store` and editor litter |

## Decisions Made

| Decision | Rationale | Impact |
|---|---|---|
| Vault at `<repo>/vault`, recorded as `vault_path` | Brief overrides design-doc §2's separate repo | v0.3 network-backend swap stays a config change |
| PATH priority `~/.local/bin` first | Neither dir the brief named exists; `~/.local/bin` is on PATH and holds claude/codex/hermes | Install works on this machine without sudo |
| Templates hold only wrapper + `{{SHERMAN_BODY}}` | Hand-copying the persona into two adapters is how either-engine decays into Claude-only | Adding a third engine is one wrapper file |
| `awk` splice, never `sed` | Body is multi-line markdown with `&`, `/`, backslashes — all special on sed's replacement side | Persona can contain arbitrary markdown safely |
| `jq` not `python3` in smoke | `python3` here is a pyenv shim, HOME-dependent; smoke overrides HOME | Smoke stays hermetic |
| Real first run left to Evan | Answering the provider question means choosing his engine for him | His first `sherman` is the designed experience |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|---|---|---|
| Auto-fixed | 1 | Essential — installer was unrunnable |
| Corrected assertions | 1 | Test was wrong, not the work |
| Scope additions | 1 | Hygiene, non-destructive |
| Deliberate non-execution | 1 | Design-respecting |

**Total impact:** No scope creep. One real bug found and fixed by the plan's own verify step.

### Auto-fixed

**1. [installer] `install.sh` had no exec bit**
- **Found during:** Task 3 verify — `./install.sh` returned "permission denied"
- **Issue:** Chicken-and-egg. `install.sh` chmods `bin/sherman` and `smoke.sh`, but nothing chmods the installer itself, so a fresh clone cannot run it.
- **Fix:** `chmod +x install.sh`, committed at mode `100755` (git tracks the bit)
- **Verification:** `git ls-files -s` → `100755` on all three scripts
- **Commit:** `2f59775`

### Corrected assertions

**2. [test] Task 1 verify asserted `logo/`+`vault/` were empty**
- The boundary's actual requirement is that *this plan* authors nothing there. The parallel Codex session landed 6 files at 01:01 while this plan executed.
- Assertion corrected from absence to non-authorship. Only `mkdir -p` was run — verified by mtimes and by the fact that none of the six appear in this plan's commit.
- **Upside:** `logo/banner.ans` existing early meant AC-6's ANSI branch got tested for real rather than by inspection.

### Scope additions

**3. [hygiene] `smoke.sh` cleans up its own vault litter**
- The sandboxed run creates `vault/memory/private/smoke-tester` in the *real* vault, because `vault_path` is repo-relative and the HOME override does not redirect it.
- Added `rmdir` on the trap. `rmdir` only removes empty directories, so it can never touch real data.

### Deliberate non-execution

**4. Real `~/.sherman/config.json` not created**
- The plan's verification checklist expected a genuine interactive first run. Skipped on purpose: answering the provider question means choosing Evan's engine for him, and that question is the one thing the design says is his.
- Compensated with exhaustive sandbox coverage: first run, second run, engine switch, missing binary, both banner branches, symlink resolution from `/tmp`.

## Issues Encountered

| Issue | Resolution |
|---|---|
| `${PIPESTATUS}` returned empty when capturing exit code | Test-harness artifact. Re-ran capturing `$?` directly → exit 1 confirmed |
| Wizard appeared to abort mid-run under `\| head -6` | SIGPIPE from the truncating pipe, not a script fault. Re-ran writing to a log file → completed normally |

Neither was a defect in the delivered code.

## Skill Audit

No `.paul/SPECIAL-FLOWS.md` configured — audit skipped.

## Next Phase Readiness

**Ready:**
- The chassis is done and verified. Anything added to the vault is immediately reachable by Sherman with no code change.
- Adding a skill is a folder + `SKILL.md`; adding an engine is one wrapper file.
- `vault_path` indirection means the v0.3 vault service does not require touching `bin/sherman`.

**Concerns:**
- **Sherman has an empty brain.** The chassis is complete but the vault holds only READMEs. Sherman will correctly say it doesn't know rather than invent — designed behavior, but it makes the product feel hollow until knowledge lands.
- The Codex adapter has never met real Codex. The engine-switch test proves the *assembly*, not the *contract*. First real exercise is v0.2 on a machine without Claude Code.
- `~/.sherman/workspace/` is disposable by design. If a future skill writes session artifacts there, they die on next launch. Anything durable must go to the vault.

**Blockers:**
- Phase 3 (skills) is blocked on design-doc §7 Q1 — the 3–5 tasks employees burn the most hours on.

---
*Phase: 01-launcher-chassis, Plan: 01*
*Completed: 2026-07-26*
