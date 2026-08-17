import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'ink';
import chalk from 'chalk';

import { Thinking, elapsedSuffix } from '../src/ui/Thinking.js';
import { activityDescriptor } from '../src/ui/ActivityLine.js';

Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true });
Object.defineProperty(process.stdout, 'rows', { value: 24, configurable: true });
chalk.level = 0;

const ansi = /\x1b\[[0-9;]*m/g;
const plain = (value) => value.replace(ansi, '');

test('elapsedSuffix ticks whole seconds for running work only', () => {
    const running = { startedAt: 10_000, durationMs: null };
    assert.equal(elapsedSuffix(running, 22_400), ' · 12s');
    assert.equal(elapsedSuffix(running, 10_100), ' · 0s');
    // Completed rows carry the engine's own duration through the trace; a
    // wall clock past that point would be a second, disagreeing number.
    assert.equal(elapsedSuffix({ startedAt: 10_000, durationMs: 900 }, 22_400), '');
    // No arrival time, no claim.
    assert.equal(elapsedSuffix({ durationMs: null }, 22_400), '');
    assert.equal(elapsedSuffix(null, 22_400), '');
});

test('a running clock never goes negative on clock skew', () => {
    assert.equal(elapsedSuffix({ startedAt: 50_000, durationMs: null }, 40_000), ' · 0s');
});

test('the activity line shows the live clock while running, the measured one when done', () => {
    const running = activityDescriptor(
        [{ id: 't1', label: 'exec npm test', category: 'command', startedAt: 5_000 }],
        null,
        18_000
    );
    assert.equal(running.words, 'exec npm test · 13s');

    const done = activityDescriptor(
        [{ id: 't1', label: 'exec npm test', category: 'command', startedAt: 5_000, durationMs: 1234 }],
        null,
        18_000
    );
    assert.equal(done.words, 'exec npm test  1.2s');
});

test('an activity without an arrival time renders exactly as before', () => {
    const bare = activityDescriptor([{ id: 't1', label: 'patch scanner.js', category: 'file-change' }], null, 99_999);
    assert.equal(bare.words, 'patch scanner.js');
});

test('Thinking rows wear the clock, muted, only on running work', () => {
    const output = plain(renderToString(React.createElement(Thinking, {
        active: true,
        columns: 60,
        rows: 24,
        now: 30_000,
        activities: [
            { id: 'a', line: '💻 exec   npm test', startedAt: 18_000, durationMs: null },
            { id: 'b', line: '📖 read   AGENTS.md', startedAt: 29_000, durationMs: 40 },
        ],
    })));
    assert.match(output, /npm test · 12s/);
    assert.doesNotMatch(output, /AGENTS\.md · /);
});

test('a deterministic frame with no running rows has no clocks', () => {
    const output = plain(renderToString(React.createElement(Thinking, {
        active: true,
        columns: 60,
        rows: 24,
        now: 30_000,
        activities: [{ id: 'a', line: '💻 exec   ls', durationMs: 12 }],
    })));
    assert.doesNotMatch(output, /·\s*\d+s/);
});
