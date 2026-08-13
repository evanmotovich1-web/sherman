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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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

test('the closed framing judges a past session, with the same contract', () => {
    const request = evalRequest('/tmp/dead.jsonl', { closed: true });
    // The judge is not inside the session it grades and must not be told it is.
    assert.match(request.text, /POST-SESSION EVALUATION TURN/);
    assert.match(request.text, /ended without being graded/);
    assert.doesNotMatch(request.text, /This session is ending/);
    // Everything else is the same turn: evidence, skills, read-only, PHI.
    assert.match(request.text, /session-eval skill/);
    assert.match(request.text, /READ-ONLY/);
    assert.match(request.text, /patient-identifying/);
    assert.equal(request.mode, 'read-only');
});

// -------------------------------------------------------------------- exit --

function harness() {
    const home = mkdtempSync(join(tmpdir(), 'sherman-eval-test-'));
    const vaultPath = join(home, 'vault');
    mkdirSync(join(vaultPath, 'memory', 'shared'), { recursive: true });
    mkdirSync(join(vaultPath, 'wiki'));
    const requests = [];
    let disposed = 0;
    const makeSession = (worker = false) => ({
        info: {
            engine: 'fake', model: 'fake-model', user: 'test-user',
            vaultPath, threadId: null, contextWindow: 100000,
        },
        usage: zeroUsage(),
        async *send(request) {
            requests.push(request);
            yield { kind: 'turn-start' };
            yield { kind: 'message', text: 'a reply' };
            yield { kind: 'turn-end', usage: { ...zeroUsage(), input: 10, total: 10 } };
        },
        interrupt() {},
        dispose() { if (!worker) disposed += 1; },
    });
    const session = makeSession();
    const sessionFactory = () => makeSession(true);

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
        home, requests, session, sessionFactory, stdin, stdout,
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
        React.createElement(App, { session: h.session, sessionFactory: h.sessionFactory, sessionId: '20260728_010000_eval00' }),
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
        React.createElement(App, { session: h.session, sessionFactory: h.sessionFactory, sessionId: '20260728_010000_eval01', exitGlitchMs: 0 }),
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
        await until(() => h.requests.length >= 2);
        const evalReq = h.requests.find((request) => request?.source === 'eval');
        assert.equal(evalReq.source, 'eval');
        assert.equal(evalReq.mode, 'read-only');
        assert.match(evalReq.text, /20260728_010000_eval01\.jsonl/);

        await until(() => h.disposed() > 0);
        assert.equal(
            h.requests.filter((request) => request?.source === 'eval').length,
            1,
            'the eval ran more than once'
        );
        // Silent by design (2026-08-12): the exit eval announces itself with
        // the glitching rail, never with text.
        assert.doesNotMatch(h.captured(), /evaluating this session/, 'the exit eval announced itself in text');
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
        React.createElement(App, { session: h.session, sessionFactory: h.sessionFactory, sessionId: '20260728_010000_eval02' }),
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
        await until(() => h.requests.some((request) => request?.source === 'eval'));
        assert.equal(h.requests.find((request) => request?.source === 'eval').source, 'eval');
        await new Promise((resolve) => setTimeout(resolve, 100));

        h.stdin.write('\x03');
        await until(() => h.disposed() > 0);
        assert.equal(
            h.requests.filter((request) => request?.source === 'eval').length,
            1,
            'exit re-ran an eval the operator already ran'
        );
        assert.equal(h.requests.some((request) => ['learn', 'wiki'].includes(request?.source)), false,
            'explicit retention ran automatically at exit');
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

function checkpointHarness(verdict = 'CHECKPOINT VERDICT: on track.') {
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
                yield {
                    kind: 'message',
                    text: ['learn', 'wiki'].includes(request?.source)
                        ? '{"operations":[]}'
                        : verdict,
                };
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

// Background judges file what they propose now. The proposals lived in
// checkpoint and catch-up verdicts — paths that never reached the retention
// gate — so the vault sat at six files after seventy-five sessions. Filing
// goes through the same shell-validated writer as a hand-typed /learn, and
// only the judge's own verdict is parsed (the meta-judge quotes proposals,
// and quotes must not file).
test('a checkpoint verdict proposing a fact files it through the validator', async () => {
    const h = checkpointHarness(
        'CHECKPOINT VERDICT: drift found.\n\n/learn checkpoint-filed-fact | Background judges file what they propose.'
    );
    const oldHome = process.env.HOME;
    process.env.HOME = h.home;
    const instance = render(
        React.createElement(App, {
            session: h.session, sessionFactory: h.sessionFactory, sessionId: '20260812_200000_ckpt04',
            evalEveryMs: 120,
        }),
        { stdin: h.stdin, stdout: h.stdout, exitOnCtrlC: false, patchConsole: false }
    );
    try {
        await new Promise((resolve) => setTimeout(resolve, 60));
        h.stdin.write('real work');
        await new Promise((resolve) => setTimeout(resolve, 25));
        h.stdin.write('\r');
        await until(() => h.requests.length === 1);
        const file = join(h.home, 'vault', 'memory', 'shared', 'checkpoint-filed-fact.md');
        await until(() => existsSync(file));
        assert.equal(readFileSync(file, 'utf8'), 'Background judges file what they propose.\n');
        // Silent by contract: the filing never reaches the operator terminal.
        assert.doesNotMatch(h.captured(), /checkpoint-filed-fact/);
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(h.home, { recursive: true, force: true });
    }
});

test('the checkpoint eval grades new turns on a worker, once, in the background', async () => {
    const h = checkpointHarness();
    const oldHome = process.env.HOME;
    process.env.HOME = h.home;

    const instance = render(
        React.createElement(App, {
            session: h.session, sessionFactory: h.sessionFactory, sessionId: '20260729_040000_ckpt01',
            evalEveryMs: 120,
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
        // an idle session is never re-graded. Every checkpoint is a PAIR of
        // worker turns now: the judge, then the meta-judge grading its verdict.
        await until(() => h.workerRequests.length === 2);
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(h.workerRequests.length, 2, 'an idle session was re-graded');

        // The judge is a worker with the eval request, the meta-judge follows
        // with the verdict under review, and the main thread spent nothing.
        assert.equal(h.workerRequests[0].source, 'eval');
        assert.equal(h.workerRequests[0].mode, 'read-only');
        assert.equal(h.workerRequests[1].source, 'meta-eval');
        assert.equal(h.workerRequests[1].mode, 'read-only');
        assert.match(h.workerRequests[1].text, /CHECKPOINT VERDICT: on track\./);
        assert.equal(h.requests.length, 1, 'the checkpoint ran on the main session');
        assert.equal(h.workers.length, 2);
        assert.equal(h.workers[0].disposed(), 1, 'the checkpoint worker was not disposed');
        assert.equal(h.workers[1].disposed(), 1, 'the meta worker was not disposed');

        // A new turn re-arms the loop — another judge/meta-judge pair.
        h.stdin.write('more work');
        await new Promise((resolve) => setTimeout(resolve, 25));
        h.stdin.write('\r');
        await until(() => h.requests.length === 2);
        await until(() => h.workerRequests.length === 4);

        instance.unmount();
        // The eval loop runs and FILES, but never speaks in the transcript:
        // the operator's terminal stays about the work, not the grading of it.
        // None of the loop's chatter — the background notice, the verdict
        // panel, the meta-eval line — reaches the captured frames.
        assert.doesNotMatch(h.captured(), /checkpoint eval · background/);
        assert.doesNotMatch(h.captured(), /CHECKPOINT VERDICT/);
        assert.doesNotMatch(h.captured(), /meta eval/);
        // The verdict still outlived the turn where it belongs: the per-session
        // eval report under ~/.sherman/evals/, which /win reads.
        const { readFileSync } = await import('node:fs');
        const { evalsDir } = await import('../src/evalstore.js');
        const filed = readFileSync(join(evalsDir(h.home), '20260729_040000_ckpt01.md'), 'utf8');
        assert.match(filed, /## checkpoint eval/);
        assert.match(filed, /CHECKPOINT VERDICT: on track\./);
        assert.match(filed, /## meta eval/);
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(h.home, { recursive: true, force: true });
    }
});

// The gate is turn DEBT, not "an eval ever ran": a checkpoint ten minutes in
// must not silence the exit eval for the turns worked after it.
test('working past a checkpoint still gets the exit eval for the tail', async () => {
    const h = checkpointHarness();
    const oldHome = process.env.HOME;
    process.env.HOME = h.home;

    const instance = render(
        React.createElement(App, {
            session: h.session, sessionFactory: h.sessionFactory, sessionId: '20260731_060000_ckpt03',
            evalEveryMs: 120, exitGlitchMs: 0,
        }),
        { stdin: h.stdin, stdout: h.stdout, exitOnCtrlC: false, patchConsole: false }
    );

    try {
        h.stdin.write('real work');
        await new Promise((resolve) => setTimeout(resolve, 25));
        h.stdin.write('\r');
        await until(() => h.requests.length === 1);
        await until(() => h.workerRequests.length >= 1);

        // New turns after the checkpoint: the tail the old flag left unjudged.
        h.stdin.write('more work');
        await new Promise((resolve) => setTimeout(resolve, 25));
        h.stdin.write('\r');
        await until(() => h.requests.length === 2);
        await new Promise((resolve) => setTimeout(resolve, 60));

        h.stdin.write('\x03');
        await until(() => h.disposed() > 0);
        // The invariant is that the tail gets judged, whoever judges it: the
        // exit eval normally, or a second checkpoint if one beat ctrl+c to
        // it. What must never happen — and did, under the old "an eval ever
        // ran" flag — is the session ending with the post-checkpoint turns
        // unjudged by anyone.
        // Meta turns don't count as judging the tail — only a second EVAL does.
        const tailJudged =
            h.requests.some((r) => r?.source === 'eval')
            || h.workerRequests.filter((r) => r?.source === 'eval').length >= 2;
        assert.ok(tailJudged, 'the session ended with turns no eval ever graded');
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
            session: h.session, sessionFactory: h.sessionFactory, sessionId: '20260729_050000_ckpt02',
            evalEveryMs: 60,
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

// --------------------------------------------------------- explicit retention --

test('manual wiki writes only the explicit shell-validated fact and redacts its command payload', async () => {
    const h = harness();
    const oldHome = process.env.HOME;
    process.env.HOME = h.home;
    const instance = render(
        React.createElement(App, {
            session: h.session, sessionFactory: h.sessionFactory,
            sessionId: '20260810_121000_wiki05', wiki: true,
        }),
        { stdin: h.stdin, stdout: h.stdout, exitOnCtrlC: false, patchConsole: false }
    );
    try {
        await new Promise((resolve) => setTimeout(resolve, 100));
        h.stdin.write('/wiki approved-company-format | The approved format is versioned.');
        await new Promise((resolve) => setTimeout(resolve, 30));
        h.stdin.write('\r');
        const file = join(h.home, 'vault', 'wiki', 'approved-company-format.md');
        await until(() => {
            try { return readFileSync(file, 'utf8').includes('versioned'); } catch { return false; }
        });
        assert.equal(
            readFileSync(file, 'utf8'),
            'The approved format is versioned.\n'
        );
        assert.equal(h.requests.length, 0, 'retention must not invoke a model');
        assert.doesNotMatch(h.captured(), /approved format is versioned/);
        const logPath = join(h.home, '.sherman', 'sessions', '20260810_121000_wiki05.jsonl');
        assert.doesNotMatch(readFileSync(logPath, 'utf8'), /approved format is versioned/);
        assert.match(readFileSync(logPath, 'utf8'), /fact text redacted/);
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(h.home, { recursive: true, force: true });
    }
});

// Exit retention files eval proposals automatically now (operator's
// instruction, 2026-08-12) — but those writes are LOCAL, through the same
// shell validation as a hand-typed /wiki. What this test pins is the part
// that must never change: no retention path invokes a model. The engine
// request list stays eval + meta-eval, nothing else.
test('exit runs read-only eval and no retention path ever invokes a model', async () => {
    const h = harness();
    const oldHome = process.env.HOME;
    process.env.HOME = h.home;
    const instance = render(
        React.createElement(App, {
            session: h.session, sessionFactory: h.sessionFactory, sessionId: '20260731_090000_wiki01', wiki: true,
            exitGlitchMs: 0,
        }),
        { stdin: h.stdin, stdout: h.stdout, exitOnCtrlC: false, patchConsole: false }
    );
    try {
        await new Promise((resolve) => setTimeout(resolve, 100));
        h.stdin.write('a question');
        await new Promise((resolve) => setTimeout(resolve, 30));
        h.stdin.write('\r');
        await until(() => h.requests.length === 1);
        await new Promise((resolve) => setTimeout(resolve, 80));

        h.stdin.write('\x03');
        await until(() => h.disposed() > 0);
        // The engine requests are the contract; the exit sequence outruns the
        // off-TTY painter, so screen text past the eval notice is not
        // asserted here.
        const sources = h.requests.map((r) => r?.source);
        assert.deepEqual(
            sources.slice(1),
            ['eval', 'meta-eval'],
            'exit must judge without automatically writing authoritative memory'
        );
    } finally {
        instance.unmount();
        process.env.HOME = oldHome;
        rmSync(h.home, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------- catch-up loop --
//
// The loop's promise is a verdict for EVERY session, and the sessions that
// break it are the ones that never got to say goodbye: a closed window, a
// kill. Their logs survive; the catch-up eval grades the newest one on an
// isolated worker after launch — skipping live logs (recent mtime), skipping
// launch-and-quit logs (no sherman turn), and filing the verdict under the
// session it judged, not the session that ran the judge.
test('a launch catches up the newest dead ungraded session, and only that one', async () => {
    const { evalsDir } = await import('../src/evalstore.js');
    const { mkdirSync, writeFileSync, utimesSync, readFileSync, existsSync } = await import('node:fs');

    const h = harness();
    const workerRequests = [];
    // A worker that replies in two parts: the persisted verdict must carry
    // both, not just the last one.
    h.sessionFactory = () => ({
        info: { ...h.session.info, model: 'worker-model' },
        usage: zeroUsage(),
        async *send(request) {
            workerRequests.push(request);
            yield { kind: 'turn-start' };
            yield { kind: 'message', text: 'CATCH-UP VERDICT part one.' };
            yield { kind: 'message', text: 'And part two.' };
            yield { kind: 'turn-end', usage: zeroUsage() };
        },
        interrupt() {},
        dispose() {},
    });

    const oldHome = process.env.HOME;
    process.env.HOME = h.home;
    const sessions = join(h.home, '.sherman', 'sessions');
    mkdirSync(sessions, { recursive: true });
    const line = (role) => JSON.stringify({ role, at: '2026-07-30T10:00:00.000Z', text: 'x' }) + '\n';
    const old = (name, content) => {
        const file = join(sessions, name);
        writeFileSync(file, content);
        // Backdated an hour: old enough to be over, not a live parallel shell.
        const past = (Date.now() - 60 * 60_000) / 1000;
        utimesSync(file, past, past);
    };
    old('20260730_010000_dead01.jsonl', line('user') + line('sherman'));
    old('20260730_020000_dead02.jsonl', line('user') + line('sherman'));
    old('20260730_030000_quit03.jsonl', line('user'));
    // A live parallel shell: same shape, but its mtime is now.
    writeFileSync(join(sessions, '20260731_070000_live04.jsonl'), line('user') + line('sherman'));

    const instance = render(
        React.createElement(App, {
            session: h.session, sessionFactory: h.sessionFactory, sessionId: '20260731_080000_catch05',
            evalEveryMs: 0, catchUpDelayMs: 40,
        }),
        { stdin: h.stdin, stdout: h.stdout, exitOnCtrlC: false, patchConsole: false }
    );

    try {
        await until(() => workerRequests.length >= 1);
        // The newest DEAD session with sherman turns — not the live shell,
        // not the launch-and-quit, not the older backlog.
        assert.match(workerRequests[0].text, /20260730_020000_dead02\.jsonl/);
        assert.match(workerRequests[0].text, /POST-SESSION EVALUATION TURN/);
        assert.equal(workerRequests[0].mode, 'read-only');

        // The verdict files under the session it JUDGED, with both parts.
        await until(() => existsSync(join(evalsDir(h.home), '20260730_020000_dead02.md')));
        const written = readFileSync(join(evalsDir(h.home), '20260730_020000_dead02.md'), 'utf8');
        assert.match(written, /## catch-up eval/);
        assert.match(written, /part one\./);
        assert.match(written, /And part two\./);

        // One per launch: the older dead session waits for the next shell.
        // (The catch-up's own meta turn rides the same launch; only EVAL
        // requests count as grading a session.)
        await new Promise((resolve) => setTimeout(resolve, 150));
        assert.equal(
            workerRequests.filter((r) => r?.source === 'eval').length, 1,
            'catch-up graded more than one session in a launch'
        );
        assert.equal(existsSync(join(evalsDir(h.home), '20260730_010000_dead01.md')), false);
        assert.equal(existsSync(join(evalsDir(h.home), '20260731_070000_live04.md')), false);
        assert.equal(existsSync(join(evalsDir(h.home), '20260730_030000_quit03.md')), false);
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

// ---------------------------------------------------------------- meta-eval --

test('the meta-eval turn is read-only, sourced, and carries the verdict inline', async () => {
    const { metaEvalRequest } = await import('../src/commands.js');
    const request = metaEvalRequest('1. held — turn 3 cited the vault.', '/home/x/.sherman/sessions/abc.jsonl');
    assert.equal(request.mode, 'read-only');
    assert.equal(request.source, 'meta-eval');
    // The verdict under review is inlined, so the judge cannot be graded on a
    // report it could quietly rewrite; the log is offered for spot-checks only.
    assert.match(request.text, /grade the eval, not the session/);
    assert.match(request.text, /held — turn 3 cited the vault/);
    assert.match(request.text, /\/home\/x\/\.sherman\/sessions\/abc\.jsonl/);
    assert.match(request.text, /spot-check/);
    assert.match(request.text, /meta-eval skill/);
    assert.match(request.text, /GRADE: one of A, B, C, D, F/);
    assert.match(request.text, /READ-ONLY/);
    assert.match(request.text, /patient-identifying/);
});

test('no verdict is no meta turn, and a missing log path is tolerated', async () => {
    const { metaEvalRequest } = await import('../src/commands.js');
    assert.equal(metaEvalRequest(''), null);
    assert.equal(metaEvalRequest('   '), null);
    assert.equal(metaEvalRequest(null), null);
    const request = metaEvalRequest('A verdict.');
    assert.notEqual(request, null);
    assert.doesNotMatch(request.text, /session log the eval graded is at/);
});

// Eval output may remain in the local operational eval store, but model- and
// session-derived bytes must never be copied into the synchronized Vault.
test('eval store exposes no path that files model output into the vault', async () => {
    const evalstore = await import('../src/evalstore.js');
    const appSource = readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8');
    const skillSource = readFileSync(new URL('../../skills/meta-eval/SKILL.md', import.meta.url), 'utf8');
    assert.equal(evalstore.writeRecommendation, undefined);
    assert.doesNotMatch(appSource, /writeRecommendation|eval-recommendations/);
    assert.doesNotMatch(skillSource, /vault\/inbox|eval-recommendations/);
    assert.match(skillSource, /never enters a synchronized Vault/);
    const legacyLane = new URL('../../vault/inbox/eval-recommendations', import.meta.url);
    assert.deepEqual(
        existsSync(legacyLane) ? readdirSync(legacyLane) : [],
        [],
        'legacy synchronized eval-recommendations lane must contain no artifacts'
    );
});
