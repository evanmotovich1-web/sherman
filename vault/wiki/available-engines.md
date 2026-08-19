# Engines Sherman can run on

Five providers, selected by the wizard's provider question (the config's
`engine` field decides; nothing probes or auto-detects). Model choice for
Grok and DeepSeek is stored as `model` in `~/.sherman/config.json`.

- **codex** — OpenAI Codex CLI, driven headlessly (`codex exec --json`).
  Kernel-level sandbox: workspace-write, no network egress, vault excluded.
  Model lives in Codex's own config. See [[machine-enrollment]].
- **claude** — Claude Code, same headless seam. Listed, not yet wired into
  the Sherman Shell.
- **zai** — Z.AI GLM through the OpenCode runtime, still pinned to
  `glm-5.2`. Gotcha: a Z.AI *Coding Plan* key is not a general API key —
  on stalls, check plan type and balance first.
- **deepseek** — chosen DeepSeek model (default `deepseek-chat`) through
  the same OpenCode runtime; the key is pasted into Sherman's key store
  per [[key-handover-procedure]], never an OpenCode login. Pick another
  with `sherman model deepseek-reasoner` (or the interactive menu).
- **grok** — xAI Grok through OpenCode SuperGrok OAuth
  (`opencode auth login --pure --provider xai --method "SuperGrok Subscription"`).
  Not an API-key paste and not OpenRouter. Default `grok-4.3`; pick another
  with `sherman model grok-4.5`. Local inventory is [[local-ml-inventory-2026-08-16]].

OpenCode engines have no filesystem sandbox — Sherman confines them with a
permission allowlist instead, and the vault stays writable only through the
shell-owned validated path on every engine.

Operator-granted extra writable directories (all engines):
`~/.sherman/sandbox.json` — see `docs/sandbox-roots.md`; opt-in, vault and
network excluded, always refused for home/root.

Source: `shell/src/engine/index.js`, `shell/src/engine/codex.js`,
`shell/src/engine/opencode.js`, `shell/src/config.js`, `docs/sandbox-roots.md`.
