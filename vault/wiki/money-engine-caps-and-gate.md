# Money engine: caps, gate, and controls

Sherman spends through a Stripe **Issuing virtual card** it creates — never
anyone's personal card. Hard caps, enforced by a real-time authorization gate
(a Cloudflare Worker answering `issuing_authorization.request` inside Stripe's
two-second window):

- $50 per transaction · $150 per day · $75 per training run
- $500 starting float · $1,000 ceiling (profits above it sweep to the
  operator's payout destination on Stripe's own schedule)

Standing controls: `sherman money` (balance, ledger, pending approvals),
`sherman money setup` (live six-step readiness checklist), `sherman money
approve <id>` (execute one teed-up spend exactly as prepared), `sherman money
kill` / `resume` (freeze and reactivate all outflow). The ledger is
append-only; no money code path touches a payout destination; no screen ever
prints key material.

Every cap number lives in exactly one file — changing one is a PR the
operator merges, by construction.

Source: `shell/src/money/caps.js` (single source of cap truth),
`gate/money-gate/README.md` (gate deploy), `docs/money-setup.md` (the
operator's one-time checklist).
