import React from 'react';
import { Box, Text } from 'ink';

import { color } from './theme.js';

const MIN_MENU_WIDTH = 16;

export function CommandMenu({ commands, selected = 0, width = 80, maxRows = Infinity }) {
    if (!commands || commands.length === 0 || width < MIN_MENU_WIDTH || maxRows < 1) return null;

    const selectedIndex = Math.max(0, Math.min(selected, commands.length - 1));
    const commandLabel = (command) => width < 33 ? `/${command.name}` : command.usage;

    if (maxRows < 4) {
        const command = commands[selectedIndex];
        return React.createElement(
            Text,
            { color: color.accent, bold: true, inverse: true, wrap: 'truncate' },
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
            '/ commands'
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
                        color: index === selected ? color.accent : color.tertiary,
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
