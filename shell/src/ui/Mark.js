// The three-circle mark, redrawn as half-block pixel art.
//
// Same identity as logo/banner.ans — a small solid pink dot, a purple ring, a
// larger blue ring, stacked with air between them — but rendered at double
// vertical resolution. Each character cell holds two pixels: `▀` paints the top
// half with the foreground and the bottom half with the background, so one row
// of text carries two rows of image. That is what lets the rings keep visibly
// hollow centres and round shoulders inside a panel-sized budget; the previous
// full-block draw fused the three shapes into one blob at this size.
//
// The art is authored as a pixel grid, not as glyph strings. Glyphs are derived
// at render time from vertical pixel pairs, which is the only way `▀`/`▄`/`█`
// and the per-cell colour pairs can never disagree with each other.

import React from 'react';
import { Text, Box } from 'ink';

import { markRamp } from './theme.js';

// One letter per palette stop, so the grid below stays readable as a picture.
// Each shape runs its own small top-to-bottom gradient (see theme.markRamp);
// `.` is transparent terminal background.
const INK = {
    p: markRamp.dot.top,
    P: markRamp.dot.mid,
    m: markRamp.dot.low,
    v: markRamp.inner.top,
    V: markRamp.inner.mid,
    u: markRamp.inner.low,
    b: markRamp.outer.top,
    B: markRamp.outer.mid,
    C: markRamp.outer.low,
};

// 12 pixels wide, 22 pixels tall: dot (4), gap (2), inner ring (6), gap (2),
// outer ring (8). Two blank pixel rows per gap is one full character row of
// air, which is what makes the shapes read as three, not one.
//
// Every row must be exactly the same width and the row count must stay even —
// rows are consumed in vertical pairs.
const GRID = [
    '.....pp.....',
    '....PPPP....',
    '....PPPP....',
    '.....mm.....',
    '............',
    '............',
    '....vvvv....',
    '...VVVVVV...',
    '..VV....VV..',
    '..VV....VV..',
    '...uuuuuu...',
    '....uuuu....',
    '............',
    '............',
    '...bbbbbb...',
    '.BBBBBBBBBB.',
    'BBB......BBB',
    'BB........BB',
    'BB........BB',
    'CCC......CCC',
    '.CCCCCCCCCC.',
    '...CCCCCC...',
];

/** Measured from the art, not estimated. The panel column is sized against these. */
export const MARK_COLUMNS = GRID[0].length;
export const MARK_ROWS = Math.ceil(GRID.length / 2);

/**
 * Collapse one vertical pixel pair into styled runs.
 *
 * Per cell: both pixels empty is a space; top-only is `▀`; bottom-only is `▄`;
 * both in the same colour is `█`; and two different colours is `▀` with the
 * bottom pixel carried by the background — the case that doubles the vertical
 * resolution. Adjacent cells with identical styling merge into one run so a
 * row is a handful of <Text> spans rather than twelve.
 */
function spans(top, bottom) {
    const out = [];
    for (let x = 0; x < top.length; x++) {
        const t = INK[top[x]] ?? null;
        const b = INK[bottom[x]] ?? null;

        let ch;
        let fg = null;
        let bg = null;
        if (t === null && b === null) {
            ch = ' ';
        } else if (b === null) {
            ch = '▀';
            fg = t;
        } else if (t === null) {
            ch = '▄';
            fg = b;
        } else if (t === b) {
            ch = '█';
            fg = t;
        } else {
            ch = '▀';
            fg = t;
            bg = b;
        }

        const prev = out[out.length - 1];
        if (prev && prev.fg === fg && prev.bg === bg) {
            prev.text += ch;
        } else {
            out.push({ text: ch, fg, bg });
        }
    }
    return out;
}

// Truncate-wrapped for the same reason as the wordmark: pixel rows that wrap
// shatter into garbage, so on an impossibly narrow terminal they cut instead.
function Row({ runs }) {
    return React.createElement(
        Text,
        { wrap: 'truncate' },
        ...runs.map((run, i) =>
            run.fg === null
                ? run.text
                : React.createElement(
                      Text,
                      {
                          key: i,
                          color: run.fg,
                          backgroundColor: run.bg ?? undefined,
                      },
                      run.text
                  )
        )
    );
}

/** 12 x 11. Pink dot, purple ring, blue ring, top to bottom, with gaps. */
export function Mark() {
    const rows = [];
    for (let y = 0; y < GRID.length; y += 2) {
        rows.push(spans(GRID[y], GRID[y + 1] ?? '.'.repeat(GRID[y].length)));
    }

    return React.createElement(
        Box,
        { flexDirection: 'column' },
        ...rows.map((runs, i) => React.createElement(Row, { key: i, runs }))
    );
}
