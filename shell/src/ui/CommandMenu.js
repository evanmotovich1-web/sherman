import React from 'react';
import { Box, Text } from 'ink';

import { color } from './theme.js';

const MIN_MENU_WIDTH = 16;

export function CommandMenu({ commands, selected = 0, width = 80, maxRows = Infinity }) {
    if (!commands || commands.length === 0 || width < MIN_MENU_WIDTH || maxRows < 1) return null;

    const selectedIndex = Math.max(0, Math.min(selected, commands.length - 1));
    const commandLabel = (command) => width < 33 ? `/${command.name}` : command.usage;
    // Skills are the other contract on this palette, and the ink says which is
    // which: skill rows take the brand's purple (secondary) where first-party
    // command rows keep blue (tertiary) — selected included, so completing a
    // skill highlights in purple rather than dressing it as a command.
    const rowInk = (entry) => (entry.kind === 'skill' ? color.secondary : color.tertiary);
    const selectedInk = (entry) => (entry.kind === 'skill' ? color.secondary : color.accent);

    if (maxRows < 4) {
        const command = commands[selectedIndex];
        return React.createElement(
            Text,
            { color: selectedInk(command), bold: true, inverse: true, wrap: 'truncate' },
            ` ${commandLabel(command)} `
        );
    }

    const capacity = Math.max(1, Math.floor(maxRows) - 3);
    const start = Math.max(
        0,
        Math.min(selectedIndex - Math.floor(capacity / 2), commands.length - capacity)
    );
    const visible = commands.slice(start, start + capacity);

    return React.createElement(
        Box,
        {
            flexDirection: 'column',
            width: width - 2,
            marginX: 1,
            borderStyle: 'round',
            borderColor: color.frame,
            paddingX: 1,
            flexShrink: 0,
        },
        React.createElement(
            Text,
            { color: color.secondary, bold: true, wrap: 'truncate' },
            // The header states what the window cannot show: when entries are
            // clipped, their true count and the keys that reach them — a
            // silently windowed list would read as the whole registry.
            (commands.some((entry) => entry.kind === 'skill') ? '/ commands · skills' : '/ commands')
                + (visible.length < commands.length ? ` · ↑↓ scrolls ${commands.length} entries` : '')
        ),
        ...visible.map((command, visibleIndex) => {
            const index = start + visibleIndex;
            return (
            React.createElement(
                Text,
                { key: command.name, wrap: 'truncate' },
                React.createElement(
                    Text,
                    {
                        color: index === selected ? selectedInk(command) : rowInk(command),
                        bold: index === selected,
                        inverse: index === selected,
                    },
                    ` ${commandLabel(command)} `
                ),
                width >= 74
                    ? React.createElement(Text, { color: color.muted }, `  ${command.summary}`)
                    : null
            )
            );
        })
    );
}
