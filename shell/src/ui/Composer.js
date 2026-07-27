// The full-width input bar.
//
// Hand-rolled on useInput (D11): Ink 7 ships no text input, and ink-text-input
// only claims `ink>=5`. This is the whole editor, and it is short enough that
// taking an unverified dependency for it would be the worse trade.
//
// Ctrl+C is deliberately NOT handled here. It belongs to the app, because the
// two-stage contract (abort turn, then exit) depends on turn state this component
// does not own. Splitting that across two components is how the contract breaks.

import React, { useState } from 'react';
import { Text, Box, useInput, useWindowSize } from 'ink';

import { color } from './theme.js';

// Preserve pasted line breaks so a multi-line prompt remains visibly multi-line
// inside the field. Strip every other C0 control plus DEL; those escape/control
// bytes would otherwise render as mojibake or damage the border.
const CONTROL_CHARS_EXCEPT_LF = /[\x00-\x09\x0b-\x1f\x7f]/g;

function normalizeInput(input) {
    return input
        .replace(/\r\n?/g, '\n')
        .replace(CONTROL_CHARS_EXCEPT_LF, '');
}

/**
 * @param {{onSubmit: (text: string) => void, busy: boolean, columns?: number}} props
 */
export function Composer({ onSubmit, busy, columns }) {
    const [value, setValue] = useState('');
    const measured = useWindowSize().columns;
    const width = Math.max(1, typeof columns === 'number' ? columns : measured);

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
            const clean = input ? normalizeInput(input) : '';
            if (clean) setValue((v) => v + clean);
        },
        // While a turn is in flight the composer stops listening entirely, so a
        // user cannot queue a second turn the engine has no way to accept.
        { isActive: !busy }
    );

    // Ink's rounded border cannot render below four columns. Keep the shell
    // usable without overflow; normal terminals always take the bordered path.
    if (width < 4) {
        return React.createElement(
            Text,
            { color: color.accent, wrap: 'truncate' },
            busy ? '…' : `›${value}`
        );
    }

    return React.createElement(
        Box,
        {
            width,
            borderStyle: 'round',
            borderColor: color.accent,
            paddingX: 1,
            flexDirection: 'row',
        },
        busy
            ? React.createElement(Text, { dimColor: true }, '… working, Ctrl+C to interrupt')
            : React.createElement(
                  React.Fragment,
                  null,
                  React.createElement(Text, { color: color.accent, bold: true }, '› '),
                  React.createElement(Text, null, value),
                  // Our own caret. Ink's useCursor is for IME positioning, not a text caret.
                  React.createElement(Text, { inverse: true }, ' ')
              )
    );
}
