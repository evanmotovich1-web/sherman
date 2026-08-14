// Compaction: the pure decision, the envelopes, and the shell behavior that
// depends on both. The App case is the one that matters -- the threshold and
// the reset are only correct together, and only when the summary actually
// reaches the thread that replaced the one it summarized.

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
import {
    AUTO_COMPACT_RATIO,
    carryOverEnvelope,
    commandFor,
    compactRequest,
    shouldAutoCompact,
    suggestionsFor,
} from '../src/commands.js';
import { EngineSession } from '../src/engine/session.js';

chalk.level = 0;

const zeroUsage = () => ({ input: 0, cachedInput: 0, output: 0, reasoning: 0, total: 0 });
const ansi = /\x1b\[[0-9;?]*[A-Za-z]/g;
const plain = (value) => value.replace(ansi, '');
// One shared copy — see test-support/until.js. This file had already drifted to a
// different number than the other three, which is the whole argument for it.

test('the auto-compact threshold is 90% and never fires on a guess', () => {
    assert.equal(AUTO_COMPACT_RATIO, 0.9);

    assert.equal(shouldAutoCompact(90_000, 100_000), true);
    assert.equal(shouldAutoCompact(200_000, 100_000), true);
    assert.equal(shouldAutoCompact(89_999, 100_000), false);

    // An unknown window is the reason the status meter hides itself. The same
    // unknown must not be turned into a compaction decision.
    assert.equal(shouldAutoCompact(90_000, null), false);
    assert.equal(shouldAutoCompact(90_000, 0), false);
    assert.equal(shouldAutoCompact(null, 100_000), false);
    assert.equal(shouldAutoCompact(undefined, undefined), false);
});

test('/compact is a listed command and completes from its prefix', () => {
    assert.ok(commandFor('compact'));
    assert.deepEqual(
        suggestionsFor('/comp').map((command) => command.name),
        ['compact']
    );
});

test('the compaction turn is read-only and forbids carrying PHI forward', () => {
    const request = compactRequest('the vault migration', 'ship phase 5');

    assert.equal(request.mode, 'read-only');
    assert.equal(request.source, 'compact');
    assert.match(request.text, /the vault migration/);
    assert.match(request.text, /ship phase 5/);
    assert.match(request.text, /patient-identifying information/);
});

test('the handoff envelope wraps the next request, and is a no-op without one', () => {
    const seeded = carryOverEnvelope('prior summary', 'what next?');
    assert.match(seeded, /SHERMAN SESSION HANDOFF/);
    assert.match(seeded, /prior summary/);
    assert.match(seeded, /USER REQUEST\nwhat next\?/);

    assert.equal(carryOverEnvelope('', 'what next?'), 'what next?');
});

test('a backend with no threads reports that it did not start one', () => {
    class Bare extends EngineSession {}
    assert.equal(new Bare().startNewThread(), false);
});

test('App auto-compacts at 90% and seeds the fresh thread with the summary', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-compact-test-'));
    const oldHome = process.env.HOME;
    process.env.HOME = home;

    const requests = [];
    let threadStarts = 0;
    // A measured 95k of a 100k window on the first turn: over the line, so the
    // shell should compact without being asked. Compaction listens to the
    // engine's measured 'context' events, never to turn-end usage.
    const measurements = [95_000, 4_000];
    const session = {
        info: {
            engine: 'fake', model: 'fake-model', user: 'test-user',
            vaultPath: '/tmp/sherman-compact-test/vault', threadId: null,
            contextWindow: 100_000,
        },
        usage: zeroUsage(),
        async *send(request) {
            requests.push(request);
            const used = measurements.shift() ?? 0;
            yield { kind: 'turn-start' };
            yield {
                kind: 'message',
                text: request?.source === 'compact' ? 'HANDOFF: vault work, step 4 next.' : 'answer',
            };
            yield { kind: 'context', used, window: 100_000 };
            yield { kind: 'turn-end', usage: { ...zeroUsage(), input: used } };
        },
        startNewThread() { threadStarts += 1; return true; },
        interrupt() {},
        dispose() {},
    };

    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    stdin.ref = () => {};
    stdin.unref = () => {};

    const stdout = new PassThrough();
    stdout.columns = 80;
    stdout.rows = 30;
    let captured = '';
    stdout.on('data', (chunk) => { captured += chunk.toString(); });

    const instance = render(
        React.createElement(App, { session, sessionId: '20260728_120000_abc123' }),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false }
    );

    try {
        // Typed on a timer, like the other App tests: a write dispatched in the
        // same tick as the render lands before the composer is listening.
        await new Promise((resolve) => setTimeout(resolve, 60));
        stdin.write('first question');
        await new Promise((resolve) => setTimeout(resolve, 25));
        stdin.write('\r');

        // Turn 1, then the compaction turn the shell started by itself.
        await until(() => requests.length === 2);
        assert.equal(requests[1].source, 'compact');
        assert.equal(threadStarts, 1);

        stdin.write('follow up');
        await new Promise((resolve) => setTimeout(resolve, 25));
        stdin.write('\r');
        await until(() => requests.length === 3);

        // The point of the whole feature: the turn after the reset still knows
        // what the discarded thread knew.
        assert.match(requests[2], /SHERMAN SESSION HANDOFF/);
        assert.match(requests[2], /HANDOFF: vault work, step 4 next\./);
        assert.match(requests[2], /USER REQUEST\nfollow up/);

        // And it is spent exactly once.
        stdin.write('third');
        await new Promise((resolve) => setTimeout(resolve, 25));
        stdin.write('\r');
        await until(() => requests.length === 4);
        assert.doesNotMatch(requests[3], /SHERMAN SESSION HANDOFF/);

        // Off a TTY Ink emits its frame on unmount, so the visible notice can
        // only be inspected after the app is torn down.
        instance.unmount();
        assert.match(plain(captured), /compacting automatically/);
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
    }
});

// Compaction never sees the estimate.
//
// The estimate exists to move the meter, and the danger it introduces is that
// something ACTS on a moved meter. Compaction discards real conversation, so it
// is gated on the engine's own reported figure alone. Here the engine streams
// 8000 characters — roughly 2000 estimated tokens against a 1000-token window,
// so 200% — and then reports a real usage of 10%. If compaction could read the
// estimate this turn would compact twice over. It must not compact at all.
//
// The meter's RENDERING is asserted in contextestimate.test.js instead: off a
// TTY Ink only emits a frame on unmount, so a mid-turn meter cannot be observed
// from here, and a test that pretended to observe it would be checking nothing.
test('compaction fires on the measured figure alone, never on the estimate', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-shell-estimate-'));
    const oldHome = process.env.HOME;
    process.env.HOME = home;

    const threads = [];
    const sent = [];
    let turnEnded = false;
    const flood = 'x'.repeat(8000);

    const session = {
        info: {
            engine: 'fake', model: 'fake-model', user: 'test-user',
            vaultPath: '/tmp/sherman/vault', threadId: 't1', contextWindow: 1000,
        },
        usage: zeroUsage(),
        async *send(request) {
            sent.push(request);
            yield { kind: 'turn-start' };
            yield { kind: 'message', text: flood };
            yield { kind: 'turn-end', usage: { ...zeroUsage(), input: 100, total: 110 } };
            turnEnded = true;
        },
        startNewThread() { threads.push('new'); return true; },
        interrupt() {},
        dispose() {},
    };

    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    stdin.ref = () => {};
    stdin.unref = () => {};

    const stdout = new PassThrough();
    stdout.columns = 120;
    stdout.rows = 24;
    let captured = '';
    stdout.on('data', (chunk) => { captured += chunk.toString(); });

    const instance = render(
        React.createElement(App, { session, sessionId: '20260728_010000_estimate' }),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false }
    );

    try {
        await new Promise((resolve) => setTimeout(resolve, 100));
        stdin.write('a question');
        await new Promise((resolve) => setTimeout(resolve, 30));
        stdin.write('\r');

        await until(() => turnEnded);
        // Settle time for any compaction the shell might have decided to start.
        await new Promise((resolve) => setTimeout(resolve, 150));

        assert.equal(sent.length, 1, 'a second engine turn ran; compaction fired on an estimate');
        assert.deepEqual(threads, [], 'a fresh thread was started on an estimated figure');

        instance.unmount();
        assert.doesNotMatch(
            plain(captured),
            /compacting automatically/,
            'auto-compaction announced on an estimate'
        );
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }
});

// Compaction never sees the bill.
//
// Codex's turn.completed input_tokens is the SUM across every sub-request of
// an agentic turn — a healthy ~20k thread reports 100k+ after a few tool
// calls. The 576%-context incident: one long turn billed 1.57M tokens against
// a 272k window and the shell compacted a thread that codex itself had kept
// well inside its window. Usage is accounting; only a measured 'context'
// event may arm compaction. An engine that emits none must never compact.
test('compaction ignores turn-end usage, however far past the window it runs', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-compact-bill-'));
    const oldHome = process.env.HOME;
    process.env.HOME = home;

    const threads = [];
    const sent = [];
    let turnEnded = false;

    const session = {
        info: {
            engine: 'fake', model: 'fake-model', user: 'test-user',
            vaultPath: '/tmp/sherman/vault', threadId: 't1', contextWindow: 272_000,
        },
        usage: zeroUsage(),
        async *send(request) {
            sent.push(request);
            yield { kind: 'turn-start' };
            yield { kind: 'message', text: 'a marathon turn' };
            // 576% of the window, with no context event: the bill, not the thread.
            yield { kind: 'turn-end', usage: { ...zeroUsage(), input: 1_566_800, total: 1_566_900 } };
            turnEnded = true;
        },
        startNewThread() { threads.push('new'); return true; },
        interrupt() {},
        dispose() {},
    };

    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    stdin.ref = () => {};
    stdin.unref = () => {};

    const stdout = new PassThrough();
    stdout.columns = 120;
    stdout.rows = 24;
    let captured = '';
    stdout.on('data', (chunk) => { captured += chunk.toString(); });

    const instance = render(
        React.createElement(App, { session, sessionId: '20260728_020000_bill' }),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false }
    );

    try {
        await new Promise((resolve) => setTimeout(resolve, 100));
        stdin.write('a question');
        await new Promise((resolve) => setTimeout(resolve, 30));
        stdin.write('\r');

        await until(() => turnEnded);
        await new Promise((resolve) => setTimeout(resolve, 150));

        assert.equal(sent.length, 1, 'a second engine turn ran; compaction fired on the bill');
        assert.deepEqual(threads, [], 'a fresh thread was started on cumulative usage');

        instance.unmount();
        assert.doesNotMatch(plain(captured), /compacting automatically/);
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }
});
