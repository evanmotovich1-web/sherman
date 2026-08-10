// Committed conversation history, rendered inside the viewport.
//
// The shell runs on the terminal's alternate screen (see bin/sherman-shell.js),
// where there is no scrollback to append into — <Static>, which wrote rows once
// and left them to the terminal, is meaningless there. So the transcript is an
// ordinary component now: every turn stays in the `items` array for the life of
// the session, and layout decides what is visible. The launch-only frame stays
// top-anchored. Once conversation items exist, the transcript owns the
// available height and anchors the newest content at the bottom while
// overflowY:'hidden' clips the oldest off the top edge — the terminal's own
// scroll behavior, reproduced without its buffer — and, since scrollback landed,
// browsable: see the scrolling note further down. The session JSONL log remains
// the durable record.
//
// Every item wrapper is flexShrink:0, and that is load-bearing: Yoga's default
// shrink of 1 applies to the ITEMS when the list overflows, compressing each by
// a fraction of a row, and the rounding writes items over each other as
// garbage. Rigid items overflow past the top instead, which is exactly what
// the clip needs. Proven against ink 7.1.1 before this shipped.
//
// Turn structure: the user's line carries the same `❯` as the composer, the work
// the engine reported commits as a factual trace under it, and Sherman's reply
// arrives as a compact signed label plus indented body. The trace renders ONLY what the
// engine actually emitted — an activity line that never happened is a lie in
// the transcript, and one invented line poisons trust in all of them.

import React, { useEffect, useRef } from 'react';
import { Text, Box, useBoxMetrics, useWindowSize } from 'ink';

import { color } from './theme.js';
import { scrollWindow } from './scrollback.js';
import { Banner } from './Header.js';
import { LaunchScreen } from './LaunchScreen.js';
import { safeTerminalText } from './sanitize.js';
import { Diff } from './Diff.js';

// Width of the speaker gutter for notice/error rows. A fixed column means
// wrapped lines hang under the text rather than under the label.
const GUTTER = 9;
const DISPLAY_KINDS = new Set([
    'launch', 'banner', 'user', 'selftalk', 'reasoning', 'tool',
    'message', 'worker-message', 'notice', 'error', 'diff',
]);

function Row({ label, labelColor, children, bold, width }) {
    if (width < 2) {
        return React.createElement(Box, { width: Math.max(1, width) }, children);
    }
    const labelWidth = Math.min(GUTTER, width - 1);
    return React.createElement(
        Box,
        { flexDirection: 'row', width },
        React.createElement(
            Box,
            { width: labelWidth, flexShrink: 0 },
            React.createElement(Text, { color: labelColor, bold }, label)
        ),
        React.createElement(Box, { flexGrow: 1 }, children)
    );
}

// The `round` box glyphs, matching cli-boxes' `round` style — the same set
// Ink itself draws for borderStyle:'round', so the hand-built top row and the
// Ink-drawn sides and bottom are the same alphabet.
const ROUND = { topLeft: '╭', top: '─', topRight: '╮' };

// One dash between the corner and the label, so the row reads
// `╭─ Sherman ─────╮`. Hermes' embedTextInBorder adds NO padding of its own:
// the spaces flanking the name are part of the label string, and the single
// leading dash is the `offset`.
const BORDER_LABEL_OFFSET = 1;

/**
 * RETIRED, DELIBERATELY KEPT. Nothing calls this any more.
 *
 * Replies used to be a four-sided box whose top row carried the signature, and
 * this helper is what drew that row. The reply frame is a left rule now (see
 * `ShermanMessage`), so there is no top border to embed a label in, and the
 * worker frame did not keep the old style either — running one speaker in a box
 * and the other against a rule would preserve exactly the two-visual-language
 * problem the rule exists to remove.
 *
 * It stays because it is the one genuine Hermes technique in this codebase: a
 * cell-for-cell port of `render-border.ts`, correct under every width, and the
 * next component that wants a labelled border should start from this rather
 * than rediscovering the clamp. Retiring it costs three unreachable functions;
 * deleting it costs the technique.
 *
 * Hermes' `embedTextInBorder`, ported cell-for-cell from
 * `hermes-ink/src/ink/render-border.ts:33-66`, specialised to `align:'start'`.
 *
 * The virtual border line is `╭` + `─`×(width-2) + `╮`, i.e. exactly `width`
 * cells. Splitting it never changes that total:
 *
 *   before = borderLine[0]              + `─` × (position - 1)
 *   text   = the label, unpadded
 *   after  = `─` × (borderLength - position - textLength - 1) + borderLine[last]
 *
 * with `position = offset + 1` (+1 for the corner), clamped to
 * `[1, borderLength - textLength - 1]` so the label can never overrun `╮`.
 *
 * Returns null when the label cannot fit — Hermes drops the corners and
 * truncates there, which would make the row read as garbage in a transcript,
 * so callers fall back to an undecorated top border instead.
 */
function embedTextInBorder(width, text, offset = BORDER_LABEL_OFFSET) {
    const borderLength = width;
    const textLength = text.length;
    if (textLength >= borderLength - 2) {
        return null;
    }
    let position = offset + 1;
    position = Math.max(1, Math.min(position, borderLength - textLength - 1));
    return {
        before: ROUND.topLeft + ROUND.top.repeat(position - 1),
        text,
        after: ROUND.top.repeat(borderLength - position - textLength - 1) + ROUND.topRight,
    };
}

/**
 * The top border row, with the speaker name embedded in it.
 *
 * Recomputed on every render from the live `width`, never cached: the
 * transcript width tracks the terminal, and a stale fill would push the row
 * past the viewport. The row is always exactly `width` cells, matching the
 * bottom border Ink draws for the same box.
 */
function TitledTopBorder({ width, label, labelColor }) {
    const parts = embedTextInBorder(width, label);
    if (!parts) {
        // Too narrow for corners + label: a plain, undecorated top border.
        return React.createElement(
            Text,
            { color: color.frame, wrap: 'truncate' },
            ROUND.topLeft + ROUND.top.repeat(Math.max(0, width - 2)) + ROUND.topRight
        );
    }
    // Border runs carry the border colour; the label carries its own, exactly
    // as render-border.ts:126-131 passes `text` through unstyled between two
    // styled runs.
    return React.createElement(
        Text,
        { wrap: 'truncate' },
        React.createElement(Text, { color: color.frame }, parts.before),
        React.createElement(Text, { color: labelColor, bold: true }, parts.text),
        React.createElement(Text, { color: color.frame }, parts.after)
    );
}

// The reply frame: a signature line, then the body against a left rule.
//
//     Sherman
//     │ The vault stores one durable
//     │ fact per file.
//
// The rule sits at the SAME offset as the diff, self-talk and tool rows, whose
// prefix is the literal `  │ ` two cells in. That alignment is the entire point
// of the change: the transcript is one column of speech with one left edge, and
// a reply whose rule stood a cell off from the trace above it would read as a
// different kind of object rather than the same conversation continuing.
//
// The rule is drawn by Ink's own border machinery with three sides switched
// off, NOT by prefixing each line with `│` the way Diff.js does. Diff rows are
// `wrap:'truncate'` single lines, so a per-line prefix is exact there. Replies
// wrap, and the number of rows a reply occupies is known only after Yoga has
// measured it — a prefix loop would have to predict the wrap to place its
// glyphs, and would drop the rule on every continuation row it guessed wrong.
// Ink paints the border down whatever height the box ends up being, so the rule
// runs the full block at every width by construction.
const RULE_INDENT = 2;

function ShermanMessage({ text, width, worker = false }) {
    const safeText = safeTerminalText(text, { preserveNewlines: true });
    // Below this there is no room for indent + rule + padding + a cell of text.
    if (width < RULE_INDENT + 3) {
        return React.createElement(Text, { wrap: 'truncate' }, safeText);
    }
    const labelColor = worker ? color.secondary : color.accent;
    return React.createElement(
        Box,
        { flexDirection: 'column', width: Math.max(1, width) },
        React.createElement(
            Box,
            { marginLeft: RULE_INDENT },
            React.createElement(
                Text,
                { color: labelColor, bold: true, wrap: 'truncate' },
                worker ? '◇ Worker 01' : 'Sherman'
            )
        ),
        React.createElement(
            Box,
            {
                borderStyle: 'round',
                borderColor: color.frame,
                borderTop: false,
                borderRight: false,
                borderBottom: false,
                marginLeft: RULE_INDENT,
                width: width - RULE_INDENT,
                paddingLeft: 1,
                // Yoga stretches this body to its explicit-width parent. Keep
                // horizontal overflow visible so geometry errors fail loudly.
            },
            React.createElement(Text, { wrap: 'wrap' }, safeText)
        )
    );
}

/** One committed transcript item. */
function Item({ item, width, rows }) {
    switch (item.kind) {
        case 'launch':
            return React.createElement(LaunchScreen, {
                info: item.info,
                stats: item.stats,
                registry: item.registry,
                sessionId: item.sessionId,
                columns: width,
                rows,
            });

        // Superseded by 'launch', kept deliberately. It costs one line, and it
        // means a stale or hand-constructed item kind can never blank the opener.
        case 'banner':
            return React.createElement(Banner);

        case 'user':
            // User prompts may wrap inside the explicit-width transcript. The
            // two-space newline indent aligns continuations under the body.
            return React.createElement(
                Text,
                null,
                React.createElement(Text, { color: color.promptHistory, dimColor: true }, '❯ '),
                React.createElement(
                    Text,
                    { color: color.user },
                    safeTerminalText(item.text, { preserveNewlines: true }).replace(/\n/g, '\n  ')
                )
            );

        // Self-talk: the model's own interim summary of what it is doing. Same
        // dim italic weight as the tool trace, because it belongs to the same
        // "work in progress" register -- but carrying `⋯` where a tool line
        // carries `›`, so a glance can tell an action Sherman TOOK from a
        // thought it reported. Both are engine events; neither is narration.
        case 'selftalk':
            return React.createElement(
                Text,
                { color: color.secondary, wrap: 'truncate' },
                `  │ ⋯ summary: ${safeTerminalText(item.text)}`
            );

        // The committed activity trace, sourced only from normalized engine
        // events. Tool glyphs, labels, and measured durations are formatted by
        // App; none are simulated here. A structured row (item.trace) renders
        // the reference's table register — receding tag column, detail
        // carrying the light, muted duration — as colour on the SAME plain
        // text `item.text` holds, so the row reads identically wherever the
        // string form survives. A row without parts keeps the old single-ink
        // rendering, byte for byte.
        case 'reasoning':
        case 'tool':
            if (item.trace) {
                const { glyph, tag, label, outcome, duration } = item.trace;
                return React.createElement(
                    Text,
                    { wrap: 'truncate' },
                    React.createElement(Text, { color: color.tertiary }, '  │ '),
                    React.createElement(
                        Text,
                        { color: color.secondary },
                        `${glyph ? `${glyph} ` : ''}${safeTerminalText(tag)}  `
                    ),
                    React.createElement(Text, { color: color.value }, safeTerminalText(label)),
                    outcome
                        ? React.createElement(Text, { color: color.error }, safeTerminalText(outcome))
                        : null,
                    duration
                        ? React.createElement(Text, { color: color.muted }, safeTerminalText(duration))
                        : null
                );
            }
            return React.createElement(
                Text,
                { color: color.tertiary, wrap: 'truncate' },
                `  │ ${safeTerminalText(item.text)}`
            );

        // A file change, in the lines that changed. The payload is the engine's
        // `diff` event verbatim; Diff.js renders it and never sources anything
        // of its own.
        case 'diff':
            return React.createElement(Diff, { diff: item.diff });

        case 'message':
            return React.createElement(ShermanMessage, { text: item.text, width });

        case 'worker-message':
            return React.createElement(ShermanMessage, { text: item.text, width, worker: true });

        case 'notice':
            return React.createElement(
                Row,
                { label: '', width },
                React.createElement(Text, { color: color.muted }, safeTerminalText(item.text))
            );

        case 'error':
            return React.createElement(
                Row,
                { label: '!', labelColor: color.error, bold: true, width },
                React.createElement(Text, { color: color.error }, safeTerminalText(item.text))
            );

        default:
            // Forward-compatible: an item kind this build does not know about is
            // skipped rather than crashing the transcript.
            return null;
    }
}

// ----------------------------------------------------------------- scrolling --
// The scrolled-off rows used to be gone: the clip discarded them and nothing
// remembered how many there had been. Restoring them without inventing a second
// history means never re-rendering events into text — what scrolls past has to
// be the same component tree that was on screen.
//
// Hermes solves this with a ScrollBox in its own ink fork; stock ink has no
// such thing, and `renderToString` cannot be used to build a line buffer here
// because calling it during a render is a nested React render, which React
// rejects outright. So the transcript scrolls the way a clipped element does:
// the content column is pushed DOWN past the bottom of a fixed, overflow-hidden
// viewport by a negative bottom margin. The rows that leave the bottom and the
// rows that arrive at the top are the same rendered rows either way — the
// component tree is identical at every offset, and only what the clip admits
// changes.
//
// Every number the indicator prints comes from Yoga's measurement of that same
// tree — the viewport's height and the content's height — so "N lines below" is
// a measured fact about the frame on screen, not a model of it.

/**
 * @param {{items: Array<{id: string, kind: string, text?: string}>, columns?: number, offset?: number, onWindow?: (window: {total: number, viewport: number, below: number, following: boolean}) => void}} props
 *
 * `columns` is injectable for off-TTY fixtures (D17); live, the hook wins.
 *
 * `offset` is rows above the live tail — 0 follows it, which is the default and
 * the only state an off-TTY render can reach, so fixtures see exactly the
 * output they saw before scrollback existed.
 *
 * `onWindow` reports the measured window upward so the shell can clamp its own
 * offset and print a true count. The measurement is reported, never recomputed.
 */
export function Transcript({ items, columns, offset = 0, onWindow }) {
    const size = useWindowSize();
    const viewportWidth = typeof columns === 'number' ? columns : size.columns;
    const gutter = viewportWidth >= 4 ? 1 : 0;
    const width = Math.max(1, viewportWidth - gutter * 2);

    // Two measurements, both from the frame that is actually on screen: how
    // tall the clip is, and how tall the content inside it is. Both read 0
    // until the first layout pass, and `scrollWindow` treats that as unknown
    // rather than guessing a height.
    const viewportRef = useRef(null);
    const contentRef = useRef(null);
    const viewportMetrics = useBoxMetrics(viewportRef);
    const contentMetrics = useBoxMetrics(contentRef);
    const viewport = viewportMetrics.hasMeasured ? viewportMetrics.height : 0;
    const total = contentMetrics.hasMeasured ? contentMetrics.height : 0;

    const displayItems = items.filter((item) => DISPLAY_KINDS.has(item.kind));
    const window = scrollWindow({ total, viewport, offset });

    useEffect(() => {
        onWindow?.({
            total,
            viewport,
            below: window.below,
            following: window.following,
        });
    }, [onWindow, total, viewport, window.below, window.following]);

    return React.createElement(
        Box,
        {
            ref: viewportRef,
            flexDirection: 'column',
            flexGrow: 1,
            flexShrink: 1,
            overflowY: 'hidden',
            width: viewportWidth,
            paddingX: gutter,
            // Launch-only stays top-anchored. A conversation owns the available
            // transcript height, anchors newest content at the bottom, and clips
            // oldest content from the top.
            justifyContent: displayItems.length > 1 ? 'flex-end' : 'flex-start',
        },
        React.createElement(
            Box,
            {
                ref: contentRef,
                flexDirection: 'column',
                flexShrink: 0,
                // The scroll itself. At offset 0 this is 0, so the layout is
                // bit-for-bit the pre-scrollback one; above 0 the column hangs
                // that many rows past the bottom of the clip and the same
                // number of older rows come into view at the top.
                marginBottom: -window.offset,
            },
            displayItems.map((item) =>
                React.createElement(
                    Box,
                    {
                        key: item.id,
                        flexDirection: 'column',
                        flexShrink: 0,
                        // Air above each user turn — the rhythm that makes turns
                        // read as turns.
                        marginTop: item.kind === 'user' ? 1 : 0,
                        // No trailing blank row under a reply. The left rule
                        // does not close itself the way the old bottom border
                        // did, but it does not need to: the next user turn
                        // carries marginTop:1, so the air between turns is
                        // spent once, by the turn that starts — and spending it
                        // twice would cost a transcript row and push one more
                        // item off the top of the clip.
                        marginBottom: 0,
                    },
                    React.createElement(Item, { item, width, rows: size.rows })
                )
            )
        )
    );
}
