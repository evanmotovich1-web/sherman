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
 * @typedef {{kind:'message', text:string}} MessageEvent
 * @typedef {{kind:'tool', id:string, phase:'started'|'completed', glyph:string,
 *            label:string, durationMs:number|null}} ToolEvent
 * @typedef {{kind:'turn-end', usage:Usage}} TurnEndEvent
 * @typedef {{kind:'interrupted'}} InterruptedEvent
 * @typedef {{kind:'error', message:string}} ErrorEvent
 *
 * @typedef {TurnStartEvent|ReasoningEvent|MessageEvent|ToolEvent
 *          |TurnEndEvent|InterruptedEvent|ErrorEvent} EngineEvent
 */

/** Every event kind, for exhaustiveness checks in a UI switch. */
export const EVENT_KINDS = Object.freeze([
    'turn-start',
    'reasoning',
    'message',
    'tool',
    'turn-end',
    'interrupted',
    'error',
]);

/** Constructors, so a typo becomes a missing function instead of a silent
 *  event with the wrong `kind` that a UI quietly drops. */
export const ev = Object.freeze({
    turnStart: () => ({ kind: 'turn-start' }),
    reasoning: (text) => ({ kind: 'reasoning', text }),
    message: (text) => ({ kind: 'message', text }),
    tool: ({ id, phase, glyph = '›', label, durationMs = null }) => ({
        kind: 'tool',
        id,
        phase,
        glyph,
        label,
        durationMs,
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
     * @param {string} _text
     * @returns {AsyncIterable<EngineEvent>}
     */
    async *send(_text) {
        throw new Error('EngineSession.send not implemented');
    }

    /** Abort the in-flight turn. The session must remain usable afterward. */
    interrupt() {
        throw new Error('EngineSession.interrupt not implemented');
    }

    /** Release resources. Safe to call more than once. */
    dispose() {}
}
