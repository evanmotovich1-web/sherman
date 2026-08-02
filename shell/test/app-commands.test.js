import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import React from 'react';
import { render } from 'ink';
import chalk from 'chalk';

import { until } from '../test-support/until.js';

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
// One shared copy — see test-support/until.js for why the deadline is not a
// constant in this file any more.

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

test('a finished task commits to the trace; only the running copy leaves', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-trace-test-'));
    const oldHome = process.env.HOME;
    process.env.HOME = home;

    // The turn is held open after completion, so what is measured is the
    // committed row surviving on its own — not turn-end tidying the screen.
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
            yield {
                kind: 'tool', id: 'tool-2', phase: 'completed', glyph: '›',
                label: 'npm test', category: 'command',
                outcome: 'failed', durationMs: 2100,
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
        React.createElement(App, { session, sessionId: '20260728_010000_trace' }),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false, debug: true }
    );

    try {
        await until(() => writes.length > 0);
        stdin.write('go');
        await until(() => writes.some((write) => plain(write).includes('❯ go')));
        stdin.write('\r');

        // The completed row commits into the trace, in the reference shape:
        // glyph, padded category tag, the engine's label, measured duration.
        await until(() => latestFrame(writes).includes('📖 read    read scanner.js  0.9s'));
        const frame = latestFrame(writes);
        assert.match(frame, /│ 📖 read {4}read scanner\.js {2}0\.9s/, 'the committed row lost its trace shape');

        // Success carries NO outcome mark — in a trace where nearly every row
        // succeeds, the absence is what carries information...
        assert.doesNotMatch(frame, /✓/, 'a successful row printed a redundant ✓');
        // ...and a failure keeps its mark.
        assert.match(frame, /💻 \$ {7}npm test ×  2\.1s/, 'the failed row lost its outcome mark');

        // Committed means committed: the rows persist while the turn runs on,
        // with no live duplicate beneath them — one event, one row on screen.
        const occurrences = frame.split('read scanner.js').length - 1;
        assert.equal(occurrences, 1, 'the completed task renders twice (trace and live slot)');

        releaseTurn();
        await until(() => latestFrame(writes).includes('❯ Ask about company operations…'));
        assert.match(
            latestFrame(writes),
            /│ 📖 read {4}read scanner\.js {2}0\.9s/,
            'the committed trace row did not survive the turn ending'
        );
    } finally {
        releaseTurn();
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }
});
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

// /clear wipes the SCREEN and nothing else: the engine session is not touched
// (no dispose, no new thread — /compact owns context) and the record survives
// in the session log. Off a TTY Ink emits its frame on unmount, so the visible
// proof is that the final frame carries the notice and not the cleared reply.
test('/clear empties the transcript without touching the engine', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-clear-test-'));
    const oldHome = process.env.HOME;
    process.env.HOME = home;

    const requests = [];
    const session = fakeSession(requests, 'main');

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
        React.createElement(App, { session, sessionId: '20260729_010000_clear1' }),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false }
    );

    try {
        type(stdin, 'a question', 40);
        await until(() => requests.length === 1);
        // Let the turn's teardown settle before clearing what it rendered.
        await new Promise((resolve) => setTimeout(resolve, 100));
        type(stdin, '/clear', 0);
        await new Promise((resolve) => setTimeout(resolve, 100));

        instance.unmount();
        // The last frame that shows the notice must be a frame the cleared
        // reply is no longer in.
        const frame = latestFrame(writes, (f) => f.includes('transcript cleared'));
        assert.ok(frame, 'the /clear notice never rendered');
        assert.doesNotMatch(frame, /main response/, 'the cleared reply is still on screen');
        assert.equal(session.disposed(), 0, '/clear must not dispose the engine session');
        assert.equal(requests.length, 1, '/clear must not send an engine turn');
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }
});

// /exit is the second ctrl+c spelled as a command: with no turns there is no
// conduct to grade, so it disposes and leaves without spending an eval turn.
test('/exit on an untouched session leaves without an eval turn', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-exit-test-'));
    const oldHome = process.env.HOME;
    process.env.HOME = home;

    const requests = [];
    const session = fakeSession(requests, 'main');

    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    stdin.ref = () => {};
    stdin.unref = () => {};

    const stdout = new PassThrough();
    stdout.columns = 80;
    stdout.rows = 24;
    stdout.on('data', () => {});

    const instance = render(
        React.createElement(App, { session, sessionId: '20260729_020000_exit01' }),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false }
    );

    try {
        type(stdin, '/exit', 40);
        await instance.waitUntilExit();
        assert.equal(requests.length, 0, 'an untouched session must not spend an eval turn on exit');
        assert.equal(session.disposed(), 1, '/exit must dispose the engine session');
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }
});

// With turns in the session, /exit grades first: the eval request goes out
// read-only, and only after it completes does the shell dispose and leave.
test('/exit runs the end-of-session eval before leaving a used session', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-exit-eval-'));
    const oldHome = process.env.HOME;
    process.env.HOME = home;

    const requests = [];
    const session = fakeSession(requests, 'main');

    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    stdin.ref = () => {};
    stdin.unref = () => {};

    const stdout = new PassThrough();
    stdout.columns = 80;
    stdout.rows = 24;
    stdout.on('data', () => {});

    const instance = render(
        React.createElement(App, { session, sessionId: '20260729_030000_exit02' }),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false }
    );

    try {
        type(stdin, 'real work', 40);
        await until(() => requests.length === 1);
        await new Promise((resolve) => setTimeout(resolve, 100));
        type(stdin, '/exit', 0);
        await instance.waitUntilExit();

        assert.equal(requests.length, 2, '/exit on a used session must run exactly one eval turn');
        assert.equal(requests[1].source, 'eval');
        assert.equal(requests[1].mode, 'read-only');
        assert.equal(session.disposed(), 1);
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }
});

// /email end to end against a fake engine: the drafting request is read-only,
// the raw JSON reply never reaches the transcript, the readable draft does,
// and with browsers disabled the notice says plainly that nothing opened.
test('/email drafts through the engine and reports the open honestly', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-shell-email-test-'));
    const oldHome = process.env.HOME;
    process.env.HOME = home;
    process.env.SHERMAN_NO_BROWSER = '1';

    const requests = [];
    const session = {
        info: {
            engine: 'fake', model: 'email-model', user: 'test-user',
            vaultPath: '/tmp/sherman-command-test/vault', threadId: null,
            contextWindow: 100000,
        },
        usage: zeroUsage(),
        async *send(request) {
            requests.push(request);
            yield { kind: 'turn-start' };
            yield {
                kind: 'message',
                text: '{"to": "lab@example.com", "subject": "Analyzers back up", "body": "Both analyzers passed QC this morning."}',
            };
            yield { kind: 'turn-end', usage: zeroUsage() };
        },
        interrupt() {},
        dispose() {},
    };

    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    stdin.ref = () => {};
    stdin.unref = () => {};

    const stdout = new PassThrough();
    stdout.columns = 100;
    stdout.rows = 40;
    let captured = '';
    stdout.on('data', (chunk) => { captured += chunk.toString(); });

    const instance = render(
        React.createElement(App, {
            session, sessionId: '20260731_090000_email1',
        }),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false }
    );

    type(stdin, '/email tell the lab the analyzers are back up', 40);

    try {
        // Off a TTY Ink defers frames until unmount, so the wait watches disk:
        // the session log carries the engine reply the moment the turn lands.
        const { readFileSync: readLog } = await import('node:fs');
        const logPath = join(home, '.sherman', 'sessions', '20260731_090000_email1.jsonl');
        await until(() => {
            try {
                return readLog(logPath, 'utf8').includes('Analyzers back up');
            } catch {
                return false;
            }
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        instance.unmount();

        assert.equal(requests[0].mode, 'read-only');
        assert.equal(requests[0].source, 'email');
        assert.match(requests[0].text, /analyzers are back up/);

        const output = plain(captured);
        assert.match(output, /To: lab@example\.com/);
        assert.match(output, /Both analyzers passed QC this morning\./);
        // The raw JSON reply must not have been committed as a message.
        assert.doesNotMatch(output, /"subject":/);
        // Browsers are disabled in this test, and the notice says so instead
        // of claiming a window opened.
        assert.match(output, /Could not open a browser here/);
        assert.match(output, /SHERMAN_NO_BROWSER/);
    } finally {
        // Second unmount is a no-op; in finally so a timed-out wait can never
        // leave the Ink instance mounted and the test runner alive forever.
        instance.unmount();
        delete process.env.SHERMAN_NO_BROWSER;
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }
});

// /win end to end: the worker gets the evidence paths, the verdict becomes a
// page under ~/.sherman/win/, and with browsers disabled the notice still
// names the file instead of claiming a window.
test('/win judges the recorded sessions into a local page', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-shell-win-test-'));
    const oldHome = process.env.HOME;
    process.env.HOME = home;
    process.env.SHERMAN_NO_BROWSER = '1';

    const { mkdirSync, writeFileSync, readdirSync, readFileSync } = await import('node:fs');
    mkdirSync(join(home, '.sherman', 'sessions'), { recursive: true });
    writeFileSync(
        join(home, '.sherman', 'sessions', '20260730_a.jsonl'),
        JSON.stringify({ role: 'user', at: '2026-07-30T00:00:00Z', text: 'hello' }) + '\n'
    );

    const workerRequests = [];
    const worker = {
        info: {
            engine: 'fake', model: 'win-model', user: 'test-user',
            vaultPath: '/tmp/sherman-command-test/vault', threadId: null,
            contextWindow: 100000,
        },
        usage: zeroUsage(),
        async *send(request) {
            workerRequests.push(request);
            yield { kind: 'turn-start' };
            yield { kind: 'message', text: '# What is going right\n- vault cited in 20260730_a' };
            yield { kind: 'turn-end', usage: zeroUsage() };
        },
        interrupt() {},
        dispose() {},
    };
    const main = fakeSession([], 'main');

    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    stdin.ref = () => {};
    stdin.unref = () => {};
    const stdout = new PassThrough();
    stdout.columns = 100;
    stdout.rows = 40;
    let captured = '';
    stdout.on('data', (chunk) => { captured += chunk.toString(); });

    const instance = render(
        React.createElement(App, {
            session: main, sessionId: '20260731_100000_win1',
            sessionFactory: () => worker,
        }),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false }
    );

    type(stdin, '/win', 40);

    const winDir = join(home, '.sherman', 'win');
    try {
        // Same off-TTY rule as /email: wait on the page landing on disk.
        await until(() => {
            try {
                return readdirSync(winDir).some((n) => n.endsWith('.html'));
            } catch {
                return false;
            }
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        instance.unmount();

        assert.equal(workerRequests[0].mode, 'isolated-read-only');
        assert.equal(workerRequests[0].source, 'win');
        assert.match(workerRequests[0].text, /20260730_a\.jsonl/);

        const output = plain(captured);
        // Two logs: the fixture AND the live session's own log — the shell
        // records the /win turn itself before the worker is spawned.
        assert.match(output, /judging 2 session logs/);
        assert.match(output, /could not open a browser here/);

        const pages = readdirSync(winDir).filter((n) => n.endsWith('.html'));
        assert.equal(pages.length, 1);
        const page = readFileSync(join(winDir, pages[0]), 'utf8');
        assert.match(page, /<h1>What is going right<\/h1>/);
        assert.match(page, /2 session logs/);
    } finally {
        instance.unmount();
        delete process.env.SHERMAN_NO_BROWSER;
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }
});

// A slash that names a SKILL is an invocation, not a typo. The request must
// ride the normal prompt path (string, goal envelope rules apply), name the
// skill's own SKILL.md, and carry the operator's arguments verbatim — and a
// bare typed skill name must SUBMIT on Enter, not get re-completed into
// itself forever. A slash that names neither a command nor a skill still
// fails honestly.
test('App dispatches slash-skill invocations and still rejects unknown commands', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-shell-skill-test-'));
    const oldHome = process.env.HOME;
    process.env.HOME = home;

    const mainRequests = [];
    const main = fakeSession(mainRequests, 'main');

    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    stdin.ref = () => {};
    stdin.unref = () => {};

    const stdout = new PassThrough();
    stdout.columns = 120;
    stdout.rows = 40;
    let captured = '';
    stdout.on('data', (chunk) => { captured += chunk.toString(); });

    const instance = render(
        React.createElement(App, {
            session: main,
            sessionId: '20260731_150000_abc123',
        }),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false }
    );

    // Bare skill name: Enter submits the skill rather than re-completing it.
    type(stdin, '/seed', 40);
    // Skill with arguments: they travel verbatim.
    type(stdin, '/vault-search where is the fax SOP', 250);
    // Neither command nor skill: the shell says so and sends nothing.
    type(stdin, '/nosuchskill do things', 500);

    try {
        await until(() => mainRequests.length === 2);
        // The third submission produces no request, so its only signal is the
        // transcript — and a non-TTY stdout gets its frame at unmount. Give
        // the 500ms keystroke time to land, unmount, then read the record.
        await new Promise((resolve) => setTimeout(resolve, 450));
        instance.unmount();

        assert.equal(typeof mainRequests[0], 'string');
        assert.match(mainRequests[0], /skills\/seed\/SKILL\.md/);
        assert.equal(typeof mainRequests[1], 'string');
        assert.match(mainRequests[1], /skills\/vault-search\/SKILL\.md/);
        assert.match(mainRequests[1], /where is the fax SOP/);
        assert.equal(mainRequests.length, 2);
        assert.match(plain(captured), /Unknown command \/nosuchskill/);
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }
});
