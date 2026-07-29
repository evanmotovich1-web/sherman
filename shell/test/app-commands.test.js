import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import React from 'react';
import { render } from 'ink';
import chalk from 'chalk';

import { App } from '../src/ui/app.js';

// Colour level is pinned, not inherited: chalk resolves 3 under a TTY (or an
// inherited FORCE_COLOR) and 0 behind a pipe, and a styled chip keeps its
// trailing padding cell that an unstyled one has trimmed away. Pinning level 0
// makes these frame assertions mean the same thing in both environments.
chalk.level = 0;

const zeroUsage = () => ({ input: 0, cachedInput: 0, output: 0, reasoning: 0, total: 0 });
const ansi = /\x1b\[[0-9;?]*[A-Za-z]/g;
const plain = (value) => value.replace(ansi, '');
const maxWidth = (value) => Math.max(0, ...plain(value).split('\n').map((row) => [...row].length));
const latestFrame = (writes, predicate = () => true) => {
    for (let index = writes.length - 1; index >= 0; index--) {
        const frame = plain(writes[index]).replace(/\n$/, '');
        if (predicate(frame)) return frame;
    }
    return '';
};
const until = async (predicate, deadline = 2000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started >= deadline) throw new Error('timed out waiting for rendered state');
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};

function fakeSession(requests, label = 'main') {
    let disposed = 0;
    return {
        info: {
            engine: 'fake', model: `${label}-model`, user: 'test-user',
            vaultPath: '/tmp/sherman-command-test/vault', threadId: null,
            contextWindow: 100000,
        },
        usage: zeroUsage(),
        async *send(request) {
            requests.push(request);
            yield { kind: 'turn-start' };
            yield { kind: 'message', text: `${label} response` };
            yield { kind: 'turn-end', usage: zeroUsage() };
        },
        interrupt() {},
        dispose() { disposed += 1; },
        disposed: () => disposed,
    };
}

function type(stdin, text, at) {
    setTimeout(() => stdin.write(text), at);
    setTimeout(() => stdin.write('\r'), at + 25);
}

test('App dispatches goals, read-only plans, and isolated workers', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-shell-test-'));
    const oldHome = process.env.HOME;
    process.env.HOME = home;

    const mainRequests = [];
    const workerRequests = [];
    const main = fakeSession(mainRequests, 'main');
    const workers = [];

    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    stdin.ref = () => {};
    stdin.unref = () => {};

    const stdout = new PassThrough();
    stdout.columns = 80;
    stdout.rows = 24;
    let captured = '';
    stdout.on('data', (chunk) => { captured += chunk.toString(); });

    const instance = render(
        React.createElement(App, {
            session: main,
            sessionId: '20260727_220000_abc123',
            sessionFactory: () => {
                const worker = fakeSession(workerRequests, 'worker');
                workers.push(worker);
                return worker;
            },
        }),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false }
    );

    type(stdin, '/goal launch command system', 40);
    type(stdin, 'check status', 150);
    type(stdin, '/plan release steps', 300);
    type(stdin, '/subagent audit command UX', 450);

    await until(() => mainRequests.length === 2 && workerRequests.length === 1);
    instance.unmount();

    try {
        assert.equal(mainRequests.length, 2);
        assert.equal(typeof mainRequests[0], 'string');
        assert.match(mainRequests[0], /SHERMAN SHELL SESSION GOAL/);
        assert.match(mainRequests[0], /launch command system/);
        assert.match(mainRequests[0], /check status/);
        assert.equal(mainRequests[1].mode, 'isolated-read-only');
        assert.equal(mainRequests[1].source, 'plan');

        assert.equal(workerRequests.length, 1);
        assert.equal(workerRequests[0].mode, 'isolated-read-only');
        assert.equal(workerRequests[0].source, 'subagent');
        assert.match(workerRequests[0].text, /audit command UX/);
        assert.equal(workers.length, 1);
        assert.equal(workers[0].disposed(), 1);

        const output = plain(captured);
        assert.match(output, /Session goal set: launch command system/);
    } finally {
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }
});

test('slash palette settles within the 100x30 viewport', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-shell-palette-test-'));
    const oldHome = process.env.HOME;
    process.env.HOME = home;

    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    stdin.ref = () => {};
    stdin.unref = () => {};

    const stdout = new PassThrough();
    stdout.columns = 100;
    stdout.rows = 30;
    const writes = [];
    stdout.on('data', (chunk) => { writes.push(chunk.toString()); });

    const session = fakeSession([], 'palette');
    const instance = render(
        React.createElement(App, {
            session,
            sessionId: '20260728_010000_palette',
        }),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false, debug: true }
    );

    try {
        await until(() => writes.some((write) => plain(write).includes('Sherman Abrams v')));
        writes.length = 0;
        stdin.write('/');
        await until(() => writes.some((write) => plain(write).includes('/ commands')));

        const openFrame = latestFrame(writes, (frame) => frame.includes('/ commands'));
        const openRows = openFrame.split('\n');
        assert.equal(openRows.length, 30);
        assert.ok(maxWidth(openFrame) <= 100);
        assert.match(openFrame, /\/ commands/);
        // The composer now owns the last three rows: top border, prompt, bottom
        // border. The typed '/' still has to be the final thing on the prompt row.
        assert.match(openRows[27], /^╭─+╮$/);
        assert.match(openRows[28], /^│ ❯ \/ +│$/);
        assert.match(openRows[29], /^╰─+╯$/);
        assert.match(openFrame, /Sherman Abrams v/);

        writes.length = 0;
        stdin.write('\x1b');
        await until(() => writes.some((write) => {
            const frame = plain(write);
            return frame.includes('Sherman Abrams v') && !frame.includes('/ commands');
        }));
        const closedFrame = latestFrame(writes, (frame) => frame.includes('Sherman Abrams v'));
        const closedRows = closedFrame.split('\n');
        assert.equal(closedRows.length, 30);
        assert.ok(maxWidth(closedFrame) <= 100);
        assert.match(closedFrame, /Sherman Abrams v/);
        assert.doesNotMatch(closedFrame, /\/ commands/);
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }
});

test('slash palette remains bounded on short terminals', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-shell-short-palette-test-'));
    const oldHome = process.env.HOME;
    process.env.HOME = home;

    try {
        for (const terminalRows of [12, 10, 9, 8]) {
            const stdin = new PassThrough();
            stdin.isTTY = true;
            stdin.setRawMode = () => {};
            stdin.ref = () => {};
            stdin.unref = () => {};

            const stdout = new PassThrough();
            stdout.columns = 100;
            stdout.rows = terminalRows;
            const writes = [];
            stdout.on('data', (chunk) => { writes.push(chunk.toString()); });

            const session = fakeSession([], `palette-${terminalRows}`);
            const instance = render(
                React.createElement(App, {
                    session,
                    sessionId: `20260728_010000_palette_${terminalRows}`,
                }),
                { stdin, stdout, exitOnCtrlC: false, patchConsole: false, debug: true }
            );

            try {
                await until(() => writes.length > 0);
                writes.length = 0;
                stdin.write('/');
                await until(() => writes.some((write) => plain(write).includes('❯ /')));

                const frame = latestFrame(writes, (value) => value.includes('❯ /'));
                const frameRows = frame.split('\n');
                assert.ok(
                    frameRows.length <= terminalRows,
                    `${terminalRows}-row palette painted ${frameRows.length} rows`
                );
                assert.ok(maxWidth(frame) <= 100);
                assert.match(frameRows.at(-1), /^╰─+╯$/);
                assert.match(frameRows.at(-2), /^│ ❯ \/ +│$/);
                assert.match(frameRows.at(-3), /^╭─+╮$/);
                if (terminalRows >= 9) assert.match(frame, /\/ commands/);
            } finally {
                instance.unmount();
            }
        }
    } finally {
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }
});

test('composed busy chrome reserves activity, status, goal, and composer rows', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-shell-busy-layout-test-'));
    const oldHome = process.env.HOME;
    process.env.HOME = home;

    try {
        for (const terminalRows of [24, 5]) {
            let releaseTurn;
            const release = new Promise((resolve) => { releaseTurn = resolve; });
            const session = fakeSession([], `busy-${terminalRows}`);
            session.send = async function* () {
                yield { kind: 'turn-start' };
                for (let index = 1; index <= 3; index++) {
                    yield {
                        kind: 'tool', id: `tool-${index}`, phase: 'started',
                        glyph: '›', label: `tool-${index}`,
                    };
                }
                await release;
            };

            const stdin = new PassThrough();
            stdin.isTTY = true;
            stdin.setRawMode = () => {};
            stdin.ref = () => {};
            stdin.unref = () => {};
            const stdout = new PassThrough();
            stdout.columns = 80;
            stdout.rows = terminalRows;
            const writes = [];
            stdout.on('data', (chunk) => { writes.push(chunk.toString()); });

            const instance = render(
                React.createElement(App, {
                    session,
                    sessionId: `20260728_010000_busy_${terminalRows}`,
                }),
                { stdin, stdout, exitOnCtrlC: false, patchConsole: false, debug: true }
            );

            try {
                await until(() => writes.length > 0);
                stdin.write('/goal focused layout');
                await until(() => writes.some((write) => plain(write).includes('/goal focused layout')));
                stdin.write('\r');
                await until(() => writes.some((write) => plain(write).includes('goal set')));
                writes.length = 0;
                stdin.write('run');
                await until(() => writes.some((write) => plain(write).includes('❯ run')));
                stdin.write('\r');
                // The activity budget is what is left after the status row and
                // the composer's reserved height: the composer now draws a
                // three-row rounded box at this width, so a 24-row terminal
                // still affords the full three activity rows while a 5-row one
                // affords exactly one — and it must be the NEWEST, tool-3.
                const expectedActivityRows = Math.min(
                    3, Math.max(0, terminalRows - 1 - 3)
                );
                const expectedTools = [1, 2, 3].slice(-expectedActivityRows);
                await until(() => writes.some((write) => {
                    const frame = plain(write);
                    return expectedTools.every((index) => frame.includes(`tool-${index}`));
                }));

                const frame = latestFrame(writes, (value) => value.includes('tool-3'));
                const frameRows = frame.split('\n');
                assert.equal(frameRows.length, terminalRows);
                assert.equal(
                    frameRows.filter((row) => /│ › tool-[123]/.test(row)).length,
                    expectedActivityRows,
                    `${terminalRows}-row frame painted the wrong activity-row count`
                );
                for (const index of expectedTools) {
                    assert.match(frame, new RegExp(`│ › tool-${index}\\b`));
                }
                // Exactly one status strip. It no longer opens with ' ─ ', so it
                // is identified by the gutter space plus the state chip's own
                // padded busy segment — still one row, still exactly once.
                const statusRows = frameRows.filter(
                    (row) => /^ {2}\S+ working · \d+\.\d+s(?: |$)/.test(row)
                );
                assert.equal(statusRows.length, 1);
                assert.match(frame, /goal set/);
                // Anchored at the last chip's text: the chips stop after the
                // final segment instead of ruling to the right edge. (Its right
                // padding cell exists but is only materialised when the chip
                // carries a background, i.e. at a non-zero colour level.)
                assert.match(statusRows[0], /goal set$/);
                // The composer is reserved chrome at every height: its prompt
                // row must exist, framed by its own rounded borders, and it must
                // be the last thing in the frame.
                const promptRow = frameRows.findIndex(
                    (row) => /^│ ❯ Ctrl\+C to interrupt… +│$/.test(row)
                );
                assert.ok(
                    promptRow > 0,
                    `${terminalRows}-row frame lost the reserved composer prompt row`
                );
                assert.match(frameRows[promptRow - 1], /^╭─+╮$/);
                assert.match(
                    frameRows[promptRow + 1] ?? '',
                    /^╰─+╯$/,
                    `${terminalRows}-row frame clipped the composer's bottom border`
                );
                assert.equal(promptRow + 1, frameRows.length - 1);
            } finally {
                releaseTurn();
                instance.unmount();
            }
        }
    } finally {
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }
});

test('rows override preserves composer at one row and admits status at two', async () => {
    const oldHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), 'sherman-app-rows-'));
    process.env.HOME = home;
    try {
        for (const rows of [1, 2]) {
            const stdin = new PassThrough();
            stdin.isTTY = true;
            stdin.setRawMode = () => {};
            stdin.ref = () => {};
            stdin.unref = () => {};
            const stdout = new PassThrough();
            stdout.columns = 80;
            stdout.rows = 24;
            const writes = [];
            stdout.on('data', (chunk) => { writes.push(chunk.toString()); });
            const instance = render(
                React.createElement(App, {
                    session: fakeSession([], []), sessionId: `rows-${rows}`, rows,
                }),
                { stdin, stdout, exitOnCtrlC: false, patchConsole: false, debug: true }
            );
            try {
                await until(() => writes.length > 0);
                const frame = plain(writes.at(-1) ?? '').replace(/\n$/, '');
                assert.equal(frame.split('\n').length, rows);
                if (rows === 1) assert.doesNotMatch(frame, /blocked/);
                else assert.match(frame, /blocked/);
            } finally {
                instance.unmount();
                stdin.end();
                stdout.end();
            }
        }
    } finally {
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }
});

test('a finished task lingers, then leaves, and never enters the transcript', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-linger-test-'));
    const oldHome = process.env.HOME;
    process.env.HOME = home;

    // The turn is held open past the linger, so what is measured is the linger
    // expiring on its own rather than turn-end clearing everything.
    let releaseTurn;
    const release = new Promise((resolve) => { releaseTurn = resolve; });
    const usage = zeroUsage();
    const session = {
        info: {
            engine: 'fake', model: 'fake-model', user: 'test-user',
            vaultPath: join(home, 'vault'), threadId: null, contextWindow: 100000,
        },
        usage,
        async *send() {
            yield { kind: 'turn-start' };
            yield {
                kind: 'tool', id: 'tool-1', phase: 'started',
                glyph: '›', label: 'read scanner.js', category: 'read',
            };
            yield {
                kind: 'tool', id: 'tool-1', phase: 'completed', glyph: '›',
                label: 'read scanner.js', category: 'read',
                outcome: 'succeeded', durationMs: 900,
            };
            await release;
            yield { kind: 'turn-end', usage };
        },
        interrupt() {}, dispose() {},
    };

    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    stdin.ref = () => {};
    stdin.unref = () => {};
    const stdout = new PassThrough();
    stdout.columns = 70;
    stdout.rows = 24;
    const writes = [];
    stdout.on('data', (chunk) => { writes.push(chunk.toString()); });

    const instance = render(
        React.createElement(App, { session, sessionId: '20260728_010000_linger' }),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false, debug: true }
    );

    try {
        await until(() => writes.length > 0);
        stdin.write('go');
        await until(() => writes.some((write) => plain(write).includes('❯ go')));
        stdin.write('\r');

        // Completion is rendered: the outcome mark and the engine's measured
        // duration both reach the screen.
        await until(() => writes.some((write) => plain(write).includes('✓ read scanner.js  0.9s')));

        // ...and then it goes, on its own, while the turn is still running. The
        // face animates on a timer, so fresh frames keep arriving to observe.
        writes.length = 0;
        await until(
            () => writes.length > 0 && !latestFrame(writes).includes('read scanner.js'),
            4000
        );
        const settled = latestFrame(writes);
        assert.ok(
            !settled.includes('read scanner.js'),
            'the finished task should have left the screen'
        );
        // Still busy, so the line stays -- with the honest generic, not a stale
        // claim about a task that already finished.
        assert.match(settled, /─ \(.+\) ─ working ─/);

        releaseTurn();
        await until(() => writes.some((write) => plain(write).includes('Ask about company operations')));

        // The permanent record holds messages, not the tool trace: nothing about
        // the finished task survives anywhere on the final screen.
        const final = latestFrame(writes);
        assert.ok(!final.includes('read scanner.js'), 'tool line must not be committed');
        assert.ok(!final.includes('0.9s'), 'tool duration must not be committed');
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }
});

// Both routes to the clipboard, end to end through the real App.
//
// `clipboard` is injected so this never touches the operator's actual
// clipboard, and the fake records what it was handed: the assertion that
// matters is that the text leaving the shell is the SOURCE reply, with no
// signature line, no rule glyph and no ANSI, at whatever width the terminal
// happens to be.
// Both routes to the clipboard, end to end through the real App.
//
// `clipboard` is injected so this never touches the operator's actual
// clipboard, and the fake records what it was handed: the assertion that
// matters is that the text leaving the shell is the SOURCE reply, with no
// signature line, no rule glyph and no ANSI, at whatever width the terminal
// happens to be.
//
// Progress is tracked through `copied` rather than through rendered frames.
// Ink writes incrementally, so a notice that appeared and was later redrawn is
// not reliably present in the accumulated capture; the wording is asserted once
// at the end, against the full frame unmount emits.
test('/copy and ctrl+y both copy the last reply as plain text', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-shell-test-'));
    const oldHome = process.env.HOME;
    process.env.HOME = home;

    const copied = [];
    const clipboard = (text) => {
        copied.push(text);
        return { ok: true, method: 'pbcopy', confirmed: true, reason: null };
    };

    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    stdin.ref = () => {};
    stdin.unref = () => {};

    const stdout = new PassThrough();
    stdout.columns = 80;
    stdout.rows = 24;
    let captured = '';
    stdout.on('data', (chunk) => { captured += chunk.toString(); });

    const requests = [];
    const instance = render(
        React.createElement(App, {
            session: fakeSession(requests, 'main'),
            sessionId: '20260728_010000_copy01',
            clipboard,
        }),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false }
    );

    let settled = false;
    try {
        // Ink's stdin handler is not attached on the tick render() returns.
        await new Promise((resolve) => setTimeout(resolve, 120));

        // Nothing has been said yet: the shell must decline rather than copy
        // the launch frame, the banner, or an empty string.
        stdin.write('\x19');
        await new Promise((resolve) => setTimeout(resolve, 150));
        assert.equal(copied.length, 0, 'ctrl+y copied something before Sherman had replied');

        // Waited on the engine call, not on a rendered frame, for the same
        // incremental-write reason the wording assertion is deferred.
        type(stdin, 'a question', 10);
        await until(() => requests.length === 1);
        await new Promise((resolve) => setTimeout(resolve, 150));

        stdin.write('\x19');
        await until(() => copied.length === 1);
        assert.equal(copied[0], 'main response', 'ctrl+y did not copy the reply source text');

        type(stdin, '/copy', 10);
        await until(() => copied.length === 2);
        assert.equal(copied[1], 'main response', '/copy did not copy the reply source text');

        for (const text of copied) {
            assert.doesNotMatch(text, /│/, 'the rule glyph leaked into the clipboard');
            assert.doesNotMatch(text, /Sherman/, 'the signature line leaked into the clipboard');
            assert.doesNotMatch(text, /\x1b/, 'an ANSI escape leaked into the clipboard');
        }
        settled = true;
    } finally {
        instance.unmount();
        await new Promise((resolve) => setTimeout(resolve, 50));
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }

    // Confirmed copies, and only those, are announced as copies.
    if (settled) {
        assert.match(plain(captured), /Copied the last reply to the clipboard \(1 line\)\./);
    }
});
