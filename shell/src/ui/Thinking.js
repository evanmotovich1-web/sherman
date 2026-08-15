// The activity indicator.
//
// This is load-bearing, not decoration. D8 means there are no token deltas: a
// short answer lands all at once after a multi-second pause, and the FIRST turn
// is the slowest one in the product (~19,900 input tokens, nothing cached until
// turn 2). With nothing on screen during that wait, a working shell reads as a
// hung one — and the wait is the very first thing a new user experiences.
// (Chat turns stream now, but tool work still runs in silence between deltas,
// and every non-streaming path still leans on this entirely.)
//
// The status rule owns the sole spinner and timer for the TURN. What each row
// here carries since the live-clock work is a per-tool elapsed suffix — the
// reference's per-call timer, translated to this house's rules: no second
// spinner, and the suffix states only a measured fact ("reported 12s ago"),
// ticking once a second the way the status rule's own clock does under
// reduced motion.

import React, { useEffect, useState } from 'react';
import { Text, Box, useWindowSize } from 'ink';

import { color } from './theme.js';
import { safeTerminalText } from './sanitize.js';

/** How often the running clocks advance. Once a second: the suffix shows
 *  whole seconds, so ticking faster would repaint identical frames. */
export const CLOCK_TICK_MS = 1000;

/**
 * The elapsed suffix for one activity row, or '' when it has none.
 *
 * A row earns a clock only while it is genuinely RUNNING: it has an arrival
 * time and no engine-measured duration yet. A completed row's true duration
 * arrives from the engine and renders through the trace instead — showing
 * wall-clock past that point would be a second, disagreeing number.
 *
 * Pure, with `now` injectable, so the cadence is testable without timers.
 */
export function elapsedSuffix(activity, now = Date.now()) {
    if (!activity || Number.isFinite(activity.durationMs)) return '';
    if (!Number.isFinite(activity.startedAt)) return '';
    const seconds = Math.max(0, Math.floor((now - activity.startedAt) / 1000));
    return ` · ${seconds}s`;
}

/**
 * @param {{active: boolean, activities?: Array<{id:string,line:string,category?:string}>, lifecycle?: string|null, columns?: number, rows?: number}} props
 */
/**
 * Rows left for the activity region after the chrome below it is reserved.
 *
 * Exported because two components now share this budget -- the tool trace here
 * and the one-row ActivityLine beneath it. Computing it in one place is what
 * stops the two from each believing they have the last row.
 *
 * The composer is reserved chrome, so its resting height comes out of the
 * budget before activity rows do. It draws a rounded box — top border, prompt
 * row, bottom border — whenever it has the columns for it, and collapses to a
 * single truncating text node below Composer.js's width-10 floor.
 */
export function activityBudget(viewportWidth, viewportRows) {
    const statusRows = viewportRows >= 2 ? 1 : 0;
    const composerRows = viewportWidth >= 10 ? 3 : 1;
    return Math.max(0, viewportRows - statusRows - composerRows);
}

export function Thinking({ active, activities = [], lifecycle = null, columns, rows, reserveRows = 0, now = null }) {
    const measured = useWindowSize();
    const viewportWidth = typeof columns === 'number' ? columns : measured.columns;
    const viewportRows = typeof rows === 'number' ? rows : measured.rows;
    const gutter = viewportWidth >= 4 ? 1 : 0;
    const maxRows = Math.min(
        3,
        Math.max(0, activityBudget(viewportWidth, viewportRows) - reserveRows)
    );

    // The clock tick. Runs only while a row is actually wearing a clock, so
    // an idle shell — and a turn whose tools have all completed — is not
    // re-rendering every second for nothing. `now` is injectable so off-TTY
    // fixtures render a deterministic frame instead of racing the timer.
    const hasRunning = activities.some((a) => elapsedSuffix(a) !== '');
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!active || !hasRunning || now !== null) return undefined;
        const id = setInterval(() => setTick((n) => n + 1), CLOCK_TICK_MS);
        return () => clearInterval(id);
    }, [active, hasRunning, now]);

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
        ...activities.slice(-maxRows).map((activity) => {
            const suffix = elapsedSuffix(activity, now ?? Date.now());
            return React.createElement(
                Text,
                { key: activity.id, wrap: 'truncate' },
                React.createElement(
                    Text,
                    { color: color.tertiary },
                    `  ┊ ${safeTerminalText(activity.line)}`
                ),
                suffix === ''
                    ? null
                    : React.createElement(Text, { color: color.muted }, suffix)
            );
        })
    );
}
