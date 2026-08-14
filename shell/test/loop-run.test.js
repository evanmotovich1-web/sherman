// The loop core: pick is logged BEFORE execution, direction operations apply
// through the validated layer, a STOP file halts at every seam, consecutive
// failures halt rather than thrash, and the iteration count is hard-bounded.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ev } from '../src/engine/session.js';
import { runLoop } from '../src/loop/run.js';

function tempHomeAndVault() {
    const home = mkdtempSync(join(tmpdir(), 'sherman-loop-home-'));
    const vaultPath = join(home, 'vault');
    mkdirSync(join(vaultPath, 'direction'), { recursive: true });
    return { home, vaultPath };
}

/**
 * A scripted engine session: each send consumes the next entry — either a
 * string (yielded as the final message) or a function invoked with the
 * request (for mid-turn assertions and STOP injection) returning the string.
 */
function scriptedSession(script, requests = []) {
    return {
        async *send(request) {
            requests.push(request);
            const next = script.shift();
            const text = typeof next === 'function' ? next(request) : next;
            yield ev.turnStart();
            if (text instanceof Error) {
                yield ev.error(text.message);
            } else {
                yield ev.message(text);
            }
            yield ev.turnEnd({});
        },
    };
}

const pickJson = (pick) => JSON.stringify({ pick, why: 'test reason' });
const execJson = (extra = {}) => JSON.stringify({ outcome: 'done', ...extra });

test('an iteration logs the pick before executing, then applies direction ops', async () => {
    const { home, vaultPath } = tempHomeAndVault();
    const requests = [];
    try {
        let logAtExecTime = null;
        const session = scriptedSession([
            pickJson('run the smoke suite'),
            (request) => {
                logAtExecTime = readFileSync(join(vaultPath, 'direction', 'log.md'), 'utf8');
                assert.match(request.text, /run the smoke suite/, 'the execute turn carries the pick');
                return execJson({
                    direction: { operations: [{ path: 'thread-smoke.md', content: 'status: open\n' }] },
                });
            },
        ], requests);
        const result = await runLoop({
            config: { vaultPath }, iterations: 1, makeSession: () => session, home,
        });
        assert.equal(result.completed, 1);
        assert.equal(result.halted, null);
        assert.match(logAtExecTime, /run the smoke suite/, 'the pick was in the log before execution');
        assert.equal(existsSync(join(vaultPath, 'direction', 'thread-smoke.md')), true);
        assert.equal(requests[0].mode ?? 'normal', 'normal', 'the loop never loosens the posture');
        assert.equal(requests[0].source, 'loop-pick');
        assert.equal(requests[1].source, 'loop-exec');
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('a STOP file halts between pick and execute', async () => {
    const { home, vaultPath } = tempHomeAndVault();
    try {
        const session = scriptedSession([
            (request) => {
                mkdirSync(join(home, '.sherman', 'loop'), { recursive: true });
                writeFileSync(join(home, '.sherman', 'loop', 'STOP'), '');
                return pickJson('anything');
            },
            () => { throw new Error('the execute turn must never run after STOP'); },
        ]);
        const result = await runLoop({
            config: { vaultPath }, iterations: 3, makeSession: () => session, home,
        });
        assert.equal(result.halted, 'stop');
        assert.equal(result.completed, 0);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('a STOP file halts between iterations', async () => {
    const { home, vaultPath } = tempHomeAndVault();
    try {
        const session = scriptedSession([
            pickJson('first'),
            () => {
                mkdirSync(join(home, '.sherman', 'loop'), { recursive: true });
                writeFileSync(join(home, '.sherman', 'loop', 'STOP'), '');
                return execJson();
            },
            () => { throw new Error('iteration two must never start after STOP'); },
        ]);
        const result = await runLoop({
            config: { vaultPath }, iterations: 3, makeSession: () => session, home,
        });
        assert.equal(result.halted, 'stop');
        assert.equal(result.completed, 1);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('two consecutive failures halt the loop; a success resets the count', async () => {
    const { home, vaultPath } = tempHomeAndVault();
    try {
        const halted = await runLoop({
            config: { vaultPath }, iterations: 5,
            makeSession: () => scriptedSession(['no json here', 'still no json']),
            home,
        });
        assert.equal(halted.halted, 'failures');
        assert.equal(halted.completed, 0);

        const mixed = await runLoop({
            config: { vaultPath }, iterations: 4,
            makeSession: () => scriptedSession([
                'garbage', // pick fails -> iteration 1 failed
                pickJson('recover'), execJson(), // iteration 2 succeeds, count resets
                'garbage again', // iteration 3 failed
                pickJson('recover again'), execJson(), // iteration 4 succeeds
            ]),
            home,
        });
        assert.equal(mixed.halted, null);
        assert.equal(mixed.completed, 2);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('iteration count is clamped to 1..10 and defaults to 3', async () => {
    const { home, vaultPath } = tempHomeAndVault();
    try {
        const script = [];
        for (let i = 0; i < 20; i++) script.push(pickJson(`task ${i}`), execJson());
        const clamped = await runLoop({
            config: { vaultPath }, iterations: 99,
            makeSession: () => scriptedSession(script.slice()), home,
        });
        assert.equal(clamped.completed, 10);

        const defaulted = await runLoop({
            config: { vaultPath },
            makeSession: () => scriptedSession(script.slice()), home,
        });
        assert.equal(defaulted.completed, 3);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('an empty direction layer makes the first pick a bootstrap instruction', async () => {
    const { home, vaultPath } = tempHomeAndVault();
    const requests = [];
    try {
        const session = scriptedSession([pickJson('draft goals.md'), execJson()], requests);
        await runLoop({ config: { vaultPath }, iterations: 1, makeSession: () => session, home });
        assert.match(requests[0].text, /draft.*goals\.md/is, 'the bootstrap task is drafting the goals');
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('loop stop writes the STOP file and a fresh loop clears the stale one', async () => {
    const { home, vaultPath } = tempHomeAndVault();
    try {
        const { requestStop, clearStaleStop } = await import('../src/loop/cli.js');
        assert.equal(requestStop(home).ok, true);
        assert.equal(existsSync(join(home, '.sherman', 'loop', 'STOP')), true);
        // A fresh invocation is operator intent: the stale STOP is cleared so
        // the loop it starts is not instantly halted by a forgotten file.
        assert.equal(clearStaleStop(home), true);
        assert.equal(existsSync(join(home, '.sherman', 'loop', 'STOP')), false);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});
