# STATE

## Current Position

Milestone: v0.1 Evan-only local prototype — 🟡 In progress (1 of 4 phases)
Phase: 4 (Sherman Shell) — 🟡 In progress (1 of 2 plans) — Planning 04-02
Plan: 04-02 created, awaiting approval. 04-01 ✅ loop closed.
Status: PLAN created, ready for APPLY
Last activity: 2026-07-26 — Created `.paul/phases/04-sherman-shell/04-02-PLAN.md`

Progress:
- Milestone v0.1: [██░░░░░░░░] 1/4 phases (chassis done; shell engine layer built, UI planned)
- Phase 1: [██████████] 100% (1/1 plan)
- Phase 4: [█████░░░░░] 50% (1/2 plans — 04-01 done, 04-02 planned)

## Loop Position

```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ○        ○     [04-02 plan created, awaiting approval]
```

04-02 is the **last plan in Phase 4** — its UNIFY must run the phase transition
(PROJECT.md requirement evolution, ROADMAP status, phase commit).

04-02 is `autonomous: false` — it ends in a human-verify checkpoint, because
"does the wait feel alive?" is not a thing a script can assert.

Phase 1 loop (`01-01`) closed cleanly: 3/3 tasks PASS, AC-1..AC-7 Pass,
commits `2f59775`, `a1c10a4`.

**Phase 4 is NOT complete.** The plan/summary file count is 1:1, which a naive
check reads as a finished phase — but ROADMAP defines Phase 4 as two plans and
04-02 has not been authored yet. No phase transition was run. ROADMAP is the
authority on phase scope, not the file count.

### 04-01 result

3/3 tasks DONE, all qualified PASS. AC-1..AC-8 Pass. Two mechanical deviations,
both recorded in `04-01-SUMMARY.md`: a task-ordering artifact (`codex.js` skeleton
needed in Task 1 for Task 1's own verify to resolve), and an imprecise
`grep "dangerously"` check in the plan replaced with a precise argv assertion.

Full detail: `.paul/phases/04-sherman-shell/04-01-SUMMARY.md`

## What works right now

`sherman` is on PATH at `~/.local/bin/sherman`. First run asks two questions
(provider, name), writes `~/.sherman/config.json`, and opens a session. Every
run rebuilds the adapter in `~/.sherman/workspace/` from `agent/SYSTEM.md` plus
the memory blocks and the no-PHI rule, then execs the engine there.

**New in 04-01 — a headless Sherman you can talk to:**

```
node shell/bin/sherman-shell.js --probe "who are you?"
```

Answers as Sherman Abrams and names its own vault paths. Multi-turn works
(`--probe "a" "b"`), token counts are reported, Ctrl+C aborts a turn without
ending the session, and the engine cannot write outside the vault or reach the
network.

Not yet wired to the `sherman` command — that is 04-02.

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
| D11 | Composer built on `useInput`; no `ink-text-input` | Ink 7 ships no text input. `ink-text-input@6` peers `ink>=5` — permits 7 but untested against it. A chat composer is ~40 lines against `useInput` (`usePaste` available); taking an unverified dep for that is the worse trade. | 2026-07-26 |
| D12 | Primary screen + `<Static>`, never `alternateScreen` | Ink's own docs: scrollback is unavailable in the alternate screen. `<Static>` commits history so the terminal's native scrollback and mouse wheel work. Scrollback was in the brief; a tidy full-window layout was not. | 2026-07-26 |
| D13 | Full banner once at top; compact header pinned | The banner is 18 lines. Pinning it on a 24-row terminal leaves 6 rows for the conversation. Matches how `bin/sherman` already behaves and the brief's "small variant acceptable". | 2026-07-26 |
| D14 | Missing/old Node fails loudly; never silent fallback to the engine | A silent fallback drops the user into OpenAI chrome while they believe they are in Sherman — the exact failure Phase 4 exists to remove. `--raw` stays available, but the user chooses it. | 2026-07-26 |

## Concerns

- **Sherman has an empty brain.** Chassis complete, vault holds only READMEs. It will correctly say it doesn't know rather than invent, but the product feels hollow until knowledge lands. This is the gap that matters.
- **Sherman doesn't own the screen yet.** `bin/sherman` ends in `exec codex`, so the user lands in OpenAI's chrome. Phase 4 fixes this. Until then Sherman is branded up to the banner and unbranded after it.
- **No typewriter streaming on the Codex path.** Accepted (D8). A single short answer will appear all at once after a pause; 04-02 must carry the perceived-responsiveness load with an activity indicator and elapsed timer, or the shell will feel slower than raw Codex even though it isn't.
- **Sherman now has a hard Node dependency it did not have in Phase 1.** On this Mac `node` is `~/.local/bin/node` → `~/.hermes/node/bin/node` — supplied by Hermes' bundled runtime. It works and is on PATH, but if Hermes were removed, `sherman` would lose its UI and fall back to needing `--raw`. v0.2's installer has to decide whether to require Node or bundle it.
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
Stopped at: Plan 04-02 created (Sherman Shell UI + launcher wire-up)
Next action: Review and approve, then `/paul:apply .paul/phases/04-sherman-shell/04-02-PLAN.md`
Resume file: `.paul/phases/04-sherman-shell/04-02-PLAN.md`

Try the engine layer now: `node shell/bin/sherman-shell.js --probe "who are you?"`

### UI facts probed at 04-02 plan time (ink 7.1.1, react 19.2.8, node v22.23.1)

Recorded so no future session re-derives them:

- Ink 7 exports `Static`, `useInput`, `useAnimation`, `useCursor`, `usePaste`,
  `useWindowSize`, `renderToString` — but **no built-in text input**.
- **The banner renders correctly inside Ink** — verified via `renderToString`: raw
  256-colour escapes survive, all 18 lines preserved, width measured at 41 columns
  despite multi-byte block glyphs. No stripping or width workaround needed.
- `logo/banner.ans` is **41 cols × 18 lines**; house colours 205/135/39/196 confirmed.
- **Two-stage Ctrl+C proven in a real pty** (`script -q /dev/null`):
  `render(<App/>, {exitOnCtrlC: false})` lets `useInput` see `key.ctrl && input==='c'`.
- **`useAnimation({interval, isActive})` returns `{frame, time, delta, reset}`** —
  spinner frame *and* elapsed ms from one hook. The thinking indicator needs no
  manual `setInterval`. Verified rendering `⠦ thinking… 1.3s`.
- **`alternateScreen` destroys terminal scrollback** (Ink's own docs) → D12.
- Ink throws `Raw mode is not supported` on non-TTY stdin → the entry point must
  guard, which is also what keeps a piped smoke run from hanging.

### Trap 04-02 must fix, not discover

`smoke.sh:69` pipes answers into `./bin/sherman` and relies on the launcher
exec'ing a stub engine. Once the default `exec` becomes the shell, that run
launches Ink with piped stdin and the existing config/adapter assertions break or
hang. Those existing invocations must move to `./bin/sherman --raw` **in the same
change as the launcher swap**, or smoke goes red. That is required repair of two
existing checks, not part of the 3-new-check budget.

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
