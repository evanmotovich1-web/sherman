// Bracketed paste, folded into plain text.
//
// With mode 2004 armed (see mouse.js — it rides the same terminal-mode
// lifecycle), a terminal wraps every paste in ESC[200~ … ESC[201~. That wrap
// is the only thing standing between a multi-line paste and a submitted
// half-prompt: raw pastes arrive as keystrokes, and a chunk boundary landing
// exactly on a carriage return is Enter as far as any key handler can tell.
//
// The composer keeps one boolean of state — "a paste is open" — and runs each
// input chunk through foldPasteChunk. Between the markers, everything is
// text: carriage returns become buffer content, not submissions, and the
// markers themselves never render. A marker split across two chunks is not
// handled; terminals write the seven-byte sequence atomically, and guarding
// against a split would mean buffering every ESC that arrives.

export const PASTE_BEGIN = '\x1b[200~';
export const PASTE_END = '\x1b[201~';

/**
 * Fold one input chunk of a possibly-bracketed paste.
 *
 * @param {string} input the chunk as the key handler received it
 * @param {boolean} wasPasting whether a paste was open before this chunk
 * @returns {{text: string, pasting: boolean}} the chunk with markers removed,
 *   and whether a paste remains open after it
 */
export function foldPasteChunk(input, wasPasting) {
    const text = String(input ?? '');
    // The paste is open after this chunk if a begin marker arrived without a
    // later end marker — and an already-open paste stays open until an end
    // marker closes it.
    const begin = text.lastIndexOf(PASTE_BEGIN);
    const end = text.lastIndexOf(PASTE_END);
    const pasting = begin > end ? true : end > begin ? false : wasPasting;
    return {
        text: text.split(PASTE_BEGIN).join('').split(PASTE_END).join(''),
        pasting,
    };
}

/** Whether this chunk belongs to a bracketed paste at all. */
export function touchesPaste(input, wasPasting) {
    return wasPasting
        || (typeof input === 'string' && (input.includes(PASTE_BEGIN) || input.includes(PASTE_END)));
}
