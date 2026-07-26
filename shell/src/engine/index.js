// Backend selection. The config's `engine` field decides, and nothing else does
// -- no auto-detection, no probing PATH. The wizard already asked the user which
// provider they sign in with, and that answer IS the engine choice (§3b step 1).
// Re-deciding it here would let the shell disagree with the adapter the launcher
// assembled.

import { CodexSession } from './codex.js';
import { ClaudeSession } from './claude.js';

const BACKENDS = {
    codex: CodexSession,
    claude: ClaudeSession,
};

/**
 * @param {import('../config.js').ShermanConfig} config
 * @returns {import('./session.js').EngineSession}
 */
export function selectBackend(config) {
    const Backend = BACKENDS[config.engine];
    if (!Backend) {
        throw new Error(
            `Unknown engine "${config.engine}" in ${config.configPath}.\n` +
            `Valid engines: ${Object.keys(BACKENDS).join(', ')}.\n` +
            'Delete the config and run sherman again to re-choose.'
        );
    }
    return new Backend(config);
}

export { CodexSession, ClaudeSession };
