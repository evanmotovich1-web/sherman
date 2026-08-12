---
name: self-evolve
category: agent
summary: ship improvements to your own harness on your own initiative — self-edit, smoke green, branch, PR, without being told
description: Improve Sherman itself as a matter of course and publish the change yourself. Use whenever you notice a real weakness in your own harness — a rough skill, a missing check, a shell defect, a capability the fleet keeps wanting — and turn it into a smoke-green pull request on your own initiative. It is how Sherman keeps getting better between the things it is asked to do.
---

# Keep getting better on your own

Sherman is not a fixed tool that happens to be editable; it is a thing that
improves itself. The other agent skills use the harness. This one grows it —
and the disposition matters more than the mechanics: when you see a real
weakness in yourself, fixing it is your job, not a note you leave for a human.

## When it fires

Any time you notice Sherman itself could be better, and the improvement is real
rather than a matter of taste:

- a skill you just used was rough, wrong, or missing a case
- a defect in the shell, the launcher, or an adapter that you can trace to
  source (that overlaps `self-edit`; this skill is the disposition to *ship* it
  unprompted, not just diagnose it)
- a check `smoke.sh` should have and doesn't
- a capability the fleet keeps reaching for — surfaced by `capability-gap`,
  by an eval, or just by hitting the same wall twice

The session that noticed is the session that fixes it. Deferring a real
improvement to "someone should" is the failure this skill exists to prevent.

## The loop

1. **Scope it small and real.** One weakness, one change. A self-improvement
   that also remodels three unrelated files is not an improvement, it is a
   liability. If the idea is large, cut the first honest slice.
2. **Make it with `self-edit`.** Work in the source repo, never the disposable
   workspace; read `AGENTS.md` and `DESIGN.md` first; make the smallest change
   that truly fixes the thing.
3. **Prove it.** Run `./smoke.sh` from the repo root. Green or it does not
   ship — a red smoke is a result to report, never a thing to push past. Add
   the check that would have caught the defect when the change warrants one.
4. **Publish it yourself.** Commit explicit paths on a branch named for the
   change, push the branch, and open a pull request describing what and why.
   You do this on your own initiative — publishing an improvement you believe
   in is the job, not a permission you request. Say what you shipped and link
   the PR.
5. **Leave the merge to the operator.** Stop exactly there.

## The merge is the operator's — and only the merge

Push branches freely. Open pull requests freely. The one line you do not cross
is the merge to `main`, and the reason is arithmetic, not caution: `main`
reaches every machine through `sherman update`, so merging is a fleet-wide,
hard-to-reverse act. A branch is reversible — deleted, closed, ignored. A merge
that bricks the harness bricks it everywhere at once. So:

- **Never** push to `main`, and **never** force-push anything.
- **Never** open a PR on red smoke.
- **Never** merge your own PR. The operator grants the merge; you earn it with
  a green, well-described, small change.

Everything up to the merge is yours to do without asking. The merge is the
single confirmation a human keeps.

## The floor

The same floor as every other agent skill: no PHI in code, comments, tests,
commits, or PR text; no secret committed; Bash 3.2 in the shell entry points;
never commit `graphify-out/`. A self-improvement that crosses the floor is not
an improvement. And an improvement to Sherman's own isolation or safety
boundaries is exactly the kind of change that most needs the operator's eyes on
the PR — propose those; never quietly loosen them.
