// Reads ~/.sherman/config.json — the file the launcher's wizard owns.
//
// The shell is a READER here. The wizard writes this file; nothing in shell/
// ever should. Keeping that one-way makes the launcher the single source of
// truth for identity and engine choice.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Codex's model metadata reports these usable context windows. Keep the map
// small and explicit: an unknown model gets no meter rather than a guessed
// denominator. `context_window_tokens` can override a provider-specific limit.
export const MODEL_CONTEXT_WINDOWS = Object.freeze({
    'gpt-5.6-sol': 272000,
    'gpt-5.6-terra': 272000,
    'gpt-5.6-luna': 272000,
    'gpt-5.5': 272000,
    'gpt-5.4': 272000,
    'gpt-5.4-mini': 272000,
    'gpt-5.3-codex-spark': 128000,
});

export function contextWindowFor(model, override = null) {
    if (Number.isInteger(override) && override > 0) return override;
    return MODEL_CONTEXT_WINDOWS[model] ?? null;
}

// Resolve $HOME live on every call, never at import time. smoke.sh overrides
// HOME to sandbox its run, and a value captured at module load would both
// defeat the test and read Evan's real config instead of the sandbox one.
function shermanHome() {
    return join(process.env.HOME || homedir(), '.sherman');
}

/**
 * @typedef {Object} ShermanConfig
 * @property {number} version
 * @property {string} engine        'codex' | 'claude'
 * @property {string} user          slug, also a private-memory directory name
 * @property {string} vaultPath     company knowledge base
 * @property {string} workspacePath engine cwd; holds the assembled adapter
 * @property {string} configPath    where this came from
 * @property {number|null} contextWindowTokens optional operator override
 * @property {string} telegramToken bot token for the Telegram bridge; '' unset
 * @property {string} telegramChat  the one chat id the bridge answers; '' unpaired
 */

/**
 * Load and validate the Sherman config.
 * @returns {ShermanConfig}
 * @throws {Error} with a message that says what is wrong and how to fix it
 */
export function loadConfig() {
    const home = shermanHome();
    const configPath = join(home, 'config.json');

    let raw;
    try {
        raw = readFileSync(configPath, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') {
            throw new Error(
                `No Sherman config at ${configPath}.\n` +
                'Run sherman once to set up this machine.'
            );
        }
        throw new Error(`Cannot read ${configPath}: ${err.message}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // Same remedy the launcher already prints for a broken config, worded
        // the same way on purpose -- two different repair instructions for one
        // problem is how a user ends up not trusting either.
        throw new Error(
            `Config at ${configPath} is not valid JSON.\n` +
            'Delete it and run sherman again.'
        );
    }

    const missing = ['engine', 'user', 'vault_path'].filter(
        (k) => typeof parsed[k] !== 'string' || parsed[k].length === 0
    );
    if (missing.length > 0) {
        throw new Error(
            `Config at ${configPath} is incomplete (missing: ${missing.join(', ')}).\n` +
            'Delete it and run sherman again.'
        );
    }

    if (
        parsed.context_window_tokens !== undefined &&
        (!Number.isInteger(parsed.context_window_tokens) || parsed.context_window_tokens <= 0)
    ) {
        throw new Error(
            `Config at ${configPath} has an invalid context_window_tokens value.\n` +
            'Use a positive integer or remove the override.'
        );
    }

    // snake_case dies here. Mapping at this boundary means no other module has
    // to know the on-disk wire format, so changing the file shape later touches
    // exactly one function.
    return {
        version: parsed.version ?? 1,
        engine: parsed.engine,
        user: parsed.user,
        vaultPath: parsed.vault_path,
        workspacePath: join(home, 'workspace'),
        configPath,
        contextWindowTokens: parsed.context_window_tokens ?? null,
        telegramToken: typeof parsed.telegram_token === 'string' ? parsed.telegram_token : '',
        telegramChat:
            typeof parsed.telegram_chat === 'string' || typeof parsed.telegram_chat === 'number'
                ? String(parsed.telegram_chat)
                : '',
    };
}
