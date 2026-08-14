# Engines Sherman can run on

Four providers, selected by the wizard's provider question (the config's
`engine` field decides; nothing probes or auto-detects):

- **codex** — OpenAI Codex CLI, driven headlessly (`codex exec --json`).
  Kernel-level sandbox: workspace-write, no network egress, vault excluded.
- **claude** — Claude Code, same headless seam.
- **zai** — Z.AI GLM through the OpenCode runtime. Gotcha: a Z.AI *Coding
  Plan* key is not a general API key — on stalls, check plan type and
  balance first.
- **deepseek** — deepseek-chat through the same OpenCode runtime; the key is
  pasted into Sherman's key store, never an OpenCode login.

OpenCode engines have no filesystem sandbox — Sherman confines them with a
permission allowlist instead, and the vault stays writable only through the
shell-owned validated path on every engine.

Operator-granted extra writable directories (all engines):
`~/.sherman/sandbox.json` — see `docs/sandbox-roots.md`; opt-in, vault and
network excluded, always refused for home/root.

Source: `shell/src/engine/index.js`, `shell/src/engine/codex.js`,
`shell/src/engine/opencode.js`, `docs/sandbox-roots.md`.
