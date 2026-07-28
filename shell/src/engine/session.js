// The engine seam.
//
// Design doc §3 promises Sherman runs on either engine. Phase 1 kept that
// promise at the persona layer: one agent/SYSTEM.md, two thin adapters. This
// file keeps it at the UI layer: one EngineSession contract, two thin backends.
//
// The rule that makes it work is the same rule: NOTHING engine-specific lives
// here. No codex event names, no claude flags, no JSON shapes from either. A UI
// written against this file must be unable to tell which engine answered. If
// you find yourself wanting to leak an engine detail through, that detail
// belongs in the backend instead.

/**
 * What the status bar needs to describe the session.
 *
 * @typedef {Object} SessionInfo
 * @property {string} engine        'codex' | 'claude'
 * @property {string} model         display hint only; may be a neutral label
 * @property {string} user
 * @property {string} vaultPath
 * @property {string|null} threadId null until the engine reports one
 * @property {number|null} contextWindow known model limit, or null to omit meter
 */

/**
 * Normalized token accounting. Engine payloads get mapped into this shape so
 * the status bar never learns a vendor's field names.
 *
 * @typedef {Object} Usage
 * @property {number} input
 * @property {number} cachedInput
 * @property {number} output
 * @property {number} reasoning
 * @property {number} total
 */

/**
 * The only event shapes a UI ever sees.
 *
 * @typedef {{kind:'turn-start'}} TurnStartEvent
 * @typedef {{kind:'reasoning', text:string}} ReasoningEvent
 * @typedef {{kind:'status', text:string}} StatusEvent
 * @typedef {{kind:'message', text:string}} MessageEvent
 * @typedef {{kind:'tool', id:string, phase:'started'|'updated'|'completed', glyph:string,
 *            label:string, category:string, outcome:'running'|'succeeded'|'failed'|'declined'|'unknown',
 *            durationMs:number|null}} ToolEvent
 * @typedef {{kind:'turn-end', usage:Usage|null}} TurnEndEvent
 * @typedef {{kind:'interrupted'}} InterruptedEvent
 * @typedef {{kind:'error', message:string}} ErrorEvent
 * @typedef {{kind:'diff', path:string, changeKind:string, available:boolean,
 *            reason:string|null, added:number, removed:number,
 *            lines:Array<{sign:'+'|'-', text:string}>, more:number}} DiffEvent
 *
 * @typedef {TurnStartEvent|ReasoningEvent|StatusEvent|MessageEvent|ToolEvent
 *          |TurnEndEvent|InterruptedEvent|ErrorEvent|DiffEvent} EngineEvent
 *
 * A `diff` event reports one file change in the lines that actually changed.
 * `available:false` is a first-class outcome, not a failure to paper over: no
 * engine in this repo ships line content in its stream (see filediff.js), so
 * the lines are read from disk and sometimes cannot be. When that happens the
 * event still reports the path and the fact of the change, carries a `reason`,
 * and the UI states plainly that line detail is unavailable. A `diff` event
 * must never contain a line that was not read from a real file.
 *
 * `reasoning` and `status` are both interim signals, and they differ in what
 * they are evidence OF. A `reasoning` event carries the model's own words about
 * what it is doing, so it earns a place in the committed trace. A `status`
 * event is a lifecycle fact the transport reported ("the turn started"), which
 * is worth showing while it is true and worth nothing afterward -- so it is
 * transient and never commits. Neither may be synthesized: see codex.js.
 */

/** Every event kind, for exhaustiveness checks in a UI switch. */
export const EVENT_KINDS = Object.freeze([
    'turn-start',
    'reasoning',
    'status',
    'message',
    'tool',
    'turn-end',
    'interrupted',
    'error',
    'diff',
]);

/** Constructors, so a typo becomes a missing function instead of a silent
 *  event with the wrong `kind` that a UI quietly drops. */
export const ev = Object.freeze({
    turnStart: () => ({ kind: 'turn-start' }),
    reasoning: (text) => ({ kind: 'reasoning', text }),
    status: (text) => ({ kind: 'status', text }),
    message: (text) => ({ kind: 'message', text }),
    tool: ({
        id,
        phase,
        glyph = '›',
        label,
        category = 'tool',
        outcome = phase === 'completed' ? 'unknown' : 'running',
        durationMs = null,
    }) => ({
        kind: 'tool',
        id,
        phase,
        glyph,
        label,
        category,
        outcome,
        durationMs,
    }),
    diff: ({ path, changeKind, available, reason = null, added = 0, removed = 0, lines = [], more = 0 }) => ({
        kind: 'diff',
        path,
        changeKind,
        available,
        reason,
        added,
        removed,
        lines,
        more,
    }),
    turnEnd: (usage) => ({ kind: 'turn-end', usage }),
    interrupted: () => ({ kind: 'interrupted' }),
    error: (message) => ({ kind: 'error', message }),
});

/** @returns {Usage} */
export function emptyUsage() {
    return { input: 0, cachedInput: 0, output: 0, reasoning: 0, total: 0 };
}

/**
 * Fold one turn's usage into a running session total.
 * @param {Usage} into @param {Usage} add @returns {Usage}
 */
export function addUsage(into, add) {
    return {
        input: into.input + add.input,
        cachedInput: into.cachedInput + add.cachedInput,
        output: into.output + add.output,
        reasoning: into.reasoning + add.reasoning,
        total: into.total + add.total,
    };
}

/**
 * Abstract base. Unimplemented members throw loudly rather than returning
 * undefined -- a half-built backend should fail at the first call, not present
 * an empty chat pane and leave you wondering whether the model is just slow.
 */
export class EngineSession {
    /** @returns {SessionInfo} */
    get info() {
        throw new Error('EngineSession.info not implemented');
    }

    /** @returns {Usage} */
    get usage() {
        throw new Error('EngineSession.usage not implemented');
    }

    /**
     * Run one user turn.
     * @param {string|{text:string, mode?:'normal'|'read-only'|'isolated-read-only', source?:string}} _request
     * @returns {AsyncIterable<EngineEvent>}
     */
    async *send(_request) {
        throw new Error('EngineSession.send not implemented');
    }

    /**
     * Drop conversation continuity so the next `send` opens a fresh thread,
     * and report whether that happened.
     *
     * This is a capability, not a requirement: a backend with no notion of a
     * thread answers `false` and the UI says so plainly instead of claiming a
     * reduction it did not get. The default is that honest `false` rather than
     * a throw, because a session that cannot start a new thread is a working
     * session -- just one where /compact summarizes without shrinking anything.
     *
     * @returns {boolean}
     */
    startNewThread() {
        return false;
    }

    /** Abort the in-flight turn. The session must remain usable afterward. */
    interrupt() {
        throw new Error('EngineSession.interrupt not implemented');
    }

    /** Release resources. Safe to call more than once. */
    dispose() {}
}
