# PROJECT

Bootstrapped 2026-07-26 from the design source of truth:
`/Users/moto/code/agentic-os/plans/PLAN-2026-07-25-sherman-abrams-agent.md`
That document remains authoritative for design. This file is the PAUL-side
distillation — read it for constraints, read the plan doc for reasoning.

## What this is

**Sherman Abrams** — one elite AI agent for the family medical diagnostics
company (Sherman Abrams Labs).

The UX contract, in Evan's words: the way typing `hermes` in a terminal brings
up Hermes, typing `sherman` brings up Sherman Abrams — custom logo banner, then
a working session that knows the business.

End state: everyone in the company runs Sherman from their own device, all
connected to the same company knowledge base.

## Value proposition

Sherman is **not its own engine**. It is a branded, memory-wired layer over
whichever coding CLI the user already has (Claude Code or Codex). One
definition of Sherman — persona, skills, memory layout — plus two thin
adapters. That is what makes "either engine" a real promise instead of a
Claude-only product that drifted.

The skills are the product; everything else is chassis.

## Core requirements

| # | Requirement | Source |
|---|---|---|
| R1 | `sherman` on PATH → banner → working session | §1, §3b step 6 |
| R2 | Provider choice is the FIRST question ever asked; it IS the engine choice (Anthropic→`claude`, OpenAI→`codex`) | §3b step 1 |
| R3 | **No custom OAuth.** Launching the engine triggers that engine's own native browser login. Sherman only records the choice. | §3b step 1 |
| R4 | Two-tier memory: shared business memory (all agents read+write) + private per-user memory (that user's agent only) | §4 |
| R5 | Engine-specific detail lives in the adapter, never in skills or the vault | §3 |
| R6 | Vault reached through a thin interface — local-path backend now, network backend at Phase 3. Swap must be a config change, not a rewrite. | §4 |
| R7 | Installer is idempotent — rerunning re-asks only what is missing | §3b |

## Hard constraints

### C1 — No PHI. Ever. (compliance, non-negotiable)

Medical diagnostics company. Patient data is PHI.

**V1 rule:** the vault holds procedures, SOPs, formats, and company knowledge —
**never** patient records or results tied to a named patient.

This is what keeps the later WhatsApp bridge clean: WhatsApp is not
HIPAA-compliant for PHI, but SOP/ops/knowledge chatter is fine *because PHI
never enters Sherman at all*.

Loosening this is a real compliance project (BAAs, encryption, access logs),
not a config change. The rule is restated verbatim in the assembled adapter on
every single launch.

### C2 — The vault is hidden from employees

Company-owned. Sherman reads and writes it; employees interact with Sherman,
never with the vault. A file on an employee's disk is a file the employee can
open — so the vault never syncs to employee machines (Phase 3 enforces this
server-side). Phase 1 exception: Evan-only, so vault-local is fine.

### C3 — Clean slate

Not part of agentic-os, not a worktree, no Pi machinery, no factory laws.
Hermes is a pattern reference for the always-on phase, not the engine.

### C4 — Platform floor: macOS system bash 3.2.57

No `${var,,}`, no associative arrays, no `readlink -f`. Verified 2026-07-26.

### C5 — Local commits only

`git init` here and commit locally. **Evan pushes.** Never push.

## Repository layout (target)

```
/Users/moto/code/sherman/
  install.sh              # PATH symlink + chmod, idempotent
  bin/sherman             # launcher: banner, first-run wizard, adapter assembly, exec
  agent/SYSTEM.md         # the persona — one definition of who Sherman is
  adapters/claude-code/CLAUDE.md   # engine wrapper template
  adapters/codex/AGENTS.md         # engine wrapper template
  smoke.sh                # 3 checks, no framework
  logo/                   # ANSI banner            [PARALLEL TRACK — Codex owns]
  vault/                  # company knowledge base [PARALLEL TRACK — Codex owns]
  skills/                 # company skills         [later slice]
```

### Runtime state (outside the repo)

```
~/.sherman/config.json    # {version, engine, user, vault_path}
~/.sherman/workspace/     # engine cwd; adapter file refreshed every launch
```

## Memory model

| Tier | Path | Read | Write |
|---|---|---|---|
| Business (shared) | `<vault>/memory/shared/` + `<vault>/wiki/` | every user's Sherman | every user's Sherman |
| Private | `<vault>/memory/private/<user>/` | that user's Sherman only | that user's Sherman only |

## Out of scope for this project

- Pi seats, factory machinery, agentic-os integration
- Custom OAuth of any kind
- Anything that puts patient-identifying data anywhere near Sherman
