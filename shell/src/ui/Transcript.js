// Committed conversation history.
//
// Everything here goes through a single <Static> (D12). Ink writes those rows out
// once and then stops managing them, which is what leaves them in the terminal's
// OWN scrollback — so the mouse wheel and Cmd-F work the way people expect. The
// alternate screen would give a tidier fixed layout and destroy exactly that.
//
// ONE <Static> for the whole history, with the launch screen as its first item.
// Ink only reliably supports a single Static instance, and threading the opener
// through the same list also guarantees it stays above the first message.
//
// Turn structure (Phase 6): the user's line is a bullet, the work the engine
// reported commits as a dim italic trace under it, and Sherman's reply arrives
// in a bordered box signed in its top border. The trace renders ONLY what the
// engine actually emitted — an activity line that never happened is a lie in
// the transcript, and one invented line poisons trust in all of them.

import React from 'react';
import { Text, Box, Static, useWindowSize } from 'ink';

import { color, markRamp } from './theme.js';
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
 * dots in the mark's own colours) plus the word Sherman, set into the top
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
            React.createElement(Text, { color: markRamp.dot.mid }, '●'),
            React.createElement(Text, { color: markRamp.inner.mid }, '●'),
            React.createElement(Text, { color: markRamp.outer.mid }, '●'),
            React.createElement(Text, { color: color.accent, bold: true }, ' Sherman '),
            React.createElement(Text, { color: color.accent }, '─'.repeat(fill) + '╮')
        ),
        React.createElement(
            Box,
            {
                width: box,
                borderStyle: 'round',
                borderTop: false,
                borderColor: color.accent,
                paddingX: 1,
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
    const measured = useWindowSize().columns;
    const width = typeof columns === 'number' ? columns : measured;

    return React.createElement(Static, { items }, (item) =>
        React.createElement(
            Box,
            {
                key: item.id,
                flexDirection: 'column',
                // Air above each user turn and below each reply — the rhythm
                // that makes turns read as turns.
                marginTop: item.kind === 'user' ? 1 : 0,
                marginBottom: item.kind === 'message' ? 1 : 0,
            },
            React.createElement(Item, { item, width })
        )
    );
}
