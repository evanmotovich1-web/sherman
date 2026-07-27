// engine · model | tokens | real context meter | session minutes | turn timer
//
// Every segment has a real source. Context appears only when both values exist:
// the latest turn's reported input tokens and a known/overridden model window.
// The bar never estimates either side and never animates as fake progress.

import React from 'react';
import { Text, Box, useWindowSize, useAnimation } from 'ink';

import { color } from './theme.js';

const SEP = ' | ';
const METER_CELLS = 10;

function formatTokens(total) {
    if (!total) return '0';
    if (total < 1000) return String(total);
    return `${(total / 1000).toFixed(1)}k`;
}

function formatK(total) {
    const value = total / 1000;
    return `${Number.isInteger(value) ? value : value.toFixed(1)}K`;
}

function contextSegment(used, window, busy) {
    if (!Number.isFinite(used) || used < 0 || !Number.isFinite(window) || window <= 0) {
        return null;
    }

    const percent = Math.max(0, Math.min(100, Math.round((used / window) * 100)));
    const filled = Math.max(0, Math.min(METER_CELLS, Math.round(percent / 10)));
    const label = `${formatK(used)}/${formatK(window)}`;
    const bar = `${'█'.repeat(filled)}${'░'.repeat(METER_CELLS - filled)}`;

    return {
        key: 'context',
        plain: `${label} | [${bar}] ${percent}%`,
        compactPlain: `[${bar}] ${percent}%`,
        tinyPlain: `${percent}%`,
        spans: [
            { text: `${label} | [`, tint: color.muted },
            { text: '█'.repeat(filled), tint: color.accent, dim: !busy, bold: busy },
            { text: '░'.repeat(METER_CELLS - filled), tint: color.frame, dim: true },
            { text: `] ${percent}%`, tint: color.accent, dim: !busy, bold: busy },
        ],
        compactSpans: [
            { text: '[', tint: color.frame, dim: !busy },
            { text: '█'.repeat(filled), tint: color.accent, dim: !busy, bold: busy },
            { text: '░'.repeat(METER_CELLS - filled), tint: color.frame, dim: true },
            { text: `] ${percent}%`, tint: color.accent, dim: !busy, bold: busy },
        ],
        tinySpans: [{ text: `${percent}%`, tint: color.accent, dim: !busy, bold: busy }],
    };
}

/**
 * @param {{info: object, usage: object, contextUsed?: number|null, busy?: boolean, sessionStart?: number, lastTurnMs?: number|null, columns?: number}} props
 */
export function StatusBar({
    info,
    usage,
    contextUsed = null,
    busy = false,
    sessionStart,
    lastTurnMs = null,
    columns,
}) {
    const measured = useWindowSize().columns;
    const width = typeof columns === 'number' ? columns : measured;

    // Only the factual timer ticks here. The trace owns the sole spinner.
    const { time } = useAnimation({ interval: 1000, isActive: busy });
    useAnimation({ interval: 30000, isActive: !busy });

    const available = Math.max(1, width - 1);
    const minutes =
        typeof sessionStart === 'number'
            ? Math.max(0, Math.floor((Date.now() - sessionStart) / 60000))
            : null;

    const segments = [
        {
            key: 'id',
            plain: `${info.engine} · ${info.model}`,
            spans: [
                { text: info.engine, tint: color.muted },
                { text: ' · ', tint: color.frame, dim: !busy },
                { text: info.model, tint: color.muted },
            ],
        },
        {
            key: 'tokens',
            plain: `${formatTokens(usage?.total ?? 0)} tok`,
            spans: [{ text: `${formatTokens(usage?.total ?? 0)} tok`, tint: color.muted }],
        },
    ];

    const context = contextSegment(contextUsed, info.contextWindow, busy);
    if (context) segments.push(context);

    if (minutes !== null) {
        segments.push({
            key: 'session',
            plain: `session ${minutes}m`,
            spans: [{ text: `session ${minutes}m`, tint: color.muted }],
        });
    }

    if (busy) {
        const seconds = (time / 1000).toFixed(1);
        segments.push({
            key: 'turn',
            plain: `turn ${seconds}s`,
            spans: [{ text: `turn ${seconds}s`, tint: color.accent, bold: true }],
        });
    } else if (typeof lastTurnMs === 'number') {
        const seconds = (lastTurnMs / 1000).toFixed(1);
        segments.push({
            key: 'turn',
            plain: `last ${seconds}s`,
            spans: [{ text: `last ${seconds}s`, dim: true }],
        });
    }

    const fits = (list) => list.map((segment) => segment.plain).join(SEP).length <= available;
    let visible = segments;

    if (!fits(visible)) visible = visible.filter((segment) => segment.key !== 'session');
    if (!fits(visible)) {
        visible = visible.map((segment) =>
            segment.key === 'id'
                ? {
                      ...segment,
                      plain: info.engine,
                      spans: [{ text: info.engine, tint: color.muted }],
                  }
                : segment
        );
    }
    if (!fits(visible)) visible = visible.filter((segment) => segment.key !== 'tokens');
    if (!fits(visible)) visible = visible.filter((segment) => segment.key !== 'id');
    if (!fits(visible)) {
        visible = visible.map((segment) =>
            segment.key === 'context'
                ? { ...segment, plain: segment.compactPlain, spans: segment.compactSpans }
                : segment
        );
    }
    if (!fits(visible)) {
        visible = visible.map((segment) =>
            segment.key === 'context'
                ? { ...segment, plain: segment.tinyPlain, spans: segment.tinySpans }
                : segment
        );
    }

    const children = [];
    visible.forEach((segment, index) => {
        if (index > 0) {
            children.push(
                React.createElement(
                    Text,
                    { key: `sep${index}`, color: color.frame, dimColor: !busy },
                    SEP
                )
            );
        }
        segment.spans.forEach((span, spanIndex) => {
            children.push(
                React.createElement(
                    Text,
                    {
                        key: `s${index}.${spanIndex}`,
                        color: span.tint,
                        dimColor: span.dim === true,
                        bold: span.bold === true,
                    },
                    span.text
                )
            );
        });
    });

    return React.createElement(
        Box,
        null,
        React.createElement(Text, { wrap: 'truncate' }, ...children)
    );
}