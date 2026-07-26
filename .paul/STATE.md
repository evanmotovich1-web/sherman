# STATE

## Current Position

Milestone: v0.1 Evan-only local prototype — 🟡 In progress (1 of 4 phases)
Phase: 4 (Sherman Shell) — Planning
Plan: 04-01 created, awaiting approval
Status: PLAN created, ready for APPLY
Last activity: 2026-07-26 — Created `.paul/phases/04-sherman-shell/04-01-PLAN.md`

Progress:
- Milestone v0.1: [██░░░░░░░░] 1/4 phases (chassis done; shell planned, vault seed landing, skills blocked)
- Phase 1: [██████████] 100% (1/1 plan)
- Phase 4: [░░░░░░░░░░] 0% (0/2 plans)

## Loop Position

```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ○        ○     [04-01 plan created, awaiting approval]
```

Phase 1 loop (`01-01`) closed cleanly: 3/3 tasks PASS, AC-1..AC-7 Pass,
commits `2f59775`, `a1c10a4`.

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
| D8 | Codex transport = `codex exec --json` + `exec resume`, not app-server | Stable CLI surface, verified end-to-end on codex 0.145.0 incl. multi-turn resume and token usage. app-server has true token deltas (`AgentMessageDeltaNotification`) but is `[experimental]` with 39+ message types — a v1 built on it breaks on `codex update`. `EngineSession` keeps the swap cheap. | 2026-07-26 |
| D9 | Vault boundary enforced by the macOS seatbelt sandbox, not by disabling `shell_tool` | On Codex, file read/search/write is delivered *through* shell + `apply_patch`; disabling `shell_tool` would strip the capability Sherman needs. The sandbox denies all I/O outside the permitted roots and blocks network — a stronger boundary than a tool allow-list, because the model cannot talk around it. | 2026-07-26 |
| D10 | Phase 4 numbered after existing 2/3 rather than renumbering | Phases 2 and 3 already have identities in ROADMAP and the Codex parallel track; renumbering would invalidate `phases/01-launcher-chassis/` references and cross-session assumptions. | 2026-07-26 |

## Concerns

- **Sherman has an empty brain.** Chassis complete, vault holds only READMEs. It will correctly say it doesn't know rather than invent, but the product feels hollow until knowledge lands. This is the gap that matters.
- **Sherman doesn't own the screen yet.** `bin/sherman` ends in `exec codex`, so the user lands in OpenAI's chrome. Phase 4 fixes this. Until then Sherman is branded up to the banner and unbranded after it.
- **No typewriter streaming on the Codex path.** Accepted (D8). A single short answer will appear all at once after a pause; 04-02 must carry the perceived-responsiveness load with an activity indicator and elapsed timer, or the shell will feel slower than raw Codex even though it isn't.
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
Stopped at: Plan 04-01 created (Sherman Shell — engine layer)
Next action: Review and approve the plan, then run `/paul:apply .paul/phases/04-sherman-shell/04-01-PLAN.md`
Resume file: `.paul/phases/04-sherman-shell/04-01-PLAN.md`

### Engine facts probed at plan time (codex 0.145.0, node v22.23.1)

Recorded here so no future session re-derives them:

- Event stream is `thread.started` → `turn.started` → `item.completed`(×N) → `turn.completed`
- `turn.completed.usage` carries input / cached_input / output / reasoning token counts
- `codex exec resume <thread_id> --json "<prompt>"` genuinely threads the conversation
- **No token deltas** — a 128-token answer arrived as one `item.completed` ~5.5s in
- **Trap:** `codex exec` hangs reading stdin when stdin is not a TTY → spawn with stdin ignored
- **Trap:** `exec resume` rejects `-s`, `-C`, `--add-dir`, `-p`; only `-c`, `--enable/--disable`,
  `-m`, `--json`, `--skip-git-repo-check` are common to both. All posture must travel as `-c`.
- `sandbox_mode` and `sandbox_workspace_write.writable_roots` both validate under `--strict-config`
- cwd must stay `~/.sherman/workspace` so codex picks up the assembled `AGENTS.md`;
  the vault reaches writability via `writable_roots`, not via cwd
