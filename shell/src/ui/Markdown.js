// Markdown, rendered in the house inks.
//
// Sherman's replies used to print as raw text: the model's `**` and backticks
// reached the screen literally, which read as a log where the reference reads
// as a product. This renderer closes that gap with a hand-rolled subset —
// headings, emphasis, inline and fenced code, lists, quotes, rules, links,
// and aligned pipe tables — the shapes models actually emit, and nothing
// speculative beyond them.
//
// Two rules govern everything here:
//
// 1. The parser is PURE and exported. `parseBlocks` and `parseInline` take a
//    string and return plain data, so tests pin them without a render, and the
//    coming token-streaming work can freeze settled blocks and re-parse only
//    the live tail — the reference's technique — without touching this file.
// 2. Nothing is ever dropped. A construct this subset does not recognise, a
//    table too wide for the viewport, an unclosed fence at end of text — all
//    fall back to the literal lines. Wrong styling is recoverable; missing
//    content is not.
//
// Inks come from theme.js only. Headings carry the accent, inline code the
// tertiary blue, code blocks the readable value neutral, quotes and rules the
// muted gray — no colour is invented here, so the reply body stays inside the
// same palette as the frame around it.

import React from 'react';
import { Text, Box } from 'ink';
import stringWidth from 'string-width';

import { color } from './theme.js';

// ------------------------------------------------------------------ inline --

// One alternation, ordered by binding strength: code spans first (their
// content is opaque — a `*` inside backticks is a glyph, not emphasis), then
// links, bold, italic. Underscore italic requires non-space at both edges so
// snake_case_names survive unstyled.
const INLINE = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)/;

/**
 * Parse one line of text into styled spans.
 *
 * Returns an array of `{ text, bold?, italic?, code?, href? }` nodes. Nesting
 * goes one honest level deep — emphasis inside bold, code inside either —
 * which covers what models write without the cost of a real grammar.
 */
export function parseInline(text) {
    const nodes = [];
    let rest = String(text ?? '');
    while (rest.length > 0) {
        const match = INLINE.exec(rest);
        if (!match) {
            nodes.push({ text: rest });
            break;
        }
        if (match.index > 0) {
            nodes.push({ text: rest.slice(0, match.index) });
        }
        const token = match[0];
        if (match[1]) {
            nodes.push({ text: token.slice(1, -1), code: true });
        } else if (match[2]) {
            const split = token.indexOf('](');
            nodes.push({
                text: token.slice(1, split),
                href: token.slice(split + 2, -1),
            });
        } else if (match[3]) {
            for (const inner of parseInline(token.slice(2, -2))) {
                nodes.push({ ...inner, bold: true });
            }
        } else {
            for (const inner of parseInline(token.slice(1, -1))) {
                nodes.push({ ...inner, italic: true });
            }
        }
        rest = rest.slice(match.index + token.length);
    }
    return nodes;
}

// ------------------------------------------------------------------ blocks --

const FENCE = /^\s*```\s*(\S*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?[\s:|-]+-[\s:|-]*\|?\s*$/;

const isTableRow = (line) => typeof line === 'string' && line.includes('|');

/**
 * Parse markdown text into a flat list of block objects:
 *
 *   { type: 'heading', depth, text }
 *   { type: 'code', lang, lines }        — fence glyphs consumed
 *   { type: 'quote', lines }
 *   { type: 'list', items: [{ marker, text }] }
 *   { type: 'table', rows: [[cell]] }    — divider row consumed
 *   { type: 'rule' }
 *   { type: 'paragraph', lines }
 *
 * An unclosed fence keeps everything after it as code — the honest reading of
 * a reply that was cut off mid-block.
 */
export function parseBlocks(text) {
    const lines = String(text ?? '').split('\n');
    const blocks = [];
    let paragraph = [];
    const flush = () => {
        if (paragraph.length > 0) {
            blocks.push({ type: 'paragraph', lines: paragraph });
            paragraph = [];
        }
    };
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const fence = FENCE.exec(line);
        if (fence) {
            flush();
            const code = [];
            i += 1;
            while (i < lines.length && !FENCE.test(lines[i])) {
                code.push(lines[i]);
                i += 1;
            }
            blocks.push({ type: 'code', lang: fence[1] || '', lines: code });
            continue;
        }
        const heading = HEADING.exec(line);
        if (heading) {
            flush();
            blocks.push({ type: 'heading', depth: heading[1].length, text: heading[2] });
            continue;
        }
        if (RULE.test(line)) {
            flush();
            blocks.push({ type: 'rule' });
            continue;
        }
        if (QUOTE.test(line)) {
            flush();
            const quote = [];
            while (i < lines.length && QUOTE.test(lines[i])) {
                quote.push(QUOTE.exec(lines[i])[1]);
                i += 1;
            }
            i -= 1;
            blocks.push({ type: 'quote', lines: quote });
            continue;
        }
        if (LIST_ITEM.test(line)) {
            flush();
            const items = [];
            while (i < lines.length && LIST_ITEM.test(lines[i])) {
                const [, , marker, body] = LIST_ITEM.exec(lines[i]);
                items.push({ marker, text: body });
                i += 1;
            }
            i -= 1;
            blocks.push({ type: 'list', items });
            continue;
        }
        if (isTableRow(line) && TABLE_DIVIDER.test(lines[i + 1] ?? '')) {
            flush();
            const raw = [line];
            i += 2;
            while (i < lines.length && isTableRow(lines[i])) {
                raw.push(lines[i]);
                i += 1;
            }
            i -= 1;
            blocks.push({ type: 'table', rows: raw.map(splitTableRow), raw });
            continue;
        }
        if (line.trim() === '') {
            flush();
            continue;
        }
        paragraph.push(line);
    }
    flush();
    return blocks;
}

// Split `| a | b |` into trimmed cells, tolerating absent outer pipes.
function splitTableRow(line) {
    let cells = line.split('|');
    if (cells.length > 0 && cells[0].trim() === '') cells = cells.slice(1);
    if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells = cells.slice(0, -1);
    return cells.map((cell) => cell.trim());
}

// ---------------------------------------------------------------- rendering --

function InlineSpans({ nodes, baseColor }) {
    return React.createElement(
        Text,
        null,
        nodes.map((node, index) => {
            if (node.code) {
                return React.createElement(
                    Text,
                    { key: index, color: color.tertiary, bold: node.bold },
                    node.text
                );
            }
            if (node.href) {
                // The link text carries the light; the target trails in muted
                // parens. Hiding the URL behind OSC-8 was rejected — not every
                // terminal resolves it, and a link whose destination cannot be
                // seen cannot be trusted.
                return React.createElement(
                    Text,
                    { key: index },
                    React.createElement(Text, { color: color.tertiary, underline: true }, node.text),
                    React.createElement(Text, { color: color.muted }, ` (${node.href})`)
                );
            }
            return React.createElement(
                Text,
                { key: index, color: baseColor, bold: node.bold, italic: node.italic },
                node.text
            );
        })
    );
}

function InlineLine({ text, baseColor }) {
    return React.createElement(InlineSpans, { nodes: parseInline(text), baseColor });
}

function Heading({ depth, text }) {
    // Depth 1–2 carry the accent — the reply's own section marks deserve the
    // one vivid ink. Deeper headings stay bold in the readable neutral so a
    // heavily sectioned reply does not become a pink wall.
    const ink = depth <= 2 ? color.accent : color.value;
    return React.createElement(
        Text,
        { wrap: 'wrap', bold: true, color: ink },
        React.createElement(InlineSpans, { nodes: parseInline(text), baseColor: ink })
    );
}

function CodeBlock({ lang, lines }) {
    return React.createElement(
        Box,
        { flexDirection: 'column' },
        lang
            ? React.createElement(Text, { color: color.muted, wrap: 'truncate' }, `  ${lang}`)
            : null,
        (lines.length > 0 ? lines : ['']).map((line, index) =>
            React.createElement(
                Text,
                { key: index, color: color.value, wrap: 'wrap' },
                // Two-space indent sets code off from prose without a fill;
                // opaque backgrounds composite badly on transparent terminals.
                `  ${line === '' ? ' ' : line}`
            )
        )
    );
}

function Quote({ lines }) {
    return React.createElement(
        Box,
        { flexDirection: 'column' },
        lines.map((line, index) =>
            React.createElement(
                Text,
                { key: index, color: color.muted, italic: true, wrap: 'wrap' },
                `▏ `,
                React.createElement(InlineSpans, { nodes: parseInline(line), baseColor: color.muted })
            )
        )
    );
}

function List({ items, baseColor }) {
    return React.createElement(
        Box,
        { flexDirection: 'column' },
        items.map((item, index) => {
            // Ordered markers keep their number; unordered collapse to the
            // house bullet. Both hang the marker in a fixed two-cell-plus
            // gutter so wrapped lines align under the text.
            const ordered = /\d/.test(item.marker);
            const marker = ordered ? `${item.marker.replace(/[.)]$/, '.')} ` : '• ';
            return React.createElement(
                Box,
                { key: index, flexDirection: 'row' },
                React.createElement(
                    Box,
                    { flexShrink: 0 },
                    React.createElement(Text, { color: ordered ? color.secondary : color.accent }, `  ${marker}`)
                ),
                React.createElement(
                    Box,
                    { flexGrow: 1 },
                    React.createElement(
                        Text,
                        { wrap: 'wrap' },
                        React.createElement(InlineSpans, { nodes: parseInline(item.text), baseColor })
                    )
                )
            );
        })
    );
}

/**
 * An aligned pipe table. Column widths are measured with stringWidth so CJK
 * and emoji cells keep the grid true. If the aligned grid would overflow the
 * viewport, the block falls back to the literal source lines — a misaligned
 * table that shows everything beats a beautiful one that corrupts the layout.
 */
function Table({ rows, raw, width, baseColor }) {
    const columns = Math.max(...rows.map((row) => row.length));
    const widths = [];
    for (let col = 0; col < columns; col += 1) {
        widths.push(Math.max(...rows.map((row) => stringWidth(row[col] ?? ''))));
    }
    const total = widths.reduce((sum, w) => sum + w, 0) + (columns - 1) * 3;
    if (total > width) {
        return React.createElement(
            Box,
            { flexDirection: 'column' },
            raw.map((line, index) =>
                React.createElement(Text, { key: index, color: baseColor, wrap: 'wrap' }, line)
            )
        );
    }
    const pad = (cell, col) => cell + ' '.repeat(Math.max(0, widths[col] - stringWidth(cell)));
    const rule = widths.map((w) => '─'.repeat(w)).join('─┼─');
    return React.createElement(
        Box,
        { flexDirection: 'column' },
        rows.map((row, rowIndex) => {
            const cells = row.map((cell, col) =>
                React.createElement(
                    React.Fragment,
                    { key: col },
                    col > 0 ? React.createElement(Text, { color: color.muted }, ' │ ') : null,
                    React.createElement(
                        Text,
                        { color: rowIndex === 0 ? color.value : baseColor, bold: rowIndex === 0 },
                        pad(cell, col)
                    )
                )
            );
            const line = React.createElement(Text, { key: rowIndex, wrap: 'truncate' }, cells);
            if (rowIndex !== 0) return line;
            return React.createElement(
                React.Fragment,
                { key: 'head' },
                line,
                React.createElement(Text, { color: color.muted, wrap: 'truncate' }, rule)
            );
        })
    );
}

/**
 * The reply body, rendered. `text` must already be sanitized by the caller
 * (ShermanMessage runs safeTerminalText before anything reaches this file);
 * `width` is the transcript's content width, used only for the table
 * fallback decision. `baseColor` inks plain prose and defaults to the
 * terminal's own foreground.
 */
export function Markdown({ text, width, baseColor }) {
    const blocks = parseBlocks(text);
    return React.createElement(
        Box,
        { flexDirection: 'column' },
        blocks.map((block, index) =>
            React.createElement(
                Box,
                // One blank row between blocks — the source's blank-line
                // rhythm, spent once per boundary. The first block sits flush
                // under the titled rule.
                { key: index, flexDirection: 'column', marginTop: index === 0 ? 0 : 1 },
                React.createElement(BlockView, { block, width, baseColor })
            )
        )
    );
}

function BlockView({ block, width, baseColor }) {
    switch (block.type) {
        case 'heading':
            return React.createElement(Heading, { depth: block.depth, text: block.text });
        case 'code':
            return React.createElement(CodeBlock, { lang: block.lang, lines: block.lines });
        case 'quote':
            return React.createElement(Quote, { lines: block.lines });
        case 'list':
            return React.createElement(List, { items: block.items, baseColor });
        case 'table':
            return React.createElement(Table, { rows: block.rows, raw: block.raw, width, baseColor });
        case 'rule':
            return React.createElement(
                Text,
                { color: color.muted, wrap: 'truncate' },
                '─'.repeat(Math.max(1, Math.min(width, 32)))
            );
        default:
            return React.createElement(
                Box,
                { flexDirection: 'column' },
                block.lines.map((line, lineIndex) =>
                    React.createElement(
                        Text,
                        { key: lineIndex, wrap: 'wrap' },
                        React.createElement(InlineLine, { text: line, baseColor })
                    )
                )
            );
    }
}
