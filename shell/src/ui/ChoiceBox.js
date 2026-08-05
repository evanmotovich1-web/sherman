import React from 'react';
import { Box, Text } from 'ink';

import { color } from './theme.js';

export function ChoiceBox({ question, choices, selected = 0, width = 80 }) {
    const safeWidth = Math.max(16, width);
    const selectedIndex = Math.max(0, Math.min(selected, choices.length - 1));
    return React.createElement(
        Box,
        {
            flexDirection: 'column',
            width: safeWidth,
            borderStyle: 'round',
            borderColor: color.secondary,
            paddingX: 1,
            flexShrink: 0,
        },
        React.createElement(Text, { color: color.secondary, bold: true, wrap: 'wrap' }, question),
        ...choices.map((choice, index) => React.createElement(
            Text,
            {
                key: `${index}:${choice}`,
                color: index === selectedIndex ? color.accent : color.muted,
                bold: index === selectedIndex,
                inverse: index === selectedIndex,
                wrap: 'truncate',
            },
            `${index === selectedIndex ? '›' : ' '} ${choice}`
        )),
        React.createElement(Text, { color: color.muted, dimColor: true }, '↑↓ choose · Enter continue')
    );
}
