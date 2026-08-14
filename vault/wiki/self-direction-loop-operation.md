# Operating the self-direction loop

`sherman loop [n]` (default 3 iterations, max 10) makes Sherman pick and
execute its own next task from the direction layer at `vault/direction/`:
`goals.md` (ranked standing goals), `thread-<slug>.md` files (open work
threads), `log.md` (shell-owned audit trail — every pick is logged BEFORE it
executes).

Steering it:

- Edit `goals.md` anytime; lines containing `[operator]` cannot be rewritten
  by agents — a proposed rewrite that drops one is rejected whole.
- `sherman loop stop` halts a running loop at its next seam.
- Two consecutive failed iterations halt the loop; a 20-minute wall-clock cap
  interrupts a wedged turn.
- The loop adds zero privilege: same sandbox, same vault validation, same
  gates as an interactive session. It can branch and open PRs; it cannot
  merge to main, spend outside the money engine, or send externally.

Practical: keep picks small enough to finish inside the cap — the first live
run (2026-08-13) chose an implement-and-PR task too big for 20 minutes and
was cleanly interrupted. Threads exist so big work spans iterations.

Source: `docs/superpowers/specs/2026-08-13-self-direction-loop-design.md`,
`shell/src/loop/`, smoke check 40.
