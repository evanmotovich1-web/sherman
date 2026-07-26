// engine · model | tokens | session minutes | turn timer / last turn
//
// Hermes-style segments in the red family, under one rule: every segment has a
// real data source — session.info, session.usage, or a real clock — or it does
// not appear. There is deliberately NO context-percent segment: this transport
// reports no context-window figure (probed at 04-01), and a percentage of an
// invented denominator would be the one dishonest number on an honest screen.
//
// It must never wrap. A wrapped status bar does not look like a smaller status
// bar, it looks like the app is broken — so on a narrow terminal segments are
// dropped in a deliberate order rather than allowed to spill.

import React from 'react';
import { Text, Box, useWindowSize, useAnimation } from 'ink';

import { color } from './theme.js';

const SEP = ' | ';

/** 60258 -> "60.3k". A status bar wants a number you can glance at. */
function formatTokens(total) {
    if (!total) return '0';
    if (total < 1000) return String(total);
    return `${(total / 1000).toFixed(1)}k`;
}

/**
 * @param {{info: object, usage: object, busy?: boolean, sessionStart?: number, lastTurnMs?: number | null, columns?: number}} props
 *
 * `columns` is injectable (D17): useWindowSize reports a fixed 80 under
 * renderToString, so the segment-drop behaviour below would otherwise be
 * untestable off a TTY. Live, nothing passes it and the hook wins.
 */
export function StatusBar({ info, usage, busy = false, sessionStart, lastTurnMs = null, columns }) {
    const measured = useWindowSize().columns;
    const width = typeof columns === 'number' ? columns : measured;

    // Two clocks. The 1s tick is the live turn timer (time resets when `busy`
    // flips, which is once per turn). The slow tick only exists so the session
    // minutes cannot go stale while the shell sits idle.
    const { time } = useAnimation({ interval: 1000, isActive: busy });
    useAnimation({ interval: 30000, isActive: !busy });

    const available = Math.max(20, width - 1);

    const minutes =
        typeof sessionStart === 'number'
            ? Math.max(0, Math.floor((Date.now() - sessionStart) / 60000))
            : null;

    // Segments as span lists, so one string can carry several colours. `plain`
    // is what the width math counts.
    const segments = [];

    segments.push({
        key: 'id',
        plain: `${info.engine} · ${info.model}`,
        spans: [
            { text: info.engine, tint: color.muted },
            { text: ' · ', tint: color.frame },
            { text: info.model, tint: color.muted },
        ],
    });

    segments.push({
        key: 'tokens',
        plain: `${formatTokens(usage?.total ?? 0)} tok`,
        spans: [{ text: `${formatTokens(usage?.total ?? 0)} tok`, tint: color.muted }],
    });

    if (minutes !== null) {
        segments.push({
            key: 'session',
            plain: `session ${minutes}m`,
            spans: [{ text: `session ${minutes}m`, tint: color.muted }],
        });
    }

    // Live timer while working, last duration after — never both, and neither
    // before the first turn has even started.
    if (busy) {
        const s = (time / 1000).toFixed(1);
        segments.push({
            key: 'turn',
            plain: `turn ${s}s`,
            spans: [{ text: `turn ${s}s`, tint: color.accent }],
        });
    } else if (typeof lastTurnMs === 'number') {
        const s = (lastTurnMs / 1000).toFixed(1);
        segments.push({
            key: 'turn',
            plain: `last ${s}s`,
            spans: [{ text: `last ${s}s`, dim: true }],
        });
    }

    // Narrow terminals: sacrifice in a deliberate order. Session minutes go
    // first (least surprising to lose), then the model (engine remains), and
    // tokens + the timer are never dropped — they are the values that change.
    const fits = (segs) =>
        segs.map((s) => s.plain).join(SEP).length <= available;

    let visible = segments;
    if (!fits(visible)) {
        visible = visible.filter((s) => s.key !== 'session');
    }
    if (!fits(visible)) {
        visible = visible.map((s) =>
            s.key === 'id'
                ? { ...s, plain: info.engine, spans: [{ text: info.engine, tint: color.muted }] }
                : s
        );
    }

    const children = [];
    visible.forEach((seg, i) => {
        if (i > 0) {
            children.push(
                React.createElement(Text, { key: `sep${i}`, color: color.frame }, SEP)
            );
        }
        seg.spans.forEach((span, j) => {
            children.push(
                React.createElement(
                    Text,
                    {
                        key: `s${i}.${j}`,
                        color: span.tint,
                        dimColor: span.dim === true,
                    },
                    span.text
                )
            );
        });
    });

    return React.createElement(
        Box,
        null,
        // `truncate` is the last line of defence: even fully dropped, a
        // 20-column terminal must not wrap.
        React.createElement(Text, { wrap: 'truncate' }, ...children)
    );
}
