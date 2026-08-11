// The full-width input bar.
//
// Hand-rolled on useInput (D11): Ink 7 ships no text input, and ink-text-input
// only claims `ink>=5`. This is the whole editor, and it is short enough that
// taking an unverified dependency for it would be the worse trade.
//
// Ctrl+C is deliberately NOT handled here. It belongs to the app, because the
// two-stage contract (abort turn, then exit) depends on turn state this component
// does not own. Splitting that across two components is how the contract breaks.

import React, { useEffect, useRef, useState } from 'react';
import { Text, Box, useBoxMetrics, useInput, useWindowSize } from 'ink';

import { color } from './theme.js';
import { caretForClick, isMouseSequence } from './mouse.js';
import { foldPasteChunk, touchesPaste } from './paste.js';
import { CommandMenu } from './CommandMenu.js';
import { commandFor, suggestionsFor, typedSkillName } from '../commands.js';

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
 * @param {{onSubmit: (text: string) => void, busy: boolean, steering?: boolean, columns?: number, initialValue?: string, click?: {column: number, row: number, seq: number} | null}} props
 *
 * `busy` blocks the composer outright — a pending choice owns the keyboard.
 * `steering` is the running-turn state: the input stays live so the operator
 * can type a mid-work note, and Enter hands it to onSubmit, which queues it
 * for the turn boundary rather than starting a second turn. The command menu
 * sleeps while steering, because commands cannot run mid-turn.
 *
 * `click` is the most recent mouse press the shell saw, forwarded verbatim.
 * The composer maps it itself rather than being told where its caret should go,
 * because the composer is the only thing that knows where the composer is: the
 * row it occupies moves with the command palette, the busy state, and the
 * terminal height, and a caller guessing at that would be guessing.
 */
export function Composer({ onSubmit, busy, steering = false, columns, initialValue = '', click = null, skills = [] }) {
    const [value, setValue] = useState(initialValue);
    // Where the next character goes. Kept at the end of the text at all times
    // except when a click has moved it, so a keyboard-only session behaves
    // exactly as it did before the caret existed.
    const [caret, setCaret] = useState(initialValue.length);
    const [selected, setSelected] = useState(0);
    const [menuDismissed, setMenuDismissed] = useState(false);
    const size = useWindowSize();
    const width = Math.max(1, typeof columns === 'number' ? columns : size.columns);
    const suggestions = menuDismissed || steering ? [] : suggestionsFor(value, skills);
    // A typed value that names a loaded skill inks the whole entry purple —
    // the composer-side echo of the palette's skill rows, so the operator sees
    // which contract Enter is about to invoke before pressing it.
    const skillTyped = typedSkillName(value, skills);
    const valueInk = skillTyped ? color.secondary : undefined;


    useEffect(() => {
        setSelected((current) => Math.min(current, Math.max(0, suggestions.length - 1)));
    }, [suggestions.length]);


    // Every path that replaces the whole value puts the caret at the end of the
    // new text — completing a command, clearing after submit. Only editing at
    // the caret and clicking move it anywhere else.
    const changeValue = (next) => {
        setValue((current) => {
            const resolved = typeof next === 'function' ? next(current) : next;
            setCaret(resolved.length);
            return resolved;
        });
        setSelected(0);
        setMenuDismissed(false);
    };

    const editAtCaret = (edit) => {
        setValue((current) => {
            const at = Math.max(0, Math.min(caret, current.length));
            const { text, caret: nextCaret } = edit(current, at);
            setCaret(Math.max(0, Math.min(text.length, nextCaret)));
            return text;
        });
        setSelected(0);
        setMenuDismissed(false);
    };

    const completeSelected = () => {
        const command = suggestions[selected];
        if (!command) return false;
        changeValue(`/${command.name} `);
        return true;
    };

    // Whether a bracketed paste is open across input chunks. A ref, not
    // state: it must be read and written inside the same key event, and a
    // paste's chunks can all arrive within one render.
    const pastingRef = useRef(false);

    useInput(
        (input, key) => {
            // Let the app's handler own Ctrl+C. Returning early matters: without
            // it the 'c' would also be typed into the buffer.
            if (key.ctrl && input === 'c') return;

            // Everything inside a bracketed paste is text, before any key
            // means anything: the terminal's ESC[200~/201~ wrap (armed in
            // mouse.js) is what marks it, and a carriage return in here is
            // pasted content — it inserts a newline and must never submit,
            // even when a chunk boundary leaves it standing alone as what
            // any handler below would read as Enter.
            if (touchesPaste(input, pastingRef.current)) {
                const folded = foldPasteChunk(input, pastingRef.current);
                pastingRef.current = folded.pasting;
                const clean = normalizeInput(folded.text);
                if (clean) {
                    editAtCaret((current, at) => ({
                        text: current.slice(0, at) + clean + current.slice(at),
                        caret: at + clean.length,
                    }));
                }
                return;
            }

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
                // A fully-typed name — command or skill — submits; only a
                // fragment completes. Without the skill check, Enter on a
                // typed "/seed" would re-complete it into itself forever.
                if (
                    suggestions.length > 0
                    && !commandFor(commandName)
                    && !typedSkillName(`/${commandName}`, skills)
                    && completeSelected()
                ) {
                    return;
                }
                if (text.length > 0) {
                    changeValue('');
                    onSubmit(text);
                }
                return;
            }

            if (key.backspace || key.delete) {
                editAtCaret((current, at) => ({
                    text: current.slice(0, Math.max(0, at - 1)) + current.slice(at),
                    caret: at - 1,
                }));
                return;
            }

            // Ignore the remaining control keys rather than letting their escape
            // sequences land in the buffer as mojibake.
            if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;
            if (key.tab || key.escape || key.pageUp || key.pageDown) return;
            if (key.ctrl || key.meta) return;

            // Pasting a multi-line block then pressing Enter is the intended
            // flow; a pasted newline deliberately does not auto-send.
            // Mouse reports reach this handler as ordinary input on a terminal
            // that sends them. Dropping them here is what keeps `\x1b[<0;12;34M`
            // out of the buffer; on a terminal that never sends one, the guard
            // never fires and not a single keystroke is handled differently.
            if (isMouseSequence(input)) return;

            const clean = input ? normalizeInput(input) : '';
            if (clean) {
                editAtCaret((current, at) => ({
                    text: current.slice(0, at) + clean + current.slice(at),
                    caret: at + clean.length,
                }));
            }
        },
        // Only a pending choice deafens the composer — its arrow keys belong
        // to the ChoiceBox. While a turn is in flight the composer stays LIVE:
        // what used to be dropped keystrokes is now steering, queued by submit
        // for the turn boundary, so typing mid-turn is never lost and never
        // interrupts.
        { isActive: !busy }
    );

    // ------------------------------------------------------------- geometry --
    // Where the composer actually is on screen. `useBoxMetrics` reports the
    // outer box's position relative to its parent, and its parent IS the app's
    // root box, so `top` is an absolute screen row. The prompt is always the
    // last content row of that box — the content column is bottom-anchored and
    // the bottom border is the final row — so its 0-based index is
    // `top + height - 2`, derived from the measurement rather than from a guess
    // about how tall the palette happens to be. Terminals report mouse rows
    // 1-based, so the value kept here is that index plus one, in the terminal's
    // own units; converting once, here, is what stops an off-by-one from being
    // rediscovered at every comparison.
    //
    // Horizontally: border (1) + paddingX (1) + the '❯ ' gutter (2) = column 4,
    // and 2 in the unframed narrow fallback which has neither border nor
    // padding.
    const outerRef = useRef(null);
    const outer = useBoxMetrics(outerRef);
    const framed = width >= 10;
    const textRow = outer.hasMeasured ? outer.top + outer.height - (framed ? 1 : 0) : null;
    const textColumn = framed ? 4 : 2;

    // A click anywhere on that row places the caret; a click anywhere else is
    // ignored, because there is nothing else here to click. `seq` is what makes
    // two clicks at the same spot two events rather than one.
    useEffect(() => {
        if (!click || textRow === null || busy) return;
        const at = caretForClick({
            column: click.column,
            row: click.row,
            textRow,
            textColumn,
            length: value.length,
        });
        if (at !== null) setCaret(at);
        // `value.length` is deliberately absent: a click acts on the text that
        // was under the pointer, and re-running when the text changes later
        // would move the caret for a click the user already finished making.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [click?.seq, textRow, textColumn, busy]);

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
            Box,
            { ref: outerRef, flexShrink: 0 },
            React.createElement(
            Text,
            { color: color.promptLive, wrap: 'truncate' },
            // Same gutter as inside the box (Hermes' '❯' plus one space), so
            // the fallback reads as the same prompt, just unframed. The node
            // truncates, so the extra cell is safe at any width.
            busy ? '…' : `❯ ${value}`
            )
        );
    }

    // Same two strings as before, re-derived from the new text room. The long
    // placeholder is 29 cells and used to appear at width 34 (room = 34-5);
    // the short one is 21 cells and appeared at width 26. Text room is now
    // width - 7 rather than width - 5, so both thresholds move up by 2.
    const placeholder = width >= 36
        ? 'Ask about company operations…'
        : width >= 28 ? 'Ask about operations…' : '';
    // The steering placeholder keeps the literal words "Ctrl+C to interrupt"
    // at every width that shows one: that phrase is the running-turn marker
    // the operator (and the scrollback tests) recognize, and steering must
    // not hide the interrupt it is the alternative to.
    const steerPlaceholder = width >= 68
        ? 'steer Sherman while it works · Enter queues · Ctrl+C to interrupt…'
        : width >= 28 ? 'Ctrl+C to interrupt…' : '';
    const hint = steering ? steerPlaceholder : placeholder;
    // Reserve one row for status and three for the bordered composer (top
    // border, one prompt row, bottom border). The palette owns only the
    // remainder, so suggestions can never evict the composer — and no more
    // than the height the twelve first-party commands always took, so the
    // skill list scrolls inside the same box instead of burying the
    // transcript under a palette as tall as the screen. Fifteen rows is that
    // exact height: header, twelve entries, two border rows.
    const menuRows = Math.max(0, Math.min(size.rows - 4, 15));

    return React.createElement(
        Box,
        { ref: outerRef, width, flexDirection: 'column', flexShrink: 0 },
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
                          value.length === 0 && hint
                              ? React.createElement(
                                    Text,
                                    { color: color.muted, wrap: 'truncate' },
                                    hint
                                )
                              // At the end of the text — which is where it sits
                              // unless a click moved it — this is the same two
                              // nodes the composer always rendered, so a
                              // keyboard-only frame is byte-identical. Inside
                              // the text, the block moves onto the character it
                              // is in front of and the tail follows it.
                              : caret >= value.length
                                  ? React.createElement(Text, { color: valueInk }, value)
                                  : React.createElement(
                                        Text,
                                        { color: valueInk },
                                        value.slice(0, caret),
                                        React.createElement(
                                            Text,
                                            { color: color.accent, inverse: true },
                                            value.slice(caret, caret + 1)
                                        ),
                                        value.slice(caret + 1)
                                    ),
                          caret >= value.length || (value.length === 0 && hint)
                              ? React.createElement(Text, { color: color.accent, inverse: true }, ' ')
                              : null
                      ),
                  ])
            )
        )
    );
}
