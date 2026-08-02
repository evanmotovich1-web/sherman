# Changes

Newest entries appear first. “Building” means active work that is not yet a
shipped, verified release.

## 2026-08-02 — Added: Sherman can reach the public internet, through a connector it names

- New skill `mcp`. It is the other half of `0-1`: that one acquires a
  capability, this one spends it. Check what is actually wired before claiming
  a capability, name the connector and platform an answer came through, and
  separate what was reached from what was dark. Routed from `agent/SYSTEM.md`,
  so it is reached from the operating contract rather than only when a
  description happens to match.
- Two connectors catalogued, both verified against a live server first.
  `agent-reach` — Agent Reach 1.5.0 as a user-global uv tool, fifteen platforms
  behind one router. Its MCP server exposes exactly one tool, `get_status`; the
  fetching is its command-line tool, and the skill says so plainly rather than
  letting a turn be wasted looking for tools that are not there. `exa` —
  keyless semantic web search over live pages, HTTP transport, and therefore
  Claude Code only, which `/connectors` and the launcher both state.
- Connector catalog entries may now declare `env`, the environment their server
  process runs under, with one new expansion variable: `${PATH}`, the
  launcher's own. This exists because a server that shells out to its own
  helper binaries and is handed a truncated PATH reports its own capabilities
  as missing — a wrong answer that looks exactly like a right one. Agent Reach
  read 4 of 15 channels under a bare PATH and 5 of 15 under the rendered one.
  A committed catalog cannot know an operator's PATH, so an entry writes
  `${HOME}/.local/bin:${PATH}`; duplicates are collapsed on render because the
  result lands in a person's codex config. The probe runs under the same
  environment, so what is tested is what the engine is handed, and a value that
  does not resolve blocks the connector instead of half-building it.
- Verified end to end: the rendered `.mcp.json` and codex `[mcp_servers.*.env]`
  block both parse, Claude Code lists all three servers from the workspace, and
  `get_status` answers when spawned from exactly the rendered command and
  environment. A sandbox HOME without Agent Reach installed degrades to the
  named repair command rather than a broken server, and that repair command was
  itself run in a throwaway tool directory before being written down.

## 2026-07-31 — Changed: skills act first, and failed updates keep their evidence

- Sherman now works autonomously by default: inspect the vault and available
  files, infer routine choices, use reversible defaults, and finish the task
  instead of turning a skill into a questionnaire. Interactive interviews,
  menus, and approval checkpoints are opt-in through the current request; one
  focused question remains for a genuinely unknowable, material blocker. The
  shared operating contract governs every turn, `/skill` envelopes reinforce
  it, and SEED explicitly converts its imported wait points into an internal
  decision checklist. The automatic session eval now grades avoidable questions
  and pauses, while durable corrections are recorded without asking whether to
  remember them. The no-PHI boundary is unchanged.
- `sherman update` now treats dependency-install or smoke failure as a failed
  verification, never a healthy update; it also reinstalls dependencies when
  either package manifest changes. Smoke repeats every failure in a final
  recap, and its Node-test check prints the actual failing TAP blocks instead
  of discarding them and showing only a count. A PC result such as "39 passed,
  5 failed" now ends with the five diagnostics needed to repair that platform.
  The update check itself now uses an offline fake checkout for both pass and
  fail paths instead of contacting the real remote during every smoke run.

## 2026-07-30 — Changed: old configs get the new questions; the installer grows the window

- A config written before the model and Telegram questions existed now gets
  exactly those questions asked once, on the next interactive launch, then
  the config version bumps to 2 so it never repeats. "It didn't ask me" was
  the real experience of the first Windows machine — its config predated the
  questions — and silently never asking is the wrong kind of quiet.
  Non-interactive runs skip: a pipe cannot answer. Verified end-to-end with
  an expect-driven pty: model lands in codex's own config, version bumps.
- install.ps1 (build 2026-07-30.14) grows the console to 120×45 best-effort
  before starting Sherman: the full launch screen needs 29+ rows and the
  wide banner 40+, and the person should not have to know that. Where the
  terminal ignores console resize APIs, the compact card itself now names
  the fix on screen.

## 2026-07-30 — Added: model choice, Telegram bridge, and one vault on every machine

- Driven by the first real Windows install (issue #9, ten runs on real
  hardware): setup gained an optional **model** question — written into
  codex's own config, the one place codex reads it, backed up and verified
  by read-back — and an optional **Telegram** token question. The connect
  flow may exist because the bridge now does: `bridge/telegram.js`, zero
  dependencies, long-polling the Bot API, one engine session per chat over
  the same assembled adapter as the shell, default-deny to every chat but
  the one paired with `sherman telegram --allow`. Verified to the edge of
  what a machine without a bot token can verify: a fake token reaches
  Telegram's own Unauthorized and exits loud. WhatsApp remains unbuilt and
  is stated as such, not menued.
- **`sherman sync`** shares the vault across machines through the repo:
  pull --ff-only, commit only the shared lanes (wiki, shared memory,
  inbox), push when the machine has write access, and say plainly when it
  only pulled. Private memory never travels; sync refuses to commit over
  another session's staged work. The new **llm-wiki** skill (tenth) teaches
  the habit: write the fact, sync, report what actually happened. The vault
  is plain Markdown, so it doubles as an Obsidian vault as-is.
- The compact launch card now says it is the small-window view and that a
  larger window shows the full screen — on the first Windows run it read as
  "an old Sherman" next to a maximized Mac, and a view that cannot explain
  itself invites exactly that misreading.

## 2026-07-30 — Changed: skills reach the engine, speak the standard, and gain a ninth

- Until now the skills reached the launch screen and nothing else — no
  ordinary engine turn ever saw them. The launcher now copies `skills/` into
  the workspace on every launch, at `.agents/skills` (the Agent Skills
  convention Codex discovers natively) and `.claude/skills` (Claude Code's),
  and the assembled body tells the engine they are there. Copies, not
  symlinks: the workspace is disposable, and a link would aim engine writes
  back at the repo. Smoke check 3 counts what landed against what the repo
  defines, per convention.
- Every `SKILL.md` now carries the Agent Skills standard's second mandatory
  field, `description` — the line an engine reads to decide when a skill
  applies. The registry treats a skill without one as malformed, because a
  skill the engine will never reach for is not a working skill.
  `skills/README.md` documents the contract.
- New skill `sop-review` (documents): report which vault SOPs are overdue,
  coming due, or have never been reviewed, from a review line each SOP
  carries — the one PHI-free document-control habit every serious lab
  document system sells. It never marks anything reviewed; that stays a
  human act. `sop-draft` now ends SOPs with the review line under the same
  rule. Grounding: `docs/research/market-2026-07.md`.

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
