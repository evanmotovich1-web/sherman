// The compounding rule (spec §4.6), run by `sherman money sync`.
//
// Collected revenue settles in the Stripe merchant balance. While the float
// sits under its ceiling, profit moves INTO the float by an internal Stripe
// top-up — merchant balance to Issuing financial account, money never
// leaving Stripe, on a key scoped to allow exactly this move and nothing
// outbound. At or above the ceiling, the excess stays in the merchant
// balance where Stripe's automatic payout schedule — configured once by the
// operator, untouchable by any key Sherman holds — sweeps it out. Sherman
// only OBSERVES that sweep (balance transactions) and appends
// `sweep_observed` lines.
//
// The pot at risk is bounded at 2x by arithmetic: the agent can only grow
// the float by internal transfer, this rule stops feeding it at the ceiling,
// and nothing above the ceiling is reachable by any credential Sherman
// holds.

import { CAPS } from './caps.js';

/**
 * The pure rule: given the float level, any pending top-ups, and the
 * merchant profit available, say what happens next. No I/O.
 *
 * @param {{float_cents: number, pending_topup_cents?: number, merchant_available_cents: number}} balances
 * @returns {{action: 'topup'|'observe-sweep'|'none', topup_cents: number, reason: string}}
 */
export function planReinvest({ float_cents, pending_topup_cents = 0, merchant_available_cents }) {
    const committed = float_cents + pending_topup_cents;
    const headroom = CAPS.FLOAT_CEILING_CENTS - committed;

    if (headroom <= 0) {
        return {
            action: 'observe-sweep',
            topup_cents: 0,
            reason: 'float at ceiling — excess stays in the merchant balance for Stripe to sweep on its schedule',
        };
    }
    const topup = Math.min(merchant_available_cents, headroom);
    if (topup <= 0) {
        return { action: 'none', topup_cents: 0, reason: 'no merchant profit to reinvest yet' };
    }
    return {
        action: 'topup',
        topup_cents: topup,
        reason: `compounding: internal top-up of ${topup} cents toward the float ceiling`,
    };
}

/**
 * Execute one planned top-up through the stubbed Stripe client.
 *
 * FALLBACK, explicit by design: Stripe restricted-key grids vary, and the
 * internal top-up permission may turn out not to be grantable to the issuing
 * key exactly as the spec's grid describes. If the live call comes back
 * refused (degraded: false — Stripe said no, not "not configured"), the move
 * is NOT retried and NOT worked around: it is teed up as a one-click
 * approval — the operator performs the same internal merchant→float move in
 * the Stripe dashboard — via the `teeUp` callback, and the tee-up lands in
 * the ledger as `approval_teed`. Never silently attempted, never silently
 * dropped: those are the only two outcomes the fence allows.
 *
 * @param {{action: string, topup_cents: number, reason: string}} plan  from planReinvest()
 * @param {{client: object, append: Function, teeUp: Function}} deps
 * @returns {Promise<{ok: boolean, degraded?: boolean, message: string}>}
 */
export async function runReinvest(plan, { client, append, teeUp }) {
    if (plan.action !== 'topup') {
        return { ok: true, message: plan.reason };
    }

    const result = await client.createInternalTopup(plan.topup_cents);
    if (result.ok) {
        append({
            type: 'topup',
            amount_cents: plan.topup_cents,
            currency: 'usd',
            counterparty: 'stripe-internal',
            rail: 'stripe-topup',
            stripe_id: result.data?.id ?? '',
            result: 'approved',
            note: 'reinvest: merchant balance to float (internal, inside Stripe)',
        });
        return { ok: true, message: `topped the float up by ${plan.topup_cents} cents (internal transfer)` };
    }

    if (result.degraded) {
        // Not set up (no key, no config, or fetches disabled): name it and do
        // nothing — setup is the repair, not an approval.
        return result;
    }

    // The internal-topup-permission fallback: Stripe refused the scoped call,
    // so the identical move becomes the operator's one click.
    const teed = teeUp({
        amount_cents: plan.topup_cents,
        merchant: 'stripe-internal',
        play: 'reinvest',
        reason: 'internal top-up refused on the issuing key — operator performs the merchant→float move in the Stripe dashboard',
        prepared_call: { kind: 'dashboard-topup', amount_cents: plan.topup_cents },
    });
    append({
        type: 'approval_teed',
        amount_cents: plan.topup_cents,
        currency: 'usd',
        counterparty: 'stripe-internal',
        play: 'reinvest',
        rail: 'stripe-topup',
        stripe_id: '',
        result: 'pending',
        note: `reinvest top-up teed up for one-click approval (${teed?.id ?? 'unfiled'}): ${result.message}`,
    });
    return {
        ok: false,
        degraded: false,
        message: `internal top-up refused — teed up for the operator instead (${result.message})`,
    };
}
