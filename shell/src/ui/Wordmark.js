// The SHERMAN AGENT wordmark, in two sizes, generated from one glyph table.
//
// Why generated rather than read from logo/banner.ans:
//
//   1. logo/ belongs to the parallel Codex track, and banner.ans stays exactly
//      as it is — bin/sherman still prints it for its pre-shell moments.
//   2. Two sizes from one table means the small form can never drift from the
//      large one. Parsing lines back out of a mixed-content .ans file to get
//      the fallback would be both fragile and pointless.
//
// The letterforms are the same shapes banner.ans uses, redrawn at seven rows
// for the v3 full-bleed pass. Only the rendering is new.
//
// Since v3 the lockup is left-anchored: SHERMAN carries the lit/ramp/shadow
// treatment, and AGENT sits directly beneath it, flush to the same left edge,
// so the pair reads as one unit the way HERMES-AGENT does — not as a word with
// a right-floated tag.

import React from 'react';
import { Text, Box, useWindowSize } from 'ink';

import { ramp } from './theme.js';

// 7 columns per glyph, 7 rows tall. Joined with a single space:
// 7*7 + 6 = 55 columns. Only SHERMAN's letters exist at this size — the AGENT
// sub-deck always draws from the SMALL table.
const LARGE = {
    S: ['███████', '█      ', '█      ', '███████', '      █', '      █', '███████'],
    H: ['█     █', '█     █', '█     █', '███████', '█     █', '█     █', '█     █'],
    E: ['███████', '█      ', '█      ', '█████  ', '█      ', '█      ', '███████'],
    R: ['██████ ', '█     █', '█     █', '██████ ', '█   █  ', '█    █ ', '█     █'],
    M: ['█     █', '██   ██', '█ ███ █', '█  █  █', '█     █', '█     █', '█     █'],
    A: [' █████ ', '█     █', '█     █', '███████', '█     █', '█     █', '█     █'],
    N: ['█     █', '██    █', '█ █   █', '█  █  █', '█   █ █', '█    ██', '█     █'],
};

// 5 columns per glyph: 5*7 + 6 = 41 columns for SHERMAN. Pixel-identical to
// the wordmark already in logo/banner.ans, so the fallback looks like a smaller
// Sherman rather than a different one.
const SMALL = {
    S: ['█████', '█    ', '█████', '    █', '█████'],
    H: ['█   █', '█   █', '█████', '█   █', '█   █'],
    E: ['█████', '█    ', '████ ', '█    ', '█████'],
    R: ['████ ', '█   █', '████ ', '█  █ ', '█   █'],
    M: ['█   █', '██ ██', '█ █ █', '█   █', '█   █'],
    A: [' ███ ', '█   █', '█████', '█   █', '█   █'],
    N: ['█   █', '██  █', '█ █ █', '█  ██', '█   █'],
    G: ['█████', '█    ', '█ ███', '█   █', '█████'],
    T: ['█████', '  █  ', '  █  ', '  █  ', '  █  '],
};

const WORD = 'SHERMAN';
const SUB = 'AGENT';

/** Measured, not estimated. Exported so the smoke checks assert against one source. */
export const LARGE_COLUMNS = 55;
export const SMALL_COLUMNS = 41;

// The narrow tag: letters spaced out so 5 glyphs still read as a deck.
const SUB_TAG = SUB.split('').join(' ');

/** Rim + 7 body rows + shadow + gap + 5 AGENT rows. */
export const LARGE_ROWS = 15;
/** 5 body rows + the tag line. */
export const SMALL_ROWS = 6;

// 55 plus a little air. Choosing the threshold at exactly 55 would put the mark
// flush against both edges of the terminal, which looks like an accident.
const LARGE_MIN_COLUMNS = 58;

/** One row of a word, letters joined by a one-column gutter. */
function row(table, word, r) {
    return word
        .split('')
        .map((ch) => table[ch][r])
        .join(' ');
}

/**
 * A half-height edge traced over whichever columns had ink on `src`.
 *
 * `▄` above the top row reads as a lit rim; the same glyph below the bottom row
 * reads as a shadow the letters cast. One helper, because they are the same
 * operation seen from opposite ends.
 */
function edge(src, glyph) {
    return [...src].map((c) => (c === '█' ? glyph : ' ')).join('');
}

// Every line is truncate-wrapped. A block-glyph row that wraps does not degrade
// gracefully — it shatters into fragments on the next line, which is exactly the
// failure the size fallback exists to prevent. Truncation is the safety net for
// the case where even the small form does not fit.
function Line({ tint, children }) {
    return React.createElement(Text, { color: tint, wrap: 'truncate' }, children);
}

/** 55 x 15. Lit rim, SHERMAN on the ramp, shadow, then AGENT flush left. */
function Large() {
    const top = row(LARGE, WORD, 0);
    const bottom = row(LARGE, WORD, 6);

    return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(Line, { key: 'lit', tint: ramp.lit }, edge(top, '▄')),
        ...ramp.body.map((tint, r) =>
            React.createElement(Line, { key: `b${r}`, tint }, row(LARGE, WORD, r))
        ),
        React.createElement(Line, { key: 'shadow', tint: ramp.shadow }, edge(bottom, '▄')),
        React.createElement(Text, { key: 'gap' }, ' '),
        ...[0, 1, 2, 3, 4].map((r) =>
            React.createElement(Line, { key: `a${r}`, tint: ramp.agent }, row(SMALL, SUB, r))
        )
    );
}

/**
 * 41 x 6, the compact brand gradient with the AGENT tag beneath, flush left.
 */
function Small() {
    return React.createElement(
        Box,
        { flexDirection: 'column' },
        ...ramp.compact.map((tint, r) =>
            React.createElement(Line, { key: `s${r}`, tint }, row(SMALL, WORD, r))
        ),
        React.createElement(Line, { key: 'tag', tint: ramp.agent }, SUB_TAG)
    );
}

/**
 * Picks the largest form the terminal can hold without wrapping.
 *
 * `columns` is an optional override. Live, nothing passes it and the hook wins.
 * It exists because `useWindowSize()` reports a hardcoded 80x24 under Ink's
 * `renderToString` — the `columns` option there drives layout only — so without
 * an injectable width the fallback branch could never be tested off a real TTY.
 * The launch screen resolves the width once and passes it down, which also means
 * the wordmark and the panel below it can never disagree about how wide the
 * terminal is.
 *
 * @param {{columns?: number}} props
 */
export function Wordmark({ columns }) {
    const measured = useWindowSize().columns;
    const width = typeof columns === 'number' ? columns : measured;

    return width >= LARGE_MIN_COLUMNS
        ? React.createElement(Large)
        : React.createElement(Small);
}

/** Rows the chosen form will occupy — the launch screen's height math needs it. */
export function wordmarkRows(width) {
    return width >= LARGE_MIN_COLUMNS ? LARGE_ROWS : SMALL_ROWS;
}
