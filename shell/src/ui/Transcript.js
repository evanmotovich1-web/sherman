// Committed conversation history, rendered inside the viewport.
//
// The shell runs on the terminal's alternate screen (see bin/sherman-shell.js),
// where there is no scrollback to append into — <Static>, which wrote rows once
// and left them to the terminal, is meaningless there. So the transcript is an
// ordinary component now: every turn stays in the `items` array for the life of
// the session, and layout decides what is visible. The Box below shrinks
// against the fixed-height root in app.js; while the turns fit, they read from
// the top with the chrome directly beneath them, and once they outgrow the
// space, justifyContent:'flex-end' anchors the newest content to the bottom
// while overflowY:'hidden' clips the oldest off the top edge — the terminal's
// own scroll behavior, reproduced without its buffer. There is no page-up
// browsing of what scrolled off (README.md records the limitation); the session
// JSONL log is the durable record.
//
// Every item wrapper is flexShrink:0, and that is load-bearing: Yoga's default
// shrink of 1 applies to the ITEMS when the list overflows, compressing each by
// a fraction of a row, and the rounding writes items over each other as
// garbage. Rigid items overflow past the top instead, which is exactly what
// the clip needs. Proven against ink 7.1.1 before this shipped.
//
// Turn structure (Phase 6): the user's line is a bullet, the work the engine
// reported commits as a dim italic trace under it, and Sherman's reply arrives
// in a bordered box signed in its top border. The trace renders ONLY what the
// engine actually emitted — an activity line that never happened is a lie in
// the transcript, and one invented line poisons trust in all of them.

import React from 'react';
import { Text, Box, useWindowSize } from 'ink';

import { color } from './theme.js';
import { Banner } from './Header.js';
import { LaunchScreen } from './LaunchScreen.js';

// Width of the speaker gutter for notice/error rows. A fixed column means
// wrapped lines hang under the text rather than under the label.
const GUTTER = 9;

function Row({ label, labelColor, children, bold }) {
    return React.createElement(
        Box,
        { flexDirection: 'row' },
        React.createElement(
            Box,
            { width: GUTTER, flexShrink: 0 },
            React.createElement(Text, { color: labelColor, bold }, label)
        ),
        React.createElement(Box, { flexGrow: 1 }, children)
    );
}

/**
 * Sherman's reply, boxed and signed: the mark at one-character scale (three
 * dots plus the word Sherman, bold in the anchor accent) set into the top
 * border — the same composed-line + borderTop:false construction the launch
 * panel's version header uses.
 */
function ShermanBox({ text, width }) {
    const box = Math.max(1, width);

    // Ink's rounded border has an intrinsic four-column minimum. Below that,
    // degrade to truncated prose rather than spill past the terminal edge.
    if (box < 4) {
        return React.createElement(Text, { wrap: 'truncate' }, text);
    }

    // ' ●●● Sherman ' — measured in code points so the fill is exact.
    const label = ' ●●● Sherman ';
    const fill = Math.max(0, box - 3 - [...label].length);

    return React.createElement(
        Box,
        { flexDirection: 'column', width: box },
        React.createElement(
            Text,
            { wrap: 'truncate' },
            React.createElement(Text, { color: color.accent }, '╭─ '),
            React.createElement(Text, { color: color.accent, bold: true }, '●●● Sherman '),
            React.createElement(Text, { color: color.accent }, '─'.repeat(fill) + '╮')
        ),
        React.createElement(
            Box,
            {
                width: box,
                borderStyle: 'round',
                borderTop: false,
                borderColor: color.accent,
                paddingX: 2,
                paddingY: 1,
            },
            React.createElement(Text, null, text)
        )
    );
}

/** One committed transcript item. */
function Item({ item, width }) {
    switch (item.kind) {
        case 'launch':
            return React.createElement(LaunchScreen, {
                info: item.info,
                stats: item.stats,
                sessionId: item.sessionId,
            });

        // Superseded by 'launch', kept deliberately. It costs one line, and it
        // means a stale or hand-constructed item kind can never blank the opener.
        case 'banner':
            return React.createElement(Banner);

        case 'user':
            return React.createElement(
                Text,
                null,
                React.createElement(Text, { color: color.accent }, '● '),
                React.createElement(Text, { color: color.user }, item.text)
            );

        // The committed activity trace. Dim italic, indented under the bullet,
        // and sourced only from normalized engine events. Tool glyphs, labels,
        // and measured durations are formatted by App; none are simulated here.
        case 'reasoning':
        case 'tool':
            return React.createElement(
                Text,
                { dimColor: true, italic: true, wrap: 'truncate' },
                `  ${item.text}`
            );

        case 'message':
            return React.createElement(ShermanBox, { text: item.text, width });

        case 'notice':
            return React.createElement(
                Row,
                { label: '', labelColor: color.faint },
                React.createElement(Text, { color: color.muted }, item.text)
            );

        case 'error':
            return React.createElement(
                Row,
                { label: '!', labelColor: color.error, bold: true },
                React.createElement(Text, { color: color.error }, item.text)
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
    const width = typeof columns === 'number' ? columns : size.columns;

    // Every item renders at least one line, so at most `rows` of them can be
    // visible at once. Older items still live in `items` — they are simply not
    // worth a Yoga layout pass on every frame of a long session.
    const visible = items.slice(-size.rows);

    return React.createElement(
        Box,
        {
            flexDirection: 'column',
            flexShrink: 1,
            overflowY: 'hidden',
            // Terminal-like scroll: once turns exist, anchor the NEWEST content
            // to the bottom and clip the oldest off the top. The launch moment
            // is the exception — while the opener is the only item, anchor to
            // the top, so on a short terminal the wordmark and version border
            // still paint from the top-left and it is the panel's tail that
            // clips, never its head. Both anchors render identically whenever
            // the content fits.
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
                    marginBottom: item.kind === 'message' ? 1 : 0,
                },
                React.createElement(Item, { item, width })
            )
        )
    );
}
