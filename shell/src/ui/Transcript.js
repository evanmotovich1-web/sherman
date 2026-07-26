// Committed conversation history.
//
// Everything here goes through a single <Static> (D12). Ink writes those rows out
// once and then stops managing them, which is what leaves them in the terminal's
// OWN scrollback — so the mouse wheel and Cmd-F work the way people expect. The
// alternate screen would give a tidier fixed layout and destroy exactly that.
//
// ONE <Static> for the whole history, with the banner as its first item. Ink only
// reliably supports a single Static instance, and threading the banner through the
// same list also guarantees it stays above the first message.

import React from 'react';
import { Text, Box, Static } from 'ink';

import { color } from './theme.js';
import { Banner } from './Header.js';
import { LaunchScreen } from './LaunchScreen.js';

// Width of the speaker gutter. A fixed column means wrapped lines hang under the
// text rather than under the label.
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

/** One committed transcript item. */
function Item({ item }) {
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
                Row,
                { label: 'you', labelColor: color.muted },
                React.createElement(Text, { color: color.user }, item.text)
            );

        case 'message':
            return React.createElement(
                Row,
                { label: 'sherman', labelColor: color.accent, bold: true },
                React.createElement(Text, null, item.text)
            );

        // Reasoning and tool lines are deliberately quiet. They exist to prove
        // work is happening, not to be read closely.
        case 'reasoning':
            return React.createElement(
                Row,
                { label: '', labelColor: color.faint },
                React.createElement(Text, { dimColor: true }, `thinking · ${item.text}`)
            );

        case 'tool':
            return React.createElement(
                Row,
                { label: '', labelColor: color.faint },
                React.createElement(Text, { dimColor: true }, `· ${item.text}`)
            );

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
 * @param {{items: Array<{id: string, kind: string, text?: string}>}} props
 */
export function Transcript({ items }) {
    return React.createElement(Static, { items }, (item) =>
        React.createElement(
            Box,
            { key: item.id, flexDirection: 'column', marginBottom: item.kind === 'message' ? 1 : 0 },
            React.createElement(Item, { item })
        )
    );
}
