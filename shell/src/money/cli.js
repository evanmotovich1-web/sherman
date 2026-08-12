// `sherman money` — the operator's window into the earning float.
//
// Same split as `sherman board`: bin/sherman owns the bash 3.2 dispatch and
// this file owns the logic. It is also importable — the shell's /money
// command renders the same screens in-session through moneyCommand().
//
// Subcommands:
//
//   (default)      float balance, today's spend vs the day cap, last 10
//                  ledger lines, pending approvals — sync runs first
//   ledger [n]     last n ledger lines (default 25)
//   sync           reconcile the ledger against Stripe (stub until deploy)
//   kill           the kill switch, three steps, each reported (§4.3)
//   resume         reactivate after a kill — interactive yes, operator only
//   approve <id>   execute one teed-up spend, exactly as prepared (§4.4)
//
// Money hygiene: this file prints key NAMES at most, never values, and no
// Stripe id prefix that could be mistaken for one. The ledger is written
// through appendLedger() only.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { CAPS } from './caps.js';
import { appendLedger, moneyDir, readLedger } from './ledger.js';
import { stripeClient, syncWithStripe } from './stripe.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GATE_DIR = join(REPO_ROOT, 'gate', 'money-gate');
const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function dollars(cents) {
    if (!Number.isInteger(cents)) return '$?';
    const sign = cents < 0 ? '-' : '';
    return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------- approvals --

export function approvalsDir(dir = moneyDir()) {
    return join(dir, 'approvals');
}

/**
 * Tee up one spend the caps blocked: amount and merchant pinned in a file
 * the operator approves with one command. Never silently attempted, never
 * silently dropped.
 */
export function teeUpApproval(fields, dir = moneyDir()) {
    const id = `ap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const record = { id, created: new Date().toISOString(), ...fields };
    try {
        mkdirSync(approvalsDir(dir), { recursive: true, mode: 0o700 });
        writeFileSync(join(approvalsDir(dir), `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    } catch (error) {
        return { ok: false, reason: `could not write the approval: ${error?.message ?? error}` };
    }
    return { ok: true, id, record };
}

function loadApprovalFiles(dir) {
    let names = [];
    try {
        names = readdirSync(approvalsDir(dir)).filter((n) => n.endsWith('.json'));
    } catch {
        return [];
    }
    const records = [];
    for (const name of names.sort()) {
        try {
            const record = JSON.parse(readFileSync(join(approvalsDir(dir), name), 'utf8'));
            if (record?.id) records.push(record);
        } catch { /* an unreadable approval is skipped, not guessed at */ }
    }
    return records;
}

function isExpired(record, now = Date.now()) {
    const created = Date.parse(record.created ?? '');
    return Number.isFinite(created) && now - created > APPROVAL_TTL_MS;
}

/**
 * Seven-day expiry (§4.4): an expired approval appends a `decline` line with
 * `note: approval expired` and its file steps aside — renamed, not edited,
 * so the trail of what was teed up survives.
 */
export function expireApprovals(dir = moneyDir(), append = appendLedger, now = Date.now()) {
    const expired = loadApprovalFiles(dir).filter((record) => isExpired(record, now));
    for (const record of expired) {
        append({
            type: 'decline',
            amount_cents: record.amount_cents,
            currency: 'usd',
            counterparty: record.merchant ?? '',
            play: record.play ?? '',
            rail: 'approval-queue',
            stripe_id: '',
            result: 'declined',
            note: `approval expired: ${record.id}`,
        }, dir);
        try {
            renameSync(join(approvalsDir(dir), `${record.id}.json`), join(approvalsDir(dir), `${record.id}.json.expired`));
        } catch { /* already gone is fine */ }
    }
    return expired.map((record) => record.id);
}

export function pendingApprovals(dir = moneyDir(), now = Date.now()) {
    return loadApprovalFiles(dir).filter((record) => !isExpired(record, now));
}

// --------------------------------------------------------------- gate flags --

/**
 * KV writes reach the gate through the operator's own wrangler login, from
 * the gate directory — the worker holds no API key and exposes no admin
 * route. Absent wrangler, the caller gets a named refusal, not a shrug.
 */
function gateKv(args) {
    let run;
    try {
        run = spawnSync('wrangler', ['kv', 'key', ...args, '--binding', 'MONEY_KV', '--remote'], {
            cwd: GATE_DIR, encoding: 'utf8', timeout: 30000,
        });
    } catch (error) {
        return { ok: false, message: `wrangler did not run: ${error?.message ?? error}` };
    }
    if (run.error?.code === 'ENOENT') {
        return { ok: false, message: 'wrangler is not installed — the gate flag was not changed (sherman install wrangler, then retry)' };
    }
    if (run.status !== 0) {
        const tail = (run.stderr || run.stdout || '').trim().split('\n').slice(-2).join(' ');
        return { ok: false, message: `wrangler exited ${run.status}: ${tail}` };
    }
    return { ok: true, message: 'gate KV updated' };
}

// ------------------------------------------------------------------ screens --

function renderEntry(entry) {
    if (entry.malformed) return `  (malformed line) ${entry.raw}`;
    const direction = entry.type === 'collect' ? '+' : entry.type === 'spend' ? '-' : ' ';
    const amount = Number.isInteger(entry.amount_cents) ? `${direction}${dollars(entry.amount_cents)}` : '';
    const parts = [entry.ts, entry.type?.padEnd(17), amount.padStart(9), entry.counterparty, entry.result, entry.note]
        .filter((piece) => piece !== undefined && piece !== null && piece !== '');
    return `  ${parts.join('  ')}`;
}

function todaySpentCents(entries) {
    const today = new Date().toISOString().slice(0, 10);
    return entries
        .filter((e) => e.type === 'spend' && e.result === 'approved' && typeof e.ts === 'string' && e.ts.startsWith(today))
        .reduce((sum, e) => sum + (Number.isInteger(e.amount_cents) ? e.amount_cents : 0), 0);
}

function lastKnownBalanceCents(entries) {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
        if (Number.isInteger(entries[i].balance_after_cents)) return entries[i].balance_after_cents;
    }
    return null;
}

async function defaultScreen(dir) {
    const lines = [];

    // Sync first (§4.2) — offline or unconfigured, its named message IS the
    // sync report.
    const sync = await syncWithStripe({ dir });
    lines.push(`sync: ${sync.message}`);
    expireApprovals(dir);

    if (existsSync(join(dir, 'KILL'))) {
        lines.push('KILL is set — all outflow is frozen. Collect still runs. `sherman money resume` (operator only) reactivates.');
    }

    // Whole-ledger read: today's spend and the last known balance need every
    // line, not the tail.
    const all = readLedger(0, dir);
    if (!all.ok) return { ok: false, text: all.reason };

    const balance = lastKnownBalanceCents(all.entries);
    lines.push(`float: ${balance === null ? 'unknown until the first synced transaction' : dollars(balance)} (start ${dollars(CAPS.FLOAT_START_CENTS)}, ceiling ${dollars(CAPS.FLOAT_CEILING_CENTS)})`);
    lines.push(`today's spend: ${dollars(todaySpentCents(all.entries))} of the ${dollars(CAPS.PER_DAY_CENTS)} day cap (per-txn cap ${dollars(CAPS.PER_TXN_CENTS)}, training-run cap ${dollars(CAPS.PER_TRAINING_RUN_CENTS)})`);

    lines.push('');
    if (all.entries.length === 0) {
        lines.push('ledger: empty — no money has moved yet');
    } else {
        lines.push(`ledger — last ${Math.min(10, all.entries.length)} of ${all.total}:`);
        lines.push(...all.entries.slice(-10).map(renderEntry));
    }

    const pending = pendingApprovals(dir);
    lines.push('');
    if (pending.length === 0) {
        lines.push('pending approvals: none');
    } else {
        lines.push('pending approvals — `sherman money approve <id>` executes exactly the prepared spend:');
        for (const record of pending) {
            lines.push(`  ${record.id}  ${dollars(record.amount_cents)}  ${record.merchant ?? '?'}  ${record.reason ?? ''}`);
        }
    }
    return { ok: true, text: lines.join('\n') };
}

function ledgerScreen(dir, count) {
    const limit = Number.isInteger(count) && count > 0 ? count : 25;
    const result = readLedger(limit, dir);
    if (!result.ok) return { ok: false, text: result.reason };
    if (result.entries.length === 0) return { ok: true, text: 'ledger: empty — no money has moved yet' };
    return {
        ok: true,
        text: [`ledger — last ${result.entries.length} of ${result.total}:`, ...result.entries.map(renderEntry)].join('\n'),
    };
}

// ------------------------------------------------------------ kill / resume --

async function kill(dir) {
    const lines = [];
    const client = stripeClient({ dir });

    const card = await client.setCardStatus('inactive');
    lines.push(`1. card inactive at Stripe: ${card.ok ? 'done' : card.message}`);

    const flag = gateKv(['put', 'KILL', '1']);
    lines.push(`2. gate KILL flag: ${flag.message}`);

    try {
        writeFileSync(join(dir, 'KILL'), `${new Date().toISOString()}\n`, { mode: 0o600 });
        lines.push(`3. local KILL file written — the skill freezes every spend it would prepare`);
    } catch (error) {
        lines.push(`3. could not write the local KILL file: ${error?.message ?? error}`);
    }

    const logged = appendLedger({
        type: 'kill', currency: 'usd', rail: 'control', stripe_id: '', note: 'kill switch thrown', result: 'approved',
    }, dir);
    lines.push(logged.ok ? 'ledger: kill line appended' : `ledger: ${logged.reason}`);
    lines.push('collect (money in) stays live on purpose — only outflow is frozen.');
    return { ok: true, text: lines.join('\n') };
}

async function resume(dir) {
    if (!process.stdin.isTTY) {
        return { ok: false, text: 'resume requires the operator: run `sherman money resume` in an interactive terminal and answer yes' };
    }
    process.stdout.write([
        'resume will re-enable, in order:',
        '  1. the Issuing card (status active at Stripe)',
        '  2. the gate (KILL flag deleted from KV)',
        '  3. local spend preparation (~/.sherman/money/KILL removed)',
        'Type yes to proceed > ',
    ].join('\n'));

    const answer = await new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.once('line', (line) => { rl.close(); resolve(line.trim()); });
    });
    if (answer !== 'yes') return { ok: false, text: 'not resumed — nothing changed' };

    const lines = [];
    const client = stripeClient({ dir });
    const card = await client.setCardStatus('active');
    lines.push(`1. card active at Stripe: ${card.ok ? 'done' : card.message}`);

    const flag = gateKv(['delete', 'KILL']);
    lines.push(`2. gate KILL flag: ${flag.ok ? 'deleted' : flag.message}`);

    try {
        unlinkSync(join(dir, 'KILL'));
        lines.push('3. local KILL file removed');
    } catch {
        lines.push('3. no local KILL file to remove');
    }

    const logged = appendLedger({
        type: 'resume', currency: 'usd', rail: 'control', stripe_id: '', note: 'resumed by the operator', result: 'approved',
    }, dir);
    lines.push(logged.ok ? 'ledger: resume line appended' : `ledger: ${logged.reason}`);
    return { ok: true, text: lines.join('\n') };
}

// ------------------------------------------------------------------ approve --

async function approve(dir, id) {
    if (!id) {
        const pending = pendingApprovals(dir);
        return {
            ok: false,
            text: pending.length === 0
                ? 'Usage: sherman money approve <id> — and no approvals are pending'
                : `Usage: sherman money approve <id> — pending: ${pending.map((r) => r.id).join(', ')}`,
        };
    }
    expireApprovals(dir);

    const path = join(approvalsDir(dir), `${id}.json`);
    let record;
    try {
        record = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        const pending = pendingApprovals(dir);
        return {
            ok: false,
            text: `no pending approval '${id}'${pending.length ? ` — pending: ${pending.map((r) => r.id).join(', ')}` : ' (it may have expired; the ledger says)'}`,
        };
    }

    const lines = [`approving ${record.id}: ${dollars(record.amount_cents)} to ${record.merchant ?? '?'} — exactly as prepared, nothing else`];

    // The gate passes it on a one-time approval_id it validates against the
    // pinned amount; the record is deleted on use at the gate's side.
    const push = gateKv(['put', `approval:${record.id}`, JSON.stringify({ id: record.id, amount_cents: record.amount_cents, merchant: record.merchant ?? '' })]);
    lines.push(`gate: ${push.ok ? 'one-time approval pushed' : push.message}`);

    if (record.prepared_call?.kind === 'dashboard-topup') {
        lines.push('prepared call is an operator dashboard move — perform the top-up in the Stripe dashboard; sync will observe it');
    } else {
        lines.push('the prepared spend now clears the gate once, at its pinned amount, when the purchase runs');
    }

    const logged = appendLedger({
        type: 'approval_executed',
        amount_cents: record.amount_cents,
        currency: 'usd',
        counterparty: record.merchant ?? '',
        play: record.play ?? '',
        rail: 'approval-queue',
        stripe_id: '',
        result: 'pending',
        note: `approved by the operator: ${record.id}`,
    }, dir);
    lines.push(logged.ok ? 'ledger: approval_executed appended' : `ledger: ${logged.reason}`);

    try {
        renameSync(path, `${path}.used`);
    } catch { /* the rename is bookkeeping, not the approval */ }

    return { ok: true, text: lines.join('\n') };
}

// ----------------------------------------------------------------- dispatch --

/**
 * The importable entry the shell's /money command uses. Mutating verbs stay
 * in the terminal: kill and approve want the operator's own prompt, and
 * resume is interactive by contract — Sherman never runs it on its own
 * initiative.
 */
export async function moneyCommand(args = '', dir = moneyDir()) {
    const [verb, rest] = String(args).trim().split(/\s+/, 2);
    if (!verb) return defaultScreen(dir);
    if (verb === 'ledger') return ledgerScreen(dir, Number(rest));
    if (verb === 'sync') {
        const sync = await syncWithStripe({ dir });
        return { ok: true, text: `sync: ${sync.message}` };
    }
    if (['kill', 'resume', 'approve'].includes(verb)) {
        return { ok: false, text: `run \`sherman money ${verb}\` in a terminal — the in-shell /money window is read-only` };
    }
    return { ok: false, text: 'Usage: /money [ledger [n] | sync] · terminal: sherman money [ledger|sync|kill|resume|approve <id>]' };
}

async function main(argv) {
    const dir = moneyDir();
    const [verb, arg] = argv;
    let result;
    if (!verb) result = await defaultScreen(dir);
    else if (verb === 'ledger') result = ledgerScreen(dir, Number(arg));
    else if (verb === 'sync') { const sync = await syncWithStripe({ dir }); result = { ok: true, text: `sync: ${sync.message}` }; }
    else if (verb === 'kill') result = await kill(dir);
    else if (verb === 'resume') result = await resume(dir);
    else if (verb === 'approve') result = await approve(dir, arg);
    else result = { ok: false, text: 'Usage: sherman money [ledger [n] | sync | kill | resume | approve <id>]' };

    process.stdout.write(`${result.text}\n`);
    process.exitCode = result.ok ? 0 : 1;
}

// Run only when invoked as a program (bin/sherman does), never on import.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    await main(process.argv.slice(2));
}
