---
phase: 01-launcher-chassis
plan: 01
status: complete
commit: 2f59775
date: 2026-07-26
---

# SUMMARY — 01-01 Launcher chassis

**3 tasks, 3 PASS. 7/7 acceptance criteria met. Committed locally as `2f59775`. Nothing pushed.**

## How to try it

```bash
cd /Users/moto/code/sherman
./install.sh          # already run — symlinked into ~/.local/bin
sherman               # first run asks 2 questions, then opens your session
```

First run asks exactly two things:

```
Sign in with: [1] Anthropic  [2] OpenAI  >
Your name >
```

Answer `1` and it launches Claude Code. If you aren't authenticated, Claude
Code's own browser login fires — Sherman has no auth code of its own.

Every run after that: banner, then straight into a session.

```bash
./smoke.sh            # 3 checks, currently all green
cat ~/.sherman/config.json
cat ~/.sherman/workspace/CLAUDE.md    # what Sherman actually reads
```

To change who Sherman is, edit `agent/SYSTEM.md` — the adapter is rebuilt from
it on every launch, so changes land next time you type `sherman`.

## What was built

| File | What it does |
|---|---|
| `bin/sherman` | Banner → wizard (first run only) → adapter assembly → `exec` engine with cwd `~/.sherman/workspace/` |
| `install.sh` | chmod + PATH symlink, idempotent, reports where it landed and whether that's on PATH |
| `agent/SYSTEM.md` | The persona. One definition, spliced into whichever adapter applies |
| `adapters/claude-code/CLAUDE.md` | Claude Code wrapper — engine framing + `{{SHERMAN_BODY}}` token, nothing else |
| `adapters/codex/AGENTS.md` | Same contract in AGENTS.md idiom |
| `smoke.sh` | 3 checks: executable / first-run config / adapter contents |

The persona and the three memory blocks (knowledge base, private memory, no-PHI
rule) are generated in exactly one place — `bin/sherman` — and spliced with
`awk` into the engine template. Nothing is hand-duplicated across the two
adapters, which is what keeps "either engine" from decaying into Claude-only.

## What is stubbed or deferred

| Item | State |
|---|---|
| **Vault contents** | The Codex track landed `wiki/README.md`, `memory/shared/README.md`, `inbox/README.md`. There is no real company knowledge in there yet, so Sherman has nothing substantive to search. It will say so rather than invent — that is the designed behavior, but the vault is the next thing that matters. |
| **Skills** | None. `skills/` does not exist. Blocked on design-doc §7 Q1 — the 3–5 tasks employees burn the most hours on. |
| **Codex adapter** | Written and exercised by the engine-switch test (config flipped to `codex`, correct `AGENTS.md` produced, no stale sibling). Never run against real Codex. That is v0.2's job, on a machine without Claude Code. |
| **Wizard steps 3–4** | Role/skills questions and WhatsApp registration not built — v0.2 and v0.3. |
| **`curl \| bash` installer** | `install.sh` is local-clone only. The one-link front door is v0.2. |
| **Vault service** | Phase 1 is local-path only. `vault_path` is a config field precisely so the v0.3 network backend is a config change, not a rewrite. |
| **Your real first run** | Deliberately left to you — see deviation D3 below. |

## Deviations from plan

**D1 — Task 1 verify assertion was over-specified.**
It asserted `find logo vault -type f` returns 0. The parallel Codex session
landed 6 files there at 01:01 while this plan was executing. The boundary's
actual requirement is that *this plan* authors nothing in those trees, which
holds — only `mkdir -p` was run. Assertion corrected to non-authorship.
Side effect: `logo/banner.ans` existing early meant AC-6's ANSI branch got
tested for real instead of by inspection.

**D2 — `install.sh` needed its own exec bit.**
Chicken-and-egg the plan missed: `install.sh` chmods `bin/sherman` and
`smoke.sh` but nothing chmods the installer. Fixed with `chmod +x install.sh`,
committed at mode `100755` so a fresh clone runs `./install.sh` directly.

**D3 — The real `~/.sherman/config.json` was not created.**
The plan's verification checklist expected a genuine interactive first run.
Deliberately skipped: answering the provider question means choosing your
engine for you, and that question is the one thing the design says is yours.
Every path was proven in sandbox instead — first run, second run, engine
switch, missing binary, banner fallback, symlink resolution from outside the
repo. Your first `sherman` will run the wizard as designed.

**D4 — `smoke.sh` cleans up after itself (addition, not deviation).**
The sandboxed run creates `vault/memory/private/smoke-tester` in the real
vault, because `vault_path` is repo-relative and the HOME override does not
redirect it. `smoke.sh` now `rmdir`s it on exit — `rmdir` only removes empty
directories, so it can never touch real data.

## Verification evidence

- `bash -n` clean on all three scripts
- `./install.sh` twice → same report, one symlink, no error
- `command -v sherman` → `/Users/moto/.local/bin/sherman`
- `./smoke.sh` → 3 checks, 12 assertions, all PASS, exit 0
- AC-2: piped `1` + `Smoke Tester` → valid JSON, user slugified to `smoke-tester`
- AC-3: missing `codex` → official install command, exit 1, **no config written**
- AC-4: second run silent; config flipped to `codex` → `AGENTS.md` written, `CLAUDE.md` removed
- AC-5: adapter contains persona, both vault tiers, user name, `patient`, no leftover token
- AC-6: both branches — real `banner.ans` and plain-text fallback in a logo-less copy
- Symlink resolution proven by invoking `sherman` from `/tmp`
- `git log` → 1 commit; `git remote -v` → empty

## For UNIFY

No GAP or DRIFT survived. Three tasks reported DONE, all qualified PASS on
first check except Task 3, which needed the `install.sh` exec-bit fix (D2)
before its verify passed.

Open thread for the next loop: the vault has no company knowledge in it, so
Sherman is currently a well-built chassis with an empty brain. Design-doc §7
Q1 is the unblock.
