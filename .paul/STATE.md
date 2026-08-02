# STATE

## Current Position

Milestone: v0.1 Evan-only local prototype — 🟡 In progress
Phase: 8 (Connectors and method skills) — ✅ COMPLETE (3/3 plans)
Plan: None active. Ready to plan.
Status: Sherman can now acquire capability it does not have. MCP stopped being
a hardcoded block and became a catalog the launcher renders for both engines,
with keys held outside the repo and a connector omitted whole rather than
half-wired. `0-1` is the skill that adds entries — verifying first, wiring what
needs no person, and handing over one account-and-key checklist when one is
required. `evan` and `wayfinder` came out of a personal `~/.claude` and into
the product, self-contained and engine-agnostic. Smoke 23 → 26 checks, all
green; shell tests 174/174.
Last activity: 2026-08-01 — Phase 8 complete: commits 638f3bc, 25c7962, 210b45a

**Record gap, stated rather than papered over.** Between Phase 7 and Phase 8 a
large body of work shipped as direct commits outside the loop — `skills/` and
the whole starting set, the slash palette, `/eval`, `/email`, `/win`, `/wiki`
and the LLM Wiki integration, `install.ps1` and the Windows bootstrap, the
launch-screen rework, and smoke growing 21 → 23 checks. It is committed and
green; it has no PLAN or SUMMARY. The tables below cover the loop, not the
repo, and reconstructing summaries after the fact would invent a record rather
than keep one.

Progress:
- Milestone v0.1: [███████░░░] 5/7 phases (command, shell, launch screen, session/turn UI, public-readiness done; vault seed and skills remain)
- Phase 1: [██████████] 100% (1/1 plan)
- Phase 4: [██████████] 100% (2/2 plans)
- Phase 5: [██████████] 100% (1/1 plan)
- Phase 6: [██████████] 100% (2/2 plans)
- Phase 7: [██████████] 100% (1/1 plan)

## Loop Position

```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ✓        ✓     [08-01/02/03 loops complete — Phase 8 closed]
```

Every loop closed cleanly:

| Plan | Tasks | ACs | Commit |
|---|---|---|---|
| `01-01` launcher chassis | 3/3 PASS | 7/7 Pass | `2f59775` |
| `04-01` engine layer | 3/3 PASS | 8/8 Pass | `1f75e0a` |
| `04-02` shell UI + wire-up | 3/3 PASS + checkpoint approved | 9/9 Pass | `fcd2b82` |
| `05-01` launch screen v2 | 4/4 PASS (2 gaps fixed) + checkpoint approved | 8/8 Pass | `a8ab909` |
| `06-01` session identity + first frame v3 | 4/4 PASS + checkpoint approved | 6/6 Pass | `99331f3` |
| `06-02` live turn UI | 4/4 PASS (1 D17 gap fixed) + checkpoint approved | 5/5 Pass | `f4b7518` |
| `07-01` public-repo readiness | 3/3 PASS (+1 follow-up commit) | 5/5 Pass | `1b07221` `a7e87f3` `8d66fb2` `8899d45` |
| `08-01` connector layer | 3/3 PASS | 6/6 Pass | `638f3bc` |
| `08-03` method skills (evan, wayfinder) | 3/3 PASS | 5/5 Pass | `25c7962` |
| `08-02` 0-1 | 3/3 PASS | 5/5 Pass | `210b45a` |

Details: `.paul/phases/04-sherman-shell/04-01-SUMMARY.md`, `04-02-SUMMARY.md`,
`.paul/phases/05-launch-screen-v2/05-01-SUMMARY.md`,
`.paul/phases/06-session-and-turn-ui/06-01-SUMMARY.md`, `06-02-SUMMARY.md`

## What works right now

**Type `sherman` and Sherman appears — as Sherman.**

```
sherman           the Sherman Shell: banner, chat pane, status bar
sherman --raw     the engine directly, its own chrome, for debugging
```

First run asks two questions (provider, name) and writes
`~/.sherman/config.json`. Every run rebuilds the adapter in
`~/.sherman/workspace/` from `agent/SYSTEM.md` plus the memory blocks and the
no-PHI rule, then hands off.

**The first frame is the Hermes posture in Sherman's palette.** The SHERMAN
deck (lit rim, red ramp, shadow) with the AGENT sub-deck right-aligned beneath
it, then an identity block — `<model> · Sherman Abrams Labs`, the vault folder,
the session id — then the knowledge panel with the build stamped into its top
border (`╭─ Sherman Abrams v0.2.0 · <sha> · +N ─╮`; segments omitted cleanly
without git). The opener fills the viewport; every value is read from config,
`session.info`, package.json, git, or a readdir — nothing invented, which is
why the counts still honestly read `0`.

**Every session has a name.** One id per launch (`YYYYMMDD_HHMMSS_<6 hex>`)
minted by `bin/sherman`, identical on the panel, in the adapter's
memory-attribution rule ("— user · session · date"), and heading the JSONL turn
log at `~/.sherman/sessions/<id>.jsonl`. `sherman update` reports honestly in
all three repo states (today: "no update source configured", exit 0).

**Turns are staged.** Your line commits as `● …`; the wait narrates itself in
dim italic straight from the engine's real events (never invented — a
no-activity turn shows only "thinking… <elapsed>"); the reply lands in a
bordered box signed `●●● Sherman`. The bar underneath: `engine · model |
tokens | session Nm | turn N.Ns` live in red while working, `last N.Ns` after.
No ctx-percent — this transport reports no context figure. Ctrl+C interrupts;
again exits. The transcript still lives in the terminal's own scrollback.

The engine is sealed in the vault: writes outside it are denied, network egress is
denied, and that was proven by a test that tried to escape.

Diagnostics:

```
node shell/bin/sherman-shell.js --probe "who are you?"
```

Normalized events, no UI. Works even with no `node_modules`, so a broken UI cannot
disable the tool that debugs it.

`./smoke.sh` — 11 checks, green.

**What does NOT work yet: knowing the business.** The vault holds READMEs. Sherman
will say it doesn't know rather than invent — and since Phase 5 the launch screen
says so too, on every single launch.

## Parallel track

A Codex session owns `logo/` and `vault/`. Across both Phase 4 plans it committed
`f8c4d59` (logo ring-mark fix), `5dbcc32` (gitignore graphify-out), `4e2bca4` (root
AGENTS.md, DESIGN.md, CLAUDE.md, docs/) and `728c0dc` (graphify rule). Every one
checked for overlap with `shell/` and the protected launcher files: zero conflicts
across three phases now.

Its `AGENTS.md` adds a repo rule this session has followed: run `graphify update .`
after every commit, and never commit `graphify-out/`.

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
| D13 | Superseded — launch is committed history; no compact header is pinned | The v8 viewport rewrite retained the launch moment as the transcript's first item but reduced persistent chrome to the status rule and composer. | 2026-07-26 |
| D14 | Missing/old Node fails loudly; never silent fallback to the engine | A silent fallback drops the user into OpenAI chrome while they believe they are in Sherman — the exact failure Phase 4 exists to remove. `--raw` stays available, but the user chooses it. | 2026-07-26 |
| D15 | READMEs excluded from vault counts | The launch panel's whole value is that its numbers are true. Counting scaffolding would print "1 wiki page" over an empty vault. Reads 0 until R8 lands, which is both honest and useful pressure. | 2026-07-26 |
| D16 | Launch panel says "Keys", not "Commands" | The shell has zero slash commands and no `/help`. A Commands section could only be empty or invented, and the panel's one rule is that nothing on it is invented. One-line change the day a command ships. | 2026-07-26 |
| D17 | Width-branching components take an injectable `columns` prop | `useWindowSize()` returns a fixed 80x24 under `renderToString`, so a width-dependent test would silently render at 80 and prove nothing. The screen resolves width once and passes it down. **Any future width-branching UI must follow this or it is untestable off a TTY.** | 2026-07-26 |
| D18 | `engine · model` appears in the panel footer only | The brief placed it in the left column *and* the footer of the same box; printed twice inside one border it reads as a rendering bug. Left column is identity, footer is runtime. **Evolved in Phase 6:** the model moved to the identity block under the wordmark (Evan's Hermes brief) and left the footer — the once-per-surface principle is what survives. | 2026-07-26 |
| D19 | Session id minted in `bin/sherman`, travels by env, never config | The adapter is assembled before the shell exists, so a shell-minted id could never reach the attribution rule. Per-launch state does not belong in config.json. | 2026-07-26 |
| D20 | A status segment renders only if it has a real source | No ctx-percent (this transport reports no context-window figure); no segment before its first real value. A percentage of an invented denominator would be the one dishonest number on an honest screen. | 2026-07-26 |
| D21 | The session log may quietly die but may never crash or spam | One append failure disables it for the session. A log that failed once and then printed a retry error per turn would be worse than no log. | 2026-07-26 |
| D22 | `sherman update` never merges, and guards against smoke recursion | ff-only or "manual update needed". Update runs smoke after a real pull, and smoke's update check skips under SHERMAN_UPDATE_RUNNING — without the guard the pair would loop the day a remote exists. | 2026-07-26 |

## Concerns

- **Sherman has an empty brain. This is now THE gap.** Two phases built an
  excellent shell around a vault of READMEs. Everything else on this list is a
  detail next to it.
- **The first turn is the slowest thing a user meets** — ~19,900 input tokens with
  nothing cached until turn 2. The indicator covers it honestly but does not make it
  fast. If it grates, the fix is D8 (app-server transport), not more UI.
- **Node 22+ is a hard dependency** for the UI, supplied here by Hermes' bundled
  runtime (`~/.local/bin/node → ~/.hermes/node/bin/node`). If Hermes went away,
  `sherman` would drop to `--raw` only. v0.2's installer must decide: require or
  bundle. Tracked as R14.
- **`ink` + `react` are the project's first dependencies.** Ink 7 needs React ≥19.2
  and Node ≥22, so a Node upgrade is now also a UI compatibility question.
- **The shell looks like a chat app, so it will be judged like one.** No cross-run
  history, no up-arrow recall, no multi-line editing. Deliberate for v1; history
  recall is the first thing likely to be missed. Tracked as R16.
- **The posture depends on codex config key names** (`sandbox_mode`,
  `sandbox_workspace_write.writable_roots`, `approval_policy`). Re-run the boundary
  test in `shell/README.md` after any `codex update`.
- **Claude backend is still a stub.** Fine for Evan (codex); blocking for an
  Anthropic user. Now genuinely a one-file job.
- **Codex adapter has still not met a machine *without* Claude Code.** Phase 4 drove
  real Codex, so the transport and adapter are proven here — the remaining gap is a
  second machine (v0.2, R9).
- **`~/.sherman/workspace/` is disposable by design.** Any future skill writing
  artifacts there loses them on next launch (R10).

## Blockers

- **Phase 3 (skills) is blocked on design-doc §7 Q1** — the 3–5 tasks employees burn the most hours on. This is the one answer that unblocks the actual product.

## Git State

Branch: `main`
Remotes: `origin` → https://github.com/evanmotovich1-web/sherman.git —
**PUBLIC since 2026-07-29**, flipped at Evan's explicit direction after the
clean secret audit; the push (3ac5b0a..74b7c43) was likewise Evan-directed,
so C5 held: pushing stayed his call. Because a remote exists, smoke check
10's `sherman update` now performs a real `git pull --ff-only` and a nested
smoke run.
Feature branches: none — all work on `main`

Phase 4 commits: `7a9b4dd` (04-01 plan), `1f75e0a` (engine layer), `7536aa2`,
`c5b22a6` (04-01 close), `879240d` (04-02 plan), `fcd2b82` (shell UI),
`3d7625d` (Phase 4 close).

Phase 5 commits: `a8ab909` (launch screen v2), `15fed16` (colour fix — Ink
silently drops bare 256-colour indexes; everything now `ansi256(N)`, guarded
by smoke check 9).

Phase 6 commits: `cc1a24d` (both plans), `99331f3` (06-01 session identity +
first frame v3), `0275b24` (06-01 close), `f4b7518` (06-02 live turn UI).

`shell/node_modules/` and `graphify-out/` are gitignored.
`shell/package-lock.json` is tracked, for reproducible installs at v0.2.

## Session Continuity

Last session: 2026-07-29
Stopped at: Phase 7 complete — the repo is publishable: history audited
clean, README under the honesty laws, registry-driven wizard, verify-then-
claim installer, twenty-one smoke checks green
Next action: The repo is public and pushed (Evan-directed, 2026-07-29).
What remains is **design-doc §7 Q1** (the 3–5 tasks employees burn the most
hours on) to unblock Phase 3 skills — still the one answer standing between
Sherman and being useful.
Resume file: `.paul/ROADMAP.md`

Probed for Phase 6 (recorded in the plans, headline here): Ink 7 per-side
borders make text-in-border work (version header, Sherman box label); Ink 7
reads stdin via 'readable'+read() so a patched PassThrough drives the real App
off-TTY (now smoke check 11's mechanism — it types into the real composer);
the session-id recipe is bash-3.2 clean; the transport reports no
context-window figure, so no ctx-percent segment exists (D20).

Try it now:

```
sherman
```

### UI facts probed at 05-01 plan time (ink 7.1.1, react 19.2.8, node v22.23.1)

Measured, not assumed. Recorded so APPLY does not re-derive them:

- **`renderToString(node, {columns})` honours `columns`** (default 80) and *does*
  capture `<Static>` output. This is how the launch screen gets smoke-tested at any
  width with no TTY — the mechanism 04-02 lacked.
- **…but `useWindowSize()` does NOT see that `columns`.** Corrected during APPLY:
  under `renderToString` the hook returns a hardcoded **80x24** at every width;
  the option drives layout and truncation only. Any component whose behaviour
  branches on width must therefore accept an **injectable `columns` prop** or it
  is untestable off a TTY — and worse, a width-dependent test will silently pass
  by rendering at 80 and proving nothing. `LaunchScreen` resolves width once and
  passes it to `Wordmark`, so the two can never disagree.
- **A `<Box width={N}>` does not stretch on a wide terminal** — width 76 measured 76
  at both 80 and 200 columns. **But a hardcoded 76 overflows at 60.** Panel width
  must be `Math.min(columns - 2, 76)`. This is the single likeliest way to ship
  wrapped garbage.
- **Wordmark geometry, both forms rendered and measured:** large (7-wide glyphs +
  1 gutter) = **55 cols × 7 rows**; small (5-wide) = **41 cols × 5 rows**, identical
  to the existing `banner.ans` wordmark. 55 fits inside 80 with 25 to spare.
- **Visual width = strip `\x1b\[[0-9;]*m`, then count code points.** `█ ▄ ▀` are
  3 bytes but 1 column — byte length lies, and every width assertion depends on this.
- **The shell has ZERO slash commands** (grep across `shell/src/ui/`). The real
  affordances are Enter, Ctrl+C, and the CLI flags. A "Commands" section cannot be
  honestly populated today; `/help` does not exist.
- **`session.info` already carries `engine`, `model`, `user`, `vaultPath`,
  `threadId`** — the panel needs nothing new from the engine layer, so Phase 5
  touches no file under `shell/src/engine/` and R12's record holds.
- **`threadId` is null until the engine reports one**, so at launch it is *always*
  null. `'new'` is the honest launch-time value, not a bug to chase.

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
