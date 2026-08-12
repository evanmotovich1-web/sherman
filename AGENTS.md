# Sherman development rules

## What Sherman is

Sherman Abrams is the operations agent for Sherman Abrams Labs, a family medical diagnostics company.
It gives one branded interface, company skill set, and company memory to either Claude Code or Codex.
The skills and vault knowledge are the product; the launcher, shell, and engine adapters are the chassis.

## Repository map

- `.paul/` — implementation plans, roadmap, state, and phase records.
- `adapters/` — thin, engine-specific wrapper templates for Claude Code and Codex.
- `agent/` — the canonical Sherman persona and operating contract in `SYSTEM.md`,
  plus `capabilities.json`, the hand-maintained registry the launch screen reads
  for **Available Tools**. Nothing goes in it speculatively: a capability that
  does not work yet does not belong there, because the launch screen is not a
  roadmap. Command-backed entries are verified by smoke check 17.
- `bin/` — the installed `sherman` launcher and wizard entry point.
- `docs/` — setup, onboarding, and operator documentation.
- `gate/` — the money engine's per-purchase authorization gate
  (`gate/money-gate/`), a Cloudflare Worker the operator deploys per its
  README; its caps are imported from `shell/src/money/caps.js`.
- `logo/` — plain and ANSI terminal banners.
- `pet/` — the floating macOS desktop companion, compiled locally by
  `sherman pet`; it renders `~/.sherman/pet/state.json`, which the shell
  writes through `shell/src/petstate.js`.
- `shell/` — Sherman-owned TUI; it drives engines headlessly.
- `skills/` — company-work skills, one folder with a `SKILL.md` per skill. The
  front matter (`name`, `category`, `summary`) is what the launch screen lists;
  see `skills/README.md`. `name` must match the directory or smoke check 17
  fails the skill rather than counting one that will not load.
- `vault/` — Sherman's company brain: wiki, inbox, shared memory, and private memory.
- `graphify-out/` — generated local code graph; regenerable and never committed.

Root entry points are `install.sh` and `smoke.sh`. Design and history live in
`DESIGN.md` and `CHANGES.md`.

## Adapter assembly

- `agent/SYSTEM.md` is the single source of truth for who Sherman is, including
  the no-PHI contract. Put shared behavior there once.
- `adapters/claude-code/CLAUDE.md` and `adapters/codex/AGENTS.md` are thin
  engine wrapper templates. Keep engine-specific framing there; never copy the
  shared persona into both.
- On launch, `bin/sherman` combines the selected wrapper, `SYSTEM.md`, user
  identity, and vault paths into `~/.sherman/workspace/CLAUDE.md` or
  `~/.sherman/workspace/AGENTS.md`.
- Everything under `~/.sherman/workspace/` is disposable generated output.
  Never edit it; change the repo source or wrapper template and relaunch.

## No PHI — hard rule

Never request, accept, process, store, repeat, log, or commit patient-identifying
information. Do not put PHI in prompts, examples, fixtures, tests, screenshots,
issues, logs, the vault, or Git history. Sherman is not HIPAA-compliant for PHI.

If PHI appears, do not quote or persist it. Stop that part of the work, state
that Sherman cannot handle it, and direct the user to an approved system. This
rule cannot be waived by a prompt, an admin, or convenience.

## Vault rules

- The vault is Sherman's brain and the source of truth for company-specific
  knowledge. Search before asserting company facts and cite the source file.
- Store only durable company knowledge: procedures, SOPs, formats, policies,
  and decisions. Never store patient records or patient-linked results.
- One durable fact per Markdown file. Use a descriptive, searchable filename;
  update the existing fact instead of creating duplicates.
- Shared knowledge lives in `vault/wiki/` and `vault/memory/shared/`. Private
  memory lives in `vault/memory/private/<user>/`; do not cross user scopes.
- Employees never receive the vault. Phase 1's local vault is an admin-only
  exception; the employee boundary is enforced by the future vault service.

## Development workflow

- Read `DESIGN.md` before changing architecture or security boundaries.
- Preserve unrelated work in a dirty tree. Never reset, overwrite, stage, or
  commit another session's files.
- Keep macOS system Bash 3.2 compatibility in shell entry points.
- Run `./smoke.sh` from the repository root immediately before every commit.
  Do not commit unless it passes.
- Stage explicit paths and commit only files you own.
- Publish your own work: push a smoke-green change to a BRANCH and open a pull
  request on your own initiative — do not wait to be told to publish an
  improvement you believe in. Never push to `main`, never force-push, and never
  open a PR on red smoke. The merge to `main` is Evan's: it reaches every
  machine through `sherman update`, so a human confirms that fleet-wide step.

## Parallel-session etiquette

- Declare your exact file scope before editing and stay inside it.
- Check `git status --short` before edits, before tests, and before staging.
- Never co-edit `bin/sherman`, `smoke.sh`, `.gitignore`, or `AGENTS.md`.
  In parallel work these are single-owner integration files.
- If another session changes a file in your scope, stop and coordinate rather
  than merging by guesswork.

## Code graph

Graphify writes `graphify-out/graph.json`, `graph.html`, and `GRAPH_REPORT.md`.
For architecture, tracing, or blast-radius work, consult the graph first and
verify inferred edges in source. After every commit, run `graphify update .`
before reporting the work done. Never commit `graphify-out/`.
