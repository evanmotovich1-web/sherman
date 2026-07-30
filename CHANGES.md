# Changes

Newest entries appear first. “Building” means active work that is not yet a
shipped, verified release.

## 2026-07-30 — Added: install.ps1, a Windows bootstrap for the WSL2 route

- `install.ps1` automates docs/WINDOWS.md end to end from PowerShell: enable
  WSL2 (the one step that may need an admin shell and a reboot — it stops
  and says so instead of half-doing it), install Ubuntu, install git/curl/jq
  inside it, clone into the Linux filesystem, and hand off to `./install.sh`
  in the distro. Idempotent at every stage; every "verified" line follows a
  real check (`wsl -d Ubuntu -e true`, `command -v` inside the distro), and
  distro detection never parses `wsl -l`'s UTF-16 output — exit codes only.
- The platform remains untested and both the doc and the script keep saying
  so: the WSL write-boundary is stated as UNVERIFIED until someone re-runs
  the escape test there. New smoke check 23 pins the routing (doc ↔ script),
  the unverified-boundary admission, and — only where a `pwsh` exists to do
  it — the script's syntax, with the pass line naming exactly what was
  checked.

## 2026-07-29 — Changed: install.sh provisions missing prerequisites itself

- A machine without Node 22+ gets the official build downloaded from
  nodejs.org into `~/.sherman/runtime` (pinned v22.23.2, all four
  darwin/linux × arm64/x64 tarballs verified to exist) and linked next to
  `sherman` — no sudo, nothing outside Sherman's own directories. A machine
  without the codex CLI gets `npm install -g @openai/codex`. Both claims
  follow verification (`node --version`, `codex --version`); failed
  downloads say so. Signing in remains the engine's own first-launch login —
  the one thing no installer can do.
- `SHERMAN_INSTALL_NO_FETCH=1` disables all network fetches and says so
  plainly; smoke uses it to stay offline. Check 21 asserts the guard's
  honesty; new check 22 exercises the real download → extract → link →
  verify chain against a stub curl serving a fake tarball, and proves an npm
  that produced no codex is refused an "installed" line.
- README and docs/WINDOWS.md updated: prerequisites shrank to what genuinely
  stays yours (macOS or WSL2, the sign-in, git+curl).

## 2026-07-29 — Added: a Windows install route, stated as untested

- `docs/WINDOWS.md` documents the WSL2 route end to end — Node 22 via nvm,
  the Codex CLI and its own sign-in, clone + `./install.sh` — and states
  plainly what is unproven there: the vault write-boundary escape test has
  only ever run on macOS, smoke has never executed on Linux, and the UI has
  never rendered in Windows Terminal. No native installer exists, and the
  doc says why instead of omitting it.
- The README's Windows sentence now routes to that doc; smoke check 19
  additionally fails if the README points at a Windows route that is missing
  or does not admit it is untested.

## 2026-07-29 — Changed: install.sh claims only what it verified

- Every success line now follows a check, not an attempt: "executable" after
  `[ -x ]`, "dependencies installed" only after `node_modules/ink` and
  `node_modules/react` exist (npm exiting 0 is an attempt's report), and the
  "linked" line only after `readlink` confirms the symlink points at the
  launcher. The npm-missing graceful path is unchanged.
- A truthful still-needed report closes the run: Node found/too-old/missing
  and codex CLI found/missing — reported, never installed, because install.sh
  does not provide either.
- Smoke check 21 drives install.sh in a sandboxed fake repo with an npm stub
  that exits 0 while producing nothing, and fails the suite if any claim
  outruns its verification.

## 2026-07-29 — Changed: the wizard renders from a provider registry

- The first-run provider menu now renders from a registry in `bin/sherman`
  (one `id|label|binary|status|reason` line per provider). Codex is the only
  available provider; Anthropic is listed as visibly unavailable and refuses
  selection with the reason, instead of proceeding into a shell whose Claude
  backend is a stub that errors on every turn.
- Adding or enabling a provider later is one registry line, not new wizard
  flow. The seam — including why messaging channels are absent from setup —
  is recorded in `DESIGN.md`.
- Smoke checks 2/3/5/6 repaired for the codex-first reality; new check 20
  proves the unavailable provider is shown, refused with its reason, and that
  the run still completes on the available one. A hand-written
  `engine: claude` config still selects the stub exactly as before.

## 2026-07-29 — Added: README, ahead of going public

- Audited all 57 commits of history for secrets before anything else: clean.
  No credentials in any commit; the committed `.mcp.json` carries only env-var
  placeholders; no `.env`, captured config, or session logs ever landed.
- Added `.env`, `.env.*`, and `*.local` to `.gitignore` as standing hygiene.
- Wrote the first `README.md` under the same honesty laws as the shell: the
  install section says what `install.sh` actually does, prerequisites name
  what it does not provide (Node 22+, the Codex CLI and its login), Windows is
  stated plainly as never-run, and unbuilt integrations appear only under a
  marked "Not built yet" heading. The safety section describes the real
  boundary — the default-deny macOS sandbox and the no-PHI floor — and does
  not claim approval-gated writes, because `approval_policy="never"` is the
  wired truth.
- Smoke check 19 now guards the README's honesty mechanically.

## 2026-07-28 — Building: launch and chrome rewrite

- Reversed the v6.1 tall launch panel introduced in `45ae8b9`. Launch cards now
  use truthful compact/full modes and hug their content at every terminal
  height, leaving spare rows to the transcript instead of stretching the card.
- The launch layout matrix now enforces the compact/full boundaries and forbids
  height-dependent panel stretching.
- Preserved alternate-screen viewport history while reducing persistent chrome
  to one truthful status rule and one borderless composer row.
- Added `/compact`, plus automatic compaction at 90% of the model's context
  window. Compaction is a read-only summarization turn followed by a new engine
  thread; the summary rides the next request as a handoff and is spent once. The
  thread reset is an `EngineSession.startNewThread()` capability that defaults to
  a truthful `false`, so a backend that cannot reset says so instead of claiming
  a reduction it did not get.
- Added first-party `/help`, `/goal`, `/plan`, and `/subagent`; read-only plan and
  worker turns are fresh, ephemeral, transcript-independent, and explicitly
  disable inherited MCP servers and host tools.
- Expanded Codex event mapping into factual reasoning, tool, command, patch,
  collaboration, plan, usage, and outcome activity without exposing hidden
  chain-of-thought.
- Reworked launch identity, live vault counts, transcript signatures, activity,
  status timing/context, palette budgeting, narrow layouts, and reduced motion.
- Added terminal-output sanitization for OSC, CSI, and unsafe controls plus
  terminal-cell-aware CJK, emoji, and combining-character layout.
- Added live App command/isolation tests and responsive matrices spanning target,
  short, narrow, hostile, and pathological terminal sizes.

## 2026-07-26 — Building: Sherman Shell

- A parallel PAUL-mode session is building the Node terminal UI that will own
  Sherman's chat surface and drive Claude Code or Codex headlessly.
- Planned first slice: branded header, streaming chat, engine/model/user/vault
  status, and a shared `EngineSession` seam. The Board follows the stable chat
  loop.

## 2026-07-26 — Fixed: company logo mark

- Replaced the generic three-block header mark with the stacked Sherman Abrams
  Labs mark in the plain and ANSI banners.
- The owning parallel session still controls and commits the banner files.

## 2026-07-26 — Added: banner and starter vault

- Added plain and ANSI terminal banners.
- Seeded `vault/wiki/`, `vault/inbox/`, shared memory guidance, and the private
  memory boundary.
- Commit: `6e52b3b` (`banner + starter vault (codex)`).

## 2026-07-26 — Added: Phase 1 launcher chassis

- Added the idempotent installer, `sherman` launcher and first-run wizard,
  canonical persona, Claude/Codex wrapper templates, and smoke suite.
- The launcher assembles a fresh runtime adapter, records engine/user/vault
  configuration, and delegates login to the selected engine's native OAuth.
- Phase implementation: `2f59775`; PAUL summary/state completion:
  `a1c10a4`, `0f40325`.
