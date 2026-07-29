// A live, ESTIMATED context figure for the status meter — and the boundary that
// keeps it from ever being mistaken for a measured one.
//
// Codex reports usage exactly once per turn, in `turn.completed`. That was
// verified against codex-cli 0.145.0 by capturing a real turn's JSONL: seven
// events, and only the last carried a `usage` payload. `codex exec --help` has
// no usage-streaming flag, and the `TokenUsageUpdatedNotification` that does
// exist in the binary belongs to `codex app-server`, a protocol shell/README.md
// deliberately rejected as experimental.
//
// So during a turn there is no true number. The meter used to sit frozen on the
// previous turn's figure, which read as a broken widget on a long turn.
//
// This module produces a stand-in from what CAN be counted locally — the
// characters actually sent and actually streamed back — and everything about it
// is built so the estimate cannot be laundered into a fact:
//
//   * It is returned tagged `estimated: true`. The status bar prints `~` on both
//     the token figure and the percentage, so the screen says "about" wherever
//     it says anything.
//   * It NEVER feeds compaction. Compaction throws away real conversation, and
//     doing that on a guess would destroy context to satisfy a number nobody
//     measured. `shouldAutoCompact` is called only with `turn.completed` usage;
//     see app.js.
//   * It is discarded the instant a real figure arrives. The measured value
//     replaces it at turn end rather than being blended with it — an average of
//     a fact and a guess is a guess.
//
// The estimate is deliberately crude, because a more elaborate one would invite
// more trust than the input deserves. It cannot see the system prompt, the
// vault files Codex read, the tool output it consumed, or its own reasoning
// tokens, so it UNDERSTATES — usually substantially, on a turn that reads
// files. Understating is the safer direction here: the meter creeping up too
// slowly is a cosmetic disappointment, while overstating would push the
// operator toward compacting a session that had plenty of room left.

/**
 * Rough tokens for a run of text.
 *
 * Four characters per token is the common English approximation, and it is an
 * approximation: real tokenizers split on subwords, so code and identifiers run
 * denser than prose and long whitespace runs much thinner. Exported so the
 * ratio is testable and visible rather than buried at a call site.
 */
export const CHARS_PER_TOKEN = 4;

/** @returns {number} */
export function estimateTokens(text) {
    if (typeof text !== 'string' || text.length === 0) return 0;
    return tokensForChars(text.length);
}

/**
 * The same ratio, applied to a character count the caller already has.
 *
 * The live path accumulates a running total of characters rather than keeping
 * the text — the transcript already holds the text, and a second copy of a long
 * turn exists only to be measured and thrown away.
 */
export function tokensForChars(chars) {
    if (!Number.isFinite(chars) || chars <= 0) return 0;
    return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * The figure the meter should show right now.
 *
 * @param {{measured: number|null, sentChars: number, streamedChars: number}} input
 *   `measured` is the last `turn.completed` input-token count, or null before
 *   any turn has completed. `sentChars` is what this turn's prompt carried;
 *   `streamedChars` is everything the engine has emitted back so far.
 *
 * @returns {{used: number, estimated: boolean}|null}
 *   `null` when there is nothing honest to show at all — no measurement and
 *   nothing sent yet — so the caller omits the segment rather than rendering a
 *   confident zero, which is the rule mapUsage already follows for absent
 *   payloads.
 *
 * The model of "context used" is the next turn's input: what the thread already
 * held, plus what this turn added on both sides. That is why a completed turn's
 * `input` is the right baseline — it already includes every earlier turn.
 */
export function projectContext({ measured, sentChars = 0, streamedChars = 0 }) {
    const baseline = Number.isFinite(measured) && measured >= 0 ? measured : null;
    const added = tokensForChars(sentChars) + tokensForChars(streamedChars);

    if (baseline === null) {
        // Nothing measured yet. Only worth showing once this turn has actually
        // sent something; before that there is no information at all.
        if (added === 0) return null;
        return { used: added, estimated: true };
    }

    if (added === 0) {
        // Between turns: the measured figure stands on its own.
        return { used: baseline, estimated: false };
    }

    return { used: baseline + added, estimated: true };
}
