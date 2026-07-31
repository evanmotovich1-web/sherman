// The end-of-session evaluation: the request it builds, and the exit behavior
// that runs it.
//
// The failure modes that matter are not the happy path. An eval that runs on an
// empty session taxes every launch; an eval that re-runs after being
// interrupted traps the operator in a shell they asked to leave; an eval that
// writes would be grading a brain it is simultaneously editing. Each of those
// is pinned here.

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
import { evalRequest } from '../src/commands.js';

chalk.level = 0;

const zeroUsage = () => ({ input: 0, cachedInput: 0, output: 0, reasoning: 0, total: 0 });
const ansi = /\x1b\[[0-9;?]*[A-Za-z]/g;
const plain = (value) => value.replace(ansi, '');
const until = async (predicate, deadline = 3000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started >= deadline) throw new Error('timed out waiting for state');
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};

// ----------------------------------------------------------------- request --

test('the eval turn is read-only, sourced, and points at the log file', () => {
    const request = evalRequest('/home/x/.sherman/sessions/abc.jsonl');
    assert.equal(request.mode, 'read-only');
    assert.equal(request.source, 'eval');
    assert.match(request.text, /\/home\/x\/\.sherman\/sessions\/abc\.jsonl/);
    // The judge must not reconstruct the conversation from memory it does not
    // have, must follow both skills, and must not write.
    assert.match(request.text, /must not\s+reconstruct it from memory/);
    assert.match(request.text, /session-eval skill/);
    assert.match(request.text, /capability-gap skill/);
    assert.match(request.text, /READ-ONLY/);
    assert.match(request.text, /patient-identifying/);
});

test('conduct-only mode drops the capability-gap pass and nothing else', () => {
    const conduct = evalRequest('/tmp/log.jsonl', { gaps: false });
    assert.doesNotMatch(conduct.text, /capability-gap/);
    assert.match(conduct.text, /session-eval skill/);
});

test('no log path is no request, not a request about nothing', () => {
    assert.equal(evalRequest(''), null);
    assert.equal(evalRequest(null), null);
});

// -------------------------------------------------------------------- exit --

function harness() {
    const home = mkdtempSync(join(tmpdir(), 'sherman-eval-test-'));
    const requests = [];
    let disposed = 0;
    const session = {
        info: {
            engine: 'fake', model: 'fake-model', user: 'test-user',
            vaultPath: '/tmp/sherman/vault', threadId: null, contextWindow: 100000,
        },
        usage: zeroUsage(),
        async *send(request) {
            requests.push(request);
            yield { kind: 'turn-start' };
            yield { kind: 'message', text: 'a reply' };
            yield { kind: 'turn-end', usage: { ...zeroUsage(), input: 10, total: 10 } };
        },
        interrupt() {},
        dispose() { disposed += 1; },
    };

    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    stdin.ref = () => {};
    stdin.unref = () => {};
    const stdout = new PassThrough();
    stdout.columns = 100;
    stdout.rows = 30;
    let captured = '';
    stdout.on('data', (chunk) => { captured += chunk.toString(); });

    return {
        home, requests, session, stdin, stdout,
        disposed: () => disposed,
        captured: () => plain(captured),
    };
}

// A session that was launched and quit has no conduct to grade. Charging a real
// engine turn to say so would be a tax on opening the shell.
test('exiting an empty session runs no eval and just leaves', async () => {
    const h = harness();
    const oldHome = process.env.HOME;
    process.env.HOME = h.home;
    const instance = render(
        React.createElement(App, { session: h.session, sessionId: '20260728_010000_eval00' }),
        { stdin: h.stdin, stdout: h.stdout, exitOnCtrlC: false, patchConsole: false }
    );
    try {
        await new Promise((resolve) => setTimeout(resolve, 100));
        h.stdin.write('\x03');
        await until(() => h.disposed() > 0);
        assert.equal(h.requests.length, 0, 'an empty session sent an engine request on exit');
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(h.home, { recursive: true, force: true });
    }
});

// A session with a turn gets graded on the way out, by a read-only eval turn
// pointed at this session's own log, exactly once.
test('exiting a session with turns runs the eval once, then leaves', async () => {
    const h = harness();
    const oldHome = process.env.HOME;
    process.env.HOME = h.home;
    const instance = render(
        React.createElement(App, { session: h.session, sessionId: '20260728_010000_eval01' }),
        { stdin: h.stdin, stdout: h.stdout, exitOnCtrlC: false, patchConsole: false }
    );
    try {
        await new Promise((resolve) => setTimeout(resolve, 100));
        h.stdin.write('a question');
        await new Promise((resolve) => setTimeout(resolve, 30));
        h.stdin.write('\r');
        await until(() => h.requests.length === 1);
        await new Promise((resolve) => setTimeout(resolve, 100));

        h.stdin.write('\x03');
        await until(() => h.requests.length === 2);
        const evalReq = h.requests[1];
        assert.equal(evalReq.source, 'eval');
        assert.equal(evalReq.mode, 'read-only');
        assert.match(evalReq.text, /20260728_010000_eval01\.jsonl/);

        await until(() => h.disposed() > 0);
        assert.equal(h.requests.length, 2, 'the eval ran more than once');
        assert.match(h.captured(), /evaluating this session before exit/);
        assert.match(h.captured(), /ctrl\+c to skip/, 'the escape hatch was not announced');
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(h.home, { recursive: true, force: true });
    }
});

// /eval marks the session as graded: quitting afterwards must not grade it a
// second time. One session, one judgment.
test('a manual /eval satisfies the exit eval', async () => {
    const h = harness();
    const oldHome = process.env.HOME;
    process.env.HOME = h.home;
    const instance = render(
        React.createElement(App, { session: h.session, sessionId: '20260728_010000_eval02' }),
        { stdin: h.stdin, stdout: h.stdout, exitOnCtrlC: false, patchConsole: false }
    );
    try {
        await new Promise((resolve) => setTimeout(resolve, 100));
        h.stdin.write('a question');
        await new Promise((resolve) => setTimeout(resolve, 30));
        h.stdin.write('\r');
        await until(() => h.requests.length === 1);
        await new Promise((resolve) => setTimeout(resolve, 80));

        h.stdin.write('/eval');
        await new Promise((resolve) => setTimeout(resolve, 30));
        h.stdin.write('\r');
        await until(() => h.requests.length === 2);
        assert.equal(h.requests[1].source, 'eval');
        await new Promise((resolve) => setTimeout(resolve, 100));

        h.stdin.write('\x03');
        await until(() => h.disposed() > 0);
        assert.equal(h.requests.length, 2, 'exit re-ran an eval the operator already ran');
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(h.home, { recursive: true, force: true });
    }
});

// -------------------------------------------------------- checkpoint loop --
//
// The background eval must be a judge, not an interruption: it runs on an
// isolated worker session, only when turns happened since the last grading,
// and never for a session that has done nothing. The interval is injectable
// (evalEveryMs) so these tests measure behavior, not ten minutes.

function checkpointHarness() {
    const h = harness();
    const workerRequests = [];
    const workers = [];
    h.workerRequests = workerRequests;
    h.workers = workers;
    h.sessionFactory = () => {
        let disposed = 0;
        const worker = {
            info: { ...h.session.info, model: 'worker-model' },
            usage: zeroUsage(),
            async *send(request) {
                workerRequests.push(request);
                yield { kind: 'turn-start' };
                yield { kind: 'message', text: 'CHECKPOINT VERDICT: on track.' };
                yield { kind: 'turn-end', usage: zeroUsage() };
            },
            interrupt() {},
            dispose() { disposed += 1; },
            disposed: () => disposed,
        };
        workers.push(worker);
        return worker;
    };
    return h;
}

test('the checkpoint eval grades new turns on a worker, once, in the background', async () => {
    const h = checkpointHarness();
    const oldHome = process.env.HOME;
    process.env.HOME = h.home;

    const instance = render(
        React.createElement(App, {
            session: h.session, sessionId: '20260729_040000_ckpt01',
            sessionFactory: h.sessionFactory, evalEveryMs: 120,
        }),
        { stdin: h.stdin, stdout: h.stdout, exitOnCtrlC: false, patchConsole: false }
    );

    try {
        await new Promise((resolve) => setTimeout(resolve, 60));
        h.stdin.write('real work');
        await new Promise((resolve) => setTimeout(resolve, 25));
        h.stdin.write('\r');
        await until(() => h.requests.length === 1);

        // Two full intervals with no further turns: exactly one checkpoint —
        // an idle session is never re-graded.
        await until(() => h.workerRequests.length === 1);
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(h.workerRequests.length, 1, 'an idle session was re-graded');

        // The judge is a worker with the eval request, and the main thread
        // spent nothing on it.
        assert.equal(h.workerRequests[0].source, 'eval');
        assert.equal(h.workerRequests[0].mode, 'read-only');
        assert.equal(h.requests.length, 1, 'the checkpoint ran on the main session');
        assert.equal(h.workers.length, 1);
        assert.equal(h.workers[0].disposed(), 1, 'the checkpoint worker was not disposed');

        // A new turn re-arms the loop.
        h.stdin.write('more work');
        await new Promise((resolve) => setTimeout(resolve, 25));
        h.stdin.write('\r');
        await until(() => h.requests.length === 2);
        await until(() => h.workerRequests.length === 2);

        instance.unmount();
        assert.match(h.captured(), /checkpoint eval · background/);
        assert.match(h.captured(), /CHECKPOINT VERDICT/);
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(h.home, { recursive: true, force: true });
    }
});

test('an untouched session is never checkpoint-graded', async () => {
    const h = checkpointHarness();
    const oldHome = process.env.HOME;
    process.env.HOME = h.home;

    const instance = render(
        React.createElement(App, {
            session: h.session, sessionId: '20260729_050000_ckpt02',
            sessionFactory: h.sessionFactory, evalEveryMs: 60,
        }),
        { stdin: h.stdin, stdout: h.stdout, exitOnCtrlC: false, patchConsole: false }
    );

    try {
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(h.workerRequests.length, 0, 'a session with no turns was graded');
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(h.home, { recursive: true, force: true });
    }
});

// Verdicts must outlive the session: one Markdown file per session under
// ~/.sherman/evals/, appended per verdict, silent on failure like the log.
test('eval reports persist per session and fail silently without a home', async () => {
    const { appendEvalReport, evalsDir } = await import('../src/evalstore.js');
    const { readFileSync } = await import('node:fs');

    const home = mkdtempSync(join(tmpdir(), 'sherman-evalstore-'));
    try {
        assert.equal(appendEvalReport('20260731_100000_ab12', 'exit eval', 'Verdict one.', { home }), true);
        assert.equal(appendEvalReport('20260731_100000_ab12', 'checkpoint eval', 'Verdict two.', { home }), true);
        const written = readFileSync(join(evalsDir(home), '20260731_100000_ab12.md'), 'utf8');
        assert.match(written, /## exit eval/);
        assert.match(written, /Verdict one\./);
        assert.match(written, /## checkpoint eval/);
        assert.match(written, /Verdict two\./);

        // Nothing to say, nothing written, no crash.
        assert.equal(appendEvalReport('', 'exit eval', 'x', { home }), false);
        assert.equal(appendEvalReport('id', 'exit eval', '   ', { home }), false);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});
