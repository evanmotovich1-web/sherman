---
name: money-engine
category: finance
summary: run the earning loop — research plays, build, execute inside the capped float, collect, report, reinvest
description: Operate Sherman's self-sustaining income loop end to end — research and rank income plays, build the reversible parts, execute spends inside the capped Stripe float, collect revenue autonomously, keep the append-only ledger, report, and reinvest to compound. Use whenever the operator says to earn, run the money engine, work the campaigns, or check the plays; every dollar moves inside the pre-funded float and its caps, never a primary account.
---

# Run the money engine

Sherman earns real money for the operator inside a fenced float. The fence is
the product: $500 pre-funded on Stripe, hard caps in code on every spend, an
append-only ledger, and a kill switch. Inside the fence you run the whole
loop yourself; at the fence you tee up the step and hand the operator one
click.

## The loop

Every campaign cycles through the same seven steps. Steps never skip; a step
that cannot complete blocks with its blocker named on the board.

1. **Research** — rank plays and niches with the research stack
   (`deep-research`, `fact-checking`, `product-demand-research`,
   `trend-discovery`, the ScrapeCreators suite). A play must clear the same
   bar ticket 002 used: legal, ToS-tolerant of agents, capital inside the
   float, honest time-to-first-dollar. Grey-area plays score out, always.
2. **Propose** — new plays or material pricing/niche changes land as cards on
   the team board with expected cost, expected revenue, and a success signal.
   The two locked launch plays (§2) are pre-approved; anything beyond them is
   a proposal until the loop's own evidence promotes it.
3. **Build the reversible parts** — deliverable templates, bundle packaging,
   outreach drafts, payment links. Reversible means: costs $0 or only capped
   float dollars, publishes nothing outward, and can be deleted without
   trace. Build everything the fence does not block before asking anything.
4. **Execute, capped and gated** — spends go through the Issuing card and the
   authorization gate: ≤ $50/txn, ≤ $150/day, ≤ $75/training-run, declined in
   code otherwise. A spend above a cap is teed up as a one-click approval
   (§4.4), never attempted around the gate. Outward submissions on platforms
   that require a human are prepared, not sent — the operator clicks.
5. **Collect** — revenue arrives through Stripe payment links and invoices
   created with the restricted collect key, and through marketplace sales.
   Collecting is fully autonomous. Every dollar in, on every rail, is
   recorded in the ledger — full-income capture, regardless of any 1099-K
   threshold.
6. **Report** — every transaction appends to the ledger as it happens;
   `sherman money` shows balance and recent moves live; a weekly plain-terms
   report covers revenue, spend, float level, per-play P&L, and what gets
   reinvested next.
7. **Reinvest** — profits top the float back up and compound it to $1,000;
   beyond that the excess stays in the merchant balance and auto-sweeps to
   the operator's payout account. Training runs are reinvestment (§2.3):
   staged until revenue exists, ≤ $75/run, prepaid, kill-timed, never the
   trading corpus.

## The fence is not yours to move

Caps, the ledger, the kill switch, and the payout destination live in code
and on Stripe's side. You work inside them; you never edit
`shell/src/money/caps.js`, the gate, or ledger history to make a spend fit.
A spend the fence blocks is either teed up for approval or dropped with a
note — those are the only two outcomes. Primary bank credentials never enter
any prompt, file, or log. No PHI, ever. Key values are named, never printed
(`$STRIPE_RESTRICTED_KEY` is how you refer to one).

## Working the campaigns

Run the engine as a team (see the `team` skill): the board at
`boards/team-money-engine.md` is the campaign's state, and the roles in the
money-engine spec (researcher, builder, outreach-drafter, ledger-keeper) are
the seats. Prefer marking a card `verify` for another session over grading
your own work. Durable lessons about what earns go through
`self-improvement`; improvements to the engine itself go through
`self-evolve` as branch + PR.
