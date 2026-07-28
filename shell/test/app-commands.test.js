import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import React from 'react';
import { render } from 'ink';

import { App } from '../src/ui/app.js';

const zeroUsage = () => ({ input: 0, cachedInput: 0, output: 0, reasoning: 0, total: 0 });

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

    await new Promise((resolve) => setTimeout(resolve, 750));
    instance.unmount();
    await new Promise((resolve) => setTimeout(resolve, 80));

    try {
        assert.equal(mainRequests.length, 2);
        assert.equal(typeof mainRequests[0], 'string');
        assert.match(mainRequests[0], /SHERMAN SHELL SESSION GOAL/);
        assert.match(mainRequests[0], /check status/);
        assert.equal(mainRequests[1].mode, 'isolated-read-only');
        assert.equal(mainRequests[1].source, 'plan');

        assert.equal(workerRequests.length, 1);
        assert.equal(workerRequests[0].mode, 'isolated-read-only');
        assert.equal(workerRequests[0].source, 'subagent');
        assert.match(workerRequests[0].text, /audit command UX/);
        assert.equal(workers.length, 1);
        assert.equal(workers[0].disposed(), 1);

        const plain = captured.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
        assert.match(plain, /goal: launch command system/);
        assert.match(plain, /Worker 01/);
    } finally {
        process.env.HOME = oldHome;
        rmSync(home, { recursive: true, force: true });
    }
});
