# STATE

## Current Position

Milestone: v0.1 Evan-only local prototype — 🟡 In progress
Phase: 1 of 3 (Launcher chassis) — APPLY complete
Plan: 01-01 executed. 3/3 tasks PASS, AC-1..AC-7 all met. Commit `2f59775`.
Status: `sherman` installed and working. Nothing pushed.
Last activity: 2026-07-26 — APPLY complete for 01-01

Progress:
- Milestone v0.1: [███░░░░░░░] ~33% (chassis done; logo/vault landing, skills blocked)
- Phase 1: [██████████] 100% (1/1 plan)

## Loop Position

```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ✓        ○     [APPLY complete — ready for UNIFY]
```

## APPLY results (01-01, 2026-07-26)

- **Task 1 PASS** — repo skeleton, `agent/SYSTEM.md`, two adapter templates
  carrying only an engine wrapper plus the `{{SHERMAN_BODY}}` token. No
  persona text duplicated into either adapter.
- **Task 2 PASS** — `bin/sherman`: banner, two-question wizard, config write,
  `awk` splice, `exec` into the engine at `~/.sherman/workspace/`. Proven in
  sandbox across first run, second run, engine switch, missing binary, banner
  fallback, and symlink invocation from outside the repo.
- **Task 3 PASS** — `install.sh` (idempotent, `~/.local/bin`, reports PATH
  status), `smoke.sh` (3 checks / 12 assertions, green), commit `2f59775`.

### Deviations (for UNIFY)

1. Task 1's verify asserted `logo/`+`vault/` were empty; the Codex track landed
   6 files mid-execution. Boundary intent — this plan authors nothing there —
   holds. Assertion corrected to non-authorship.
2. `install.sh` needed its own exec bit; nothing chmodded the installer.
   Committed at mode `100755`.
3. Real `~/.sherman/config.json` deliberately not created — the provider
   question is Evan's to answer. All paths proven in sandbox instead.
4. `smoke.sh` gained cleanup of the `smoke-tester` private-memory dir it
   creates in the real vault (`rmdir`, so never destructive). Addition.

## Parallel track

A Codex session owns `logo/` and `vault/` concurrently. Phase 1 must not create
or edit files in either tree — `mkdir -p` of empty dirs only. Integration is
one-way and non-blocking: `bin/sherman` reads `logo/banner.ans` if present and
falls back to plain text if not.

## Decisions

| # | Decision | Rationale | Date |
|---|---|---|---|
| D1 | Repo lives at `/Users/moto/code/sherman`, vault at `<repo>/vault` | Build brief overrides design doc §2, which put the vault in a separate repo. Recorded as `vault_path` in config.json so the Phase-3 network-backend swap stays a config change (R6). | 2026-07-26 |
| D2 | install.sh PATH priority: `~/.local/bin` → `~/bin` → `/usr/local/bin` | Brief named the last two. Neither exists here; `/usr/local/bin` is on PATH but absent from disk and needs sudo. `~/.local/bin` exists, is on PATH, and holds claude/codex/hermes. Brief's real requirement — detect and report — is preserved. | 2026-07-26 |
| D3 | Adapter templates hold only an engine wrapper + `{{SHERMAN_BODY}}`; bin/sherman generates the body | Keeps persona and memory blocks in exactly one place. Hand-duplication across two adapters is how the either-engine promise decays into Claude-only (design doc §3). | 2026-07-26 |
| D4 | Splice with `awk`, never `sed` | The body is multi-line markdown containing `&`, `/` and backslashes — all special on sed's replacement side. | 2026-07-26 |
| D5 | `jq` for JSON in smoke, not `python3` | `python3` here is a pyenv shim and is HOME-dependent; smoke overrides HOME. `/usr/bin/jq` is system-level. | 2026-07-26 |
| D6 | `.paul/` bootstrapped from the design doc rather than by interview | PROJECT/ROADMAP content already existed in `PLAN-2026-07-25-sherman-abrams-agent.md` §1/§4/§5/§6; an init interview would have re-litigated decided design. | 2026-07-26 |

## Session Continuity

Last session: 2026-07-26
Stopped at: Plan 01-01 created
Next action: Review and approve, then `/paul:apply .paul/phases/01-launcher-chassis/01-01-PLAN.md`
Resume file: `.paul/phases/01-launcher-chassis/01-01-PLAN.md`
