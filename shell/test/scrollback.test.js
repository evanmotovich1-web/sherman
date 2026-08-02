// Scrollback: the window arithmetic, the rendered window, and the live keys.
//
// The arithmetic is pure and tested directly. The rendered window is tested by
// driving the real Transcript with a real Ink render and reading which rows the
// clip admitted — the point of the design is that the component tree is
// identical at every offset, so the only thing worth asserting is what the
// viewport shows and what it reports having hidden. The keys are tested against
// the real App, including while a turn is in flight, because "scroll during a
// turn" is the requirement that the composer's own `isActive:false` would
// silently defeat.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import React from 'react';
import { Box, render } from 'ink';
import chalk from 'chalk';

import { until } from '../test-support/until.js';

import { App } from '../src/ui/app.js';
import { Transcript } from '../src/ui/Transcript.js';
import {
    clampOffset,
    historyLabel,
    maxOffset,
    scrollBy,
    scrollWindow,
} from '../src/ui/scrollback.js';

chalk.level = 0;

const ansi = /\x1b\[[0-9;?]*[A-Za-z]/g;
const plain = (value) => value.replace(ansi, '');

// The terminal sequences a real terminal sends for these keys, written straight
// into stdin. Nothing in the shell is reached through a private API here.
const PAGE_UP = '\x1b[5~';
const PAGE_DOWN = '\x1b[6~';
const SHIFT_UP = '\x1b[1;2A';

// One shared copy — see test-support/until.js for why the deadline is not a
// constant in this file any more.

function fakeTty() {
    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    stdin.ref = () => {};
    stdin.unref = () => {};
    return stdin;
}

test('the scroll window is pure arithmetic with no room for a decorative count', () => {
    // A buffer that fits cannot scroll: there is nothing below to count.
    assert.equal(maxOffset(6, 10), 0);
    assert.equal(maxOffset(10, 10), 0);
    assert.equal(maxOffset(30, 10), 20);

    // The clamp is what stops a held PgUp from scrolling into blank space above
    // the oldest row.
    assert.equal(clampOffset(-5, 30, 10), 0);
    assert.equal(clampOffset(999, 30, 10), 20);
    assert.equal(scrollBy(18, 9, 30, 10), 20);
    assert.equal(scrollBy(2, -9, 30, 10), 0);

    // `below` is literally the offset once clamped — the indicator prints the
    // state, it does not derive a number that could disagree with it.
    const parked = scrollWindow({ total: 30, viewport: 10, offset: 7 });
    assert.deepEqual(parked, { start: 13, end: 23, below: 7, following: false, offset: 7 });
    assert.equal(parked.end - parked.start, 10);

    const tail = scrollWindow({ total: 30, viewport: 10, offset: 0 });
    assert.deepEqual(tail, { start: 20, end: 30, below: 0, following: true, offset: 0 });

    // An unmeasured viewport is reported as unknown, not guessed at: no window
    // has been laid out, so no claim is made about what is off screen.
    const unmeasured = scrollWindow({ total: 30, viewport: 0, offset: 7 });
    assert.equal(unmeasured.below, 0);
    assert.deepEqual([unmeasured.start, unmeasured.end], [0, 30]);

    // The label is absent while following and exact when not, singular included.
    assert.equal(historyLabel(tail), null);
    assert.equal(historyLabel(scrollWindow({ total: 30, viewport: 10, offset: 0 })), null);
    assert.match(historyLabel(parked), /^viewing history — 7 lines below/);
    assert.match(
        historyLabel(scrollWindow({ total: 11, viewport: 10, offset: 1 })),
        /^viewing history — 1 line below/
    );
});

test('the transcript window moves through real rendered rows and reports true counts', async () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
        id: `i${index}`, kind: 'notice', text: `row ${index}`,
    }));

    async function frameAt(offset) {
        const stdin = fakeTty();
        const stdout = new PassThrough();
        stdout.columns = 40;
        stdout.rows = 6;
        const writes = [];
        stdout.on('data', (chunk) => { writes.push(chunk.toString()); });

        let reported = null;
        const instance = render(
            React.createElement(
                Box,
                { width: 40, height: 6, flexDirection: 'column' },
                React.createElement(Transcript, {
                    items, offset, onWindow: (next) => { reported = next; },
                })
            ),
            { stdin, stdout, exitOnCtrlC: false, patchConsole: false, debug: true }
        );
        await until(() => reported !== null && reported.viewport > 0);
        const frame = plain(writes.filter((write) => write.includes('row')).at(-1) ?? '');
        instance.unmount();
        return {
            reported,
            rows: frame.split('\n').map((row) => row.trim()).filter(Boolean),
        };
    }

    const tail = await frameAt(0);
    // Twelve one-row items in a six-row viewport: the newest six, and nothing
    // claimed to be below them.
    assert.deepEqual(tail.rows, ['row 6', 'row 7', 'row 8', 'row 9', 'row 10', 'row 11']);
    assert.deepEqual(
        tail.reported,
        { total: 12, viewport: 6, below: 0, following: true }
    );

    // Two rows back: the same rendered rows, two earlier. The two that left the
    // bottom are exactly the two the report calls "below".
    const back2 = await frameAt(2);
    assert.deepEqual(back2.rows, ['row 4', 'row 5', 'row 6', 'row 7', 'row 8', 'row 9']);
    assert.equal(back2.reported.below, 2);
    assert.equal(back2.reported.following, false);

    // Past the top, the clamp holds the oldest row at the top of the viewport
    // and the count stays true rather than running on with the keypresses.
    const top = await frameAt(99);
    assert.deepEqual(top.rows, ['row 0', 'row 1', 'row 2', 'row 3', 'row 4', 'row 5']);
    assert.equal(top.reported.below, 6);
    assert.equal(top.reported.total - top.reported.viewport, 6);
});

test('the shell scrolls during a turn, counts honestly, and snaps back on submit', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-scrollback-test-'));
    const oldHome = process.env.HOME;
    process.env.HOME = home;

    // A turn that stays open until released, so the scroll keys are exercised
    // at exactly the moment the composer has stopped listening.
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let turns = 0;
    const usage = { input: 0, cachedInput: 0, output: 0, reasoning: 0, total: 0 };
    const session = {
        info: {
            engine: 'fake', model: 'fake-model', user: 'test-user',
            vaultPath: join(home, 'vault'), threadId: null, contextWindow: 100000,
        },
        usage,
        async *send() {
            turns += 1;
            yield { kind: 'turn-start' };
            if (turns === 1) await held;
            yield { kind: 'message', text: 'answer' };
            yield { kind: 'turn-end', usage };
        },
        interrupt() {},
        dispose() {},
    };

    const stdin = fakeTty();
    // A TTY stdout, unlike the other fixtures here: off a TTY, Ink buffers every
    // frame and flushes once at unmount, so a test that watches the shell react
    // to a keypress mid-turn would see nothing until it was over.
    const stdout = new PassThrough();
    stdout.isTTY = true;
    stdout.columns = 80;
    stdout.rows = 14;
    let captured = '';
    stdout.on('data', (chunk) => { captured += chunk.toString(); });

    // ...and `interactive: true` is what makes that TTY flag stick. Ink decides
    // as `!isInCi && isTTY`, with isInCi read from the environment at import, so
    // on a CI runner the flag above is overruled and the buffering this comment
    // warns about comes back — which is exactly how this test first failed the
    // day CI started running. The mode is stated rather than inferred.
    const instance = render(
        React.createElement(App, { session, sessionId: '20260728_010000_scroll' }),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false, interactive: true }
    );

    try {
        // A 14-row viewport: the launch card alone overflows it, so there is real
        // history to scroll before a single turn has run.
        await until(() => plain(captured).includes('Ask about company operations'));

        stdin.write('first question');
        await until(() => plain(captured).includes('first question'));
        stdin.write('\r');
        await until(() => plain(captured).includes('Ctrl+C to interrupt'));

        // The LAST count written, not the first: on a TTY Ink emits a frame per
        // render, so the accumulated capture holds the whole sequence and only
        // its tail describes the shell as it now stands.
        const countIn = (frame) => {
            const hits = [...plain(frame).matchAll(/viewing history — (\d+) lines? below/g)];
            return hits.length > 0 ? Number(hits[hits.length - 1][1]) : null;
        };

        // Mid-turn: the composer is deaf by design, and scrollback still works.
        // A single-row step moves the count by exactly one row, from nothing to
        // one, so the indicator's first appearance is already a true count.
        captured = '';
        stdin.write(SHIFT_UP);
        await until(() => countIn(captured) === 1);
        captured = '';
        stdin.write(SHIFT_UP);
        await until(() => countIn(captured) === 2);

        // Paging goes further back and then stops: a second page at the top of
        // the buffer must not keep incrementing a number nothing backs.
        captured = '';
        stdin.write(PAGE_UP);
        await until(() => countIn(captured) > 2);
        const atTop = countIn(captured);
        captured = '';
        stdin.write(PAGE_UP);
        stdin.write(SHIFT_UP);
        await until(() => countIn(captured) !== null);
        assert.equal(countIn(captured), atTop, 'the count must clamp at the top of the buffer');

        // Paging back down returns to the tail and the indicator disappears
        // rather than lingering at zero.
        captured = '';
        stdin.write(PAGE_DOWN);
        stdin.write(PAGE_DOWN);
        await until(() => {
            const frame = plain(captured);
            return frame.includes('Ctrl+C to interrupt') && !frame.includes('viewing history');
        });

        // The turn completes while parked in history. The reply lands below the
        // window, so the view must NOT jump to it — and the proof that it was
        // appended anyway is the count growing underneath the viewer, which is
        // the whole reason the count is measured rather than remembered.
        captured = '';
        stdin.write(SHIFT_UP);
        await until(() => countIn(captured) === 1);
        release();
        await until(() => countIn(captured) > 1);
        assert.ok(
            countIn(captured) > 1,
            'a reply arriving while parked must append to the buffer, not scroll the view'
        );

        // Submitting is the snap-back: the next question is at the tail, so the
        // indicator must be gone by the time the turn is in flight.
        // Separate writes, as elsewhere in the suite: text and Return in one
        // chunk arrive as a single keypress whose \r the composer strips.
        stdin.write('second question');
        await until(() => plain(captured).includes('second question'));
        stdin.write('\r');
        await until(() => turns === 2);
        // Cleared only once the second turn is under way, so what is examined is
        // the shell after the snap rather than the frames that led up to it.
        captured = '';
        await until(() => plain(captured).includes('❯'));
        assert.equal(countIn(captured), null, 'submitting must snap back to the live tail');
    } finally {
        release();
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }
});
