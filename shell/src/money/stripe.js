// The one module boundary between the money engine and Stripe.
//
// Everything that would touch the network lives behind stripeClient(), and
// every method degrades to a NAMED refusal — `{ok: false, degraded: true,
// message}` — when the machine is not set up for it: no config file yet, a
// key not stored, or network fetches disabled (SHERMAN_NO_FETCH, the smoke
// suite's standing rule). Callers render the message; they never guess.
//
// Key handling, restated because money raises the stakes: key VALUES are
// never printed, logged, or interpolated into any message. Presence checks
// are boolean. The value is read exactly once, into the Authorization header
// of a request. The two keys this module accepts are restricted keys whose
// permission grids (docs/money-setup.md) exclude every payout-destination
// surface, so the calls below are the whole reachable Stripe surface.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { moneyDir } from './ledger.js';

export const KEY_NAMES = Object.freeze({
    collect: 'STRIPE_RESTRICTED_KEY',
    issuing: 'STRIPE_ISSUING_KEY',
    webhook: 'STRIPE_WEBHOOK_SECRET',
});

/**
 * Non-secret account identifiers — Issuing card id, financial account id,
 * gate URL — written once by the operator setup step. Not secrets, but
 * operator-specific, so they live under ~/.sherman/money and never in the
 * repo.
 *
 * @returns {{ok: true, config: object} | {ok: false, degraded: true, message: string}}
 */
export function loadMoneyConfig(dir = moneyDir()) {
    const path = join(dir, 'config.json');
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return {
                ok: false,
                degraded: true,
                message: 'no money config yet — the one-time setup in docs/money-setup.md writes ~/.sherman/money/config.json',
            };
        }
        return { ok: false, degraded: true, message: 'money config unreadable — fix or remove ~/.sherman/money/config.json' };
    }
    if (!parsed || typeof parsed !== 'object') {
        return { ok: false, degraded: true, message: 'money config malformed — fix or remove ~/.sherman/money/config.json' };
    }
    return { ok: true, config: parsed };
}

function missingKey(name) {
    return {
        ok: false,
        degraded: true,
        message: `${name} is not stored — hand it over once with /key ${name} <value> (docs/money-setup.md, step 5)`,
    };
}

function fetchesDisabled() {
    return {
        ok: false,
        degraded: true,
        message: 'network fetches are disabled (SHERMAN_NO_FETCH) — no Stripe call was made',
    };
}

/**
 * The Stripe client. Every method returns `{ok: true, data}` or the degraded
 * shape above; a live API error comes back as `{ok: false, degraded: false,
 * message}` so callers can tell "not set up" from "Stripe said no".
 */
export function stripeClient({ env = process.env, dir = moneyDir(), fetchImpl = globalThis.fetch } = {}) {
    async function request(keyName, method, path, params = null) {
        if (!env[keyName]) return missingKey(keyName);
        if (env.SHERMAN_NO_FETCH) return fetchesDisabled();

        // The single place a key value is read, straight into the header.
        const headers = { Authorization: `Bearer ${env[keyName]}` };
        let body;
        if (params) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            body = new URLSearchParams(params).toString();
        }
        let response;
        try {
            response = await fetchImpl(`https://api.stripe.com${path}`, { method, headers, body });
        } catch (error) {
            return { ok: false, degraded: false, message: `Stripe unreachable: ${error?.message ?? error}` };
        }
        let data;
        try {
            data = await response.json();
        } catch {
            data = null;
        }
        if (!response.ok) {
            const detail = data?.error?.message ?? `HTTP ${response.status}`;
            return { ok: false, degraded: false, message: `Stripe refused the call: ${detail}` };
        }
        return { ok: true, data };
    }

    return {
        /** Merchant balance — the collect side settles here. */
        getMerchantBalance() {
            return request(KEY_NAMES.collect, 'GET', '/v1/balance');
        },

        /** Balance transactions — how the sweep is OBSERVED, never driven. */
        listBalanceTransactions(limit = 25) {
            return request(KEY_NAMES.collect, 'GET', `/v1/balance_transactions?limit=${Number(limit)}`);
        },

        /** Issuing transactions — the spend side the sync reconciles against. */
        listIssuingTransactions(limit = 25) {
            return request(KEY_NAMES.issuing, 'GET', `/v1/issuing/transactions?limit=${Number(limit)}`);
        },

        /** Card status — `inactive` is kill step 1, `active` is resume. */
        async setCardStatus(status) {
            const loaded = loadMoneyConfig(dir);
            if (!loaded.ok) return loaded;
            if (!loaded.config.card_id) {
                return { ok: false, degraded: true, message: 'no card_id in ~/.sherman/money/config.json — setup step, docs/money-setup.md' };
            }
            return request(KEY_NAMES.issuing, 'POST', `/v1/issuing/cards/${loaded.config.card_id}`, { status });
        },

        /**
         * The internal merchant→float move (§4.6 of the spec): a top-up of
         * the Issuing financial account from the merchant balance, inside
         * Stripe, with a key scoped to allow exactly this and nothing
         * outbound. Money never leaves Stripe on any call in this file.
         */
        createInternalTopup(amountCents, description = 'sherman reinvest: merchant to float') {
            return request(KEY_NAMES.issuing, 'POST', '/v1/topups', {
                amount: String(amountCents),
                currency: 'usd',
                description,
            });
        },
    };
}

/**
 * What `sherman money sync` runs: pull Stripe's record and append anything
 * the local ledger lacks, so the ledger converges on Stripe even for gate
 * decisions made while the laptop slept.
 *
 * The pull half is a stub behind this clean boundary until deploy day: with
 * no config or keys it names exactly what is missing, and with them it pulls
 * balances and issuing transactions but leaves the reconcile diff to the
 * deploy-day iteration that can see real ids to key on. It never invents a
 * ledger line.
 *
 * @returns {{ok: boolean, degraded?: boolean, message: string, appended: number}}
 */
export async function syncWithStripe({ env = process.env, dir = moneyDir() } = {}) {
    const loaded = loadMoneyConfig(dir);
    if (!loaded.ok) return { ...loaded, appended: 0 };

    const client = stripeClient({ env, dir });
    const balance = await client.getMerchantBalance();
    if (!balance.ok) return { ...balance, appended: 0 };

    const issuing = await client.listIssuingTransactions();
    if (!issuing.ok) return { ...issuing, appended: 0 };

    // Deploy-day boundary: matching Stripe records to ledger lines needs the
    // real id space (ipi_/txn_ prefixes on a live account). The shapes above
    // are already pulled; the diff-and-append lands with the first configured
    // account, and until then sync says so instead of pretending.
    return {
        ok: true,
        message: 'pulled Stripe balances and issuing transactions; nothing to reconcile on this machine yet',
        appended: 0,
    };
}
