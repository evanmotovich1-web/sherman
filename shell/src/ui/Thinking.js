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
 * @param {{active: boolean, activity: string | null}} props
 */
export function Thinking({ active, activity }) {
    const { frame, time } = useAnimation({ interval: 80, isActive: active });

    if (!active) return null;

    const glyph = SPINNER[frame % SPINNER.length];
    const seconds = (time / 1000).toFixed(1);

    // The label narrates the turn: a generic word held for thirty seconds tells
    // the user nothing, so the newest reasoning/tool line replaces it as the
    // engine works.
    const what = activity && activity.length > 0 ? activity : 'thinking';

    return React.createElement(
        Box,
        null,
        React.createElement(Text, { color: color.accent }, `${glyph} `),
        React.createElement(Text, null, what),
        // Elapsed time stays dim: it should be checkable, not attention-grabbing.
        React.createElement(Text, { dimColor: true }, `  ${seconds}s`)
    );
}
