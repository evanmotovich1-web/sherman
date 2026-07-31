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

/**
 * Nearest-neighbour magnify the pixel grid by an integer factor.
 *
 * Hermes has no equivalent — its `branding.tsx` says outright that terminals
 * cannot scale glyphs, and its pet sprite is downscaled in Python before it
 * ever reaches the TUI. So a larger mark can only be a larger *grid*: each
 * pixel becomes an n x n block of the same pixel. That keeps the art identical
 * — same shapes, same ramp stops, same proportions — instead of redrawing it,
 * and it keeps the row count even, which `spans` requires.
 */
function magnify(grid, factor) {
    if (factor <= 1) return grid;
    const out = [];
    for (const row of grid) {
        let wide = '';
        for (const px of row) wide += px.repeat(factor);
        for (let i = 0; i < factor; i++) out.push(wide);
    }
    return out;
}

/** Pixel dimensions of the authored art, before any scaling. */
export const MARK_PIXELS = { width: GRID[0].length, height: GRID.length };

// ------------------------------------------------------- horizontal strip --
// The same three shapes laid side by side: dot, inner ring, outer ring, each
// trimmed to its inked columns and centered on the tallest band. Derived from
// GRID at module load rather than authored twice, so the two arrangements can
// never drift into different marks. The strip exists for terminals tall
// enough to deserve the art but too short for the 11-row stack — the vertical
// mark alone is taller than the whole panel body a 26-row window can afford.
//
// Band bounds name the blank separator rows in GRID by position; the trim
// below re-derives the inked columns, so only a change to the gaps themselves
// (the shape order or count) would need these updated.
const BANDS = [
    [0, 4],   // dot
    [6, 12],  // inner ring
    [14, 22], // outer ring
];
const STRIP_GAP = 2;

function stripGrid() {
    const bands = BANDS.map(([from, to]) => {
        const rows = GRID.slice(from, to);
        let lo = Infinity;
        let hi = -1;
        for (const row of rows) {
            for (let x = 0; x < row.length; x++) {
                if (row[x] !== '.') {
                    lo = Math.min(lo, x);
                    hi = Math.max(hi, x);
                }
            }
        }
        return rows.map((row) => row.slice(lo, hi + 1));
    });

    const height = Math.max(...bands.map((rows) => rows.length));
    const gap = '.'.repeat(STRIP_GAP);
    const out = [];
    for (let y = 0; y < height; y++) {
        out.push(
            bands
                .map((rows) => {
                    const top = Math.floor((height - rows.length) / 2);
                    return rows[y - top] ?? '.'.repeat(rows[0].length);
                })
                .join(gap)
        );
    }
    return out;
}

const STRIP = stripGrid();

/** Character-cell size of the strip: two pixel rows per text row, as ever. */
export function markStripSize() {
    return { columns: STRIP[0].length, rows: STRIP.length / 2 };
}

/** Dot, inner ring, outer ring, left to right — the mark for short panels. */
export function MarkStrip() {
    const rows = [];
    for (let y = 0; y < STRIP.length; y += 2) {
        rows.push(spans(STRIP[y], STRIP[y + 1] ?? '.'.repeat(STRIP[y].length)));
    }
    return React.createElement(
        Box,
        { flexDirection: 'column' },
        ...rows.map((runs, i) => React.createElement(Row, { key: i, runs }))
    );
}

/**
 * Character-cell size of the mark at a given integer scale.
 *
 * Two pixel rows per text row, so height halves; width is one cell per pixel.
 * Callers size the left column from this rather than from a second constant
 * that could drift away from the art.
 */
export function markSize(scale = 1) {
    const s = Math.max(1, Math.floor(scale));
    return {
        columns: MARK_PIXELS.width * s,
        rows: (MARK_PIXELS.height * s) / 2,
    };
}

/**
 * Pink dot, purple ring, blue ring, top to bottom, with gaps.
 *
 * `scale` is an integer magnification of the same art: 1 is 12 x 11 (the
 * compact rendition, unchanged), 2 is 24 x 22 for the tall launch panel.
 */
export function Mark({ scale = 1 }) {
    const grid = magnify(GRID, Math.max(1, Math.floor(scale)));
    const rows = [];
    for (let y = 0; y < grid.length; y += 2) {
        rows.push(spans(grid[y], grid[y + 1] ?? '.'.repeat(grid[y].length)));
    }

    return React.createElement(
        Box,
        { flexDirection: 'column' },
        ...rows.map((runs, i) => React.createElement(Row, { key: i, runs }))
    );
}
