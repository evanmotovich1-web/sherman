# Sherman edits its own code — design

Date: 2026-08-11. Session ran autonomously; decisions below were made from the
repo's own conventions and are Evan's to overturn at review.

## Goal

Sherman, running inside an engine session, can improve or repair its own
source: find the repo, figure out what is wrong or missing on its own, change
the code, verify with `smoke.sh`, and leave a branch + commit for Evan to
review. Today it cannot even locate its source — the workspace context never
says where the repo is, and the workspace itself is disposable generated
output that must never be edited.

## Approaches considered

1. **A `self-edit` skill + a repo pointer in the generated workspace context**
   (chosen). Smallest true change: skills are already how Sherman does company
   work the same way twice, and the launch screen picks a new skill up from a
   readdir. The one missing fact — where the source lives — is injected by
   `bin/sherman` into the workspace body at launch, exactly where the vault
   paths already are.
2. A first-party shell command (`/improve`) that opens a dedicated
   self-modification session. Rejected: more chassis for no more capability;
   the engine already has file and shell tools, it only lacks the knowledge
   and the guardrails.
3. Letting the engine edit the copied skills in the workspace and syncing
   back. Rejected outright: the workspace is disposable by contract, and
   reverse-syncing generated output into the repo inverts the source of truth.

## Design

**New skill `skills/self-edit/SKILL.md`** (category `agent`). Instructions to
Sherman: when a fix or improvement targets Sherman itself, work in the source
repo named in the workspace context, never in `~/.sherman/workspace`. Encodes
the figure-it-out loop — read `AGENTS.md` and `DESIGN.md` first, reproduce or
locate the problem in source, make the smallest change that fixes it, run
`./smoke.sh` from the repo root, commit on a branch with explicit paths, never
push, tell the operator to relaunch to see the change. Carries the hard
boundaries verbatim: preserve a dirty tree, Bash 3.2 compatibility in shell
entry points, no PHI anywhere including examples, and honest failure — if
smoke does not pass, say so and do not commit.

**`bin/sherman` workspace body** gains a "Your own source" section alongside
the vault paths: the absolute repo root (`$ROOT`, known at launch), the rule
that the workspace is generated and disposable, and a pointer to the
`self-edit` skill for how changes are made.

No `agent/capabilities.json` entry: skills are not tools, and the launch
screen counts skills from the directory already.

## Verification

`./smoke.sh` green — check 17 validates the new skill's front matter and
would fail a malformed one. Manual read of the assembled workspace body path
for the new section.

## Build plan

Built by parallel subagents with disjoint file scopes — one on the skill, one
on `bin/sherman` — plus a motivator agent, by explicit request, whose whole
job is encouragement relayed to the workers. Integration (smoke, CHANGES.md,
commit, branch, PR) stays with the coordinating session.
