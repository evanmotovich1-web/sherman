// The money engine: gate decisions are pure and cap-true, the ledger is
// append-only in behavior (not just intent), the reinvest rule stops at the
// ceiling, approvals expire into decline lines, and no screen ever carries
// key material.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CAPS } from '../src/money/caps.js';
import { appendLedger, ledgerPath, readLedger } from '../src/money/ledger.js';
import { planReinvest, runReinvest } from '../src/money/reinvest.js';
import { loadMoneyConfig, stripeClient } from '../src/money/stripe.js';
import { moneyCommand, teeUpApproval, expireApprovals, pendingApprovals } from '../src/money/cli.js';
import { decide } from '../../gate/money-gate/decide.js';

function tempDir() {
    return mkdtempSync(join(tmpdir(), 'sherman-money-'));
}

// --------------------------------------------------------------------- gate --

test('the gate approves inside the caps and declines outside them', () => {
    const cents = (dollarsAndCents) => Math.round(dollarsAndCents * 100);

    assert.equal(decide({ amount_cents: cents(49.99) }, { day_spent_cents: 0 }).approved, true);
    assert.equal(decide({ amount_cents: cents(50.01) }, { day_spent_cents: 0 }).approved, false);

    // Three approved $50 spends fill the day cap; the fourth declines.
    let daySpent = 0;
    for (let i = 0; i < 3; i += 1) {
        const decision = decide({ amount_cents: CAPS.PER_TXN_CENTS }, { day_spent_cents: daySpent });
        assert.equal(decision.approved, true, `spend ${i + 1} of the day should approve`);
        daySpent = decision.day_spent_after_cents;
    }
    assert.equal(decide({ amount_cents: CAPS.PER_TXN_CENTS }, { day_spent_cents: daySpent }).approved, false);

    // The kill flag declines everything, including a trivial amount.
    assert.equal(decide({ amount_cents: 1 }, { kill: true }).approved, false);
});

test('an approval passes exactly the pinned amount, once past the per-txn cap', () => {
    const over = CAPS.PER_TXN_CENTS + 100;
    const approval = { id: 'ap-1', amount_cents: over };

    assert.equal(decide({ amount_cents: over, approval_id: 'ap-1' }, { approval }).approved, true);
    // A different amount than the one pinned is not the prepared spend.
    assert.equal(decide({ amount_cents: over + 1, approval_id: 'ap-1' }, { approval }).approved, false);
    // A wrong or missing id never passes.
    assert.equal(decide({ amount_cents: over, approval_id: 'ap-2' }, { approval }).approved, false);
    assert.equal(decide({ amount_cents: over }, { approval }).approved, false);
});

test('the training card has its own cap, binding even past a valid approval', () => {
    // The training cap sits above the per-txn cap, so the case that isolates
    // it is an approved spend: the approval passes step 3 for both cards,
    // and only the training card then declines at its own fence.
    const amount = CAPS.PER_TRAINING_RUN_CENTS + 1;
    const approval = { id: 'ap-t', amount_cents: amount };
    const state = { approval, day_spent_cents: 0 };
    assert.equal(decide({ amount_cents: amount, card_kind: 'training', approval_id: 'ap-t' }, state).approved, false);
    assert.equal(decide({ amount_cents: amount, card_kind: 'float', approval_id: 'ap-t' }, state).approved, true);

    // Inside its cap, a training-card spend under the per-txn cap approves
    // like any other.
    assert.equal(decide({ amount_cents: CAPS.PER_TXN_CENTS - 1, card_kind: 'training' }, {}).approved, true);
});

// ------------------------------------------------------------------- ledger --

test('the ledger appends, never rewrites, and validates its schema', () => {
    const dir = tempDir();
    try {
        const first = appendLedger({ type: 'collect', amount_cents: 50000 - 1, currency: 'usd', result: 'approved' }, dir);
        assert.equal(first.ok, true);

        const before = readFileSync(ledgerPath(dir), 'utf8');
        const second = appendLedger({ type: 'spend', amount_cents: 1200, currency: 'usd', result: 'approved' }, dir);
        assert.equal(second.ok, true);
        const after = readFileSync(ledgerPath(dir), 'utf8');

        // Line one is byte-identical after the second append, and exactly one
        // line was added.
        assert.equal(after.startsWith(before), true, 'an append changed earlier bytes');
        assert.equal(after.split('\n').length, before.split('\n').length + 1);

        // Schema: unknown types and non-integer amounts are refused with a
        // reason, not written.
        assert.equal(appendLedger({ type: 'withdrawal' }, dir).ok, false);
        assert.equal(appendLedger({ type: 'spend', amount_cents: 12.5 }, dir).ok, false);
        assert.equal(appendLedger({ type: 'spend', result: 'maybe' }, dir).ok, false);
        assert.equal(readLedger(0, dir).total, 2, 'a refused entry must not append');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

// ----------------------------------------------------------------- reinvest --

test('reinvest compounds to the ceiling and not a cent past it', () => {
    // Under the ceiling: profit moves in, capped by headroom.
    const headroom = CAPS.FLOAT_CEILING_CENTS - CAPS.FLOAT_START_CENTS;
    const modest = planReinvest({ float_cents: CAPS.FLOAT_START_CENTS, merchant_available_cents: 2000 });
    assert.deepEqual([modest.action, modest.topup_cents], ['topup', 2000]);

    const flood = planReinvest({ float_cents: CAPS.FLOAT_START_CENTS, merchant_available_cents: headroom + 99999 });
    assert.deepEqual([flood.action, flood.topup_cents], ['topup', headroom]);

    // Pending top-ups count as committed float.
    const pending = planReinvest({
        float_cents: CAPS.FLOAT_START_CENTS, pending_topup_cents: headroom, merchant_available_cents: 100,
    });
    assert.equal(pending.action, 'observe-sweep');

    // At the ceiling: observe the sweep, feed nothing.
    const atCeiling = planReinvest({ float_cents: CAPS.FLOAT_CEILING_CENTS, merchant_available_cents: 12345 });
    assert.deepEqual([atCeiling.action, atCeiling.topup_cents], ['observe-sweep', 0]);

    // Nothing to reinvest is not an error.
    assert.equal(planReinvest({ float_cents: CAPS.FLOAT_START_CENTS, merchant_available_cents: 0 }).action, 'none');
});

test('a refused internal top-up tees up the operator move instead of retrying', async () => {
    const appended = [];
    const teed = [];
    const refusingClient = {
        createInternalTopup: async () => ({ ok: false, degraded: false, message: 'permission denied for topups' }),
    };
    const result = await runReinvest(
        { action: 'topup', topup_cents: 2500, reason: 'test' },
        { client: refusingClient, append: (entry) => { appended.push(entry); return { ok: true }; }, teeUp: (fields) => { teed.push(fields); return { ok: true, id: 'ap-test' }; } },
    );
    assert.equal(result.ok, false);
    assert.match(result.message, /teed up for the operator/);
    assert.equal(teed.length, 1);
    assert.equal(teed[0].amount_cents, 2500);
    assert.equal(appended.length, 1);
    assert.equal(appended[0].type, 'approval_teed');

    // Degraded (not set up) means named message, no tee-up, no ledger noise.
    const unconfigured = {
        createInternalTopup: async () => ({ ok: false, degraded: true, message: 'STRIPE_ISSUING_KEY is not stored' }),
    };
    const silent = await runReinvest(
        { action: 'topup', topup_cents: 2500, reason: 'test' },
        { client: unconfigured, append: () => assert.fail('no ledger line when merely unconfigured'), teeUp: () => assert.fail('no tee-up when merely unconfigured') },
    );
    assert.equal(silent.degraded, true);
});

// ---------------------------------------------------------------- approvals --

test('approvals expire after seven days into a decline line', () => {
    const dir = tempDir();
    try {
        const fresh = teeUpApproval({ amount_cents: 9900, merchant: 'example.com', play: 'test' }, dir);
        assert.equal(fresh.ok, true);
        const stale = teeUpApproval({ amount_cents: 8800, merchant: 'old.example.com', play: 'test' }, dir);
        assert.equal(stale.ok, true);

        // Age the stale one past the window by rewriting its created stamp —
        // allowed here because an approval file is queue state, not the ledger.
        const stalePath = join(dir, 'approvals', `${stale.id}.json`);
        const record = JSON.parse(readFileSync(stalePath, 'utf8'));
        record.created = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
        writeFileSync(stalePath, JSON.stringify(record));

        const expired = expireApprovals(dir);
        assert.deepEqual(expired, [stale.id]);

        const remaining = pendingApprovals(dir);
        assert.deepEqual(remaining.map((r) => r.id), [fresh.id]);

        const ledger = readLedger(0, dir);
        assert.equal(ledger.entries.length, 1);
        assert.equal(ledger.entries[0].type, 'decline');
        assert.match(ledger.entries[0].note, /approval expired/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

// ------------------------------------------------------- screens and hygiene --

test('the money screens degrade with named messages and never leak key material', async () => {
    const dir = tempDir();
    try {
        // A fixture ledger and dummy keys in the environment: the worst case
        // for a leak is everything present and the screen still silent on it.
        mkdirSync(dir, { recursive: true });
        appendLedger({ type: 'collect', amount_cents: 4200, currency: 'usd', counterparty: 'client', result: 'approved', balance_after_cents: 4200 }, dir);
        process.env.STRIPE_RESTRICTED_KEY = 'rk_live_dummy_for_test_only';
        process.env.STRIPE_ISSUING_KEY = 'rk_live_dummy_issuing_only';
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy_for_test_only';

        const screen = await moneyCommand('', dir);
        assert.equal(screen.ok, true);
        assert.match(screen.text, /no money config yet/, 'sync must name the missing setup');
        assert.match(screen.text, /float/, 'the screen shows the float line');
        for (const marker of ['rk_live', 'sk_live', 'whsec_', 'dummy_for_test_only']) {
            assert.equal(screen.text.includes(marker), false, `screen leaked ${marker}`);
        }

        const ledgerView = await moneyCommand('ledger 5', dir);
        assert.equal(ledgerView.ok, true);
        assert.match(ledgerView.text, /collect/);
        assert.equal(ledgerView.text.includes('rk_live'), false);

        // The mutating verbs stay in the terminal.
        const killTry = await moneyCommand('kill', dir);
        assert.equal(killTry.ok, false);
        assert.match(killTry.text, /sherman money kill/);
    } finally {
        delete process.env.STRIPE_RESTRICTED_KEY;
        delete process.env.STRIPE_ISSUING_KEY;
        delete process.env.STRIPE_WEBHOOK_SECRET;
        rmSync(dir, { recursive: true, force: true });
    }
});

test('the setup checklist tracks local progress and never prints a key value', async () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    try {
        // Fresh machine: no keys, no config. Every local checkpoint is pending
        // and the next action is the very first handover.
        const before = await moneyCommand('setup', dir);
        assert.equal(before.ok, true);
        assert.match(before.text, /0 of 5 local checkpoints done/);
        assert.match(before.text, /\[ \] collect key stored/);
        assert.match(before.text, /next: hand over the collect key/);
        // The three account-side steps are named, not faked as verified.
        assert.match(before.text, /confirm at Stripe/);
        assert.match(before.text, /Issuing enabled/);

        // Keys handed over and the config artifacts written: every local
        // checkpoint flips, and the screen still carries no key material.
        process.env.STRIPE_RESTRICTED_KEY = 'rk_live_dummy_for_test_only';
        process.env.STRIPE_ISSUING_KEY = 'rk_live_dummy_issuing_only';
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy_for_test_only';
        writeFileSync(
            join(dir, 'config.json'),
            JSON.stringify({ card_id: 'ic_dummy_card_id', gate_url: 'https://gate.example.workers.dev' })
        );

        const after = await moneyCommand('setup', dir);
        assert.equal(after.ok, true);
        assert.match(after.text, /all local checkpoints done/);
        assert.match(after.text, /\[x\] collect key stored/);
        assert.match(after.text, /\[x\] gate url recorded/);
        for (const marker of ['rk_live', 'whsec_', 'dummy_for_test_only', 'ic_dummy_card_id', 'gate.example']) {
            assert.equal(after.text.includes(marker), false, `setup screen leaked ${marker}`);
        }
    } finally {
        delete process.env.STRIPE_RESTRICTED_KEY;
        delete process.env.STRIPE_ISSUING_KEY;
        delete process.env.STRIPE_WEBHOOK_SECRET;
        rmSync(dir, { recursive: true, force: true });
    }
});

test('the stripe client refuses to fetch when network is disabled or keys are absent', async () => {
    const dir = tempDir();
    try {
        const bare = stripeClient({ env: {}, dir });
        const noKey = await bare.getMerchantBalance();
        assert.equal(noKey.degraded, true);
        assert.match(noKey.message, /STRIPE_RESTRICTED_KEY is not stored/);

        const offline = stripeClient({
            env: { STRIPE_RESTRICTED_KEY: 'x', SHERMAN_NO_FETCH: '1' },
            dir,
            fetchImpl: () => assert.fail('a fetch escaped SHERMAN_NO_FETCH'),
        });
        const refused = await offline.getMerchantBalance();
        assert.equal(refused.degraded, true);
        assert.match(refused.message, /SHERMAN_NO_FETCH/);

        assert.equal(loadMoneyConfig(dir).ok, false, 'an absent config is a named degradation');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
