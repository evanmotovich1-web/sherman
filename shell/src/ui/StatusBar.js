// Hermes-sized status rule: state · engine/model · real context · session
//
// Every segment has a real source. Context appears only when both values exist:
// a token figure and a known/overridden model window.
//
// The token figure has TWO sources now, and the difference is visible on screen
// rather than only in the types. Between turns it is Codex's reported input
// count — measured, solid bar, plain number. During a turn Codex reports
// nothing at all (verified against codex-cli 0.145.0; see contextestimate.js),
// so the meter shows a local estimate: `~` on both the figure and the percent,
// a lighter ▒ fill, and never the over-window red. The measured value replaces
// it at turn end rather than being averaged with it.
//
// The window side is never estimated, and the bar still never animates as fake
// progress — a moving estimate is driven by characters that genuinely arrived,
// not by a timer.

import React from 'react';
import { Text, Box, useWindowSize, useAnimation } from 'ink';
import stringWidth from 'string-width';

import { color, SPINNER } from './theme.js';
import { safeTerminalText } from './sanitize.js';

// Chip geometry. Each segment sits on its own background chip with one space
// of padding on each side, and chips are separated by a single space on the
// default background — that gap is the only thing dividing them, so it is
// never spent on anything else. Total cost of a strip of N segments is
// therefore sum(stringWidth(plain) + CHIP_PADDING) + (N - 1) * CHIP_GAP.
const CHIP_PADDING = 2;
const CHIP_GAP = 1;
const METER_CELLS = 10;
const MIN_STATUS_COLUMNS = 9;

function formatTokens(total) {
    if (!total) return '0';
    if (total < 1000) return String(total);
    return `${(total / 1000).toFixed(1)}k`;
}

function formatK(total) {
    return `${(total / 1000).toFixed(1)}k`;
}

function truncateText(text, maxWidth) {
    if (stringWidth(text) <= maxWidth) return text;
    if (maxWidth < 1) return '';
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let visible = '';
    for (const { segment } of segmenter.segment(text)) {
        if (stringWidth(visible + segment) > maxWidth - 1) break;
        visible += segment;
    }
    return `${visible}…`;
}

function formatDuration(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * The context meter.
 *
 * `estimated` marks a figure Codex has not reported yet — see
 * contextestimate.js for why one exists at all. It is never rendered as a bare
 * number: a `~` leads both the token figure and the percentage, so the two
 * places a reader actually looks both say "about". The mark is in the PLAIN
 * text, not only in the colour, because a narrow terminal drops to `tinyPlain`
 * and a colour-blind or NO_COLOR terminal drops the tint entirely — an estimate
 * distinguished only by ink would read as measured in exactly the conditions
 * where the operator is least able to check.
 *
 * The bar itself also stops short of solid while estimating: a filled cell is a
 * claim about a tenth of the window, and the estimate cannot see the system
 * prompt, the files Codex read, or its own reasoning tokens, so it understates.
 */
function contextSegment(used, window, busy, estimated = false) {
    if (!Number.isFinite(used) || used < 0 || !Number.isFinite(window) || window <= 0) {
        return null;
    }

    const ratio = used / window;
    const percent = Math.max(0, Math.round(ratio * 100));
    const filled = ratio >= 1
        ? METER_CELLS
        : Math.max(0, Math.floor(ratio * METER_CELLS));
    // An estimate never borrows the alarm colour. Red says "you are over the
    // window", which is a measured claim this figure has not earned.
    const contextTint = ratio > 1 && !estimated ? color.error : color.accent;
    const mark = estimated ? '~' : '';
    const label = `${mark}${formatK(used)}/${formatK(window)}`;
    const pct = `${mark}${percent}%`;
    // Estimated fill reads as the lighter ▒ rather than the solid █, so the
    // meter's own texture says provisional before any number is read.
    const fillGlyph = estimated ? '▒' : '█';
    const bar = `${fillGlyph.repeat(filled)}${'░'.repeat(METER_CELLS - filled)}`;

    return {
        key: 'context',
        plain: `${label} · [${bar}] ${pct}`,
        compactPlain: `[${bar}] ${pct}`,
        tinyPlain: pct,
        spans: [
            { text: `${label} · [`, tint: color.muted },
            { text: fillGlyph.repeat(filled), tint: contextTint, dim: estimated || !busy, bold: busy && !estimated },
            { text: '░'.repeat(METER_CELLS - filled), tint: color.meterEmpty, dim: true },
            { text: `] ${pct}`, tint: contextTint, dim: estimated || !busy, bold: busy && !estimated },
        ],
        compactSpans: [
            { text: '[', tint: color.frame, dim: !busy },
            { text: fillGlyph.repeat(filled), tint: contextTint, dim: estimated || !busy, bold: busy && !estimated },
            { text: '░'.repeat(METER_CELLS - filled), tint: color.meterEmpty, dim: true },
            { text: `] ${pct}`, tint: contextTint, dim: estimated || !busy, bold: busy && !estimated },
        ],
        tinySpans: [{ text: pct, tint: contextTint, dim: estimated || !busy, bold: busy && !estimated }],
    };
}

/**
 * @param {{info: object, usage: object, contextUsed?: number|null, contextEstimated?: boolean, busy?: boolean, sessionStart?: number, lastTurnMs?: number|null, columns?: number, goal?: string, vaultOk?: boolean}} props
 */
export function StatusBar({
    info,
    usage,
    contextUsed = null,
    // True when contextUsed is a local estimate rather than a figure Codex
    // reported. Defaults false so every existing call site keeps meaning
    // "measured" without having to say so.
    contextEstimated = false,
    busy = false,
    sessionStart,
    lastTurnMs = null,
    columns,
    goal = '',
    vaultOk = true,
}) {
    const measured = useWindowSize().columns;
    const viewportWidth = typeof columns === 'number' ? columns : measured;
    const gutter = viewportWidth >= 4 ? 1 : 0;
    const width = Math.max(1, viewportWidth - gutter * 2);
    const configuredMotion = process.env.SHERMAN_MOTION;
    const reducedMotion = configuredMotion !== undefined
        && configuredMotion.trim().toLowerCase() !== 'on';
    // useAnimation resets frame and time when isActive flips false -> true.
    // This busy-only 10 Hz hook therefore reports this turn's elapsed time.
    // It knowingly repaints inside the fixed-height root because, during a
    // silent turn, this status indicator is the sole moving liveness signal.
    const { frame, time } = useAnimation({ interval: reducedMotion ? 1000 : 100, isActive: busy });
    // Return intentionally unused: this hook repaints the idle session clock.
    // 10s, not 1s: on a terminal too short for the tree (seen in Windows
    // Terminal via ConPTY), Ink cannot repaint in place and every tick
    // appends a copy of the frame -- a once-a-second idle clock turned that
    // into a waterfall. An idle clock that hops 10s at a time costs nothing;
    // during a turn the busy hook above still animates at full rate. The env
    // override exists for tests that need a fast repaint backstop, not for
    // operators.
    const idleTickMs = Number(process.env.SHERMAN_IDLE_TICK_MS) > 0
        ? Number(process.env.SHERMAN_IDLE_TICK_MS)
        : 10000;
    useAnimation({ interval: idleTickMs, isActive: !busy });

    if (viewportWidth < MIN_STATUS_COLUMNS) return null;

    const available = Math.max(1, width - 2);
    const elapsed = typeof sessionStart === 'number' ? Date.now() - sessionStart : null;
    const spinner = reducedMotion ? '●' : SPINNER[frame % SPINNER.length];
    const statusText = busy
        ? width < 40
            ? `${spinner} ${(time / 1000).toFixed(1)}s`
            : `${spinner} working · ${(time / 1000).toFixed(1)}s`
        : vaultOk === false ? 'blocked' : 'ready';
    const safeEngine = safeTerminalText(info.engine);
    const safeModel = safeTerminalText(info.model);
    const compactModel = truncateText(safeModel, 16);
    const modelText = safeEngine ? `${safeEngine}·${safeModel}` : safeModel;
    const compactModelText = safeEngine ? `${safeEngine}·${compactModel}` : compactModel;
    const modelSpans = [
        ...(safeEngine
            ? [
                  { text: safeEngine, tint: color.muted },
                  { text: '·', tint: color.frame, dim: !busy },
              ]
            : []),
        { text: safeModel, tint: color.valueModel, bold: true },
    ];
    const compactModelSpans = [
        ...(safeEngine
            ? [
                  { text: safeEngine, tint: color.muted },
                  { text: '·', tint: color.frame, dim: !busy },
              ]
            : []),
        { text: compactModel, tint: color.valueModel, bold: true },
    ];

    const segments = [
        {
            key: 'status',
            plain: statusText,
            spans: [{
                text: statusText,
                tint: busy ? color.accent : vaultOk === false ? color.error : color.tertiary,
                bold: busy || vaultOk === false,
            }],
        },
    ];
    if (safeModel) {
        segments.push({
            key: 'model',
            plain: modelText,
            compactPlain: compactModelText,
            spans: modelSpans,
            compactSpans: compactModelSpans,
        });
    }

    const context = contextSegment(contextUsed, info.contextWindow, busy, contextEstimated);
    if (context) {
        segments.push(context);
    } else if ((usage?.total ?? 0) > 0) {
        segments.push({
            key: 'tokens',
            plain: `${formatTokens(usage.total)} tok`,
            spans: [{ text: `${formatTokens(usage.total)} tok`, tint: color.muted }],
        });
    }

    if (elapsed !== null) {
        const duration = `session ${formatDuration(elapsed)}`;
        segments.push({
            key: 'duration',
            plain: duration,
            spans: [{ text: duration, tint: color.muted }],
        });
    }
    if (!busy && typeof lastTurnMs === 'number') {
        const last = `last ${(lastTurnMs / 1000).toFixed(1)}s`;
        segments.push({ key: 'last', plain: last, spans: [{ text: last, tint: color.tertiary }] });
    }
    const safeGoal = truncateText(safeTerminalText(goal), 40);
    if (safeGoal) {
        segments.push({
            key: 'goal',
            plain: 'goal set',
            compactPlain: 'goal set',
            spans: [{ text: 'goal set', tint: color.secondary }],
            compactSpans: [{ text: 'goal set', tint: color.secondary }],
        });
    }

    const stripWidth = (list) => (list.length === 0 ? 0 : list.reduce(
        (total, segment) => total + stringWidth(segment.plain) + CHIP_PADDING,
        (list.length - 1) * CHIP_GAP
    ));
    const fits = (list) => stripWidth(list) <= available;
    let visible = segments;
    if (!fits(visible)) visible = visible.filter((segment) => segment.key !== 'last');
    if (!fits(visible)) visible = visible.filter((segment) => segment.key !== 'duration');
    if (!fits(visible)) visible = visible.filter((segment) => segment.key !== 'tokens');
    if (!fits(visible)) {
        visible = visible.map((segment) =>
            segment.key === 'model'
                ? { ...segment, plain: segment.compactPlain, spans: segment.compactSpans }
                : segment
        );
    }
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
    if (!fits(visible)) visible = visible.filter((segment) => segment.key !== 'context');
    if (!fits(visible)) {
        visible = visible.map((segment) =>
            segment.key === 'goal'
                ? { ...segment, plain: segment.compactPlain, spans: segment.compactSpans }
                : segment
        );
    }
    if (!fits(visible)) {
        const withoutModel = visible.filter((segment) => segment.key !== 'model');
        // What is left for the model chip's text once the other chips, their
        // padding, and the gap in front of this one are paid for.
        const usedWithoutModel = stripWidth(withoutModel)
            + (withoutModel.length > 0 ? CHIP_GAP : 0);
        const modelBudget = Math.max(0, available - usedWithoutModel - CHIP_PADDING);
        visible = visible.map((segment) => {
            if (segment.key !== 'model' || modelBudget < 1) return segment;
            const text = truncateText(segment.plain, modelBudget);
            return {
                ...segment,
                plain: text,
                spans: [{ text, tint: color.valueModel, bold: true }],
            };
        });
    }
    if (!fits(visible)) visible = visible.filter((segment) => segment.key !== 'model');
    if (!fits(visible)) visible = visible.filter((segment) => segment.key !== 'goal');

    // Chips, in order, each one its own run of background-filled Text nodes.
    // Ink applies backgroundColor per Text node, so the padding spaces carry
    // the chip fill too; the single-space gap between chips deliberately does
    // not, which is what makes the separation visible. There is no opener and
    // no filler rule — the strip simply ends after the last chip.
    const children = [];
    visible.forEach((segment, index) => {
        if (index > 0) {
            children.push(React.createElement(Text, { key: `gap${index}` }, ' '.repeat(CHIP_GAP)));
        }
        children.push(
            React.createElement(
                Text,
                { key: `pad-l${index}`, backgroundColor: color.chipBg },
                ' '
            )
        );
        segment.spans.forEach((span, spanIndex) => {
            children.push(
                React.createElement(
                    Text,
                    {
                        key: `s${index}.${spanIndex}`,
                        color: span.tint,
                        backgroundColor: color.chipBg,
                        dimColor: span.dim === true,
                        bold: span.bold === true,
                    },
                    span.text
                )
            );
        });
        children.push(
            React.createElement(
                Text,
                { key: `pad-r${index}`, backgroundColor: color.chipBg },
                ' '
            )
        );
    });

    return React.createElement(
        Box,
        { width: viewportWidth, paddingX: gutter, flexShrink: 0 },
        React.createElement(Text, { wrap: 'truncate' }, ...children)
    );
}