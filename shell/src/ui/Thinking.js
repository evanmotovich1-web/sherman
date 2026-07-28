// The activity indicator.
//
// This is load-bearing, not decoration. D8 means there are no token deltas: a
// short answer lands all at once after a multi-second pause, and the FIRST turn
// is the slowest one in the product (~19,900 input tokens, nothing cached until
// turn 2). With nothing on screen during that wait, a working shell reads as a
// hung one — and the wait is the very first thing a new user experiences.
//
// `useAnimation` carries the whole job: `frame` indexes the spinner, `time` is
// elapsed milliseconds. No setInterval, no Date.now() bookkeeping, and the values
// reset themselves when `isActive` flips false -> true, which is once per turn.

import React from 'react';
import { Text, Box, useAnimation } from 'ink';

import { color, SPINNER } from './theme.js';

/**
 * @param {{active: boolean, activities?: Array<{id:string,line:string,category?:string}>, lifecycle?: string|null}} props
 */
export function Thinking({ active, activities = [], lifecycle = null }) {
    const { frame, time } = useAnimation({ interval: 80, isActive: active });

    if (!active) return null;

    const glyph = process.env.SHERMAN_MOTION === 'off' ? '●' : SPINNER[frame % SPINNER.length];
    const seconds = (time / 1000).toFixed(1);

    // A real in-flight tool sits above the persistent thinking tail. The tail
    // never gets replaced: even a silent backend therefore has visible life,
    // while the activity line still renders only what the engine actually sent.
    //
    // flexShrink:0 — the indicator is chrome inside the fixed-height root; only
    // the transcript above it is allowed to give up rows (see app.js).
    return React.createElement(
        Box,
        { flexDirection: 'column', flexShrink: 0 },
        activities.length === 0 && lifecycle
            ? React.createElement(
                  Text,
                  { dimColor: true, italic: true, wrap: 'truncate' },
                  `  ${lifecycle}`
              )
            : null,
        ...activities.slice(-3).map((activity) =>
            React.createElement(
                Text,
                { key: activity.id, color: color.tertiary, wrap: 'truncate' },
                `  │ ${activity.line}`
            )
        ),
        React.createElement(
            Text,
            null,
            React.createElement(Text, { color: color.accent }, `  ${glyph} `),
            React.createElement(Text, { color: color.muted }, 'working'),
            React.createElement(Text, { dimColor: true, italic: true }, `  ${seconds}s`)
        )
    );
}
