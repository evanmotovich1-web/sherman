# How changes reach every Sherman machine

Delivery is the merge to `main`: `sherman update` on each machine pulls
`main`, so a merge is a fleet-wide act and a human (the operator) confirms
it. Agents publish work as a smoke-green branch plus a pull request — on
their own initiative, without being asked — and never push to `main`, never
force-push, never open a PR on red smoke.

`./smoke.sh` from the repository root is the gate before every commit; after
merging several PRs in sequence, run it once more on the merged `main`,
because branches merged the same day were not necessarily tested together.

Source: `AGENTS.md` (development workflow), `bin/sherman` (`sherman update`).
