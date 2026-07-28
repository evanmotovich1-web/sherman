// The SHERMAN AGENT wordmark, in three sizes, generated from glyph tables.
//
// Why generated rather than read from logo/banner.ans:
//
//   1. logo/ belongs to the parallel Codex track, and banner.ans stays exactly
//      as it is — bin/sherman still prints it for its pre-shell moments.
//   2. Every size drawing from tables in this one file means the smaller forms
//      can never drift from the large one. Parsing lines back out of a
//      mixed-content .ans file to get the fallbacks would be both fragile and
//      pointless.
//
// New in this pass, the full lockup: ONE line, SHERMAN-AGENT, joined by a real hyphen
// glyph, in the same retro-3D construction as the HERMES-AGENT reference. The
// construction is the ANSI-Shadow letterform: solid ██ strokes with thin
// box-drawing characters (╔ ╗ ╚ ╝ ║ ═) tracing every stroke's right and
// bottom edge — a thin outline echo offset down-right that reads as depth,
// the double-line inset look, not a solid drop shadow. The RETRO glyphs below
// were extracted verbatim from the reference art, so the construction is
// copied, not approximated; only the inks are Sherman's. Solid cells carry
// three horizontal bands — pink over purple over blue, the brand translation
// of the reference's yellow/yellow/orange — and the echo is one dim indigo so
// it sits behind the letterforms (the reference relies on thin-vs-solid alone
// for that reading; the dim tone pushes the echo one step further back).
//
// Below the lockup's width the mark falls back to the v3 stack — SHERMAN on
// the lit/ramp/shadow treatment with AGENT flush beneath — and below that to
// the small form. Both fallbacks are unchanged from v3/v5.

import React from 'react';
import { Text, Box, useWindowSize } from 'ink';

import { ramp, retro } from './theme.js';

// Reference scale: 6 rows, letter spacing built into the glyphs, letters
// butted directly against one another the way the reference smushes
// HERMES-AGENT into one line. The hyphen is a glyph like any other — it is
// what makes SHERMAN-AGENT one connected lockup rather than two adjacent
// words. Widths vary per letter (M is 11 columns, the hyphen 6), so rows are
// joined with no gutter and come out equal-length by construction.
const RETRO = {
    S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
    H: ['██╗  ██╗', '██║  ██║', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
    E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
    R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
    M: [
        '███╗   ███╗',
        '████╗ ████║',
        '██╔████╔██║',
        '██║╚██╔╝██║',
        '██║ ╚═╝ ██║',
        '╚═╝     ╚═╝',
    ],
    A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
    N: [
        '███╗   ██╗',
        '████╗  ██║',
        '██╔██╗ ██║',
        '██║╚██╗██║',
        '██║ ╚████║',
        '╚═╝  ╚═══╝',
    ],
    G: [' ██████╗ ', '██╔════╝ ', '██║  ███╗', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
    T: [
        '████████╗',
        '╚══██╔══╝',
        '   ██║   ',
        '   ██║   ',
        '   ██║   ',
        '   ╚═╝   ',
    ],
    '-': ['      ', '      ', '█████╗', '╚════╝', '      ', '      '],
};

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

const LOCKUP = 'SHERMAN-AGENT';
const WORD = 'SHERMAN';
const SUB = 'AGENT';

/** One row of the lockup. No gutter — the reference font carries its own spacing. */
function retroRow(r) {
    return LOCKUP.split('')
        .map((ch) => RETRO[ch][r])
        .join('');
}

/** One row of a word, letters joined by a one-column gutter. */
function row(table, word, r) {
    return word
        .split('')
        .map((ch) => table[ch][r])
        .join(' ');
}

// Measured from the assembled art in code points, never guessed — a glyph
// edit can never silently invalidate the breakpoints derived from these.
export const RETRO_COLUMNS = Math.max(...RETRO.S.map((_, r) => [...retroRow(r)].length));
export const STACK_COLUMNS = [...row(LARGE, WORD, 0)].length;
export const SMALL_COLUMNS = [...row(SMALL, WORD, 0)].length;

// The narrow tag: letters spaced out so 5 glyphs still read as a deck.
const SUB_TAG = SUB.split('').join(' ');

/** The lockup is exactly its glyph height: 6 rows, nothing above or below. */
export const RETRO_ROWS = RETRO.S.length;
/** Rim + 7 body rows + shadow + gap + 5 AGENT rows. */
export const STACK_ROWS = 15;
/** 5 body rows + the tag line. */
export const SMALL_ROWS = 6;

// Each threshold is its form's width plus a little air. A threshold at
// exactly the rendered width would put the mark flush against both edges of
// the terminal, which looks like an accident.
const RETRO_MIN_COLUMNS = RETRO_COLUMNS + 3;
const STACK_MIN_COLUMNS = STACK_COLUMNS + 3;

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

/**
 * One lockup row, split into the construction's two inks: solid runs take the
 * row's band colour, box-drawing runs take the dim echo tone. Splitting per
 * run (not per cell) keeps the span count low; spaces stay uncoloured and
 * attach to no ink.
 */
function RetroLine({ band, text }) {
    const spans = [...text.matchAll(/█+| +|[^█ ]+/g)].map((m, i) => {
        const run = m[0];
        const tint = run[0] === '█' ? band : run[0] === ' ' ? undefined : retro.echo;
        return React.createElement(Text, { key: i, color: tint }, run);
    });
    // The outer Text truncates the composed row as one unit, same safety net
    // as Line — a sheared lockup must clip, never wrap.
    return React.createElement(Text, { wrap: 'truncate' }, ...spans);
}

/** 111 x 6: SHERMAN-AGENT on one line, at reference scale. */
function Retro() {
    // retro.bands is row-indexed: its six entries are the three colour bands,
    // two rows each, zipped against the six glyph rows.
    return React.createElement(
        Box,
        { flexDirection: 'column' },
        ...retro.bands.map((band, r) =>
            React.createElement(RetroLine, { key: r, band, text: retroRow(r) })
        )
    );
}

/** 55 x 15. Lit rim, SHERMAN on the ramp, shadow, then AGENT flush left. */
function Stack() {
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
 * Picks the largest form the terminal can hold without wrapping: the one-line
 * retro lockup, then the SHERMAN-over-AGENT stack, then the small form.
 *
 * `columns` is an optional override. Live, nothing passes it and the hook wins.
 * It exists because `useWindowSize()` reports a hardcoded 80x24 under Ink's
 * `renderToString` — the `columns` option there drives layout only — so without
 * an injectable width the fallback branches could never be tested off a real
 * TTY. The launch screen resolves the width once and passes it down, which also
 * means the wordmark and the panel below it can never disagree about how wide
 * the terminal is.
 *
 * @param {{columns?: number, compact?: boolean}} props
 */
export function Wordmark({ columns, compact = false }) {
    const measured = useWindowSize().columns;
    const width = typeof columns === 'number' ? columns : measured;

    if (compact) return React.createElement(Small);
    if (width >= RETRO_MIN_COLUMNS) return React.createElement(Retro);
    if (width >= STACK_MIN_COLUMNS) return React.createElement(Stack);
    return React.createElement(Small);
}

/**
 * Rows the form chosen at `width` will occupy. Nothing consumes this today —
 * the launch screen went top-anchored in v3 and dropped its height math — but
 * it is kept beside the tier selection above so that if viewport-filling ever
 * returns, the height a caller plans for cannot drift from the form Wordmark
 * actually picks.
 */
export function wordmarkRows(width) {
    if (width >= RETRO_MIN_COLUMNS) return RETRO_ROWS;
    if (width >= STACK_MIN_COLUMNS) return STACK_ROWS;
    return SMALL_ROWS;
}
