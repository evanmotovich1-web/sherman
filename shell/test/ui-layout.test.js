import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import React from 'react';
import { Box, render, renderToString } from 'ink';
import stringWidth from 'string-width';

import { COMMANDS } from '../src/commands.js';
import { CommandMenu } from '../src/ui/CommandMenu.js';
import { Composer } from '../src/ui/Composer.js';
import { LaunchScreen } from '../src/ui/LaunchScreen.js';
import { StatusBar } from '../src/ui/StatusBar.js';
import { Transcript } from '../src/ui/Transcript.js';
import { safeTerminalText } from '../src/ui/sanitize.js';
import { SPINNER } from '../src/ui/theme.js';

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
    const at60 = plain(renderToString(
        React.createElement(LaunchScreen, {
            info, stats, sessionId: '20260728_010000_layout', columns: 120, rows: 60,
        }),
        { columns: 120 }
    ));
    assert.equal(at60, at40, 'launch cards must hug content instead of stretching with height');

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

test('persistent chrome matches Hermes two-row footprint', () => {
    const composer = contentRows(renderToString(
        React.createElement(Composer, { onSubmit() {}, busy: false, columns: 120 }),
        { columns: 120 }
    ));
    assert.equal(composer.length, 1);
    assert.match(composer[0], /^ ❯ Ask about company operations…/);
    assert.ok([...composer[0]].length <= 120);

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
        assert.equal(
            maxWidth(status[0]), columns - 1,
            'status rule fills the gutter-inset width'
        );
        assert.match(status[0], /^ ─ ready │ codex·/);
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
        assert.equal(rawRows(output).length, 1, `${columns}-column non-empty composer wrapped`);
        assert.match(output, /❯ x/);
    }

    const pasted = Array.from({ length: 7 }, (_, index) => `line-${index + 1}`).join('\n');
    const clipped = await renderComposer(pasted, 40, 10);
    assert.equal(rawRows(clipped).length, 6);
    assert.doesNotMatch(clipped, /\bline-1\b/);
    assert.match(clipped, /\bline-7\b/);
    assert.match(clipped, /❯/);
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
        assert.equal(maxWidth(output), columns - 1);
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

test('reply margins remain part of the rendered geometry', () => {
    const reply = rawRows(renderToString(
        React.createElement(Transcript, {
            items: [{ id: 'reply', kind: 'message', text: 'Concise response.' }],
            columns: 80,
        }),
        { columns: 80 }
    ));
    assert.deepEqual(reply, [' ◆ Sherman', '   Concise response.', '']);
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
        assert.ok(
            rawRows(composer).length <= 1,
            `${width}-column composer painted more than one row`
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
