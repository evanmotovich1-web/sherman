// Terminal mouse reporting: turning it on, turning it off, and reading it.
//
// Hermes has `lib/terminalModes.ts` for the same job, and the discipline is
// worth copying even though the code is not: modes you switch on are a debt to
// the terminal, and the terminal has no way to collect. A shell that exits with
// mouse reporting still enabled leaves every subsequent click in that window
// spraying `\e[<0;12;34M` into whatever prompt comes next. So the disable runs
// on EVERY exit path, exactly as the alternate-screen restore does, and it runs
// synchronously — a queued stream write does not survive `process.exit`.
//
// SGR 1006 is the only encoding used. The legacy X10 encoding packs the
// coordinates into single bytes and simply cannot address a column past 223,
// which on a modern terminal is a bug waiting for a wide window. 1006 reports
// decimal coordinates and distinguishes press from release, and every terminal
// that understands 1000 has understood 1006 for a decade.

import { writeSync } from 'node:fs';

const ESC = '\x1b';

// 1000: report button presses and releases, including the wheel, and nothing
// else. Deliberately NOT 1002 or 1003 — motion reporting would deliver a packet
// per cell the pointer crosses, and this shell has nothing that follows a
// pointer. 1006: encode those reports as SGR. Bracketed paste is intentionally
// separate: /select may turn mouse capture off, but paste safety must stay on.
export const MOUSE_ON = `${ESC}[?1000h${ESC}[?1006h`;
export const MOUSE_OFF = `${ESC}[?1006l${ESC}[?1000l`;
export const PASTE_ON = `${ESC}[?2004h`;
export const PASTE_OFF = `${ESC}[?2004l`;

// The signals Ink's own screen restore covers. A handler is registered for each
// so a mouse-mode reset happens before the process goes away, and each one
// re-raises the default behaviour afterwards rather than swallowing the signal.
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * Turn mouse reporting on for the life of the process, and guarantee it off.
 *
 * A no-op returning a no-op when stdout is not a TTY: piped runs (smoke, CI)
 * must stay byte-identical, and a terminal that is not there cannot be left in
 * a bad mode. The returned function disables immediately and detaches the
 * guards; calling it twice is safe, which matters because the normal path calls
 * it on unmount and the exit guard would otherwise call it again.
 */
export function enableMouse(stdout = process.stdout, { mouse = true } = {}) {
    if (!stdout || !stdout.isTTY) {
        const noop = () => {};
        noop.setMouse = () => {};
        return noop;
    }

    let pasteArmed = true;
    let mouseArmed = mouse;
    let closed = false;
    const write = (value, synchronous = false) => {
        try {
            // Exit/signal paths cannot trust a queued stream write to drain.
            // A live mode toggle can and must use the stream itself: that makes
            // the disable part of the terminal's ordered output rather than
            // bypassing Ink on descriptor 1 (which may not be this stdout).
            if (synchronous) writeSync(stdout.fd ?? 1, value);
            else stdout.write(value);
        } catch {
            // A closed or redirected descriptor at exit is not worth crashing
            // over; there is no terminal left to repair.
        }
    };

    const setMouse = (enabled) => {
        if (closed || enabled === mouseArmed) return;
        mouseArmed = enabled;
        write(enabled ? MOUSE_ON : MOUSE_OFF);
    };

    const off = (options = {}) => {
        if (closed) return;
        if (options?.paste === false) {
            setMouse(false);
            return;
        }
        closed = true;
        const value = `${mouseArmed ? MOUSE_OFF : ''}${pasteArmed ? PASTE_OFF : ''}`;
        mouseArmed = false;
        pasteArmed = false;
        if (value) write(value, options === true || options?.synchronous === true);
        detach();
    };
    off.setMouse = setMouse;

    const onExit = () => { off({ synchronous: true }); };
    const onSignal = (signal) => {
        off({ synchronous: true });
        process.kill(process.pid, signal);
    };
    const handlers = SIGNALS.map((signal) => [signal, () => onSignal(signal)]);

    function detach() {
        process.removeListener('exit', onExit);
        for (const [signal, handler] of handlers) {
            process.removeListener(signal, handler);
        }
    }

    process.on('exit', onExit);
    for (const [signal, handler] of handlers) process.on(signal, handler);

    try {
        stdout.write(`${PASTE_ON}${mouse ? MOUSE_ON : ''}`);
    } catch {
        off();
        const noop = () => {};
        noop.setMouse = () => {};
        return noop;
    }

    return off;
}

// `ESC [ < button ; column ; row (M|m)`, matched globally because a fast wheel
// delivers several packets in one read.
//
// The ESC is optional, and that is not sloppiness. `parseMouse` reads raw stdin
// chunks, where it is always present; `isMouseSequence` is handed what Ink's key
// parser produced, and Ink has already consumed the ESC as the introducer of an
// escape sequence it did not recognise. A guard that insisted on the ESC would
// pass every real report straight through into the composer, which is the exact
// bug it exists to prevent — observed, not theorised.
const SGR = /\x1b?\[<(\d+);(\d+);(\d+)([Mm])/g;

/** True if this chunk is nothing but mouse reports. */
export function isMouseSequence(input) {
    if (typeof input !== 'string' || input.length === 0) return false;
    SGR.lastIndex = 0;
    return input.replace(SGR, '').length === 0;
}

/**
 * Parse every SGR mouse report in a chunk.
 *
 * The button field is a bitfield: bits 0-1 are the button, bit 2 shift, bit 3
 * meta, bit 4 control, and bit 6 marks a wheel event, where button 0 is a
 * scroll up and button 1 a scroll down. `column` and `row` are 1-based, as the
 * terminal reports them; converting to 0-based is the caller's decision because
 * only the caller knows what it is indexing into.
 *
 * Releases are returned too, tagged, so a caller can choose. This shell acts on
 * press, which is what makes a click feel immediate rather than deferred to the
 * lift.
 */
export function parseMouse(input) {
    if (typeof input !== 'string') return [];
    const events = [];
    SGR.lastIndex = 0;
    let match;
    while ((match = SGR.exec(input)) !== null) {
        const button = Number(match[1]);
        const column = Number(match[2]);
        const row = Number(match[3]);
        const pressed = match[4] === 'M';

        if ((button & 64) !== 0) {
            // Wheel reports arrive only as presses; a release would be a second
            // notch that never happened.
            if (pressed) {
                events.push({ type: 'wheel', direction: (button & 3) === 0 ? 'up' : 'down', column, row });
            }
            continue;
        }

        events.push({
            type: pressed ? 'press' : 'release',
            button: button & 3,
            column,
            row,
        });
    }
    return events;
}

/**
 * Which caret position a click at `column` selects on a text row.
 *
 * `textColumn` is the 0-based screen column the text begins at. The result is
 * clamped to the text: a click in the prompt gutter lands at 0 and a click
 * anywhere in the empty space past the end lands at the end, which is what
 * makes clicking "after" a short line do the obvious thing rather than nothing.
 *
 * Returns null when the row is not the text row at all — callers use that to
 * ignore the click entirely rather than inventing a target for it.
 */
export function caretForClick({ column, row, textRow, textColumn, length }) {
    if (row !== textRow) return null;
    const at = (column - 1) - textColumn;
    return Math.max(0, Math.min(length, at));
}
