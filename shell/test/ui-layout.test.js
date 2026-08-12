import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import React from 'react';
import { Box, render, renderToString } from 'ink';
import stringWidth from 'string-width';
import chalk from 'chalk';

import { COMMANDS } from '../src/commands.js';
import { loadRegistry } from '../src/registry.js';
import { CommandMenu } from '../src/ui/CommandMenu.js';
import { Composer } from '../src/ui/Composer.js';
import { ChoiceBox } from '../src/ui/ChoiceBox.js';
import { LaunchScreen, markScaleFor } from '../src/ui/LaunchScreen.js';
import { markSize } from '../src/ui/Mark.js';
import { StatusBar } from '../src/ui/StatusBar.js';
import { Transcript } from '../src/ui/Transcript.js';
import { Wordmark } from '../src/ui/Wordmark.js';
import { safeTerminalText } from '../src/ui/sanitize.js';
import { shimmerSegments, startLoadIn } from '../src/ui/loadin.js';

// Windows reports the live console size even through a pipe, so a real
// PowerShell width leaks into renders these tests believe are pinned (a
// 102-column console failed an 80-column assertion on an otherwise healthy
// machine). Freeze the harness terminal before any render happens.
Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true });
Object.defineProperty(process.stdout, 'rows', { value: 24, configurable: true });
import { SPINNER } from '../src/ui/theme.js';

// Colour level is pinned, not inherited. Chalk resolves level 3 under a TTY (or
// FORCE_COLOR) and 0 behind a pipe, and several assertions here compare rendered
// output against escape-free expectations — most visibly the hostile-payload
// check, which reads "no ESC byte reached the terminal" and would otherwise trip
// on Ink's OWN styling rather than on leaked control sequences. At level 0 Ink
// emits no escapes of its own, so any ESC in the output is genuine leakage and
// the check means exactly what it says, on a TTY and off one alike.
chalk.level = 0;

const ansi = /\x1b\[[0-9;]*m/g;
const plain = (value) => value.replace(ansi, '');
const rawRows = (value) => plain(value).split('\n');
const contentRows = (value) => rawRows(value).filter(Boolean);
const maxWidth = (value) => Math.max(0, ...rawRows(value).map((line) => stringWidth(line)));

test('ChoiceBox renders a bounded question with one visibly selected option', () => {
    const output = plain(renderToString(React.createElement(ChoiceBox, {
        question: 'How should this sound?',
        choices: ['Concise professional', 'Warm professional', 'Formal'],
        selected: 1,
        width: 60,
    })));
    assert.match(output, /How should this sound\?/);
    assert.match(output, /› Warm professional/);
    assert.match(output, /↑↓ choose · Enter continue/);
    assert.ok(maxWidth(output) <= 60);

    const narrow = renderToString(React.createElement(ChoiceBox, {
        question: 'Q?', choices: ['One', 'Two'], selected: 0, width: 10,
    }));
    assert.ok(maxWidth(narrow) <= 10);
});

const pause = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

async function renderTranscript(items, columns, height) {
    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    stdin.ref = () => {};
    stdin.unref = () => {};

    const stdout = new PassThrough();
    stdout.columns = columns;
    stdout.rows = height;
    const writes = [];
    stdout.on('data', (chunk) => { writes.push(chunk.toString()); });

    const instance = render(
        React.createElement(
            Box,
            { width: columns, height, flexDirection: 'column' },
            React.createElement(Transcript, { items })
        ),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false, debug: true }
    );

    try {
        await pause();
        return plain(writes.at(-1) ?? '').replace(/\n$/, '');
    } finally {
        instance.unmount();
    }
}

async function renderComposer(initialValue, columns, height) {
    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    stdin.ref = () => {};
    stdin.unref = () => {};
    const stdout = new PassThrough();
    stdout.columns = columns;
    stdout.rows = height;
    const writes = [];
    stdout.on('data', (chunk) => { writes.push(chunk.toString()); });
    const instance = render(
        React.createElement(Composer, {
            onSubmit() {}, busy: false, columns, initialValue,
        }),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false, debug: true }
    );
    try {
        await pause();
        return plain(writes.at(-1) ?? '').replace(/\n$/, '');
    } finally {
        instance.unmount();
    }
}

const info = {
    engine: 'codex', model: 'gpt-5.6-sol', user: 'test-user',
    vaultPath: '/tmp/sherman/vault', contextWindow: 272000, threadId: null,
};
const stats = { wiki: 2, shared: 1, private: 0, inbox: 1, ok: true };

// The geometry tests pin their panel heights to exact rows, so every registry
// section they render must be machine-independent. Tools and skills come from
// the repo (stable in CI and on every checkout); mcp and agents are pinned
// fixtures here because the real loaders read THIS machine's workspace and
// ~/.sherman — state a relaunch or a connector change silently moves, which
// is exactly what once flipped these tests overnight.
const geometryRegistry = {
    ...loadRegistry(),
    mcp: { ok: true, categories: [{ name: 'wired', items: ['agent-reach', 'llmwiki', 'exa'] }], count: 3 },
    agents: {
        ok: true,
        categories: [
            { name: 'research', items: ['@researcher', '@scout', '@ml-researcher'] },
            { name: 'review', items: ['@reviewer'] },
        ],
        count: 4,
        list: [],
        malformed: [],
    },
};

test('launch hierarchy stays clean and bounded across target terminal sizes', () => {
    for (const [columns, rows] of [[80, 24], [100, 30], [120, 40], [160, 48]]) {
        const output = renderToString(
            React.createElement(LaunchScreen, {
                info, stats, registry: geometryRegistry, sessionId: '20260728_010000_abc123', columns, rows,
                platform: 'win32',
            }),
            { columns }
        );
        // On the PC: full bleed up to the 120-column design cap; past it the
        // frame keeps its designed width and centers, so the widest line is
        // the pad plus the capped panel, never the whole terminal.
        const cappedWidth = Math.min(columns, 120);
        const expectedWidth = Math.floor((columns - cappedWidth) / 2) + cappedWidth;
        assert.equal(maxWidth(output), expectedWidth, `${columns}x${rows} lost launch geometry`);
        // On the Mac the same terminal gets the original full-bleed frame.
        const macOutput = renderToString(
            React.createElement(LaunchScreen, {
                info, stats, registry: geometryRegistry, sessionId: '20260728_010000_abc123', columns, rows,
                platform: 'darwin',
            }),
            { columns }
        );
        assert.equal(maxWidth(macOutput), columns, `${columns}x${rows} lost the Mac's full-width launch geometry`);
        assert.ok(
            rawRows(output).length <= rows - 2,
            `${columns}x${rows} launch crowds out status/composer`
        );
        if (rows < 29) {
            assert.match(plain(output), /\/help/);
            // 24 rows on a wide terminal is the mid panel: the abridged Mac
            // frame — section titles with one dense category line each — not
            // the compact card. The first real Windows machine launches here.
            assert.match(plain(output), /Available Tools/);
            assert.match(plain(output), /\bVault\b/);
        } else {
            assert.match(plain(output), /\bVault\b/);
            // The closing tally is unconditional above the compact cutoff: the
            // registry lists give up rows on a short terminal, but the counts
            // they summarize never do. The mcp and agent registries are part
            // of the tally now, and /help may lose its "for commands" tail to
            // truncation on a 100-column panel — never the hint itself.
            assert.match(plain(output), /\d+ tools · \d+ mcp · \d+ skills · \d+ agents · \/help/);
        }
    }

    // With the expanded built-in skill/tool set, the list budget now spends
    // each additional available row revealing another real category. The
    // below-threshold panel therefore grows from 41 to 43 rather than freezing
    // its registry at the smaller viewport's cap.
    const at41 = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, registry: geometryRegistry, sessionId: '20260728_010000_layout', columns: 120, rows: 41,
        }),
        { columns: 120 }
    ));
    const at43 = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, registry: geometryRegistry, sessionId: '20260728_010000_layout', columns: 120, rows: 43,
        }),
        { columns: 120 }
    ));
    const at60 = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, registry: geometryRegistry, sessionId: '20260728_010000_layout', columns: 120, rows: 60,
            platform: 'win32',
        }),
        { columns: 120 }
    ));
    assert.ok(
        at43.split('\n').length > at41.split('\n').length,
        'extra pre-stretch rows should reveal more of the real registry'
    );
    // At and above it the panel claims a share of the height, so a 60-row
    // terminal gets a taller frame than a 40-row one — and still leaves room
    // for the status rule and composer.
    //
    // Strictly taller, not taller by a fixed margin. The PC stretch is capped
    // at STRETCH_MAX_INNER while the compact panel hugs its REAL content, so
    // every skill added to the registry narrows the gap between them. A fixed
    // margin here is a tripwire on the product's core motion — it fires the day
    // someone ships two skills, which says nothing about the layout. What must
    // never happen is the tall terminal rendering a SHORTER panel than the
    // short one, and that is what this asserts.
    const rowsAt41 = at41.split('\n').length;
    const rowsAt60 = at60.split('\n').length;
    assert.ok(
        rowsAt60 > rowsAt41,
        `tall terminals must stretch the launch panel (41 rows -> ${rowsAt41}, 60 -> ${rowsAt60})`
    );
    assert.ok(rowsAt60 <= 58, 'a stretched launch panel must not crowd out status and composer');
    // The PC stretch is capped: slack past the doubled mark's column falls
    // below the top-anchored frame instead of hollowing the box out with
    // multi-row voids between its sections.
    const at60Interior = at60.split('\n').filter((line) => line.startsWith('│'));
    let voidRun = 0;
    let worstVoid = 0;
    for (const line of at60Interior) {
        voidRun = line.replace(/[│\s]/g, '') === '' ? voidRun + 1 : 0;
        worstVoid = Math.max(worstVoid, voidRun);
    }
    assert.ok(
        worstVoid <= 4,
        `stretched panel opened a ${worstVoid}-row void between sections`
    );

    // Maximized on a wide monitor (the first real Windows machine's 250-column
    // fullscreen): the frame caps at its designed width and centers, instead
    // of stretching a mostly-empty box across the whole screen.
    const maximized = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, registry: geometryRegistry, sessionId: '20260728_010000_layout', columns: 250, rows: 60,
            platform: 'win32',
        }),
        { columns: 250 }
    ));
    const maxBorder = rawRows(maximized).find((line) => line.includes('╭'));
    assert.ok(maxBorder, 'maximized frame lost its panel border');
    assert.equal(stringWidth(maxBorder.trimStart()), 120, 'maximized panel must cap at the design width');
    assert.equal(maxBorder.length - maxBorder.trimStart().length, 65, 'maximized panel must center in the terminal');

    // The same maximized terminal on the Mac is the design being restored:
    // the panel spans the full width, uncentered, and the tall stretch is
    // unbounded — the operator kept the PC cap and asked for the Mac back.
    const macMaximized = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, registry: geometryRegistry, sessionId: '20260728_010000_layout', columns: 250, rows: 60,
            platform: 'darwin',
        }),
        { columns: 250 }
    ));
    const macBorder = rawRows(macMaximized).find((line) => line.includes('╭'));
    assert.ok(macBorder, 'Mac maximized frame lost its panel border');
    assert.equal(stringWidth(macBorder.trimStart()), 250, 'Mac maximized panel must span the terminal');
    assert.equal(macBorder.length - macBorder.trimStart().length, 0, 'Mac maximized panel must not be centered');
    const macAt60 = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, registry: geometryRegistry, sessionId: '20260728_010000_layout', columns: 120, rows: 60,
            platform: 'darwin',
        }),
        { columns: 120 }
    ));
    assert.ok(
        macAt60.split('\n').length > rowsAt60,
        'the Mac tall frame must keep the unbounded stretch the PC gave up'
    );

    // Three tiers on a retro-wide terminal, each boundary crossed exactly
    // once: the compact card below 22 rows, the mid panel (Vault section
    // title and dense category lines, but no per-category label rows) from
    // 22 to 30, the full panel (per-category rows like "session: goal, …")
    // at 31 — not 29, because at retro width the full panel's fifteen-row
    // left column cannot coexist with the eight-row headline until 31, and
    // the headline must never vanish and reappear across a two-row band.
    const wideAt = (rows) => plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, sessionId: '20260728_010000_boundary', columns: 120, rows,
        }),
        { columns: 120 }
    ));
    const wideCard = wideAt(21);
    const wideMid = wideAt(22);
    const wideMidTop = wideAt(30);
    const wideFull = wideAt(31);
    assert.doesNotMatch(wideCard, /\bVault\b/);
    assert.match(wideCard, /larger window shows the full screen/);
    for (const mid of [wideMid, wideMidTop]) {
        assert.match(mid, /\bVault\b/);
        assert.match(mid, /Available Tools/);
        assert.doesNotMatch(mid, /session: /);
    }
    assert.match(wideFull, /\bVault\b/);
    assert.match(wideFull, /session: /);

    // The mid panel's mark stands up as soon as the rows are there: from 26
    // (with the headline) the box carries the Mac's downward mark — nine art
    // rows inside the border, like the full panel's — where 24 still lays it
    // on its side at four. Asked for plainly on the first real Windows
    // machine: "the box needs to be taller — why is the logo not downward
    // like the mac".
    const artRows = (rows) => rawRows(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, sessionId: '20260728_010000_boundary', columns: 120, rows,
        }),
        { columns: 120 }
    )).filter((line) => line.startsWith('│') && /[▀▄█]/.test(line)).length;
    assert.equal(artRows(24), 4, 'below the tall budget the mark lies on its side');
    assert.equal(artRows(26), 9, 'at 26 rows the mark stands downward, Mac-style');

    // The headline is height-aware now: the retro lockup (its ╔ echo glyphs
    // are unique to it) arrives at 24 rows — where the frame first affords
    // its two extra rows — and holds through the mid band and the full panel.
    // The first real Windows machine sits at ~26 rows and 120+ columns, and
    // "not even the sherman logo at the top" was the complaint.
    assert.doesNotMatch(wideAt(23), /╔/);
    for (const rows of [24, 26, 30, 31]) {
        assert.match(wideAt(rows), /╔/, `retro headline missing at 120x${rows}`);
    }
    // Below retro width the full panel still begins at 29.
    const hundredFull = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, sessionId: '20260728_010000_boundary', columns: 100, rows: 29,
        }),
        { columns: 100 }
    ));
    assert.match(hundredFull, /session: /);

    // The update notice rides the version border: present in every tier when
    // the checkout is behind its upstream, absent otherwise, and always zero
    // rows. SHERMAN_UPDATE_BEHIND is the test seam — the real value is a git
    // measurement whose truth depends on the checkout running this suite.
    try {
        process.env.SHERMAN_UPDATE_BEHIND = '3';
        for (const rows of [21, 26, 31]) {
            assert.match(wideAt(rows), /⚠ update available · sherman update/,
                `update notice missing at 120x${rows}`);
        }
        process.env.SHERMAN_UPDATE_BEHIND = '0';
        assert.doesNotMatch(wideAt(26), /update available/);
    } finally {
        delete process.env.SHERMAN_UPDATE_BEHIND;
    }

    // The card's own capability lines belong to terminals too narrow for two
    // columns: stacked, with height to spare, the card lists the categories —
    // and at a height where the base card is an exact fit, they vanish
    // rather than overflow (one row past the viewport duplicates frames,
    // issue #18's waterfall).
    const narrowTall = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, sessionId: '20260728_010000_boundary', columns: 50, rows: 30,
        }),
        { columns: 50 }
    ));
    // Only the line heads: at 50 columns the category run truncates, and the
    // total after it is the first thing the ellipsis eats.
    assert.match(narrowTall, /tools {5}\w[\w-]*, /);
    assert.match(narrowTall, /skills {4}\w[\w-]*, /);
    const tight = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, sessionId: '20260728_010000_boundary', columns: 80, rows: 20,
        }),
        { columns: 80 }
    ));
    assert.doesNotMatch(tight, /tools {5}/);
    assert.doesNotMatch(tight, /skills {4}/);

    // The stacked boundary moved 40/41 -> 43/44 with the identity block: a
    // stacked frame carries the identity under the mark now, and at 41-43 rows
    // that pile would overflow the chrome, so the compact card holds until 44.
    const stackedCompact = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, sessionId: '20260728_010000_boundary', columns: 40, rows: 43,
        }),
        { columns: 40 }
    ));
    const stackedFull = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, sessionId: '20260728_010000_boundary', columns: 40, rows: 44,
        }),
        { columns: 40 }
    ));
    assert.doesNotMatch(stackedCompact, /\bVault\b/);
    assert.match(stackedFull, /\bVault\b/);
});

// The widest contiguous run of mark pixels *inside the panel border*. The
// wordmark is block art too and sits above the border, so restricting to
// bordered rows is what makes this a read of the mark specifically rather than
// of whichever piece of art happens to be widest.
const markRun = (output) =>
    rawRows(output).filter((line) => line.startsWith('│')).reduce((widest, line) => {
        let run = 0;
        let best = 0;
        for (const ch of line) {
            if (ch === '▀' || ch === '▄' || ch === '█') best = Math.max(best, ++run);
            else run = 0;
        }
        return Math.max(widest, best);
    }, 0);

test('the mark scales with the tall panel and stays compact below it', () => {
    // markSize is derived from the authored grid, so these are the art's real
    // dimensions rather than a second copy of them that could drift.
    assert.deepEqual(markSize(1), { columns: 12, rows: 11 });
    assert.deepEqual(markSize(2), { columns: 24, rows: 22 });

    // The scale rule itself, independent of rendering. A stretched body with
    // room in both axes earns 2; every other case is the compact rendition.
    // The doubled mark shares its column with the identity block, so the rows
    // it needs are the 22-row art plus the gap and three identity lines: 26.
    assert.equal(markScaleFor({ bodyRows: 26, stack: false, inner: 100 }), 2);
    assert.equal(markScaleFor({ bodyRows: null, stack: false, inner: 100 }), 1);
    assert.equal(markScaleFor({ bodyRows: 26, stack: true, inner: 100 }), 1);
    // One row short of art + identity, and one column short of leaving the
    // knowledge column its 20 — both must refuse rather than clip.
    assert.equal(markScaleFor({ bodyRows: 25, stack: false, inner: 100 }), 1);
    assert.equal(markScaleFor({ bodyRows: 26, stack: false, inner: 56 }), 1);

    const frame = (rows) => renderToString(
        React.createElement(LaunchScreen, {
            info, stats, registry: geometryRegistry, sessionId: '20260728_010000_markscale', columns: 120, rows,
        }),
        { columns: 120 }
    );

    // 24 rows on a wide terminal is the mid panel now, and its mark is the
    // horizontal strip: the widest run is the outer ring's bottom edge
    // (▀▀██████▀▀), ten cells — same picture, lying down. The card itself
    // (short AND narrow) still carries no mark at all.
    assert.equal(markRun(frame(24)), 10, 'the mid panel renders the strip mark');
    assert.equal(
        markRun(renderToString(
            React.createElement(LaunchScreen, {
                info, stats, registry: geometryRegistry, sessionId: '20260728_010000_markscale', columns: 120, rows: 21,
            }),
            { columns: 120 }
        )),
        0,
        'the compact card renders no mark'
    );
    // A hugging panel and the first stretched sizes keep the 12-column mark;
    // only a panel with 22 inner rows to spare doubles it. The larger built-in
    // registry consumes the first stretch rows — every real toolset and skill
    // category added moves that point up; with the money engine's toolset and
    // skill in the truthful capability registry, it sits at 48.
    assert.equal(markRun(frame(40)), 10, 'a hugging panel must keep the compact mark');
    assert.equal(markRun(frame(43)), 10, 'below the threshold the panel must hug and stay compact');
    assert.equal(markRun(frame(46)), 10, 'the first stretched sizes still spend their rows on registry truth');
    assert.equal(markRun(frame(47)), 10, 'one row short must not clip a doubled mark');
    assert.equal(markRun(frame(48)), 20, 'the first body with enough room doubles the mark');
    assert.equal(markRun(frame(60)), 20, 'a tall panel must render the doubled mark');

    // Doubled means magnified, not redrawn: twice the rows as well as twice the
    // columns, and the rings still read as rings — hollow centres with the
    // outer ring's shoulders stepping in, exactly as at scale 1. (At an even
    // vertical factor both pixels of every pair match, so the half-block glyphs
    // resolve to full blocks. That is the same picture at twice the size, not
    // different art.)
    const markRows = (output) =>
        rawRows(output).filter((line) => line.startsWith('│') && /[▀▄█]/.test(line)).length;
    assert.equal(markRows(frame(40)), 9);
    assert.equal(markRows(frame(60)), 18);
    assert.match(plain(frame(60)), /████ {16}████/);
    assert.match(plain(frame(60)), /██████ {12}██████/);

    // The mark scale now flips at 47 -> 48. The frame itself begins stretching
    // at 44; the rows in between are legitimately occupied by the larger
    // capability registry before the doubled art can fit without clipping.
    // The frame grows only by the row the viewport actually added; the mark
    // changes scale inside a budget settled before the art is sized.
    assert.equal(markRun(frame(47)), 10);
    assert.equal(markRun(frame(48)), 20);
    assert.ok(
        rawRows(frame(48)).length > rawRows(frame(47)).length,
        'the stretched panel should be taller than the hugging one'
    );
});

test('launch matrix preserves borders and budgets across stack boundaries', () => {
    const widths = [40, 50, 58, 62, 79, 80, 100, 120, 160];
    const states = [stats, { wiki: 0, shared: 0, private: 0, inbox: 0, ok: false }];

    for (let terminalRows = 24; terminalRows <= 48; terminalRows++) {
        for (const columns of widths) {
            for (const vaultStats of states) {
                const output = renderToString(
                    React.createElement(LaunchScreen, {
                        info,
                        stats: vaultStats,
                        sessionId: '20260728_010000_matrix',
                        columns,
                        rows: terminalRows,
                    }),
                    { columns }
                );
                const renderedRows = rawRows(output);
                assert.ok(
                    renderedRows.length <= terminalRows - 2,
                    `${columns}x${terminalRows} launch exceeded persistent-chrome budget`
                );
                const hasTop = renderedRows.some((line) => line.startsWith('╭'));
                const hasBottom = renderedRows.some((line) => line.startsWith('╰'));
                assert.equal(hasBottom, hasTop, `${columns}x${terminalRows} clipped one border`);
                assert.doesNotMatch(plain(output), /Sherman Abrams Labs[▀▄█]/);
                assert.ok(maxWidth(output) <= columns, `${columns}x${terminalRows} overflowed`);
            }
        }
    }
});

test('unreadable vault state admits ignorance without contradictory claims or mark corruption', () => {
    const output = plain(renderToString(
        React.createElement(LaunchScreen, {
            info,
            stats: { wiki: 0, shared: 0, private: 0, inbox: 0, ok: false },
            sessionId: '20260728_010000_unreadable',
            columns: 120,
            rows: 40,
        }),
        { columns: 120 }
    ));

    assert.doesNotMatch(output, /\b0 facts\b/);
    assert.doesNotMatch(output, /vault-grounded/);
    assert.match(output, /unreadable — check vault_path/);
    assert.match(output, /▄▀▀▄/);
    assert.doesNotMatch(output, /no PHI/);
});

test('persistent chrome matches Hermes bordered-composer footprint', () => {
    const composer = contentRows(renderToString(
        React.createElement(Composer, { onSubmit() {}, busy: false, columns: 120 }),
        { columns: 120 }
    ));
    // Three rows now: rounded top border, the prompt row, rounded bottom border.
    assert.equal(composer.length, 3);
    assert.match(composer[0], /^╭─+╮$/, 'composer lost its rounded top border');
    assert.match(
        composer[1],
        /^│ ❯ Ask about company operations… +│$/,
        'placeholder must render inside the bordered field, behind the ❯ gutter'
    );
    assert.match(composer[2], /^╰─+╯$/, 'composer lost its rounded bottom border');
    for (const row of composer) assert.ok([...row].length <= 120);
    assert.equal(maxWidth(composer.join('\n')), 120, 'composer box must span the full width');

    for (const columns of [60, 80, 100, 120]) {
        const status = contentRows(renderToString(
            React.createElement(StatusBar, {
                info,
                usage: { total: 0 },
                busy: false,
                sessionStart: Date.now(),
                columns,
            }),
            { columns }
        ));
        assert.equal(status.length, 1);
        // Chips deliberately stop after the last segment instead of ruling to
        // the right edge, so the surviving property is the bound: the strip is
        // never allowed past the gutter-inset width.
        assert.ok(
            maxWidth(status[0]) <= columns - 1,
            'status strip overflowed the gutter-inset width'
        );
        // Gutter space, then the state chip's left padding, then the segments,
        // each pair separated by exactly one gap space plus two padding spaces.
        assert.match(status[0], /^ {2}ready {3}codex·gpt-5\.6-sol {3}session \d+[smh]/);
    }
});

test('command palette uses the shell round-frame vocabulary', () => {
    const menu = renderToString(
        React.createElement(CommandMenu, { commands: COMMANDS, selected: 0, width: 80 }),
        { columns: 80 }
    );
    assert.ok(maxWidth(menu) <= 80);
    assert.match(plain(menu), /╭/);
    assert.doesNotMatch(plain(menu), /╔/);
    assert.match(plain(menu), /\/ commands/);
});

test('command palette branch boundaries and row budgets stay explicit', () => {
    const command = {
        name: 'inspect', usage: '/inspect <target>', summary: 'SUMMARY_SENTINEL',
    };
    const compact = plain(renderToString(
        React.createElement(CommandMenu, { commands: [command], width: 32, maxRows: 1 }),
        { columns: 32 }
    ));
    const usage = plain(renderToString(
        React.createElement(CommandMenu, { commands: [command], width: 33, maxRows: 1 }),
        { columns: 33 }
    ));
    assert.match(compact, /\/inspect/);
    assert.doesNotMatch(compact, /<target>/);
    assert.match(usage, /\/inspect <target>/);

    const withoutSummary = plain(renderToString(
        React.createElement(CommandMenu, { commands: [command], width: 73, maxRows: 4 }),
        { columns: 73 }
    ));
    const withSummary = plain(renderToString(
        React.createElement(CommandMenu, { commands: [command], width: 74, maxRows: 4 }),
        { columns: 74 }
    ));
    assert.doesNotMatch(withoutSummary, /SUMMARY_SENTINEL/);
    assert.match(withSummary, /SUMMARY_SENTINEL/);

    for (const width of [32, 33, 73, 74]) {
        for (const maxRows of [1, 2, 3, 4, 5, 8]) {
            const output = renderToString(
                React.createElement(CommandMenu, {
                    commands: COMMANDS, selected: 1, width, maxRows,
                }),
                { columns: width }
            );
            assert.ok(maxWidth(output) <= width, `${width} columns overflowed`);
            assert.ok(rawRows(output).length <= maxRows, `${maxRows}-row budget overflowed`);
        }
    }
});

test('composer echoes non-empty input and clips oldest pasted rows', async () => {
    for (let columns = 8; columns <= 40; columns++) {
        const output = await renderComposer('x', columns, 24);
        // Below width 10 the box cannot be drawn and the bare-text fallback
        // paints a single row; at or above it the box costs two border rows.
        const expectedRows = columns < 10 ? 1 : 3;
        assert.equal(
            rawRows(output).length, expectedRows,
            `${columns}-column non-empty composer wrapped`
        );
        assert.match(output, /❯ x/);
        if (expectedRows === 3) {
            const rows = rawRows(output);
            assert.match(rows[0], /^╭─*╮$/, `${columns}-column composer lost its top border`);
            assert.match(rows[1], /^│ ❯ x/, `${columns}-column composer lost its framed prompt`);
            assert.match(rows[2], /^╰─*╯$/, `${columns}-column composer lost its bottom border`);
        }
    }

    const pasted = Array.from({ length: 7 }, (_, index) => `line-${index + 1}`).join('\n');
    const clipped = await renderComposer(pasted, 40, 10);
    assert.equal(rawRows(clipped).length, 6);
    assert.doesNotMatch(clipped, /\bline-1\b/);
    assert.match(clipped, /\bline-7\b/);
    assert.match(clipped, /❯/);
    // Two of those six rows are the box; the clip budget owns the other four.
    assert.match(rawRows(clipped)[0], /^╭─+╮$/);
    assert.match(rawRows(clipped).at(-1), /^╰─+╯$/);
});

test('status reports vault and motion truth with terminal-cell width', () => {
    const blocked = plain(renderToString(
        React.createElement(StatusBar, {
            info, usage: { total: 0 }, busy: false, vaultOk: false, columns: 80,
        }),
        { columns: 80 }
    ));
    assert.match(blocked, /blocked/);
    assert.doesNotMatch(blocked, /ready/);

    const previousMotion = process.env.SHERMAN_MOTION;
    delete process.env.SHERMAN_MOTION;
    try {
        const moving = plain(renderToString(
            React.createElement(StatusBar, {
                info, usage: { total: 0 }, busy: true, columns: 80,
            }),
            { columns: 80 }
        ));
        assert.ok(SPINNER.some((glyph) => moving.includes(glyph)));
        assert.match(moving, /working · \d+\.\d+s/);

        for (const value of ['off', 'reduce', 'none', '1', 'true', 'disabled', '0', '']) {
            process.env.SHERMAN_MOTION = value;
            const reduced = plain(renderToString(
                React.createElement(StatusBar, {
                    info, usage: { total: 0 }, busy: true, columns: 80,
                }),
                { columns: 80 }
            ));
            assert.match(reduced, /● working/);
        }
    } finally {
        if (previousMotion === undefined) delete process.env.SHERMAN_MOTION;
        else process.env.SHERMAN_MOTION = previousMotion;
    }

    const hostileWidthInfo = {
        ...info,
        engine: '引擎🧪',
        model: '模型e\u0301🧪'.repeat(20),
    };
    for (const columns of [20, 40, 80]) {
        const output = renderToString(
            React.createElement(StatusBar, {
                info: hostileWidthInfo, usage: { total: 0 }, busy: false, columns,
            }),
            { columns }
        );
        // The chip strip no longer rules to the right edge, so the property
        // this pinned is the bound, not the fill: hostile CJK/emoji model text
        // must still be truncated inside the gutter-inset width.
        assert.ok(
            maxWidth(output) <= columns - 1,
            `${columns}-column hostile status overflowed the inset width`
        );
        const strip = contentRows(output)[0];
        assert.match(strip, /^ {2}ready {3}引擎/);
        assert.match(strip, /…$/, 'hostile model text must be truncated, not clipped away');
    }

    for (const contextUsed of [999, 1000, 1001]) {
        const output = plain(renderToString(
            React.createElement(StatusBar, {
                info: { ...info, contextWindow: 2000 },
                usage: { total: 0 }, contextUsed, columns: 80,
            }),
            { columns: 80 }
        ));
        assert.match(output, /1\.0k\/2\.0k/);
    }
});

test('multiline user prompts align continuation rows under the body', () => {
    const output = contentRows(renderToString(
        React.createElement(Transcript, {
            items: [{ id: 'user-multiline', kind: 'user', text: 'line one\nline two\nline three' }],
            columns: 80,
        }),
        { columns: 80 }
    ));
    assert.deepEqual(output, [' ● line one', '   line two', '   line three']);
});

test('reply geometry is a closed box with the signature in its top border', () => {
    const reply = rawRows(renderToString(
        React.createElement(Transcript, {
            items: [{ id: 'reply', kind: 'message', text: 'Concise response.' }],
            columns: 80,
        }),
        { columns: 80 }
    ));
    // One column of transcript gutter, then the two-cell frame indent. The
    // signature lives inside the top border, and the frame closes on all four
    // sides — top row, both side rules, bottom row.
    assert.equal(reply.length, 3, `expected a three-row closed box, got ${JSON.stringify(reply)}`);
    assert.match(reply[0], /^ {3}╭─ Sherman ─+╮$/, 'reply lost its titled top border');
    assert.match(reply[1], /^ {3}│ Concise response\. +│$/, 'reply body lost its side rules');
    assert.match(reply[2], /^ {3}╰─+╯$/, 'reply lost its bottom border');
    // Every row of the frame is the same width: the box is genuinely closed,
    // not three rows that happen to start with border glyphs.
    assert.equal(
        new Set(reply.map((line) => stringWidth(line))).size,
        1,
        'the box edges are ragged'
    );
});

// The whole point of the rule is that the transcript has ONE left edge. Diff,
// tool and self-talk rows hard-code the prefix `  │ `; the reply builds its
// rule out of an Ink border instead, so the two are produced by completely
// different machinery and nothing but a test keeps them at the same offset.
// AGENTS.md calls a mismatch here a bug, not a detail.
test('the reply rule sits at the same column as the diff and tool gutters', () => {
    const rows = rawRows(renderToString(
        React.createElement(Transcript, {
            items: [
                { id: 'tool', kind: 'tool', text: 'read vault/wiki/index.md' },
                {
                    id: 'diff',
                    kind: 'diff',
                    diff: {
                        path: 'vault/wiki/a.md', changeKind: 'update', available: true,
                        added: 1, removed: 0, lines: [{ sign: '+', text: 'one fact' }], more: 0,
                    },
                },
                { id: 'reply', kind: 'message', text: 'Aligned.' },
            ],
            columns: 80,
        }),
        { columns: 80 }
    ));
    const ruleColumns = new Set(
        rows.filter((line) => line.includes('│')).map((line) => line.indexOf('│'))
    );
    assert.equal(
        ruleColumns.size,
        1,
        `trace and reply rules drifted apart: columns ${[...ruleColumns].join(', ')}`
    );
});

// A reply that wraps is the common case, and the side rules are drawn by Ink
// across the measured height rather than prefixed per line precisely so they
// survive one. A frame that stopped after the first row would leave the
// continuation text floating unattributed — and unclosed — in the transcript.
test('the reply frame closes around the full height of a wrapped reply', () => {
    for (const columns of [60, 200]) {
        const body = 'wrap '.repeat(80).trim();
        const rows = contentRows(renderToString(
            React.createElement(Transcript, {
                items: [{ id: 'reply', kind: 'message', text: body }],
                columns,
            }),
            { columns }
        ));
        const top = rows[0];
        const bottom = rows.at(-1);
        const bodyRows = rows.slice(1, -1);
        assert.match(top, /^ {3}╭─ Sherman ─+╮$/, `${columns}-column reply lost its titled top border`);
        assert.match(bottom, /^ {3}╰─+╯$/, `${columns}-column reply lost its bottom border`);
        assert.ok(bodyRows.length > 1, `${columns}-column reply did not wrap, so this proves nothing`);
        for (const [index, line] of bodyRows.entries()) {
            assert.match(
                line,
                /^ {3}│ .*│$/,
                `${columns}-column reply lost its frame on wrapped row ${index + 1}`
            );
        }
        assert.ok(
            maxWidth(renderToString(
                React.createElement(Transcript, {
                    items: [{ id: 'reply', kind: 'message', text: body }],
                    columns,
                }),
                { columns }
            )) <= columns,
            `${columns}-column reply overflowed its width`
        );
    }
});

// The narrow fallback. Below indent + two borders + padding + a cell of text
// there is no frame to draw, and the reply degrades to bare truncated text
// rather than rendering a box with no interior or overflowing the viewport.
test('a reply too narrow to frame degrades to plain text without overflowing', () => {
    for (const columns of [3, 5, 6]) {
        const output = renderToString(
            React.createElement(Transcript, {
                items: [{ id: 'reply', kind: 'message', text: 'Concise response.' }],
                columns,
            }),
            { columns }
        );
        assert.ok(
            maxWidth(output) <= columns,
            `${columns}-column reply overflowed: ${JSON.stringify(rawRows(output))}`
        );
    }
});

// The launch frame is the transcript's only item before the first turn, and on
// a tall terminal the viewport has far more rows than it fills. Those spare
// rows must fall BELOW it: bottom-anchoring the launch frame pushes the
// wordmark down the screen and opens a void above it, which reads as a broken
// first frame. Asserted at 60 rows because that is where the gap is largest,
// and against the wordmark's first row so it pins the top of the frame itself,
// not merely the top of some content.
test('the launch frame stays anchored to the top of a tall viewport', async () => {
    const output = await renderTranscript([
        { id: 'launch', kind: 'launch', info, stats, sessionId: '20260728_010000_anchor' },
    ], 100, 60);

    const frameRows = rawRows(output);
    const firstContent = frameRows.findIndex((line) => line.trim() !== '');
    assert.equal(firstContent, 0, 'a void opened above the launch frame');
    // ...and the spare rows are genuinely below it, not absorbed by a stretch
    // that swallowed the whole viewport.
    const lastContent = frameRows.map((line) => line.trim() !== '').lastIndexOf(true);
    assert.ok(
        lastContent < frameRows.length - 1,
        'the launch viewport should end in unused rows, not run to the last line'
    );
});

test('live transcript geometry anchors the newest of two turns at 80x24', async () => {
    const output = await renderTranscript([
        { id: 'u1', kind: 'user', text: 'hello' },
        { id: 'm1', kind: 'message', text: 'Reply one.' },
        { id: 'u2', kind: 'user', text: 'again' },
        { id: 'm2', kind: 'worker-message', text: 'Worker reply.' },
    ], 80, 24);

    // Row 23 is the LAST row of a 24-row viewport. The reply is a closed box
    // again, so the frame's bottom border spends that final row and the newest
    // words stand one row above it — still anchored: the box's closing edge is
    // the newest content, and nothing hangs below the viewport.
    const frameRows = rawRows(output);
    assert.equal(frameRows.findIndex((line) => line.includes('Worker reply.')), 22);
    assert.match(frameRows[23], /^ {3}╰─+╯\s*$/, 'the closing border should hold the bottom row');
});

test('live transcript clips oldest turns and renders newest rows once', async () => {
    const items = [];
    for (let turn = 1; turn <= 20; turn++) {
        items.push(
            { id: `u${turn}`, kind: 'user', text: `user-${turn}` },
            { id: `m${turn}`, kind: 'message', text: `reply-${turn}` }
        );
    }

    const output = await renderTranscript(items, 80, 12);
    assert.doesNotMatch(output, /user-1\b|reply-1\b/);
    assert.equal(output.match(/user-20\b/g)?.length, 1);
    assert.equal(output.match(/reply-20\b/g)?.length, 1);
});

test('every transcript item kind stays inside 1..20-column live viewports', async () => {
    const items = [
        { id: 'launch', kind: 'launch', info, stats, sessionId: '20260728_010000_narrow' },
        { id: 'banner', kind: 'banner' },
        { id: 'user', kind: 'user', text: 'user row' },
        { id: 'selftalk', kind: 'selftalk', text: 'summary row' },
        { id: 'reasoning', kind: 'reasoning', text: 'reasoning row' },
        { id: 'tool', kind: 'tool', text: 'tool row' },
        { id: 'message', kind: 'message', text: 'message row' },
        { id: 'worker', kind: 'worker-message', text: 'worker row' },
        { id: 'notice', kind: 'notice', text: 'notice row' },
        { id: 'error', kind: 'error', text: 'error row' },
    ];

    for (let columns = 1; columns <= 20; columns++) {
        const output = await renderTranscript(items, columns, 20);
        assert.ok(maxWidth(output) <= columns, `${columns}-column transcript overflowed`);
        assert.ok(rawRows(output).length <= 20, `${columns}-column transcript exceeded its row budget`);
    }
});

test('pathological widths and hostile terminal text fail cleanly', () => {
    for (let width = 1; width <= 30; width++) {
        const menu = renderToString(
            React.createElement(CommandMenu, { commands: COMMANDS, selected: 0, width }),
            { columns: width }
        );
        assert.ok(maxWidth(menu) <= width);

        const composer = renderToString(
            React.createElement(Composer, { onSubmit() {}, busy: false, columns: width }),
            { columns: width }
        );
        assert.ok(maxWidth(composer) <= width);
        assert.equal(
            rawRows(composer).length, width < 10 ? 1 : 3,
            `${width}-column composer painted the wrong row count`
        );
    }

    const payload = `~/x\x1b[31mRED\x1b[0m\x1b]0;title\x07`;
    assert.equal(safeTerminalText(payload), '~/xRED');
    assert.equal(
        safeTerminalText('line one\nline two', { preserveNewlines: true }),
        'line one\nline two'
    );
    assert.equal(safeTerminalText('line one\nline two'), 'line one line two');

    const malicious = renderToString(
        React.createElement(StatusBar, {
            info,
            usage: { total: 0 },
            busy: false,
            goal: payload,
            columns: 80,
        }),
        { columns: 80 }
    );
    assert.equal(malicious.includes('\x1b'), false);
    assert.match(plain(malicious), /goal set/);
    assert.doesNotMatch(plain(malicious), /~\/xRED/);

    const previousMotion = process.env.SHERMAN_MOTION;
    process.env.SHERMAN_MOTION = 'off';
    try {
        const reduced = renderToString(
            React.createElement(StatusBar, {
                info,
                usage: { total: 0 },
                busy: true,
                columns: 80,
            }),
            { columns: 80 }
        );
        assert.match(plain(reduced), /● working · 0\.0s/);
        assert.doesNotMatch(plain(reduced), /⠋/);
    } finally {
        if (previousMotion === undefined) delete process.env.SHERMAN_MOTION;
        else process.env.SHERMAN_MOTION = previousMotion;
    }
});

// ------------------------------------------------------------- the load-in --
// The startup shimmer. Its two hard contracts are that it writes NOTHING
// without a TTY (so every renderToString fixture and piped smoke run stays
// byte-identical) and that it never delays readiness. Both are asserted here
// against injected stdout/clock/timers, so no test needs a terminal.

test('the load-in writes nothing at all without a TTY', () => {
    const writes = [];
    const stdout = { isTTY: false, columns: 100, write: (s) => writes.push(s) };

    const loadIn = startLoadIn({ stdout });
    loadIn.step('reading config…');
    loadIn.done();

    assert.deepEqual(writes, [], 'the load-in emitted output off a TTY');
});

test('the load-in sweeps a band, settles at its budget, and erases on done', () => {
    const writes = [];
    const stdout = { isTTY: true, columns: 100, write: (s) => writes.push(s) };
    let clock = 0;
    let tick = null;

    const loadIn = startLoadIn({
        stdout,
        budgetMs: 1000,
        now: () => clock,
        setTimer: (fn) => { tick = fn; return { unref() {} }; },
        clearTimer: () => { tick = null; },
    });

    // The first frame carries the wordmark and hides the cursor.
    assert.match(writes[0], /█/);
    assert.match(writes[0], /\x1b\[\?25l/);

    // Brand ramp only: pink 205, purple 135, blue 39 all present, and the
    // retired red 196 nowhere on any frame. This is the same rule smoke check 9
    // pins for the launch screen.
    loadIn.step('reading config…');
    clock = 200;
    tick();
    const swept = writes.join('');
    for (const index of [205, 135, 39]) {
        assert.ok(swept.includes(`\x1b[38;5;${index}m`), `brand colour ${index} missing`);
    }
    assert.ok(!swept.includes('38;5;196m'), 'the retired red ramp reappeared in the load-in');

    // A frame mid-sweep is partly dim and partly vivid — that IS the band.
    const midSweep = writes.at(-1);
    assert.match(midSweep, /\x1b\[2m/, 'no dim ink: nothing for the band to sweep across');
    assert.match(midSweep, /\x1b\[1m/, 'no vivid ink: the band is not lit');

    // Past the budget it settles: fully vivid, no dim ink left, and the timer
    // is cleared so it cannot animate on forever behind a slow engine start.
    clock = 1200;
    tick();
    assert.equal(tick, null, 'the load-in kept animating past its budget');
    // The five wordmark rows only: the status label under them stays muted by
    // design at every phase, so it is not part of "settled to full vivid".
    const settledArt = writes.at(-1).split('\n').slice(0, 5).join('\n');
    assert.ok(!settledArt.includes('\x1b[2m'), 'the load-in never settled to full vivid');
    assert.match(settledArt, /\x1b\[1m/);

    // done() erases the block and gives the cursor back.
    loadIn.done();
    assert.match(writes.at(-1), /\x1b\[\?25h/, 'the cursor was not restored');
    assert.ok(
        writes.at(-2).includes('\x1b[0J'),
        'the load-in did not erase itself'
    );
});

test('the load-in reports only labels it was given, and never invents one', () => {
    const writes = [];
    const stdout = { isTTY: true, columns: 100, write: (s) => writes.push(s) };
    let tick = null;

    const loadIn = startLoadIn({
        stdout, budgetMs: 1000, now: () => 0,
        setTimer: (fn) => { tick = fn; return { unref() {} }; },
        clearTimer: () => { tick = null; },
    });

    // Before any step() there is no status text at all — an unlabelled frame,
    // not a placeholder stage.
    assert.ok(!plain(writes[0]).includes('…'), 'the load-in invented a label');

    loadIn.step('reading config…');
    assert.match(plain(writes.at(-1)), /reading config…/);

    // Ticking does NOT advance to some next scripted stage: the label only ever
    // changes when the caller says the work changed.
    tick();
    tick();
    assert.match(plain(writes.at(-1)), /reading config…/);
    assert.ok(!plain(writes.at(-1)).includes('initializing'), 'the load-in narrated invented work');
});

test('the load-in adds no delay: done() is synchronous and terminal', () => {
    const writes = [];
    const stdout = { isTTY: true, columns: 100, write: (s) => writes.push(s) };
    let tick = null;
    const loadIn = startLoadIn({
        stdout, budgetMs: 1000, now: () => 0,
        setTimer: (fn) => { tick = fn; return { unref() {} }; },
        clearTimer: () => { tick = null; },
    });

    // Ready 0ms in, mid-sweep: done() returns immediately, stops the clock, and
    // every later call is inert.
    loadIn.done();
    assert.equal(tick, null);
    const after = writes.length;
    loadIn.step('too late');
    loadIn.done();
    assert.equal(writes.length, after, 'the load-in kept writing after done()');
});

test('shimmerSegments always partitions the run exactly', () => {
    for (let width = 1; width <= 60; width++) {
        for (let phase = -20; phase <= 80; phase++) {
            const [before, band, after] = shimmerSegments(width, phase);
            assert.equal(before + band + after, width, `${width}@${phase} lost cells`);
            assert.ok(before >= 0 && band >= 0 && after >= 0, `${width}@${phase} went negative`);
            assert.ok(band <= width);
        }
    }
});

// The gap between the launch frame and the status rule.
//
// This was five blank rows at 120x44 because the panel claimed a SHARE of the
// terminal (0.75), and a share is not a spacing decision — it produces a
// different gap at every height, and the panel read as though it had drifted up
// the screen away from the chrome. The budget is stated as the gap it means to
// produce now, so this is the assertion that keeps it stated.
//
// One row, and exactly one: zero butts the welcome sentence against the status
// strip, and the frame already carries marginBottom:1 to provide it.
test('the launch frame sits one blank row above the chrome at every tall size', () => {
    for (const [columns, rows] of [[120, 44], [120, 50], [120, 60], [160, 48]]) {
        const frameRows = rawRows(renderToString(
            React.createElement(LaunchScreen, {
                info, stats, sessionId: '20260728_010000_gap', columns, rows,
            }),
            { columns }
        ));

        // The frame's own trailing blank row is the gap. Anything more is slack
        // the budget failed to claim.
        let trailing = 0;
        for (let i = frameRows.length - 1; i >= 0 && frameRows[i].trim() === ''; i -= 1) trailing += 1;
        assert.equal(
            trailing,
            1,
            `${columns}x${rows} left ${trailing} blank rows under the launch frame, not 1`
        );

        // And the frame still fits above the status rule and the composer's
        // three rows, which is what the gap is measured against.
        assert.ok(
            frameRows.length <= rows - 4,
            `${columns}x${rows} launch frame collides with the chrome`
        );
    }
});

// The registry lists carry their contrast the way the reference does: the
// category label recedes and the names are the bright thing on the row. These
// were inverted — vivid label, gray names — which spends the contrast on the
// taxonomy rather than on what the operator can actually use.
test('tool and skill names are brighter than the category labels that group them', () => {
    chalk.level = 3;
    try {
        const output = renderToString(
            React.createElement(LaunchScreen, {
                info, stats, sessionId: '20260728_010000_ink', columns: 120, rows: 50,
            }),
            { columns: 120 }
        );
        const row = output.split('\n').find((line) => line.includes('goal, plan'));
        assert.ok(row, 'the session toolset row did not render');
        // The names carry the light neutral...
        assert.match(row, /\x1b\[38;5;252m/, 'tool names lost the bright neutral');
        // ...and the label is dimmed rather than competing with them.
        assert.match(row, /\x1b\[2m/, 'the category label is not dimmed');
    } finally {
        chalk.level = 0;
    }
});

// The retro lockup's depth construction: a lit rim above, a ground shadow
// below, and glints that are CHOSEN, not random. Determinism is the load-
// bearing property — a Math.random glint would render two different launch
// frames for one session, flake every frame assertion in this file, and make
// "what I saw" unreproducible.
test('the retro lockup carries a rim, a ground shadow, and deterministic glints', () => {
    const renderMark = () => plain(renderToString(
        React.createElement(Wordmark, { columns: 120 }),
        { columns: 120 }
    ));

    const rows = renderMark().split('\n');
    assert.equal(rows.length, 8, 'the lockup is rim + six glyph rows + shadow');

    // The rim sits above the letters, over their lit columns, and carries the
    // glints. Exactly three: three is the design, not "up to three" — each aim
    // point snaps to the nearest lit cell rather than vanishing into a gap.
    assert.match(rows[0], /▄/, 'the rim row lost its lit edge');
    assert.equal((rows[0].match(/✦/g) ?? []).length, 3, 'the rim must carry exactly three glints');
    assert.doesNotMatch(rows[0], /█/, 'the rim must be a half-height edge, not a solid row');

    // The ground shadow closes the construction under the echo row.
    assert.match(rows[7], /^▀[▀ ]*$/, 'the ground shadow row is malformed');

    // Same input, same frame — byte for byte.
    assert.equal(renderMark(), renderMark(), 'the lockup must render identically every time');
});
