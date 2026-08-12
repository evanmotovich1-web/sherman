# Money engine setup — the operator's one-time checklist

Six steps, in order. Nothing here is optional and nothing else is required.
Sherman preps whatever a step allows (drafted settings, the exact permission
grids on screen); the operator clicks. The operator's primary bank
credentials touch Stripe's own UI only — never Sherman, never this repo,
never any prompt or log.

1. **Create the Stripe account** (or use an existing one), activated for
   live mode, KYC'd in the operator's name.

2. **Enable Stripe Issuing** (apply in the dashboard). *Fallback clock:* if
   Issuing approval has not landed within 14 days, the spend side is wired
   to the Lithic adapter instead (same caps, same gate shape via Lithic's
   authorization webhook); collect stays on Stripe either way.

3. **Create the Issuing financial account and fund it with $500** — a
   one-time push from the operator's bank, done in the Stripe dashboard.
   This is the whole float and the hard maximum loss. *(Operator act one of
   two.)*

4. **Configure the payout destination and automatic payout schedule** in the
   Stripe dashboard. This is where profits above the float ceiling sweep on
   Stripe's own schedule; no key Sherman holds can see or change it.
   *(Operator act two of two.)*

5. **Create the two restricted keys** with the exact permission grids below,
   then hand them over once — the values go into the local key store
   (`~/.sherman/keys.json`, chmod 600, outside the repo and vault, redacted
   from every transcript and log), never anywhere else:

       /key STRIPE_RESTRICTED_KEY <the collect-side restricted key>
       /key STRIPE_ISSUING_KEY <the spend-side restricted key>

   | key | permissions set at creation |
   |-----|------------------------------|
   | `STRIPE_RESTRICTED_KEY` | **Write:** Payment Links, Checkout Sessions, PaymentIntents, Charges, Products, Prices, Invoices, Customers. **Read:** Balance, Balance transactions, Events, Disputes. **None:** everything else — explicitly Payouts = None, and every external-destination resource = None. |
   | `STRIPE_ISSUING_KEY` | **Write:** Issuing cards, Issuing authorizations, top-ups *to the financial account only* (the internal merchant-to-float move). **Read:** Issuing transactions, financial-account balance, Events. **None:** Payouts, external destinations, account settings. |

6. **Deploy the gate and connect the webhook.** Follow
   `gate/money-gate/README.md` (wrangler login, KV namespace, deploy), add
   the printed URL as a webhook endpoint for `issuing_authorization.request`
   in the Stripe dashboard, then hand over the signing secret:

       /key STRIPE_WEBHOOK_SECRET <the signing secret>

Done. From here the standing interface is: one-click approvals when a spend
is teed up (`sherman money approve <id>`), `sherman money` and
`sherman board` whenever the operator wants to look, and
`sherman money kill` if everything should stop right now.
