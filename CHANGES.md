# Changes

Newest entries appear first. “Building” means active work that is not yet a
shipped, verified release.

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
