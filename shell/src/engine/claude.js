// Claude Code backend — deliberately a stub in this phase.
//
// It implements the whole EngineSession contract so 04-02's UI needs no special
// case for it: the shell renders an error event the same way whatever produced
// it. That is the point of stubbing against the interface rather than leaving a
// hole -- the not-yet-built path exercises the same seam the real one will.

import { EngineSession, ev, emptyUsage } from './session.js';

const NOT_IMPLEMENTED =
    'The Claude Code backend is not implemented yet.\n' +
    'It is the next phase of the Sherman Shell.\n' +
    '\n' +
    'To use Claude Code today, run `sherman --raw` — that launches the engine\n' +
    'directly, without the Sherman Shell on top.';

export class ClaudeSession extends EngineSession {
    /** @param {import('../config.js').ShermanConfig} config */
    constructor(config) {
        super();
        this._config = config;
        this._usage = emptyUsage();
    }

    get info() {
        return {
            engine: 'claude',
            model: 'not implemented',
            user: this._config.user,
            vaultPath: this._config.vaultPath,
            threadId: null,
        };
    }

    get usage() {
        return this._usage;
    }

    /**
     * Yields one error event and ends the turn. It does NOT throw: this is a
     * known-unfinished path, not a crash, and a stack trace here would read as
     * a bug in Sherman rather than a feature that has not shipped.
     */
    async *send(_text) {
        yield ev.error(NOT_IMPLEMENTED);
    }

    interrupt() {
        // No child process exists, so there is nothing to abort. Silently doing
        // nothing is correct -- the UI may bind Ctrl+C unconditionally and must
        // not need to know which backend is live.
    }
}

export { NOT_IMPLEMENTED };
