// One file change, rendered as the lines that actually changed.
//
// Everything here is drawn from a `diff` engine event, and that event is built
// by reading the file on both sides of the write (see engine/filediff.js). The
// codex stream itself carries only a path and an edit kind — no line content
// and no patch — so this component has exactly two honest modes:
//
//   available:true   the +/- rows below were read from the file, and are shown
//   available:false  the path and the FACT of the change are shown, plus a
//                    plain statement that line detail is unavailable
//
// There is no third mode. This component never reconstructs, guesses at, or
// stylistically improves a line, because a diff that looks right and is wrong
// is worse than no diff at all.

import React from 'react';
import { Box, Text } from 'ink';

import { color } from './theme.js';
import { safeTerminalText } from './sanitize.js';

/** The edit kinds codex reports, as the header's verb. */
const KIND_WORD = { add: 'Create', update: 'Update', delete: 'Delete' };

/**
 * @param {{diff: {path:string, changeKind:string, available:boolean, reason:string|null,
 *                 added:number, removed:number,
 *                 lines:Array<{sign:'+'|'-', text:string}>, more:number}}} props
 */
export function Diff({ diff }) {
    if (!diff || typeof diff !== 'object') return null;

    const word = KIND_WORD[diff.changeKind] ?? 'Update';
    const path = safeTerminalText(diff.path ?? '');

    // The header carries the verb and the counts so a truncated hunk still
    // reports the true size of the change — `Update path  +3 -1`, the
    // reference register, with the counts inked like the lines they count.
    const rows = [
        React.createElement(
            Text,
            { key: 'head', wrap: 'truncate' },
            React.createElement(Text, { color: color.tertiary }, '  ┊ '),
            React.createElement(Text, { color: color.accent, bold: true }, word),
            React.createElement(Text, { color: color.value }, ` ${path}`),
            diff.available
                ? React.createElement(Text, { color: color.diffAdded }, `  +${diff.added}`)
                : null,
            diff.available
                ? React.createElement(Text, { color: color.diffRemoved }, ` -${diff.removed}`)
                : null
        ),
    ];

    if (!diff.available) {
        rows.push(
            React.createElement(
                Text,
                { key: 'unavailable', color: color.muted, wrap: 'truncate' },
                `  ┊   line detail unavailable${diff.reason ? ` (${safeTerminalText(diff.reason)})` : ''}`
            )
        );
        return column(rows);
    }

    for (const [index, line] of (diff.lines ?? []).entries()) {
        const added = line.sign === '+';
        rows.push(
            React.createElement(
                Text,
                {
                    key: `l${index}`,
                    color: added ? color.diffAdded : color.diffRemoved,
                    wrap: 'truncate',
                },
                `  ┊ ${added ? '+' : '-'} ${safeTerminalText(line.text)}`
            )
        );
    }

    // Truncation is stated, never silent: a hunk that just stopped would read as
    // a smaller change than the one that happened.
    if (diff.more > 0) {
        rows.push(
            React.createElement(
                Text,
                { key: 'more', color: color.muted, wrap: 'truncate' },
                `  ┊   +${diff.more} more lines`
            )
        );
    }

    return column(rows);
}

/** Diff rows are siblings in a column; Yoga wants one parent, not a bare array. */
function column(rows) {
    return React.createElement(Box, { flexDirection: 'column' }, ...rows);
}
