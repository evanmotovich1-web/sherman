import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'ink';
import chalk from 'chalk';

import { CodexSession } from '../src/engine/codex.js';
import { EVENT_KINDS, ev } from '../src/engine/session.js';
import { Transcript } from '../src/ui/Transcript.js';

Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true });
Object.defineProperty(process.stdout, 'rows', { value: 24, configurable: true });
chalk.level = 0;

const ansi = /\x1b\[[0-9;]*m/g;
const plain = (value) => value.replace(ansi, '');

const fakeConfig = {
    user: 'test',
    vaultPath: '/tmp/vault',
    workspacePath: '/tmp/workspace',
    contextWindowTokens: null,
};

const session = () => new CodexSession(fakeConfig);

// ------------------------------------------------------------ event contract --

test('message-delta is a first-class engine event', () => {
    assert.ok(EVENT_KINDS.includes('message-delta'));
    assert.deepEqual(ev.messageDelta('m1', 'hel'), { kind: 'message-delta', id: 'm1', text: 'hel' });
});

// -------------------------------------------------------- notification mapping --

test('turn/started maps to turn-start plus a status, and records the turn id', () => {
    const s = session();
    const events = s._mapNotification('turn/started', { turn: { id: 't1' } });
    assert.deepEqual(events.map((e) => e.kind), ['turn-start', 'status']);
    assert.equal(s._activeTurnId, 't1');
});

test('agentMessage deltas map to message-delta and the completed item to message', () => {
    const s = session();
    const deltas = s._mapNotification('item/agentMessage/delta', { itemId: 'm1', delta: 'PON' });
    assert.deepEqual(deltas, [{ kind: 'message-delta', id: 'm1', text: 'PON' }]);

    const done = s._mapNotification('item/completed', {
        item: { type: 'agentMessage', id: 'm1', text: 'PONG' },
    });
    assert.deepEqual(done, [{ kind: 'message', text: 'PONG' }]);
});

test('an empty delta yields nothing', () => {
    assert.deepEqual(session()._mapNotification('item/agentMessage/delta', { itemId: 'm1', delta: '' }), []);
});

test('camelCase commandExecution items reuse the exec item mapping', () => {
    const s = session();
    const started = s._mapNotification('item/started', {
        item: { type: 'commandExecution', id: 'exec-1', command: "/bin/zsh -lc 'echo hi'", status: 'inProgress' },
    });
    assert.equal(started.length, 1);
    assert.equal(started[0].kind, 'tool');
    assert.equal(started[0].phase, 'started');
    assert.equal(started[0].label, 'exec echo hi');

    const done = s._mapNotification('item/completed', {
        item: { type: 'commandExecution', id: 'exec-1', command: "/bin/zsh -lc 'echo hi'", status: 'completed' },
    });
    assert.equal(done.length, 1);
    assert.equal(done[0].outcome, 'succeeded');
    assert.ok(Number.isFinite(done[0].durationMs));
});

test('tokenUsage carries the live context and banks the bill for turn-end', () => {
    const s = session();
    const events = s._mapNotification('thread/tokenUsage/updated', {
        tokenUsage: {
            total: { totalTokens: 17966, inputTokens: 17855, cachedInputTokens: 11008, outputTokens: 111, reasoningOutputTokens: 0 },
            last: { totalTokens: 17966, inputTokens: 17855, cachedInputTokens: 11008, outputTokens: 111 },
            modelContextWindow: 258400,
        },
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'context');
    assert.equal(events[0].used, 17966);
    assert.equal(events[0].window, 258400);

    const end = s._mapNotification('turn/completed', {});
    assert.equal(end.length, 1);
    assert.equal(end[0].kind, 'turn-end');
    assert.equal(end[0].usage.input, 17855);
    assert.equal(end[0].usage.output, 111);
    assert.equal(end[0].usage.total, 17855 + 111);
});

test('the bill is the growth since the turn baseline, never negative', () => {
    const s = session();
    s._billBaseline = { inputTokens: 10000, cachedInputTokens: 5000, outputTokens: 100, reasoningOutputTokens: 0 };
    s._lastBill = { inputTokens: 17855, cachedInputTokens: 11008, outputTokens: 111, reasoningOutputTokens: 0 };
    const bill = s._turnBill();
    assert.equal(bill.input, 7855);
    assert.equal(bill.cachedInput, 6008);
    assert.equal(bill.output, 11);
    assert.equal(bill.total, 7855 + 11);
});

test('warning notifications map to advisory, never to error', () => {
    const events = session()._mapNotification('warning', { message: 'Skill descriptions were shortened…' });
    assert.deepEqual(events.map((e) => e.kind), ['advisory']);
});

test('turn/failed maps to error plus turn-end', () => {
    const events = session()._mapNotification('turn/failed', {
        turn: { error: { message: 'model overloaded' } },
    });
    assert.deepEqual(events.map((e) => e.kind), ['error', 'turn-end']);
    assert.equal(events[0].message, 'model overloaded');
});

test('another thread’s notifications are not this turn’s evidence', () => {
    const s = session();
    s._threadId = 'thread-a';
    const events = s._mapNotification('item/agentMessage/delta', {
        threadId: 'thread-b', itemId: 'm9', delta: 'stray',
    });
    assert.deepEqual(events, []);
});

test('unknown notifications yield nothing rather than throwing', () => {
    assert.deepEqual(session()._mapNotification('account/rateLimits/updated', {}), []);
    assert.deepEqual(session()._mapNotification('thread/status/changed', { status: { type: 'idle' } }), []);
});

// ------------------------------------------------------------- posture config --

test('the app-server posture keeps the exec posture’s spine', () => {
    const config = session()._appServerConfig();
    assert.equal(config.sandbox_mode, 'workspace-write');
    assert.equal(config.approval_policy, 'never');
    // The memory pair must never be disabled; the browser/computer tools
    // must never be enabled. Keys depend on the machine's codex config, so
    // assert the invariants, not the exact key list.
    assert.notEqual(config['mcp_servers.mnemosyne.enabled'], false);
    assert.notEqual(config['mcp_servers.llmwiki.enabled'], false);
    assert.equal(config['features.browser_use'], false);
    assert.equal(config['features.computer_use'], false);
    const roots = config['sandbox_workspace_write.writable_roots'];
    assert.ok(Array.isArray(roots));
    assert.ok(roots.some((root) => root.includes('mnemosyne')));
});

test('startNewThread also marks the app-server thread stale', () => {
    const s = session();
    s._threadId = 'thread-a';
    s._appServerThreadLoaded = true;
    assert.equal(s.startNewThread(), true);
    assert.equal(s._threadId, null);
    assert.equal(s._appServerThreadLoaded, false);
});

// ----------------------------------------------------------------- prewarm --

test('EngineSession.prewarm is a safe no-op on any backend', async () => {
    const { EngineSession } = await import('../src/engine/session.js');
    const base = new EngineSession();
    assert.equal(base.prewarm(), undefined);
});

test('prewarm runs once, joins the turn, and a failure is swallowed', async () => {
    const s = session();
    let readyCalls = 0;
    // The warm-up path IS _ensureAppServerReady; stub it to count joins
    // without spawning a real server.
    s._ensureAppServerReady = async () => {
        readyCalls += 1;
        throw new Error('no codex on this box');
    };
    s.prewarm();
    const first = s._prewarm;
    s.prewarm();
    assert.equal(s._prewarm, first, 'a second prewarm must not start a second warm-up');
    // The stored promise never rejects — the catch() swallowed the failure.
    await first;
    assert.equal(readyCalls, 1);
});

test('prewarm is skipped once the thread is already loaded', () => {
    const s = session();
    s._appServerThreadLoaded = true;
    s.prewarm();
    assert.equal(s._prewarm, null);
});

// ------------------------------------------------------------------ streaming UI --

test('a streaming reply renders an open frame: titled top rule, cursor, no close', () => {
    const output = plain(renderToString(React.createElement(Transcript, {
        items: [{ id: 'u1', kind: 'user', text: 'plan?' }],
        columns: 60,
        streaming: { id: 'm1', text: 'Working on **it**' },
    })));
    assert.match(output, /╭─ Sherman ─+╮/);
    assert.match(output, /Working on it▍/);
    assert.doesNotMatch(output, /╰/);
});

test('a committed reply replaces the stream: closed frame, no cursor', () => {
    const output = plain(renderToString(React.createElement(Transcript, {
        items: [
            { id: 'u1', kind: 'user', text: 'plan?' },
            { id: 'm1', kind: 'message', text: 'Done.' },
        ],
        columns: 60,
        streaming: null,
    })));
    assert.match(output, /╰─+╯/);
    assert.doesNotMatch(output, /▍/);
});
