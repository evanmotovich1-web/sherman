// The three-circle mark, compacted for the info panel's left column.
//
// Same identity as logo/banner.ans — a small solid pink dot, a purple ring, a
// larger blue ring — but redrawn to a budget. The banner version is 12 rows tall
// with blank rows between the shapes; inside a bordered box it would push the
// panel past a comfortable height on its own.
//
// The gaps come out, the shapes tighten to 8 rows, and the edges are traced with
// half-blocks (▄ ▀) instead of full ones. That last part is where the "higher
// fidelity" comes from: a half-block turns a stepped corner into a bevelled one
// at no extra rows, so the rings read as round rather than octagonal.

import React from 'react';
import { Text, Box } from 'ink';

import { color } from './theme.js';

/** Widest shape below. The column is sized against this. */
export const MARK_COLUMNS = 10;
export const MARK_ROWS = 8;

// Drawn at natural width, centred at render time — hand-padding these strings is
// how a one-column drift creeps in and nobody notices the mark sits off-axis.
const DOT = [
    '▄██▄',
    '▀██▀',
];

const RING_INNER = [
    ' ▄████▄',
    '██▀  ▀██',
    ' ▀████▀',
];

const RING_OUTER = [
    ' ▄██████▄',
    '███▄  ▄███',
    ' ▀██████▀',
];

/** Centre a line in the mark's column, biased left on an odd remainder. */
function centre(line) {
    const pad = Math.max(0, Math.floor((MARK_COLUMNS - [...line].length) / 2));
    return ' '.repeat(pad) + line;
}

function Shape({ lines, tint }) {
    return React.createElement(
        React.Fragment,
        null,
        ...lines.map((line, i) =>
            React.createElement(
                Text,
                { key: i, color: tint, wrap: 'truncate' },
                centre(line)
            )
        )
    );
}

/**
 * 10 x 8. Colours are the house mark's, unchanged: pink dot, purple ring,
 * blue ring, top to bottom.
 */
export function Mark() {
    return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(Shape, { key: 'dot', lines: DOT, tint: color.markTop }),
        React.createElement(Shape, { key: 'inner', lines: RING_INNER, tint: color.markMid }),
        React.createElement(Shape, { key: 'outer', lines: RING_OUTER, tint: color.markBottom })
    );
}
