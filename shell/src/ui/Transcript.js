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
// scroll behavior, reproduced without its buffer. There is no page-up
// browsing of what scrolled off (README.md records the limitation); the session
// JSONL log is the durable record.
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

import React from 'react';
import { Text, Box, useWindowSize } from 'ink';

import { color } from './theme.js';
import { Banner } from './Header.js';
import { LaunchScreen } from './LaunchScreen.js';
import { safeTerminalText } from './sanitize.js';

// Width of the speaker gutter for notice/error rows. A fixed column means
// wrapped lines hang under the text rather than under the label.
const GUTTER = 9;
const DISPLAY_KINDS = new Set([
    'launch', 'banner', 'user', 'selftalk', 'reasoning', 'tool',
    'message', 'worker-message', 'notice', 'error',
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

/** Hermes-sized reply: a compact signed label plus an indented body. */
function ShermanMessage({ text, width, worker = false }) {
    const safeText = safeTerminalText(text, { preserveNewlines: true });
    if (width < 6) {
        return React.createElement(Text, { wrap: 'truncate' }, safeText);
    }
    return React.createElement(
        Box,
        { flexDirection: 'column', width: Math.max(1, width) },
        React.createElement(
            Text,
            { color: worker ? color.secondary : color.accent, bold: true, wrap: 'truncate' },
            worker ? '◇ Worker 01' : '◆ Sherman'
        ),
        React.createElement(
            Box,
            {
                paddingLeft: width >= 4 ? 2 : 0,
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

        // The committed activity trace. Dim italic, indented under the bullet,
        // and sourced only from normalized engine events. Tool glyphs, labels,
        // and measured durations are formatted by App; none are simulated here.
        case 'reasoning':
        case 'tool':
            return React.createElement(
                Text,
                { color: color.tertiary, wrap: 'truncate' },
                `  │ ${safeTerminalText(item.text)}`
            );

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

/**
 * @param {{items: Array<{id: string, kind: string, text?: string}>, columns?: number}} props
 *
 * `columns` is injectable for off-TTY fixtures (D17); live, the hook wins.
 */
export function Transcript({ items, columns }) {
    const size = useWindowSize();
    const viewportWidth = typeof columns === 'number' ? columns : size.columns;
    const gutter = viewportWidth >= 4 ? 1 : 0;
    const width = Math.max(1, viewportWidth - gutter * 2);

    // Every item renders at least one line, so at most `rows` of them can be
    // visible at once. Older items still live in `items` — they are simply not
    // worth a Yoga layout pass on every frame of a long session.
    const displayItems = items.filter((item) => DISPLAY_KINDS.has(item.kind));
    const visible = displayItems.slice(-size.rows);

    return React.createElement(
        Box,
        {
            flexDirection: 'column',
            flexGrow: 1,
            flexShrink: 1,
            overflowY: 'hidden',
            width: viewportWidth,
            paddingX: gutter,
            // Launch-only stays top-anchored. A conversation owns the available
            // transcript height, anchors newest content at the bottom, and clips
            // oldest content from the top.
            justifyContent: visible.length > 1 ? 'flex-end' : 'flex-start',
        },
        visible.map((item) =>
            React.createElement(
                Box,
                {
                    key: item.id,
                    flexDirection: 'column',
                    flexShrink: 0,
                    // Air above each user turn and below each reply — the rhythm
                    // that makes turns read as turns.
                    marginTop: item.kind === 'user' ? 1 : 0,
                    marginBottom: item.kind === 'message' || item.kind === 'worker-message' ? 1 : 0,
                },
                React.createElement(Item, { item, width, rows: size.rows })
            )
        )
    );
}
