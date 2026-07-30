# Sherman design

Sherman Abrams is a company operations agent with one identity, one skill set,
and one company brain across two interchangeable engines. It is a clean,
standalone product: not agentic-os, not Pi machinery, and not a custom model.

The original rationale was drafted 2026-07-25 in Evan's private planning
notes, outside this repository; everything from them that still matters is
carried in this document and in the decisions table below.

## Runtime architecture

```text
`sherman` launcher
        → first-run wizard and saved config
        → adapter assembly from wrapper + agent/SYSTEM.md
        → Sherman Shell (the user interface)
        → EngineSession backend
        → Claude Code or Codex, headless
```

- The launcher detects configuration, renders the banner, and starts the shell.
- The wizard's provider choice is the engine choice: Anthropic means Claude
  Code; OpenAI means Codex. Authentication remains the engine's native OAuth.
- `agent/SYSTEM.md` is the shared persona. Engine adapters are thin templates;
  the launcher generates the selected workspace adapter on every run.
- Sherman Shell owns the screen: streaming chat, status, and later the Board.
  Engines are backends, not the visible product chrome.
- One `EngineSession` interface isolates Claude's streaming JSON/API from
  Codex's exec/app-server event stream. `sherman --raw` remains a debug escape.
- Headless engines receive only the restricted tools needed to search, read,
  and write within their allowed vault scope.

### Registries

- The first-run wizard's provider menu renders from a registry in
  `bin/sherman` — one `id|label|binary|status|reason` line per provider.
  Enabling a future backend is flipping that provider's line to `available`
  the day its backend is real; it is never new wizard flow. An unavailable
  provider is listed with its reason and refuses selection, because a
  selectable option that errors after selection is the one dishonest shape
  the menu is not allowed to have.
- Messaging channels (WhatsApp, Telegram) are deliberately absent from setup.
  Nothing offers a connect flow until the Phase 3 bridge exists; when it
  does, it reuses the same registry pattern — an entry added and flipped to
  available — rather than growing a second wizard.

## Memory and access model

The vault is company-owned and hidden from employees. A file on an employee's
device is visible to that employee, so the vault must never sync there.

| Tier | Vault path | Sherman access | Admin experience | Employee experience |
| --- | --- | --- | --- | --- |
| Shared business knowledge | `wiki/` and `memory/shared/` | Every user's Sherman reads and writes | Full vault clone; Obsidian and Git for direct gardening | No vault files; Sherman reaches only shared paths through the scoped service |
| Private user memory | `memory/private/<user>/` | Only that user's Sherman reads and writes its scope | Admins retain repository custody; agents still obey user scoping | No vault files; the service exposes only the authenticated user's scope |

Phase 1 is an Evan-only local exception: `vault/` lives in this repo and the
adapter uses a local path. Phase 3 replaces that backend with a network vault
service; the agent contract stays the same and server-side credentials enforce
privacy.

The vault stores durable company knowledge, one fact per file. It never stores
patient records, named-patient results, or any other PHI.

## Phase ladder

| Phase | Outcome | State |
| --- | --- | --- |
| 1 — Evan-only local prototype | Launcher, wizard, persona, adapter assembly, banner, starter vault, Sherman Shell, and first company skills prove “type `sherman`; the agent appears and knows the business” on one Mac | Shell v7 landed 2026-07-27; launch/chrome rewrite landed 2026-07-28; the first eight company skills shipped (see `skills/README.md`) |
| 2 — Second admin device | Full installer/onboarding, admin vault sync, and the Codex path proven on another admin machine | Not started |
| 3 — Employees and always-on service | Always-on vault host, scoped vault service, per-user credentials, WhatsApp bridge, and employee onboarding | Not started |

## Decisions on record

| Date | Decision |
| --- | --- |
| 2026-07-25 | Build Sherman as a clean standalone repo. Hermes is a pattern reference, not the engine; agentic-os and Pi are out. |
| 2026-07-25 | Ride the user's Claude Code or Codex CLI. Provider choice selects the engine, and native engine OAuth handles login. |
| 2026-07-25 | The company vault is hidden from employees. Employee access must be a server-scoped service, not synced folders. |
| 2026-07-25 | No PHI may enter Sherman. Relaxing that boundary would require a separate compliance program, not a config change. |
| 2026-07-26 | For the local prototype, keep the vault at `<repo>/vault` behind a configurable path instead of creating a second repo immediately. |
| 2026-07-26 | Sherman owns the UI. The shell drives both engines headlessly through one backend interface. |
| 2026-07-26 | `agent/SYSTEM.md` is the shared source; runtime adapters are generated on launch and disposable. |

Still open: the first 3–5 high-value employee tasks, the Phase 3 WhatsApp
provider (OpenClaw or Twilio), and the long-term company vault Git host.
