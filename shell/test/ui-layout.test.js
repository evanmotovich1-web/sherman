import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import React from 'react';
import { Box, render, renderToString } from 'ink';
import stringWidth from 'string-width';
import chalk from 'chalk';

import { COMMANDS } from '../src/commands.js';
import { CommandMenu } from '../src/ui/CommandMenu.js';
import { Composer } from '../src/ui/Composer.js';
import { LaunchScreen } from '../src/ui/LaunchScreen.js';
import { StatusBar } from '../src/ui/StatusBar.js';
import { Transcript } from '../src/ui/Transcript.js';
import { safeTerminalText } from '../src/ui/sanitize.js';
import { shimmerSegments, startLoadIn } from '../src/ui/loadin.js';
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

test('launch hierarchy stays clean and bounded across target terminal sizes', () => {
    for (const [columns, rows] of [[80, 24], [100, 30], [120, 40], [160, 48]]) {
        const output = renderToString(
            React.createElement(LaunchScreen, {
                info, stats, sessionId: '20260728_010000_abc123', columns, rows,
            }),
            { columns }
        );
        assert.equal(maxWidth(output), columns, `${columns}x${rows} lost full-width launch geometry`);
        assert.ok(
            rawRows(output).length <= rows - 2,
            `${columns}x${rows} launch crowds out status/composer`
        );
        if (rows < 29) {
            assert.match(plain(output), /\/help/);
        } else {
            assert.match(plain(output), /\bVault\b/);
            assert.match(plain(output), /\bKeys\b/);
        }
    }

    const at40 = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, sessionId: '20260728_010000_layout', columns: 120, rows: 40,
        }),
        { columns: 120 }
    ));
    const at43 = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, sessionId: '20260728_010000_layout', columns: 120, rows: 43,
        }),
        { columns: 120 }
    ));
    const at60 = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, sessionId: '20260728_010000_layout', columns: 120, rows: 60,
        }),
        { columns: 120 }
    ));
    // Below the tall threshold the panel still hugs its content, unchanged: 40
    // and 43 rows must render the identical frame.
    assert.equal(at43, at40, 'below the tall threshold the launch panel must still hug content');
    // At and above it the panel claims a share of the height, so a 60-row
    // terminal gets a visibly taller frame than a 40-row one — and still leaves
    // room for the status rule and composer.
    const rowsAt40 = at40.split('\n').length;
    const rowsAt60 = at60.split('\n').length;
    assert.ok(
        rowsAt60 >= rowsAt40 + 6,
        `tall terminals must stretch the launch panel (40 rows -> ${rowsAt40}, 60 -> ${rowsAt60})`
    );
    assert.ok(rowsAt60 <= 58, 'a stretched launch panel must not crowd out status and composer');

    const wideCompact = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, sessionId: '20260728_010000_boundary', columns: 120, rows: 28,
        }),
        { columns: 120 }
    ));
    const wideFull = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, sessionId: '20260728_010000_boundary', columns: 120, rows: 29,
        }),
        { columns: 120 }
    ));
    assert.doesNotMatch(wideCompact, /\bVault\b/);
    assert.match(wideFull, /\bVault\b/);

    const stackedCompact = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, sessionId: '20260728_010000_boundary', columns: 40, rows: 40,
        }),
        { columns: 40 }
    ));
    const stackedFull = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, sessionId: '20260728_010000_boundary', columns: 40, rows: 41,
        }),
        { columns: 40 }
    ));
    assert.doesNotMatch(stackedCompact, /\bVault\b/);
    assert.match(stackedFull, /\bVault\b/);
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
    assert.deepEqual(output, [' ❯ line one', '   line two', '   line three']);
});

test('reply geometry is a signed box whose label lives in the top border', () => {
    const reply = rawRows(renderToString(
        React.createElement(Transcript, {
            items: [{ id: 'reply', kind: 'message', text: 'Concise response.' }],
            columns: 80,
        }),
        { columns: 80 }
    ));
    // 80 columns, one column of transcript gutter each side => a 78-cell box.
    // The signature is embedded in the top border after a single dash, and the
    // bottom border — not a trailing blank row — terminates the reply.
    assert.deepEqual(reply, [
        ` ╭─ Sherman ${'─'.repeat(78 - 12)}╮`,
        ` │ Concise response.${' '.repeat(78 - 20)}│`,
        ` ╰${'─'.repeat(76)}╯`,
    ]);
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

    const frameRows = rawRows(output);
    assert.equal(frameRows.findIndex((line) => line.includes('Worker reply.')), 22);
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
