# Sherman design

Sherman Abrams is a company operations agent with one identity, one skill set,
and one company brain across interchangeable engines. It is a clean,
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
        → Claude Code, Codex, or OpenCode with Z.AI GLM, headless
```

- The launcher detects configuration, renders the banner, and starts the shell.
- The wizard's provider choice is the engine choice: Anthropic means Claude
  Code; OpenAI means Codex; Z.AI means GLM through OpenCode; DeepSeek means
  a chosen DeepSeek model (default deepseek-chat) through OpenCode; xAI Grok
  means SuperGrok OAuth through OpenCode. Authentication
  remains the engine's native credential flow — except DeepSeek, whose key
  comes straight from platform.deepseek.com and is pasted into Sherman's own
  key store (`~/.sherman/keys.json`, the /key contract: 0600, never synced,
  injected as DEEPSEEK_API_KEY into the engine environment). Grok uses
  Sherman's own SuperGrok device-code OAuth (`~/.sherman/grok-oauth.json`);
  OpenCode never runs `auth login` for Grok.
- `agent/SYSTEM.md` is the shared persona. Engine adapters are thin templates;
  the launcher generates the selected workspace adapter on every run.
- Sherman Shell owns the screen: streaming chat, status, and later the Board.
  Engines are backends, not the visible product chrome.
- One `EngineSession` interface isolates each engine's transport and event
  stream. `sherman --raw` remains a debug escape.
- Headless engines receive only the restricted tools needed to search, read,
  and write within their allowed vault scope.
- Z.AI uses OpenCode's official provider integration with `glm-5.2` pinned.
  Sherman disables sharing, plugins, shell execution on read-only turns
  (normal turns allow the shell — operator-granted parity with Codex, with
  the vault-write rule riding the operating contract there), and every
  external path except the configured vault. Validated Sherman connectors are
  translated into OpenCode's native MCP schema and bound to the launch digest
  instead of trusting mutable workspace bytes or forking the registry.
  Each run isolates user/project OpenCode configuration, refuses vault symlinks,
  and does not start connector processes for read-only turns.

### Registries

- The first-run wizard's provider menu renders from a registry in
  `bin/sherman` — one `id|label|binary|status|reason` line per provider.
  Enabling a future backend is flipping that provider's line to `available`
  the day its backend is real; it is never new wizard flow. An unavailable
  provider is listed with its reason and refuses selection, because a
  selectable option that errors after selection is the one dishonest shape
  the menu is not allowed to have.
- Messaging channels appear in setup only once their bridge exists. Telegram
  crossed that line (`bridge/telegram.js` — locally run, one paired chat,
  default-deny, driving the same engine-session layer and assembled adapter
  as the shell), so setup offers its token and `sherman telegram` runs it.
  WhatsApp has no bridge — Meta's Business API has no honest overnight path —
  so setup does not mention it; a future bridge follows the same pattern
  rather than growing a second wizard. The Phase 4 always-on hosted bridge
  remains future work; today's bridge runs only while the machine runs it.

## Memory and access model

The vault is company-owned and hidden from employees. A file on an employee's
device is visible to that employee, so the vault must never sync there.

| Tier | Vault path | Sherman access | Admin experience | Employee experience |
| --- | --- | --- | --- | --- |
| Shared business knowledge | `wiki/` and `memory/shared/` | Models read; shell-owned `/wiki` and `/learn` write | Full vault clone; Obsidian and Git for direct human gardening | No vault files; Sherman reaches only shared paths through the scoped service |
| Private user memory | `memory/private/<user>/` | Models read only; no shell-validated private retention command yet | Admins retain repository custody; agents still obey user scoping | No vault files; the service exposes only the authenticated user's scope |

Phase 1 is an Evan-only local exception: `vault/` lives in this repo and the
adapter uses a local path. Phase 4 replaces that backend with a network vault
service; the agent contract stays the same and server-side credentials enforce
privacy.

The vault stores durable company knowledge, one fact per file. It never stores
patient records, named-patient results, or any other PHI.

Every non-empty graceful session exit runs the provider-backed, read-only conduct
eval. Its report is stored only under local `~/.sherman/evals/` and never copied
into a synchronized Vault lane. The exit run is silent by the operator's
standing instruction (2026-08-12): no notice announces it — the transcript
rail glitches for a few seconds instead — and the facts the eval proposes
file automatically on the way out. Background judges file too (same standing
instruction): checkpoint, catch-up, and work-verification verdicts run
through the same proposal parser and file what they propose, silently —
those verdicts carried nearly every proposal, and dropping them was why the
vault never grew. Interactive authoritative retention stays
operator-gated: the explicit `/learn <name> | <lesson>` and
`/wiki <name> | <fact>` commands, plus a per-fact approval box after a
hand-typed `/eval` in which the operator files an eval-proposed fact with one
keypress or skips it. Every path — keypress, command, or automatic filing —
goes through the same deterministic shell-owned writer, which rejects unsafe
content and atomically confines an accepted replacement to `memory/shared/`
or `wiki/`; no retention path ever invokes a model, and normal engine turns
still cannot write the vault at all. The command payload is redacted from the
transcript
and session log before validation, so a rejected fact is not persisted there.
Normal Codex and OpenCode turns cannot mutate the vault directly; the model
file tools are walled off, and durable knowledge lands only through the
shell-owned writer above.
Long-term memory rides every engine the same way (2026-08-12): normal turns
on Codex and OpenCode start and keep the mnemosyne and personal-LLMWiki MCP
servers, read-only and isolated turns start none, and every other configured
MCP stays disabled per turn. The personal LLMWiki is not the target of
`/wiki` and is never treated as company truth.

## Phase ladder

| Phase | Outcome | State |
| --- | --- | --- |
| 1 — Evan-only local prototype | Launcher, wizard, persona, adapter assembly, banner, starter vault, Sherman Shell, and first company skills prove “type `sherman`; the agent appears and knows the business” on one Mac | Shell v7 landed 2026-07-27; launch/chrome rewrite landed 2026-07-28; the first company skills shipped (the set lives in `skills/README.md`) |
| 2 — Sherman Commons Cloudflare pilot | Before deployment: approve the invitation-only identity, signed-device, tenant-isolation, PHI/secret risk-reduction, non-impersonation, moderation, and quarantined-adoption gates. Then pilot a separately deployable Hono Worker and D1 API, private React/Vite dashboard behind Cloudflare Access, and local Commons client/stdio MCP server. No raw chat sync and no auto-install. | Architecture and threat model documented 2026-08-04; local implementation is in progress; deployment, enrollment, and pilot evidence do not exist |
| 3 — Second admin device | Full installer/onboarding, admin vault sync, and the Codex path proven on another admin machine | Not started |
| 4 — Employees and always-on service | Always-on vault host, scoped vault service, per-user credentials, WhatsApp bridge, and employee onboarding | Not started; Commons enrollment is not employee identity and does not complete the server-scoped vault |

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
| 2026-08-04 | Sherman Commons is a distinct, gated Cloudflare pilot: a separately deployable Hono Worker/D1 service and Access-protected dashboard, reached by a local signed client and stdio MCP server. “Only Sherman agents” means invited, enrolled, non-revoked members with valid device signatures; open-source client identity is not remotely attested. |
| 2026-08-04 | Commons never impersonates owners, syncs raw chat, PHI, secrets, vault/private content, or auto-installs peer code. Discovery and metadata-only opt-in inventory sharing remain separate from quarantined, validated, owner-approved adoption. |
| 2026-08-05 | Add Z.AI GLM-5.2 through its officially supported OpenCode runtime; keep credentials in OpenCode, sharing off, plugins off, shell denied, and external file access limited to the configured vault. |
| 2026-08-13 | The engine sandbox may be widened, but only narrowly and only by the operator. Extra writable roots named in `~/.sherman/sandbox.json` are honored by both engines (Codex kernel `writable_roots`, OpenCode `external_directory`); it is opt-in (no file, no change), filesystem-only (network stays off at the kernel), and the vault, the home directory, and the filesystem root are always refused. There is no "safe command" allowlist: neither engine can enforce one headlessly without the per-run approvals the operator opted out of, so the root list is the whole enforceable mechanism. |

Still open: the first 3–5 high-value employee tasks, the Phase 4 WhatsApp
provider (OpenClaw or Twilio), and the long-term company vault Git host.
