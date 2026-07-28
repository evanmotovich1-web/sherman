import React from 'react';
import { Box, Text } from 'ink';

import { color } from './theme.js';

export function CommandMenu({ commands, selected = 0 }) {
    if (!commands || commands.length === 0) return null;

    return React.createElement(
        Box,
        {
            flexDirection: 'column',
            borderStyle: 'round',
            borderColor: color.secondary,
            paddingX: 1,
            flexShrink: 0,
        },
        React.createElement(
            Text,
            { color: color.secondary, bold: true },
            'commands'
        ),
        ...commands.map((command, index) =>
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
                    ` ${command.usage} `
                ),
                React.createElement(Text, { color: color.muted }, `  ${command.summary}`)
            )
        )
    );
}
