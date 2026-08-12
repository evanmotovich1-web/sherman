// The gate's decision logic — a pure function, no I/O, unit-testable against
// fixture authorization objects (smoke check 35 does exactly that).
//
// The worker shell (worker.js) verifies the Stripe signature, resolves state
// out of KV, calls decide(), and writes the counters back. Policy lives HERE;
// transport lives there. The caps come from the single source of cap truth —
// this file contains no cap literal of its own, and smoke fails the build if
// one ever appears.

import { CAPS } from '../../shell/src/money/caps.js';

/**
 * Decide one Issuing authorization, in the spec's order (§4.5):
 *
 *   1. signature      — the worker's job, before this function is reached
 *   2. KILL flag      — decline everything
 *   3. per-txn cap    — above it, only a valid one-time approval passes,
 *                       and only for EXACTLY the prepared amount
 *   4. per-day cap    — day counter plus this amount over the cap declines
 *   5. training cap   — the single-use training card has its own, lower cap
 *   6. otherwise approve
 *
 * @param {{amount_cents: number, card_kind?: 'float'|'training', approval_id?: string|null}} authorization
 * @param {{kill?: boolean, day_spent_cents?: number, approval?: {id: string, amount_cents: number}|null}} state
 * @returns {{approved: boolean, reason: string, day_spent_after_cents: number}}
 */
export function decide(authorization, state = {}) {
    const amount = authorization?.amount_cents;
    const daySpent = state.day_spent_cents ?? 0;
    const declined = (reason) => ({ approved: false, reason, day_spent_after_cents: daySpent });

    if (!Number.isInteger(amount) || amount <= 0) return declined('malformed amount');

    if (state.kill) return declined('kill switch is set');

    if (amount > CAPS.PER_TXN_CENTS) {
        const approval = state.approval ?? null;
        const valid = approval
            && authorization.approval_id
            && authorization.approval_id === approval.id
            && amount === approval.amount_cents;
        if (!valid) return declined('over the per-transaction cap with no valid approval');
    }

    if (daySpent + amount > CAPS.PER_DAY_CENTS) return declined('over the per-day cap');

    if (authorization.card_kind === 'training' && amount > CAPS.PER_TRAINING_RUN_CENTS) {
        return declined('over the per-training-run cap');
    }

    return { approved: true, reason: 'inside the caps', day_spent_after_cents: daySpent + amount };
}
