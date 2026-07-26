# STATE

## Current Position

Milestone: v0.1 Evan-only local prototype — 🟡 In progress (1 of 4 phases)
Phase: 4 (Sherman Shell) — APPLY complete for 04-01
Plan: 04-01 executed. 3/3 tasks DONE, all qualified PASS. AC-1..AC-8 Pass. Commit `1f75e0a`.
Status: APPLY complete, ready for UNIFY
Last activity: 2026-07-26 — APPLY of 04-01 (engine layer) complete

Progress:
- Milestone v0.1: [██░░░░░░░░] 1/4 phases (chassis done; shell engine layer built, UI next)
- Phase 1: [██████████] 100% (1/1 plan)
- Phase 4: [█████░░░░░] 50% (1/2 plans — 04-01 built, 04-02 is the UI)

## Loop Position

```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ✓        ○     [04-01 applied, awaiting UNIFY]
```

Phase 1 loop (`01-01`) closed cleanly: 3/3 tasks PASS, AC-1..AC-7 Pass,
commits `2f59775`, `a1c10a4`.

### 04-01 execution record (for UNIFY)

| Task | Status | Qualify |
|---|---|---|
| 1 — skeleton, config, contract, Claude stub | DONE | PASS |
| 2 — Codex backend, posture, interrupt | DONE | PASS |
| 3 — prove boundary, document | DONE | PASS |

**Deviation 1:** `shell/src/engine/codex.js` was created as a skeleton during
Task 1, though the plan listed it only under Task 2. `selectBackend` imports it,
so Task 1's own verify could not resolve without it. Task 2 replaced the skeleton
with the real implementation. No scope change.

**Deviation 2:** Task 2's verify said `grep -rn "dangerously" shell/` must return
nothing. It returns two hits — both inside the comment that forbids those flags.
The check was imprecise, not the code. Replaced with a precise one: no
`--dangerously` outside comments, and the built argv for both turn 1 and resume
asserted clean. AC-6's actual requirement (no invocation passes the flags) holds.

**Verified empirically, not asserted:** single turn, multi-turn recall on one
thread (19,200 cached input tokens), interrupt with thread retention and no
orphan process, and the full boundary test — vault write allowed, `$HOME` write
denied, network egress denied (curl exit 6).

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

Last commit: `1f75e0a` (engine layer). Plan committed as `7a9b4dd`.
Branch: `main`
Remotes: none configured — nothing pushed, by design (Evan pushes)
Uncommitted: `logo/banner.ans`, `logo/banner.txt` (parallel Codex session is
mid-redesign of the mark — left alone deliberately), plus untracked
`graphify-out/` which neither track created as deliverable.

The parallel Codex session committed `4e2bca4` (root AGENTS.md, DESIGN.md,
CLAUDE.md, docs/) during this APPLY. Checked: no overlap with `shell/` or any
protected file. Zero conflicts, same as last phase.

## Session Continuity

Last session: 2026-07-26
Stopped at: APPLY complete for 04-01 (Sherman Shell engine layer)
Next action: Run `/paul:unify .paul/phases/04-sherman-shell/04-01-PLAN.md` to close the loop, then plan 04-02 (Ink UI + launcher wire-up)
Resume file: `.paul/phases/04-sherman-shell/04-01-PLAN.md`

Try it now: `node shell/bin/sherman-shell.js --probe "who are you?"`

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
