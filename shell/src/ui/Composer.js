// The input line.
//
// Hand-rolled on useInput (D11): Ink 7 ships no text input, and ink-text-input
// only claims `ink>=5`. This is the whole editor, and it is short enough that
// taking an unverified dependency for it would be the worse trade.
//
// Ctrl+C is deliberately NOT handled here. It belongs to the app, because the
// two-stage contract (abort turn, then exit) depends on turn state this component
// does not own. Splitting that across two components is how the contract breaks.

import React, { useState } from 'react';
import { Text, Box, useInput } from 'ink';

import { color } from './theme.js';

// C0 controls plus DEL. A single keystroke never contains these, but a PASTE
// arrives as one bulk chunk and can carry CR/LF, which would otherwise land in
// the prompt and be sent to the engine verbatim.
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

/**
 * @param {{onSubmit: (text: string) => void, busy: boolean}} props
 */
export function Composer({ onSubmit, busy }) {
    const [value, setValue] = useState('');

    useInput(
        (input, key) => {
            // Let the app's handler own Ctrl+C. Returning early matters: without
            // it the 'c' would also be typed into the buffer.
            if (key.ctrl && input === 'c') return;

            if (key.return) {
                const text = value.trim();
                if (text.length > 0) {
                    setValue('');
                    onSubmit(text);
                }
                return;
            }

            if (key.backspace || key.delete) {
                setValue((v) => v.slice(0, -1));
                return;
            }

            // Ignore the remaining control keys rather than letting their escape
            // sequences land in the buffer as mojibake.
            if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;
            if (key.tab || key.escape || key.pageUp || key.pageDown) return;
            if (key.ctrl || key.meta) return;

            // Pasting a multi-line block then pressing Enter is the intended
            // flow; a pasted newline deliberately does not auto-send.
            const clean = input ? input.replace(CONTROL_CHARS, '') : '';
            if (clean) setValue((v) => v + clean);
        },
        // While a turn is in flight the composer stops listening entirely, so a
        // user cannot queue a second turn the engine has no way to accept.
        { isActive: !busy }
    );

    if (busy) {
        // Keep a row here even when inactive. Letting the line vanish makes the
        // whole UI jump every turn.
        return React.createElement(
            Box,
            null,
            React.createElement(Text, { dimColor: true }, '  … working, Ctrl+C to interrupt')
        );
    }

    return React.createElement(
        Box,
        null,
        React.createElement(Text, { color: color.accent, bold: true }, '› '),
        React.createElement(Text, null, value),
        // Our own caret. Ink's useCursor is for IME positioning, not a text caret.
        React.createElement(Text, { inverse: true }, ' ')
    );
}
