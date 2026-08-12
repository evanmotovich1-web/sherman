// The operator's key store: named API keys, handed over once, remembered.
//
//   ~/.sherman/keys.json — per machine, chmod 600, never committed, never
//   synced, never in the vault.
//
// The problem this solves: Sherman is told to acquire capabilities, and the
// one thing it must stop for is a secret only the operator holds. Before this
// module the hand-over had no path — a key pasted as prose lands in the model
// transcript and the session log, and a key hand-edited into a JSON file is a
// policy of remembering. `/key NAME <value>` is the path: the SHELL stores it
// (the model never sees the value), the submission is redacted before it
// reaches the transcript or log (commands.js), and the value is injected into
// the engine's environment so every subsequent turn — this session and every
// future one — simply has it.
//
// THE SECRET BOUNDARY, same contract as connectors.js: anything user-facing
// formats key NAMES and never values. describeKeys() is the only formatter
// and it carries names only — not even masked tails, because the transcript
// feeds the session log and the session log feeds eval turns.

import {
    chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// $HOME resolved live on every call, config.js's reason: smoke.sh overrides
// HOME to sandbox its run, and a value captured at import time would read the
// real store instead of the sandbox one.
function shermanHome() {
    return join(process.env.HOME || homedir(), '.sherman');
}

export function keysPath(home = shermanHome()) {
    return join(home, 'keys.json');
}

// Env-var shaped on purpose: the store IS the engine environment, so a name
// that could not be an environment variable could never be used. The gate is
// also what keeps a pasted shell fragment from ever becoming a "name".
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export function validKeyName(name) {
    return NAME_RE.test(String(name ?? ''));
}

/**
 * The stored keys. An absent file is the ordinary state of a fresh machine,
 * not an error; a corrupt file is an error that deliberately does not quote
 * the file — a parse error message from a file full of API keys is one of the
 * easiest ways to print a secret (connectors.js learned this first).
 *
 * @returns {{ok: true, keys: Record<string,string>} | {ok: false, reason: string}}
 */
export function loadKeys(home = shermanHome()) {
    let text;
    try {
        text = readFileSync(keysPath(home), 'utf8');
    } catch (error) {
        if (error?.code === 'ENOENT') return { ok: true, keys: {} };
        return { ok: false, reason: 'the key store is unreadable' };
    }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, reason: 'the key store is not valid JSON — fix or remove ~/.sherman/keys.json' };
    }

    const keys = {};
    if (parsed?.keys && typeof parsed.keys === 'object') {
        for (const [name, value] of Object.entries(parsed.keys)) {
            if (validKeyName(name) && typeof value === 'string' && value.trim() !== '') {
                keys[name] = value;
            }
        }
    }
    return { ok: true, keys };
}

/**
 * Store one key. Atomic (write-then-rename), 0600 before the secret ever has
 * a resting place, and verified by read-back — the same claim discipline as
 * every other launcher write: "stored" is only said after the file says it.
 *
 * @returns {{ok: true, name: string, replaced: boolean} | {ok: false, reason: string}}
 */
export function saveKey(name, value, home = shermanHome()) {
    if (!validKeyName(name)) {
        return {
            ok: false,
            reason: 'a key name is letters, digits, and underscores, starting with a letter (e.g. STRIPE_API_KEY)',
        };
    }
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed === '') return { ok: false, reason: 'no value was given' };
    if (/[\r\n]/.test(trimmed)) return { ok: false, reason: 'a key value is one line' };

    const current = loadKeys(home);
    if (!current.ok) return { ok: false, reason: current.reason };

    const keys = { ...current.keys, [name]: trimmed };
    try {
        mkdirSync(home, { recursive: true });
        const path = keysPath(home);
        const staged = `${path}.tmp`;
        writeFileSync(staged, `${JSON.stringify({ version: 1, keys }, null, 2)}\n`, { mode: 0o600 });
        renameSync(staged, path);
        // rename preserves the staged mode, but an earlier store created by
        // something else might not be 0600 — pin it on every write.
        chmodSync(path, 0o600);
    } catch (error) {
        return { ok: false, reason: `could not write the key store: ${error?.message ?? error}` };
    }

    const verify = loadKeys(home);
    if (!verify.ok || verify.keys[name] !== trimmed) {
        return { ok: false, reason: 'read-back verification failed — nothing can be claimed stored' };
    }
    return { ok: true, name, replaced: Object.hasOwn(current.keys, name) };
}

/** @returns {{ok: true, removed: boolean} | {ok: false, reason: string}} */
export function removeKey(name, home = shermanHome()) {
    if (!validKeyName(name)) return { ok: false, reason: 'not a valid key name' };
    const current = loadKeys(home);
    if (!current.ok) return { ok: false, reason: current.reason };
    if (!Object.hasOwn(current.keys, name)) return { ok: true, removed: false };

    const keys = { ...current.keys };
    delete keys[name];
    try {
        const path = keysPath(home);
        const staged = `${path}.tmp`;
        writeFileSync(staged, `${JSON.stringify({ version: 1, keys }, null, 2)}\n`, { mode: 0o600 });
        renameSync(staged, path);
        chmodSync(path, 0o600);
    } catch (error) {
        return { ok: false, reason: `could not write the key store: ${error?.message ?? error}` };
    }
    const verify = loadKeys(home);
    if (!verify.ok || Object.hasOwn(verify.keys, name)) {
        return { ok: false, reason: 'read-back verification failed' };
    }
    return { ok: true, removed: true };
}

/**
 * Put the stored keys into an environment. Explicit environment wins: a var
 * the operator exported before launching outranks the store, because an
 * export is the more deliberate act and clobbering it would make this the one
 * config source that cannot be overridden for a single run.
 *
 * Both engines inherit the shell's process.env (codex spawns with no env
 * option; opencode spreads it), so injecting here at startup — and once more
 * on each /key save — is what makes a stored key live without a relaunch.
 *
 * @returns {{ok: boolean, reason?: string, injected: string[]}}
 */
export function injectKeys(env = process.env, home = shermanHome()) {
    const store = loadKeys(home);
    if (!store.ok) return { ok: false, reason: store.reason, injected: [] };
    const injected = [];
    for (const [name, value] of Object.entries(store.keys)) {
        if (env[name] === undefined || env[name] === '') {
            env[name] = value;
            injected.push(name);
        }
    }
    return { ok: true, injected };
}

/** What `/key` with no arguments prints. Names only — never values. */
export function describeKeys(home = shermanHome()) {
    const store = loadKeys(home);
    if (!store.ok) return `Key store unavailable: ${store.reason}.`;
    const names = Object.keys(store.keys).sort();
    if (names.length === 0) {
        return 'No keys are stored. /key <NAME> <value> stores one — chmod 600, outside the repo and the vault, value redacted from the transcript and log.';
    }
    return [
        'Stored keys — available to every turn as environment variables',
        ...names.map((name) => `  ${name}`),
        '',
        'Key names only — never values. /key <NAME> <value> replaces one · /key remove <NAME> deletes it.',
    ].join('\n');
}
