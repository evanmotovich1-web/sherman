---
name: sherman-repo-workflow
category: agent
summary: edit Sherman in the canonical checkout, never a stale clone, never git add -A
description: Use when editing Sherman's source, running smoke, opening a Sherman PR, or when git status, a Downloads copy, a nested shell path, or git add -A might be in play. Use before the first edit in any Sherman session.
---

# Work in the fleet tree, not a copy

Sherman's source is one git checkout. A second clone, a Downloads copy, or a
tree whose origin remote is not this repository is not Sherman. Edits there
do not reach `sherman update`. This skill is how you confirm you are in the
canonical tree before you touch a file.

## Confirm the checkout first

Resolve at runtime. Do not trust the folder name, a prior session, or that a
`sherman/` directory is open.

1. `git remote get-url origin` must be this repository's origin.
2. `git rev-parse --short HEAD` compared with `git rev-parse --short origin/main`
   tells you whether this tree is current.
3. `git status --short` before the first edit. Another session's files are
   not yours.

A clone under Downloads, a nested copy, or any tree behind origin/main is a
stale clone. Stop. Do not edit it. Do not "just commit here and copy later."

Never invent a doubled repo-root path (`shell/shell/` and the same shape
elsewhere). The shell lives at `shell/` in the repository root.

## What you may edit

The persona lives in `agent/SYSTEM.md`. Adapters are thin wrappers. Skills
live under `skills/`. The generated workspace the launcher assembles is
disposable — change the repo and relaunch. That is `self-edit`.

In parallel work do not co-edit `bin/sherman`, `smoke.sh`, `.gitignore`, or
`AGENTS.md`. Read `AGENTS.md`; do not edit it.

## Contribution flow

1. Branch off current `main`, named for the change. Never commit on `main`.
2. Edit. Shell entry points must stay Bash 3.2 compatible.
3. `./smoke.sh` from the repository root. Red smoke is a result to report,
   not a commit.
4. Stage **explicit named paths only**. Never `git add -A`. That sweep is how
   a workflow skill commits someone else's files and diverges the fleet tree.
5. Push the **branch**. Open a pull request against `main`. Never push to
   `main`. Never force-push.

A persona edit must keep the smoke-grepped phrases in `SYSTEM.md` (`0-1`,
the key hand-over lines, silent skills, mnemosyne). The persona must not
contain the operator's literal first name.

## Hard rules

- No PHI in code, comments, fixtures, commit messages, or history.
- Never commit `graphify-out/`.
- `sherman update` fast-forwards; a dirty diverged tree is a hard-stop, not
  an invitation to reset over uncommitted work. Report it.
- After a merge, a running session still has the old code until relaunch.

## Done means

The change is on a branch of the canonical checkout, smoke was run from that
tree, only named paths were staged, and `main` was not committed or pushed.
