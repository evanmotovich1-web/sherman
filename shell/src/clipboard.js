// Putting text on the operator's clipboard, and being honest about whether it
// landed.
//
// Two mechanisms exist, and they differ in the only way that matters here:
//
//   pbcopy   a real process. It exits 0 or it does not, and that exit code is
//            evidence. macOS only.
//   OSC 52   an escape sequence handed to the terminal emulator. It survives
//            SSH, because the terminal doing the writing is the one the human
//            is looking at. It is WRITE-ONLY: there is no reply, no
//            acknowledgement, and no way to read the clipboard back. A terminal
//            that does not implement it, or that has clipboard writes disabled
//            by policy, consumes the sequence in complete silence.
//
// So this module never returns a bare boolean. It returns which mechanism ran
// and whether that mechanism can produce evidence, and it is the CALLER's job
// to choose words that match. A `confirmed:false` result must never be
// announced as a copy that happened — the terminal may have dropped it on the
// floor and told nobody.
//
// Probed on Evan's machine before this was written: Ghostty 1.3.1, local, no
// SSH. pbcopy is at /usr/bin/pbcopy, exits 0, and a pbpaste round-trip returns
// the exact sentinel written. The OSC 52 path could NOT be probed from the
// agent's sandbox — /dev/tty was not writable there — which is precisely why
// its wording claims nothing.

import { spawnSync } from 'node:child_process';

/**
 * Terminals bound the OSC 52 payload; xterm's documented ceiling is roughly
 * 100k of base64 and several emulators are stricter. A sequence over the limit
 * is not truncated by the terminal in a way anyone can detect — it is dropped,
 * or worse, partially applied. Refusing above a conservative bound is the only
 * behaviour that cannot silently put HALF a reply on the clipboard and call it
 * a copy.
 */
export const OSC52_MAX_BASE64 = 74994;

/** `ESC ] 52 ; c ; <base64> BEL` — the `c` selects the system clipboard. */
export function osc52Sequence(text) {
    const payload = Buffer.from(text, 'utf8').toString('base64');
    if (payload.length > OSC52_MAX_BASE64) return null;
    return `\x1b]52;c;${payload}\x07`;
}

/**
 * Copy `text`, preferring the mechanism that can prove it worked.
 *
 * @returns {{
 *   ok: boolean,
 *   method: 'pbcopy'|'osc52'|null,
 *   confirmed: boolean,
 *   reason: string|null,
 * }}
 *
 * `confirmed` is true only when a mechanism returned real evidence of success.
 * `ok && !confirmed` means "attempted, unverifiable" and nothing stronger.
 *
 * Injectable seams (`run`, `stdout`) exist so the tests can drive both the
 * evidenced and the unverifiable branch without touching the real clipboard.
 */
export function copyText(text, { run = spawnSync, stdout = process.stdout } = {}) {
    if (typeof text !== 'string' || text.length === 0) {
        return { ok: false, method: null, confirmed: false, reason: 'nothing to copy' };
    }

    // pbcopy first, wherever it exists: an exit code is worth more than a
    // sequence nobody answers.
    let pbcopyReason = null;
    try {
        const result = run('pbcopy', [], { input: text });
        if (result && !result.error && result.status === 0) {
            return { ok: true, method: 'pbcopy', confirmed: true, reason: null };
        }
        pbcopyReason = result?.error
            ? `pbcopy ${result.error.code ?? 'failed'}`
            : `pbcopy exited ${result?.status ?? 'abnormally'}`;
    } catch (error) {
        pbcopyReason = `pbcopy ${error?.code ?? 'failed'}`;
    }

    // No usable pbcopy. OSC 52 reaches the terminal the human is actually
    // looking at, including across SSH — but only if there is a terminal there
    // at all. Off a TTY the sequence would go into a pipe or a log file, which
    // is not a clipboard by any definition.
    if (!stdout?.isTTY) {
        return {
            ok: false,
            method: null,
            confirmed: false,
            reason: `${pbcopyReason}, and stdout is not a terminal`,
        };
    }

    const sequence = osc52Sequence(text);
    if (sequence === null) {
        return {
            ok: false,
            method: null,
            confirmed: false,
            reason: `${pbcopyReason}, and the reply is too large for an OSC 52 clipboard write`,
        };
    }

    try {
        stdout.write(sequence);
    } catch (error) {
        return {
            ok: false,
            method: null,
            confirmed: false,
            reason: `${pbcopyReason}, and the terminal write failed (${error?.code ?? 'unknown'})`,
        };
    }

    return { ok: true, method: 'osc52', confirmed: false, reason: null };
}

/**
 * The line the shell prints for a copy result.
 *
 * This function is the honesty contract, in one place, so that no call site can
 * drift into asserting more than its mechanism earned:
 *
 *   confirmed   "Copied…"          a process exited 0
 *   attempted   "Sent…not confirm" a sequence went out and nothing came back
 *   failed      "Copy unavailable" said plainly, because that is a real outcome
 *
 * The middle case is the one worth guarding. It deliberately does not contain
 * the word "copied" in the past tense about the clipboard, because a reader
 * skimming for that word is exactly who a hedge fails.
 */
export function copyNotice(result, lineCount) {
    const lines = `${lineCount} line${lineCount === 1 ? '' : 's'}`;

    if (result.ok && result.confirmed) {
        return `Copied the last reply to the clipboard (${lines}).`;
    }
    if (result.ok && result.method === 'osc52') {
        return `Sent the last reply (${lines}) to the terminal's clipboard. `
            + 'The terminal does not answer clipboard writes, so Sherman cannot confirm it landed — '
            + 'paste to check.';
    }
    return `Copy unavailable: ${result.reason ?? 'no clipboard mechanism is available'}.`;
}

/**
 * The most recent Sherman reply, as the plain text it was built from.
 *
 * Taken from the transcript item's source `text`, never from rendered rows.
 * The rendering carries a signature line, a rule glyph on every row, ANSI
 * colour, and hard wraps at the terminal's current width — none of which the
 * operator asked for and all of which would have to be stripped back off, at
 * which point the wraps are unrecoverable. The source string is what was said.
 */
export function lastReplyText(items) {
    if (!Array.isArray(items)) return null;
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item?.kind !== 'message' && item?.kind !== 'worker-message') continue;
        return typeof item.text === 'string' && item.text.length > 0 ? item.text : null;
    }
    return null;
}
