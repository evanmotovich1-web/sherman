// The activity indicator.
//
// This is load-bearing, not decoration. D8 means there are no token deltas: a
// short answer lands all at once after a multi-second pause, and the FIRST turn
// is the slowest one in the product (~19,900 input tokens, nothing cached until
// turn 2). With nothing on screen during that wait, a working shell reads as a
// hung one — and the wait is the very first thing a new user experiences.
//
// The status rule owns the sole spinner and timer. This component renders only
// factual lifecycle/tool lines, preventing duplicated "working" chrome.

import React from 'react';
import { Text, Box, useWindowSize } from 'ink';

import { color } from './theme.js';
import { safeTerminalText } from './sanitize.js';

/**
 * @param {{active: boolean, activities?: Array<{id:string,line:string,category?:string}>, lifecycle?: string|null, columns?: number, rows?: number}} props
 */
export function Thinking({ active, activities = [], lifecycle = null, columns, rows }) {
    const measured = useWindowSize();
    const viewportWidth = typeof columns === 'number' ? columns : measured.columns;
    const viewportRows = typeof rows === 'number' ? rows : measured.rows;
    const gutter = viewportWidth >= 4 ? 1 : 0;
    const statusRows = viewportRows >= 2 ? 1 : 0;
    // The composer is reserved chrome below this component, so its resting
    // height comes out of the budget before activity rows do. It draws a
    // rounded box — top border, prompt row, bottom border — whenever it has the
    // columns for it, and collapses to a single truncating text node below
    // Composer.js's width-10 floor.
    const composerRows = viewportWidth >= 10 ? 3 : 1;
    const maxRows = Math.min(3, Math.max(0, viewportRows - statusRows - composerRows));
    if (!active || maxRows === 0 || (activities.length === 0 && !lifecycle)) return null;

    // The activity line renders only what the engine actually sent. A silent
    // backend still has visible life in the status rule below.
    //
    // flexShrink:0 — the indicator is chrome inside the fixed-height root; only
    // the transcript above it is allowed to give up rows (see app.js).
    return React.createElement(
        Box,
        { flexDirection: 'column', flexShrink: 0, width: viewportWidth, paddingX: gutter },
        activities.length === 0 && lifecycle
            ? React.createElement(
                  Text,
                  { dimColor: true, italic: true, wrap: 'truncate' },
                  `  ${safeTerminalText(lifecycle)}`
              )
            : null,
        ...activities.slice(-maxRows).map((activity) =>
            React.createElement(
                Text,
                { key: activity.id, color: color.tertiary, wrap: 'truncate' },
                `  │ ${safeTerminalText(activity.line)}`
            )
        )
    );
}
