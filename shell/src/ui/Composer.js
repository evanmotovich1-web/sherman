// The full-width input bar.
//
// Hand-rolled on useInput (D11): Ink 7 ships no text input, and ink-text-input
// only claims `ink>=5`. This is the whole editor, and it is short enough that
// taking an unverified dependency for it would be the worse trade.
//
// Ctrl+C is deliberately NOT handled here. It belongs to the app, because the
// two-stage contract (abort turn, then exit) depends on turn state this component
// does not own. Splitting that across two components is how the contract breaks.

import React, { useEffect, useState } from 'react';
import { Text, Box, useInput, useWindowSize } from 'ink';

import { color } from './theme.js';
import { CommandMenu } from './CommandMenu.js';
import { commandFor, suggestionsFor } from '../commands.js';

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
 * @param {{onSubmit: (text: string) => void, busy: boolean, columns?: number, initialValue?: string}} props
 */
export function Composer({ onSubmit, busy, columns, initialValue = '' }) {
    const [value, setValue] = useState(initialValue);
    const [selected, setSelected] = useState(0);
    const [menuDismissed, setMenuDismissed] = useState(false);
    const size = useWindowSize();
    const width = Math.max(1, typeof columns === 'number' ? columns : size.columns);
    const suggestions = menuDismissed ? [] : suggestionsFor(value);


    useEffect(() => {
        setSelected((current) => Math.min(current, Math.max(0, suggestions.length - 1)));
    }, [suggestions.length]);


    const changeValue = (next) => {
        setValue((current) => (typeof next === 'function' ? next(current) : next));
        setSelected(0);
        setMenuDismissed(false);
    };

    const completeSelected = () => {
        const command = suggestions[selected];
        if (!command) return false;
        changeValue(`/${command.name} `);
        return true;
    };

    useInput(
        (input, key) => {
            // Let the app's handler own Ctrl+C. Returning early matters: without
            // it the 'c' would also be typed into the buffer.
            if (key.ctrl && input === 'c') return;

            if (key.escape && suggestions.length > 0) {
                setMenuDismissed(true);
                return;
            }
            if (key.upArrow && suggestions.length > 0) {
                setSelected((current) =>
                    (current - 1 + suggestions.length) % suggestions.length
                );
                return;
            }
            if (key.downArrow && suggestions.length > 0) {
                setSelected((current) => (current + 1) % suggestions.length);
                return;
            }
            if (key.tab && suggestions.length > 0) {
                completeSelected();
                return;
            }

            if (key.return) {
                const text = value.trim();
                const commandName = text.startsWith('/')
                    ? text.slice(1).split(/\s/, 1)[0].toLowerCase()
                    : '';
                if (suggestions.length > 0 && !commandFor(commandName) && completeSelected()) {
                    return;
                }
                if (text.length > 0) {
                    changeValue('');
                    onSubmit(text);
                }
                return;
            }

            if (key.backspace || key.delete) {
                changeValue((current) => current.slice(0, -1));
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
            if (clean) changeValue((current) => current + clean);
        },
        // While a turn is in flight the composer stops listening entirely, so a
        // user cannot queue a second turn the engine has no way to accept.
        { isActive: !busy }
    );

    // Width budget for the bordered box:
    //   border      2 columns (│ … │)
    //   paddingX: 1 2 columns
    //   => inner content width = width - 4
    // The prompt gutter is Hermes' '❯' + COMPOSER_PROMPT_GAP_WIDTH (1) = 2
    // cells, and the block cursor is 1 more, so text room = width - 7.
    //
    // The old bare-text layout had paddingX: 1 only, i.e. inner = width - 2,
    // and refused to draw below width 8 (inner 6). Preserving that same
    // minimum inner width of 6 through a border costs two more columns, so
    // the box cannot be drawn below width 10.
    if (width < 10) {
        return React.createElement(
            Text,
            { color: color.promptLive, wrap: 'truncate' },
            // Same gutter as inside the box (Hermes' '❯' plus one space), so
            // the fallback reads as the same prompt, just unframed. The node
            // truncates, so the extra cell is safe at any width.
            busy ? '…' : `❯ ${value}`
        );
    }

    // Same two strings as before, re-derived from the new text room. The long
    // placeholder is 29 cells and used to appear at width 34 (room = 34-5);
    // the short one is 21 cells and appeared at width 26. Text room is now
    // width - 7 rather than width - 5, so both thresholds move up by 2.
    const placeholder = width >= 36
        ? 'Ask about company operations…'
        : width >= 28 ? 'Ask about operations…' : '';
    // Reserve one row for status and three for the bordered composer (top
    // border, one prompt row, bottom border). The palette owns only the
    // remainder, so suggestions can never evict the composer.
    const menuRows = Math.max(0, size.rows - 4);

    return React.createElement(
        Box,
        { width, flexDirection: 'column', flexShrink: 0 },
        React.createElement(CommandMenu, {
            commands: suggestions,
            selected,
            width,
            maxRows: menuRows,
        }),
        React.createElement(
            Box,
            {
                width,
                borderStyle: 'round',
                borderColor: color.frame,
                paddingX: 1,
                flexDirection: 'column',
                flexShrink: 0,
            },
            React.createElement(
            Box,
            {
                flexDirection: 'column',
                flexShrink: 0,
                // Hermes-sized at rest: one prompt row. Pasted input may use
                // every row not reserved for Thinking's worst-case three rows
                // and StatusBar's one row, then clips at the top. The border
                // adds two rows of its own, so the content budget that used to
                // be rows - 4 for the whole composer is rows - 6 here and the
                // bordered box still totals rows - 4.
                maxHeight: Math.max(1, size.rows - 6),
                overflowY: 'hidden',
                justifyContent: 'flex-end',
            },
            ...(busy
                ? [
                      React.createElement(
                          Text,
                          { key: 'busy', wrap: 'truncate' },
                          React.createElement(Text, { color: color.muted }, '❯ '),
                          React.createElement(Text, { color: color.muted }, 'Ctrl+C to interrupt…')
                      ),
                  ]
                : [
                      React.createElement(
                          Box,
                          {
                              key: 'input',
                              flexDirection: 'row',
                              alignItems: 'flex-end',
                              flexShrink: 0,
                          },
                          React.createElement(Text, { color: color.promptLive, bold: true }, '❯ '),
                          value.length === 0 && placeholder
                              ? React.createElement(
                                    Text,
                                    { color: color.muted, wrap: 'truncate' },
                                    placeholder
                                )
                              : React.createElement(Text, null, value),
                          React.createElement(Text, { color: color.accent, inverse: true }, ' ')
                      ),
                  ])
            )
        )
    );
}
