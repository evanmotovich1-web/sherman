// Backend selection. The config's `engine` field decides, and nothing else does
// -- no auto-detection, no probing PATH. The wizard already asked the user which
// provider they sign in with, and that answer IS the engine choice (§3b step 1).
// Re-deciding it here would let the shell disagree with the adapter the launcher
// assembled.

import { spawnSync } from 'node:child_process';

import { CodexSession } from './codex.js';
import { ClaudeSession } from './claude.js';
import { OpenCodeSession } from './opencode.js';

const BACKENDS = {
    codex: CodexSession,
    claude: ClaudeSession,
    zai: OpenCodeSession,
};

// What each backend actually launches. Used by engineAvailable so a worker
// routed to an engine this machine does not have fails at the command with a
// named repair, not mid-turn with a spawn error.
const BINARIES = {
    codex: 'codex',
    claude: 'claude',
    zai: 'opencode',
};

/** Whether the named engine binary exists on this machine PATH. */
export function engineAvailable(name) {
    const binary = BINARIES[name];
    if (!binary) return false;
    const probe = spawnSync(
        process.platform === 'win32' ? 'where' : 'which',
        [binary],
        { stdio: 'ignore' }
    );
    return probe.status === 0;
}

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

export { CodexSession, ClaudeSession, OpenCodeSession };
