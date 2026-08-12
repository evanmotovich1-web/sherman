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
// the engine reported commits as a factual trace under it — each row hanging on
// the dotted rail — and Sherman's reply arrives under a titled top rule: the
// speaker's name embedded in the border, both corner tips turned down, and the
// body flowing OPEN beneath it, the Hermes register. The trace renders ONLY what
// the engine actually emitted — an activity line that never happened is a lie in
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

// The trace rail: dotted, the Hermes register. One glyph so every railed row
// (trace, self-talk, diff) shares the same left edge by construction.
export const RAIL = '┊';

// The exit glitch. While the shell grades itself and files what it learned on
// the way out, the rail is the ONLY announcement: its glyphs churn through
// this alphabet for a few seconds and no text is printed. Deterministic per
// (tick, row) — the same frame renders the same garbage, so fixtures can pin
// it and nothing here needs a random source.
const GLITCH = ['▓', '▒', '░', '█', '╳', '╎', '┇', '⌇'];

function railGlyph(glitch, row) {
    if (!glitch) return RAIL;
    return GLITCH[(glitch + row) % GLITCH.length];
}
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
 * Live again: the reply frame is a four-sided box once more, and this helper
 * draws its top row with the signature embedded in the border. It was retired
 * once, when replies stood against a bare left rule, and kept anyway as the
 * one genuine Hermes technique in this codebase — which is exactly why the
 * closed frame could return without rediscovering the clamp. Both speakers use
 * it (`Sherman` and the worker label), so the transcript keeps one visual
 * language.
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

// The reply frame: a titled top rule and an OPEN body, the Hermes register.
//
//     ╭─ Sherman ────────────────╮
//     The vault stores one
//     durable fact per file.
//
// The two corner tips turn down and nothing else encloses the reply: no side
// rules, no bottom border. The rule spans the transcript's full width, and
// the body flows flush beneath it, exactly as Hermes prints its own replies.
// The closed four-sided box this replaces was retired on the operator's
// instruction (2026-08-12): the tips ARE the frame.
//
// The top row is hand-built by `TitledTopBorder` so the name can live inside
// the border; the body is plain wrapped text with no border machinery at all.
function ShermanMessage({ text, width, worker = false }) {
    const safeText = safeTerminalText(text, { preserveNewlines: true });
    // Below this there is no room for the corners, a dash, and a cell of
    // label, and a rule with no interior is worse than no rule.
    if (width < 5) {
        return React.createElement(Text, { wrap: 'truncate' }, safeText);
    }
    const labelColor = worker ? color.secondary : color.accent;
    return React.createElement(
        Box,
        { flexDirection: 'column', width: Math.max(1, width) },
        React.createElement(TitledTopBorder, {
            width,
            // The flanking spaces are part of the label by the Hermes
            // convention: embedTextInBorder adds no padding of its own.
            label: worker ? ' ◇ Worker 01 ' : ' Sherman ',
            labelColor,
        }),
        React.createElement(Text, { wrap: 'wrap' }, safeText)
    );
}

/** One committed transcript item. `rail` is this row's rail glyph — the
 *  dotted `┊` normally, a glitch glyph while the exit flow runs. */
function Item({ item, width, rows, rail = RAIL }) {
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
            // The ● is the turn's anchor: the accent dot marks where a turn
            // begins, and the ┊-railed work rows that follow hang under it —
            // prompt, then the tree of what the prompt caused.
            return React.createElement(
                Text,
                null,
                React.createElement(Text, { color: color.accent }, '● '),
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
                `  ${rail} ⋯ summary: ${safeTerminalText(item.text)}`
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
                    React.createElement(Text, { color: color.tertiary }, `  ${rail} `),
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
                `  ${rail} ${safeTerminalText(item.text)}`
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
 * @param {{items: Array<{id: string, kind: string, text?: string}>, columns?: number, offset?: number, glitch?: number, onWindow?: (window: {total: number, viewport: number, below: number, following: boolean}) => void}} props
 *
 * `columns` is injectable for off-TTY fixtures (D17); live, the hook wins.
 *
 * `glitch` is 0 (off) or the shell's exit-flow tick: while non-zero every
 * rail glyph churns through the glitch alphabet, one step per tick — the
 * silent signal that the exit eval and retention are running.
 *
 * `offset` is rows above the live tail — 0 follows it, which is the default and
 * the only state an off-TTY render can reach, so fixtures see exactly the
 * output they saw before scrollback existed.
 *
 * `onWindow` reports the measured window upward so the shell can clamp its own
 * offset and print a true count. The measurement is reported, never recomputed.
 */
export function Transcript({ items, columns, offset = 0, glitch = 0, onWindow }) {
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
            displayItems.map((item, row) =>
                React.createElement(
                    Box,
                    {
                        key: item.id,
                        flexDirection: 'column',
                        flexShrink: 0,
                        // Air above each user turn — the rhythm that makes turns
                        // read as turns.
                        marginTop: item.kind === 'user' ? 1 : 0,
                        // No trailing blank row under a reply. The box closes
                        // itself with its own bottom border, and the next user
                        // turn carries marginTop:1, so the air between turns is
                        // spent once, by the turn that starts — spending it
                        // twice would cost a transcript row and push one more
                        // item off the top of the clip.
                        marginBottom: 0,
                    },
                    React.createElement(Item, {
                        item,
                        width,
                        rows: size.rows,
                        rail: railGlyph(glitch, row),
                    })
                )
            )
        )
    );
}
