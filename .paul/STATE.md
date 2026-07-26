# STATE

## Current Position

Milestone: v0.1 Evan-only local prototype — 🟡 In progress (1 of 3 phases)
Phase: 1 (Launcher chassis) — ✅ COMPLETE & transitioned
Plan: 01-01 done (PLAN→APPLY→UNIFY closed). 3/3 tasks PASS, AC-1..AC-7 all Pass. Commits `2f59775`, `a1c10a4`.
Status: `sherman` installed and working. Nothing pushed.
Last activity: 2026-07-26 — UNIFY + phase transition for 01-01

Progress:
- Milestone v0.1: [███░░░░░░░] 1/3 phases (chassis done; vault seed landing, skills blocked)
- Phase 1: [██████████] 100% (1/1 plan)

## Loop Position

```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ✓        ✓     [01-01 loop complete — Phase 1 transitioned]
```

## What works right now

`sherman` is on PATH at `~/.local/bin/sherman`. First run asks two questions
(provider, name), writes `~/.sherman/config.json`, and opens a session. Every
run rebuilds `~/.sherman/workspace/CLAUDE.md` from `agent/SYSTEM.md` plus the
memory blocks and the no-PHI rule, then execs the engine there.

`./smoke.sh` — 3 checks, 12 assertions, green.

## Parallel track

A Codex session owns `logo/` and `vault/`. It landed `logo/banner.ans`,
`logo/banner.txt`, and README scaffolding under `vault/` at 01:01, mid-APPLY —
picked up automatically, zero conflicts. Those paths remain untracked in git;
that session commits them.

## Decisions

| # | Decision | Rationale | Date |
|---|---|---|---|
| D1 | Repo at `/Users/moto/code/sherman`, vault at `<repo>/vault` | Build brief overrides design doc §2. Recorded as `vault_path` so the v0.3 network-backend swap stays a config change. | 2026-07-26 |
| D2 | install.sh PATH priority `~/.local/bin` → `~/bin` → `/usr/local/bin` | Brief named the last two; neither exists here. `~/.local/bin` is on PATH and holds claude/codex/hermes. | 2026-07-26 |
| D3 | Adapter templates hold only wrapper + `{{SHERMAN_BODY}}` | Hand-duplication across adapters is how either-engine decays into Claude-only. | 2026-07-26 |
| D4 | `awk` splice, never `sed` | Body is multi-line markdown with `&`, `/`, backslashes. | 2026-07-26 |
| D5 | `jq` for JSON in smoke, not `python3` | `python3` is a pyenv shim, HOME-dependent; smoke overrides HOME. | 2026-07-26 |
| D6 | `.paul/` bootstrapped from the design doc, not by interview | PROJECT/ROADMAP content already existed in the design doc §1/§4/§5/§6. | 2026-07-26 |
| D7 | Real first run left to Evan | Answering the provider question means choosing his engine for him. | 2026-07-26 |

## Concerns

- **Sherman has an empty brain.** Chassis complete, vault holds only READMEs. It will correctly say it doesn't know rather than invent, but the product feels hollow until knowledge lands. This is the gap that matters.
- **Codex adapter never met real Codex.** Assembly proven, contract not. First real exercise is v0.2.
- **`~/.sherman/workspace/` is disposable by design.** Any future skill writing artifacts there loses them on next launch. Needs stating in skill-authoring guidance (tracked as R10 in PROJECT.md).

## Blockers

- **Phase 3 (skills) is blocked on design-doc §7 Q1** — the 3–5 tasks employees burn the most hours on. This is the one answer that unblocks the actual product.

## Git State

Last commit: `a1c10a4`
Branch: `main`
Remotes: none configured — nothing pushed, by design (Evan pushes)
Untracked: `logo/`, `vault/` (parallel Codex session's to commit)

## Session Continuity

Last session: 2026-07-26
Stopped at: Phase 1 complete and transitioned
Next action: Run `sherman` for your real first run. Then either answer §7 Q1 to unblock skills, or let the Codex track finish the vault seed.
Resume file: `.paul/ROADMAP.md`
