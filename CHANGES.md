# Changes

Newest entries appear first. “Building” means active work that is not yet a
shipped, verified release.

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
