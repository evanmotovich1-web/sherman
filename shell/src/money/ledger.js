// The append-only money ledger — ~/.sherman/money/ledger.jsonl.
//
// One transaction per line, every money event on every rail: spend, collect,
// decline, approval, sweep, top-up, kill, resume. Full-income capture is the
// rule — marketplace sales that never touch Stripe still land here.
//
// appendLedger() is the ONLY writer in the tree, and it opens the file with
// the append flag alone. Nothing edits or rewrites an existing line, ever:
// a correction is a NEW line whose `note` references the corrected `ts`.
// Smoke check 36 pins both properties — the single append-flag open and the
// byte-stability of earlier lines across appends.
//
// All amounts are integer cents. `stripe_id` is empty for off-Stripe rails.

import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const LEDGER_TYPES = Object.freeze([
    'spend', 'collect', 'decline', 'approval_teed', 'approval_executed',
    'sweep_observed', 'topup', 'kill', 'resume',
]);

export const LEDGER_RESULTS = Object.freeze(['approved', 'declined', 'pending']);

/** ~/.sherman/money — private to the operator: directory 0700, files 0600. */
export function moneyDir(home = join(homedir(), '.sherman')) {
    return join(home, 'money');
}

export function ledgerPath(dir = moneyDir()) {
    return join(dir, 'ledger.jsonl');
}

/**
 * Append one event to the ledger. The only writer.
 *
 * Fills `ts` when absent, validates `type` and `result` against the schema,
 * and refuses anything that is not a flat JSON-serialisable object — a line
 * that cannot round-trip is a line the render and the reconciler would both
 * choke on later, which is worse than refusing it now with a reason.
 *
 * @returns {{ok: true, line: string} | {ok: false, reason: string}}
 */
export function appendLedger(entry, dir = moneyDir()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return { ok: false, reason: 'a ledger entry is a plain object' };
    }
    if (!LEDGER_TYPES.includes(entry.type)) {
        return { ok: false, reason: `unknown ledger type '${entry.type}' — one of: ${LEDGER_TYPES.join(', ')}` };
    }
    if (entry.result !== undefined && !LEDGER_RESULTS.includes(entry.result)) {
        return { ok: false, reason: `unknown result '${entry.result}' — one of: ${LEDGER_RESULTS.join(', ')}` };
    }
    if (entry.amount_cents !== undefined && !Number.isInteger(entry.amount_cents)) {
        return { ok: false, reason: 'amount_cents must be integer cents' };
    }

    const record = { ts: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), ...entry };
    let line;
    try {
        line = JSON.stringify(record);
    } catch {
        return { ok: false, reason: 'entry is not JSON-serialisable' };
    }

    try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        // Append flag ONLY. No write mode, no truncation — the open itself is
        // incapable of touching an existing byte, which is the property smoke
        // check 36 asserts statically.
        const fd = openSync(ledgerPath(dir), 'a', 0o600);
        try {
            writeSync(fd, `${line}\n`);
        } finally {
            closeSync(fd);
        }
    } catch (error) {
        return { ok: false, reason: `could not append to the ledger: ${error?.message ?? error}` };
    }
    return { ok: true, line };
}

/**
 * The last `limit` ledger entries, oldest first, parsed. A line that does not
 * parse is returned as `{malformed: true, raw}` rather than dropped — a
 * ledger render that silently hides a byte is a ledger render nobody should
 * trust.
 *
 * @returns {{ok: true, entries: Array<object>, total: number} | {ok: false, reason: string}}
 */
export function readLedger(limit = 25, dir = moneyDir()) {
    let text;
    try {
        text = readFileSync(ledgerPath(dir), 'utf8');
    } catch (error) {
        if (error?.code === 'ENOENT') return { ok: true, entries: [], total: 0 };
        return { ok: false, reason: `could not read the ledger: ${error?.message ?? error}` };
    }

    const lines = text.split('\n').filter((line) => line.trim() !== '');
    const tail = limit > 0 ? lines.slice(-limit) : lines;
    const entries = tail.map((raw) => {
        try {
            return JSON.parse(raw);
        } catch {
            return { malformed: true, raw };
        }
    });
    return { ok: true, entries, total: lines.length };
}
