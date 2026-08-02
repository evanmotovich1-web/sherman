---
phase: 08-connectors-and-method-skills
plan: 01
status: complete
commit: 638f3bc
date: 2026-08-01
---

# 08-01 — The connector layer

**3/3 tasks PASS · AC 1–6 Pass · commit `638f3bc`**

## What shipped

`agent/connectors.json` (committed catalog), `~/.sherman/connectors.json`
(machine enablement + secrets, chmod 600), `shell/src/connectors.js` (resolver,
renderer, `describe`), `/connectors`, `docs/CONNECTORS.md`, and smoke check 24.

`bin/sherman`'s fifty-line llmwiki block is gone. The launcher now runs the
resolver once per launch, removes and rewrites `.mcp.json` from scratch, and
appends per-connector `[mcp_servers.*]` blocks under the existing
backup-then-read-back contract.

## Acceptance criteria

| AC | Verdict | Evidence |
|---|---|---|
| AC-1 catalog is data | Pass | No connector-specific branch remains in `bin/sherman`; llmwiki renders from its catalog entry |
| AC-2 missing secret reported, never half-wired | Pass | Check 24 asserts the keyless fixture is absent from both outputs and its secret name and signup URL appear in the notes |
| AC-3 secrets never leak | Pass | Check 24 asserts a literal fixture key appears in no rendered artifact, no note, and no return value |
| AC-4 `/connectors` shows three states | Pass | `describe()` reads Connected from the rendered `.mcp.json` and the other headings from `resolve`, omitting any that is empty |
| AC-5 LLM Wiki preserved | Pass | Rendered output compared against the previous hardcoded block — identical command, args, and TOML; `/wiki` preflight untouched and passing |
| AC-6 wiring is tested | Pass | Check 24, against fixtures, so it proves the renderer rather than this machine |

## Deviations from plan

**The `connectors` capability became a tool inside the existing `web` toolset,
not a new toolset of its own.** A new toolset adds a row to the launch panel,
and `ui-layout.test.js` asserted the tall-terminal stretch exceeds the compact
panel by six rows — a margin that was exactly consumed. Panel layout was outside
this plan's scope, so the capability moved into `web`, whose summary widened
from "look things up outside the company" to "reach outside the company". (The
underlying brittleness was addressed in 08-03, where it became unavoidable.)

**The renderer stages per-connector TOML files rather than printing TOML to
stdout.** The launcher walks `$WORKSPACE/.codex-mcp/*.toml` and appends what the
codex config does not already have. This keeps the backup-and-read-back write in
bash where the rest of the config writes live, and stays bash-3.2 clean.

## Discovered

**Bash 3.2 scans `$( … )` for quote, paren, and backtick balance even inside a
quoted heredoc.** A lone `"` in a JS regex inside a smoke check broke `smoke.sh`
with a parse error 500 lines away, twice, on two different characters. Every
such literal in a smoke heredoc must be a hex escape — `\x22`, `\x28`, `\x60` —
and the checks now carry a comment saying so, because the failure gives no hint
of its cause.

**The MCP path had no test coverage at all before this plan** — the one place
Sherman hands a live subprocess to the engine.

## Follow-on

- The catalog holds one entry. It fills as `0-1` verifies connectors.
- HTTP-transport connectors render for Claude Code only; codex's url-based MCP
  config surface has not been verified against a real codex here, and is
  reported rather than guessed.
