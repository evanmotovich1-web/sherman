# money-gate — deploying the authorization gate

The per-purchase gate for Sherman's money engine: a Cloudflare Worker that
answers Stripe's real-time `issuing_authorization.request` webhook inside its
two-second window. Policy is the pure function in `decide.js`; the caps it
enforces are imported from `shell/src/money/caps.js`, the single source of
cap truth. Nothing here is deployed by the build — deploy is the operator's
documented step below, run once after Stripe Issuing is live
(`docs/money-setup.md` is the account-side checklist).

## Deploy, in order

1. `wrangler login` (any Cloudflare account; the free tier is enough).
2. Create the KV namespace and record its id:

       wrangler kv namespace create MONEY_KV

3. Put the id it prints into `wrangler.toml` under the `MONEY_KV` binding,
   replacing `REPLACE_WITH_KV_NAMESPACE_ID_AT_DEPLOY`.
4. Set the one secret — the webhook signing secret from step 6 of
   `docs/money-setup.md`:

       wrangler secret put STRIPE_WEBHOOK_SECRET

   Never put the value in `wrangler.toml`, the repo, or the vault.
5. `wrangler deploy` from this directory, and note the workers.dev URL it
   prints.
6. In the Stripe dashboard, add that URL as a webhook endpoint subscribed to
   `issuing_authorization.request`, and write the URL into
   `~/.sherman/money/config.json` as `gate_url`.

## How the flags reach it

The worker holds no Stripe API key and can call nothing; state arrives as KV
writes made from the operator's machine with the same wrangler login:

- **Kill:** `sherman money kill` sets the `KILL` key (via
  `wrangler kv key put`); the gate then declines every authorization until
  `sherman money resume` deletes it.
- **Approvals:** `sherman money approve <id>` pushes `approval:<id>` with the
  amount pinned; the gate passes exactly that amount once, deletes the
  record on use, and nothing above the per-transaction cap moves without one.
- **Declines** are recorded under `decline:*` (seven-day TTL) for
  `sherman money sync` to pick up into the ledger.

## Defense in depth

The same cap numbers are set declaratively on the Issuing card as
`spending_limits` at card-creation time, so if this worker is ever
unreachable, Stripe's timeout fallback applies the card rules — the floor
holds even with the gate down.
