// Mouse reporting: the sequences, the caret mapping, and the promise that the
// terminal is handed back in the mode it was lent in.
//
// The exit guarantee is tested by actually exiting: a child process enables
// reporting against a descriptor pointed at a file, then leaves by each route a
// real session can leave by, and the file is read afterwards. Nothing here
// needs a pty — the fake stdout carries `isTTY` and a real file descriptor,
// which is everything `enableMouse` looks at.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import React from 'react';
import { render } from 'ink';
import chalk from 'chalk';

// These tests wait on repaints after events that may not re-render by
// themselves; the idle clock is their backstop. Production hops it to 10s
// (small-viewport waterfall, issue #18) — restore a fast tick here so the
// waits stay about mouse behavior, not clock schedules.
process.env.SHERMAN_IDLE_TICK_MS = '100';

import { App } from '../src/ui/app.js';
import {
    MOUSE_OFF,
    MOUSE_ON,
    caretForClick,
    enableMouse,
    isMouseSequence,
    parseMouse,
} from '../src/ui/mouse.js';

chalk.level = 0;

const ansi = /\x1b\[[0-9;?]*[A-Za-z]/g;
const plain = (value) => value.replace(ansi, '');

const until = async (predicate, deadline = 2000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started >= deadline) {
            throw new Error('timed out waiting for rendered state');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};

test('SGR 1006 reports parse into presses, releases and wheel notches', () => {
    assert.equal(MOUSE_ON, '\x1b[?1000h\x1b[?1006h');
    assert.equal(MOUSE_OFF, '\x1b[?1006l\x1b[?1000l');

    // A press and its release are two events, distinguished by the final byte.
    assert.deepEqual(parseMouse('\x1b[<0;12;34M'), [
        { type: 'press', button: 0, column: 12, row: 34 },
    ]);
    assert.deepEqual(parseMouse('\x1b[<0;12;34m'), [
        { type: 'release', button: 0, column: 12, row: 34 },
    ]);

    // Bit 6 marks the wheel; button 0 is up and 1 is down. A wheel release is
    // not a thing that happens, so none is reported.
    assert.deepEqual(parseMouse('\x1b[<64;5;6M\x1b[<65;5;6M\x1b[<64;5;6m'), [
        { type: 'wheel', direction: 'up', column: 5, row: 6 },
        { type: 'wheel', direction: 'down', column: 5, row: 6 },
    ]);

    // A fast wheel delivers several packets in one read, and all of them count:
    // dropping the tail of a chunk would make the scroll lag the hand.
    assert.equal(parseMouse('\x1b[<64;1;1M'.repeat(5)).length, 5);

    // Decimal coordinates past what the legacy encoding could address.
    assert.deepEqual(parseMouse('\x1b[<0;250;120M'), [
        { type: 'press', button: 0, column: 250, row: 120 },
    ]);

    // Anything that is not a report is not a report. This is the guard that
    // keeps escape bytes out of the composer, so a near-miss must fail it.
    assert.equal(isMouseSequence('\x1b[<0;1;1M'), true);
    assert.equal(isMouseSequence('\x1b[<0;1;1M\x1b[<0;1;1m'), true);
    assert.equal(isMouseSequence('hello'), false);
    assert.equal(isMouseSequence('\x1b[<0;1;1Mx'), false);
    assert.equal(isMouseSequence('\x1b[5~'), false);
    assert.equal(isMouseSequence(''), false);
    assert.deepEqual(parseMouse('\x1b[5~'), []);
});

test('a click maps to a caret column, clamped to the text', () => {
    const row = 20;
    const on = (column, length = 10) =>
        caretForClick({ column, row, textRow: row, textColumn: 4, length });

    // Screen column 5 (1-based) is the first text cell, i.e. caret 0.
    assert.equal(on(5), 0);
    assert.equal(on(9), 4);
    // Into the border and the prompt gutter: clamped to the start, not negative.
    assert.equal(on(1), 0);
    assert.equal(on(4), 0);
    // Past the end of a short line: the end, which is what clicking into the
    // empty tail of a line obviously means.
    assert.equal(on(15), 10);
    assert.equal(on(200), 10);
    // The exact last character, and one past it.
    assert.equal(on(14), 9);
    // Any other row is not the composer, so there is nothing to place.
    assert.equal(caretForClick({ column: 8, row: 19, textRow: 20, textColumn: 4, length: 10 }), null);
});

test('mouse mode is disabled on every exit path', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-mouse-test-'));
    const script = join(home, 'exit.mjs');
    const source = `
import { openSync, closeSync } from 'node:fs';
import { enableMouse } from ${JSON.stringify(new URL('../src/ui/mouse.js', import.meta.url).href)};

const fd = openSync(process.argv[2], 'w');
// Everything enableMouse inspects: a TTY flag, a descriptor, and a write.
const fake = { isTTY: true, fd, write: () => true };
enableMouse(fake);

const how = process.argv[3];
if (how === 'return') { /* fall off the end of the script */ }
if (how === 'exit') process.exit(0);
if (how === 'throw') throw new Error('boom');
if (how === 'sigint') process.kill(process.pid, 'SIGINT');
if (how === 'sigterm') process.kill(process.pid, 'SIGTERM');
if (how === 'sighup') process.kill(process.pid, 'SIGHUP');
setTimeout(() => {}, 5000);
`;
    writeFileSync(script, source);

    try {
        for (const how of ['return', 'exit', 'throw', 'sigint', 'sigterm', 'sighup']) {
            const out = join(home, `${how}.txt`);
            try {
                execFileSync(process.execPath, [script, out, how], { stdio: 'ignore' });
            } catch {
                // A thrown fault and a signal both exit non-zero. That they exit
                // badly is the point: the terminal must still be restored.
            }
            const written = readFileSync(out, 'utf8');
            assert.ok(
                written.includes(MOUSE_OFF),
                `leaving via ${how} left mouse reporting enabled`
            );
        }
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('enableMouse is inert without a TTY, so piped runs never change mode', () => {
    const writes = [];
    const notTty = { isTTY: false, fd: 1, write: (chunk) => { writes.push(chunk); return true; } };
    const before = process.listenerCount('exit');
    const off = enableMouse(notTty);
    assert.deepEqual(writes, []);
    assert.equal(process.listenerCount('exit'), before, 'no exit guard for a non-TTY');
    off();
    assert.deepEqual(writes, []);

    // And with no stdout at all, which is what a broken pipe looks like.
    assert.doesNotThrow(() => enableMouse(null)());
});

test('the shell places the caret from a click and scrolls from the wheel', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-mouse-app-'));
    const oldHome = process.env.HOME;
    process.env.HOME = home;

    const usage = { input: 0, cachedInput: 0, output: 0, reasoning: 0, total: 0 };
    const session = {
        info: {
            engine: 'fake', model: 'fake-model', user: 'test-user',
            vaultPath: join(home, 'vault'), threadId: null, contextWindow: 100000,
        },
        usage,
        async *send() {
            yield { kind: 'turn-start' };
            yield { kind: 'message', text: 'answer' };
            yield { kind: 'turn-end', usage };
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
    stdout.isTTY = true;
    stdout.columns = 80;
    stdout.rows = 14;
    let captured = '';
    stdout.on('data', (chunk) => { captured += chunk.toString(); });

    const instance = render(
        React.createElement(App, { session, sessionId: '20260728_010000_mouse' }),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false }
    );

    try {
        await until(() => plain(captured).includes('Ask about company operations'));

        stdin.write('abcdef');
        await until(() => plain(captured).includes('❯ abcdef'));

        // The composer's prompt row is the second-to-last row of a 14-row
        // terminal, and its text starts at screen column 5 (1-based): border,
        // padding, then the two-cell '❯ ' gutter. Clicking the 'c' should put
        // the caret in front of it, so the next keystroke lands there.
        captured = '';
        stdin.write('\x1b[<0;7;13M');
        stdin.write('\x1b[<0;7;13m');
        await until(() => plain(captured).includes('abcdef'));
        stdin.write('X');
        await until(() => plain(captured).includes('❯ abXcdef'));

        // A click is not a keystroke: the sequence itself must never reach the
        // buffer, on the click row or anywhere else.
        assert.doesNotMatch(plain(captured), /\[<0;7;13/);

        // A click somewhere with nothing on it changes nothing — no invisible
        // buttons. The caret stays where the earlier click put it.
        captured = '';
        stdin.write('\x1b[<0;40;3M');
        stdin.write('Y');
        await until(() => plain(captured).includes('❯ abXYcdef'));

        // The wheel scrolls the transcript, through the same clamped path the
        // keys use, and reports the same measured count.
        captured = '';
        stdin.write('\x1b[<64;40;5M');
        await until(() => /viewing history — \d+ lines? below/.test(plain(captured)));
        const [, up] = plain(captured).match(/viewing history — (\d+) lines? below/);
        assert.ok(Number(up) > 0);

        captured = '';
        stdin.write('\x1b[<65;40;5M'.repeat(4));
        await until(() => {
            const frame = plain(captured);
            return frame.includes('❯') && !frame.includes('viewing history');
        });
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }
});
