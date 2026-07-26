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

### Validated — shipped and verified

| # | Requirement | Source | Shipped |
|---|---|---|---|
| R1 | `sherman` on PATH → banner → working session | §1, §3b step 6 | ✓ Phase 1 |
| R2 | Provider choice is the FIRST question ever asked; it IS the engine choice (Anthropic→`claude`, OpenAI→`codex`) | §3b step 1 | ✓ Phase 1 |
| R3 | **No custom OAuth.** Launching the engine triggers that engine's own native browser login. Sherman only records the choice. | §3b step 1 | ✓ Phase 1 |
| R4 | Two-tier memory: shared business memory (all agents read+write) + private per-user memory (that user's agent only) | §4 | ✓ Phase 1 — wired into the adapter; enforcement is prose until v0.3 |
| R5 | Engine-specific detail lives in the adapter, never in skills or the vault | §3 | ✓ Phase 1 |
| R6 | Vault reached through a thin interface — local-path backend now, network backend at v0.3. Swap must be a config change, not a rewrite. | §4 | ✓ Phase 1 — `vault_path` config field |
| R7 | Installer is idempotent — rerunning re-asks only what is missing | §3b | ✓ Phase 1 |
| R11 | **Sherman owns the screen.** Our UI on top, the engine headless underneath — no OpenAI or Anthropic chrome. `sherman --raw` remains the debugging escape hatch. | §3c | ✓ Phase 4 |
| R12 | The either-engine promise holds at the **UI seam**, not just the persona seam: one `EngineSession` contract, engine specifics quarantined in one backend file | §3c | ✓ Phase 4 — proven by shipping the whole UI without touching `shell/src/engine/` |
| R13 | The engine runs restricted — file read/search/write inside the vault only, no network, nothing else auto-approved | §3c, §4 | ✓ Phase 4 — enforced by the OS sandbox and proven by an escape test |

### Active

- [ ] **R8 — The vault has to actually know things.** The chassis works, the screen is ours, the brain is still empty. Blocked on §7 Q1. **This is now the only thing standing between Sherman and being useful.**
- [ ] **R9 — The Codex adapter must be exercised against real Codex.** Partially discharged: Phase 4 drove real Codex headlessly through `codex exec --json`, so the adapter and the transport are both proven on this machine. What remains is a machine *without* Claude Code — v0.2.

### Emerged during Phase 1

- [ ] **R10 — Durable output must go to the vault, never the workspace.** `~/.sherman/workspace/` is wiped and rebuilt on every launch by design. Any future skill that writes artifacts there loses them. Needs stating in skill-authoring guidance before the first skill ships.

### Emerged during Phase 4

- [ ] **R14 — Node 22+ is now a hard runtime dependency.** The shell is an Ink app. On this Mac `node` is supplied by Hermes' bundled runtime (`~/.local/bin/node → ~/.hermes/node/bin/node`). v0.2's installer must decide: require Node, or bundle it. Without Node there is no UI — only `sherman --raw`.
- [ ] **R15 — Perceived speed is a product requirement, not polish.** There are no token deltas on the Codex transport (D8), and the first turn is the slowest one a user ever sees. Any future surface that waits on the engine must show live progress, or a healthy Sherman reads as a hung one.
- [ ] **R16 — The shell looks like a chat app, so users will expect chat-app affordances.** No cross-run history, no up-arrow recall, no multi-line editing. Deliberate for v1; the first to be missed is probably history recall.

## Key decisions

| Decision | Rationale | Phase |
|---|---|---|
| Vault at `<repo>/vault`, recorded as `vault_path` | Build brief overrode design-doc §2's separate-repo layout | 1 |
| PATH priority `~/.local/bin` → `~/bin` → `/usr/local/bin` | Neither dir the brief named exists on this Mac; `~/.local/bin` is on PATH and holds claude/codex/hermes | 1 |
| Adapter templates hold only an engine wrapper + `{{SHERMAN_BODY}}` | Hand-duplicating the persona across adapters is how "either engine" decays into Claude-only | 1 |
| `awk` for the splice, never `sed` | Persona is multi-line markdown containing `&`, `/`, backslashes | 1 |
| Adapter rebuilt on every launch | Repo is truth, workspace is disposable — edits to the workspace can never silently become config | 1 |
| Both adapter files removed before writing one | Switching engines otherwise strands a stale sibling the other engine may read | 1 |
| Codex driven via `codex exec --json` + `exec resume`, not the app-server protocol | Stable CLI surface, verified end to end. app-server has true token deltas but is `[experimental]` with 39+ message types — a v1 built on it breaks on `codex update`. The cost is no typewriter streaming | 4 |
| Vault boundary enforced by the macOS seatbelt sandbox, not by disabling `shell_tool` | On Codex, file access is delivered *through* shell; removing the tool would strip the capability Sherman needs. The kernel cannot be talked around by a prompt | 4 |
| All engine posture travels as `-c` overrides | `codex exec resume` accepts a narrower flag set than `codex exec` — `-s`/`-C`/`--add-dir`/`-p` are rejected. Passing sandbox as `-s` would be correct on turn 1 and silently absent afterward | 4 |
| Engine cwd stays `~/.sherman/workspace`; the vault becomes writable via `writable_roots` | Codex reads `AGENTS.md` from its cwd, and that file is Sherman's system prompt. Pointing cwd at the vault would seal the sandbox correctly and orphan the persona | 4 |
| Primary terminal screen + a single `<Static>`, never Ink's alternate screen | The alternate screen makes scrollback unavailable. Letting the terminal own the transcript is worth more than a tidy fixed layout | 4 |
| Banner printed once, not pinned; `bin/sherman` skips it in shell mode | It is 18 lines — pinning leaves six rows for the conversation on a 24-row terminal, and printing it in both places shows it twice | 4 |
| Node problems fail loudly instead of falling back to the engine | A silent fallback drops the user into engine chrome believing they are in Sherman — the exact failure the shell exists to remove | 4 |

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
  shell/                  # the Sherman Shell — our UI, engine headless underneath
    bin/sherman-shell.js  #   entry: --version, --help, --probe (Ink app at 04-02)
    src/config.js         #   reads ~/.sherman/config.json (read-only)
    src/engine/session.js #   EngineSession contract + normalized events — the seam
    src/engine/codex.js   #   the ONLY file that knows Codex exists
    src/engine/claude.js  #   stub until the Claude backend phase
    README.md             #   transport decision, permissions posture, traps
  smoke.sh                # 3 checks, no framework
  logo/                   # ANSI banner            [PARALLEL TRACK — Codex owns]
  vault/                  # company knowledge base [PARALLEL TRACK — Codex owns]
  skills/                 # company skills         [later slice]
```

**The engine seam.** `shell/src/engine/session.js` is where the either-engine
promise lives at the UI layer, exactly as `agent/SYSTEM.md` + adapters holds it at
the persona layer. Nothing engine-specific belongs in it. A UI written against its
event union must be unable to tell which engine answered — if a vendor detail wants
to leak through, it belongs in the backend instead.

### Runtime state (outside the repo)

```
~/.sherman/config.json    # {version, engine, user, vault_path}
~/.sherman/workspace/     # engine cwd; adapter file refreshed every launch
shell/node_modules/       # ink + react; installed by install.sh, gitignored
```

### Runtime requirements

| Need | For | Without it |
|---|---|---|
| The chosen engine (`codex` or `claude`) on PATH | everything | `sherman` refuses to start |
| Node 22+ and `shell/node_modules` | the Sherman Shell UI | `sherman` explains and exits; `sherman --raw` still works |
| An interactive TTY | the UI | clear message; use `--probe` or `--raw` |

## Memory model

| Tier | Path | Read | Write |
|---|---|---|---|
| Business (shared) | `<vault>/memory/shared/` + `<vault>/wiki/` | every user's Sherman | every user's Sherman |
| Private | `<vault>/memory/private/<user>/` | that user's Sherman only | that user's Sherman only |

## Out of scope for this project

- Pi seats, factory machinery, agentic-os integration
- Custom OAuth of any kind
- Anything that puts patient-identifying data anywhere near Sherman

---
*Last updated: 2026-07-26 after Phase 4*
