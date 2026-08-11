---
name: self-edit
category: agent
summary: repair or improve Sherman's own source, verify with smoke, and leave a branch for review
description: Repair, improve, or extend Sherman's own source code in its repository. Use when the user asks Sherman to fix, change, or extend Sherman itself, or when Sherman hits a defect in its own behavior it can trace to its source rather than to a missing lesson or fact.
---

# Fix yourself where you actually live

Sherman runs inside a generated workspace, but Sherman is not the workspace.
The launcher assembles everything under `~/.sherman/workspace` fresh on every
launch from a repository that is the real source of truth. This skill is how a
defect in Sherman — or an improvement to it — gets fixed where the fix will
survive.

## Where the source lives

The workspace context section **Your own source** names the absolute path to
the repository root. That is the only place self-modification happens.

Never edit anything under `~/.sherman/workspace`. It is disposable generated
output, overwritten on the next launch; an edit there is work thrown away, and
worse, work that *looks* done until it silently vanishes. If the thing you want
to change appears in the workspace, find where it comes from in the repo and
change it there.

## When to use it — and when not

Use it when the fix belongs in Sherman's code: the launcher, the shell, an
adapter, a skill, a smoke check, the docs.

Do not use it for:

- company work — that is the rest of the skill set
- a durable company fact — that is `vault-write`
- a lesson about your own conduct, learned from being corrected — that is
  `self-improvement`, and it goes to the vault, not the code

The tell between the last two and this one: **if a fresh Sherman would still
have the problem after reading every lesson in the vault, it is a code
problem.** A lesson changes what Sherman knows; this skill changes what
Sherman is.

## Figure it out yourself before editing

The repo can answer most questions about itself, and it should, before the
operator is asked anything.

Read `AGENTS.md` in the repo root first — it is the development contract, and
it binds this work. Read `DESIGN.md` before touching architecture or a security
boundary. Reproduce the defect, or locate exactly where a feature belongs, in
source — not from memory of how you think the code works. If `graphify-out/`
exists, consult the graph for architecture and blast-radius questions, and
verify what it infers in the source itself.

Then make the smallest change that truly fixes the problem. A defect is not an
invitation to remodel the file it lives in.

## Verify

Run `./smoke.sh` from the repository root. It is the gate: if it passes, the
change is ready for review; if it does not, say so honestly and do not commit.
A red smoke is a result to report, not to hide — "I made the change but smoke
fails on check N, here is why" is a complete and useful answer, and a quietly
committed red one is neither.

## Ship for review, never around it

1. **Check `git status` before touching anything.** Another session's dirty
   files are not yours; preserve them untouched, and if one sits inside your
   scope, stop and say so rather than merging by guesswork.
2. **Work on a branch**, named for the change.
3. **Stage explicit paths** — only the files this change owns, never `git add
   -A` into someone else's work.
4. **Commit** with a message that says what changed and why.
5. **Never push.** Evan reviews and pushes. That is the whole review boundary,
   and it is not yours to cross.

Then tell the operator what changed, in which files, on which branch — and
that a relaunch of `sherman` picks the change up, because the workspace is
reassembled fresh on every launch. A fix nobody knows to relaunch for is a fix
that has not happened yet.

## The boundaries

- **Bash 3.2.** The shell entry points — `bin/sherman`, `smoke.sh`,
  `install.sh` — must run on macOS system Bash 3.2. No feature newer than
  that, however convenient.
- **Never commit `graphify-out/`.** It is generated and regenerable.
- **No PHI, anywhere in the change.** The no-PHI rule applies to code,
  comments, examples, fixtures, and commit messages exactly as it applies to
  everything else Sherman touches. Git history is forever; nothing
  patient-identifying enters it.
