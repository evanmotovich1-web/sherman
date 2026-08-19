// What this machine can actually run, and which named keys are already here.
//
// /models is a local read, same contract as /connectors and /key: installed
// engines, stored or exported key NAMES, and the /subagent --engine route
// each one unlocks. Never values. Never a disk hunt for .env files — that
// would put secrets into the model's context. The key store and the
// process environment are the two places Sherman is allowed to know a
// key exists.

import { homedir } from 'node:os';
import { join } from 'node:path';

import { loadKeys } from './keys.js';
import { engineAvailable } from './engine/index.js';

export const MODEL_ENGINES = Object.freeze([
    {
        engine: 'claude',
        binary: 'claude',
        label: 'Claude Code',
        model: 'Anthropic via Claude Code',
        keys: ['ANTHROPIC_API_KEY'],
        requiresKey: false,
        repair: 'install Claude Code and sign in',
    },
    {
        engine: 'codex',
        binary: 'codex',
        label: 'Codex',
        model: 'OpenAI via Codex',
        keys: ['OPENAI_API_KEY'],
        requiresKey: false,
        repair: 'install Codex and sign in',
    },
    {
        engine: 'zai',
        binary: 'opencode',
        label: 'Z.AI GLM',
        model: 'zai/glm-5.2 via OpenCode',
        keys: ['ZAI_API_KEY'],
        requiresKey: false,
        repair: 'npm install -g opencode-ai, then `opencode auth login` and pick Z.AI',
    },
    {
        engine: 'deepseek',
        binary: 'opencode',
        label: 'DeepSeek',
        model: 'deepseek/deepseek-chat via OpenCode',
        keys: ['DEEPSEEK_API_KEY'],
        requiresKey: true,
        repair: 'npm install -g opencode-ai, then /key DEEPSEEK_API_KEY <value>',
    },
    {
        engine: 'grok',
        binary: 'opencode',
        label: 'xAI Grok',
        model: 'xai/grok-4.3 via SuperGrok OAuth',
        keys: ['XAI_API_KEY'],
        requiresKey: false,
        repair: '`sherman model grok` — Sherman SuperGrok OAuth, not OpenCode login',
    },
]);

// Named keys that do not unlock a first-party engine but may already live
// on this machine. Presence only — listed so recursive-learning can see
// what is already paid for instead of asking for it again.
export const AUX_KEYS = Object.freeze([
    'OPENROUTER_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GROQ_API_KEY',
    'TOGETHER_API_KEY',
    'MISTRAL_API_KEY',
    'XAI_API_KEY',
    'PERPLEXITY_API_KEY',
    'HUGGINGFACE_API_KEY',
    'HF_TOKEN',
]);

function shermanHome() {
    return join(process.env.HOME || homedir(), '.sherman');
}

function keyPresent(name, storeKeys, env) {
    if (storeKeys[name]) return 'store';
    const value = env[name];
    if (typeof value === 'string' && value.trim() !== '') return 'environment';
    return null;
}

/**
 * Snapshot of engines and named keys on this machine.
 *
 * @param {{home?: string, env?: NodeJS.ProcessEnv, engineAvailable?: (name: string) => boolean}} [options]
 */
export function inventory(options = {}) {
    const home = options.home ?? shermanHome();
    const env = options.env ?? process.env;
    const available = options.engineAvailable ?? engineAvailable;
    const store = loadKeys(home);
    const storeKeys = store.ok ? store.keys : {};

    const engines = MODEL_ENGINES.map((entry) => {
        const installed = Boolean(available(entry.engine));
        const keys = entry.keys
            .map((name) => ({ name, where: keyPresent(name, storeKeys, env) }))
            .filter((hit) => hit.where);
        const missingKeys = entry.requiresKey
            ? entry.keys.filter((name) => !keys.some((hit) => hit.name === name))
            : [];
        return {
            engine: entry.engine,
            binary: entry.binary,
            label: entry.label,
            model: entry.model,
            repair: entry.repair,
            installed,
            keys,
            missingKeys,
            ready: installed && missingKeys.length === 0,
        };
    });

    const engineKeyNames = new Set(MODEL_ENGINES.flatMap((entry) => entry.keys));
    const extras = [];
    const seen = new Set();
    for (const name of Object.keys(storeKeys).sort()) {
        if (engineKeyNames.has(name)) continue;
        extras.push({ name, where: 'store' });
        seen.add(name);
    }
    for (const name of AUX_KEYS) {
        if (seen.has(name)) continue;
        const where = keyPresent(name, {}, env);
        if (where) extras.push({ name, where });
    }

    return {
        ok: store.ok,
        reason: store.ok ? undefined : store.reason,
        engines,
        extras,
        ready: engines.filter((entry) => entry.ready).map((entry) => entry.engine),
    };
}

/** What `/models` prints. Names only — never values. */
export function describeModels(options = {}) {
    const snap = inventory(options);
    const lines = [];

    const ready = snap.engines.filter((entry) => entry.ready);
    const needsKey = snap.engines.filter((entry) => entry.installed && entry.missingKeys.length > 0);
    const missing = snap.engines.filter((entry) => !entry.installed);

    if (ready.length > 0) {
        lines.push('Ready to route');
        for (const entry of ready) {
            const keyNote = entry.keys.length > 0
                ? ` · ${entry.keys.map((hit) => hit.name).join(', ')} (${entry.keys[0].where})`
                : '';
            lines.push(`  ${entry.engine.padEnd(10)}${entry.model}${keyNote}`);
            lines.push(`            /subagent --engine ${entry.engine} <task>`);
        }
    }

    if (needsKey.length > 0) {
        if (lines.length) lines.push('');
        lines.push('Needs a key');
        for (const entry of needsKey) {
            lines.push(`  ${entry.engine.padEnd(10)}missing ${entry.missingKeys.join(', ')} · /key ${entry.missingKeys[0]} <value>`);
        }
    }

    if (missing.length > 0) {
        if (lines.length) lines.push('');
        lines.push('Not installed');
        for (const entry of missing) {
            const keyNote = entry.keys.length > 0
                ? ` · ${entry.keys.map((hit) => hit.name).join(', ')} is present`
                : '';
            lines.push(`  ${entry.engine.padEnd(10)}${entry.repair}${keyNote}`);
        }
    }

    if (snap.extras.length > 0) {
        if (lines.length) lines.push('');
        lines.push('Other keys on this machine');
        for (const key of snap.extras) {
            lines.push(`  ${key.name.padEnd(22)}${key.where}`);
        }
    }

    if (!snap.ok) {
        if (lines.length) lines.push('');
        lines.push(`Key store unavailable: ${snap.reason}. Engine list above is still from PATH.`);
    }

    if (lines.length === 0) {
        return 'No engines are installed on this machine. Install Claude Code, Codex, or OpenCode, then run /models again.';
    }

    lines.push('');
    lines.push('Key names only — never values. This command does not scan the disk for secrets.');
    lines.push('The parent session stays on its own engine; route a slice with /subagent --engine <name>.');
    return lines.join('\n');
}

/**
 * Pick an installed engine for a blocked slice.
 *
 * A named preference wins when it is ready; otherwise the first ready
 * engine. No silent fall-through onto an engine this machine cannot run.
 */
export function pickRoute(preferred, options = {}) {
    const snap = inventory(options);
    const name = typeof preferred === 'string' ? preferred.trim().toLowerCase() : '';
    if (name) {
        const want = snap.engines.find((entry) => entry.engine === name);
        if (want?.ready) {
            return { engine: want.engine, model: want.model, reason: 'requested engine is ready' };
        }
        if (want && !want.installed) {
            return { engine: null, model: null, reason: `${name} is not installed — ${want.repair}` };
        }
        if (want && want.missingKeys.length > 0) {
            return {
                engine: null,
                model: null,
                reason: `${name} needs /key ${want.missingKeys[0]} <value>`,
            };
        }
    }
    const first = snap.engines.find((entry) => entry.ready);
    if (first) {
        return { engine: first.engine, model: first.model, reason: 'first ready engine on this machine' };
    }
    return { engine: null, model: null, reason: 'no engine binary is installed on this machine' };
}
