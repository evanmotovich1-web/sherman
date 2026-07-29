// The live context estimate, tested for the one thing that would make it
// dishonest: a projected number that presents as a measured one.
//
// The arithmetic barely matters — it is four characters to a token, and the
// `~` on screen is the whole point of admitting that. What matters is the
// tagging, the precedence of a real measurement over a guess, and the refusal
// to invent a figure out of nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'ink';
import chalk from 'chalk';

import {
    CHARS_PER_TOKEN,
    estimateTokens,
    projectContext,
    tokensForChars,
} from '../src/contextestimate.js';
import { StatusBar } from '../src/ui/StatusBar.js';

chalk.level = 0;
const plain = (value) => value.replace(/\x1b\[[0-9;]*m/g, '');

test('the ratio is applied consistently to text and to raw counts', () => {
    assert.equal(CHARS_PER_TOKEN, 4);
    assert.equal(estimateTokens('12345678'), 2);
    assert.equal(tokensForChars(8), 2);
    // Partial tokens round up: a fragment still occupies one.
    assert.equal(estimateTokens('123'), 1);
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens(null), 0);
    assert.equal(tokensForChars(-5), 0);
    assert.equal(tokensForChars(NaN), 0);
});

// A completed turn's figure is a fact and must be presented as one.
test('a measurement with nothing in flight is reported as measured', () => {
    assert.deepEqual(
        projectContext({ measured: 40000, sentChars: 0, streamedChars: 0 }),
        { used: 40000, estimated: false }
    );
});

// The load-bearing case. The moment anything is in flight the figure is a
// projection, and it must say so, or the meter silently starts lying mid-turn.
test('anything in flight makes the figure an estimate', () => {
    const result = projectContext({ measured: 40000, sentChars: 400, streamedChars: 800 });
    assert.equal(result.estimated, true, 'a projected figure was tagged as measured');
    assert.equal(result.used, 40000 + 100 + 200);
});

test('the estimate only ever rises above the baseline it started from', () => {
    const baseline = projectContext({ measured: 40000, sentChars: 0, streamedChars: 0 });
    let previous = baseline.used;
    for (const streamed of [100, 500, 2000, 9000]) {
        const next = projectContext({ measured: 40000, sentChars: 400, streamedChars: streamed });
        assert.ok(next.used > previous, 'the meter went backwards mid-turn');
        previous = next.used;
    }
});

// Before any turn completes there is no baseline. Rendering a confident zero is
// the exact failure mapUsage already refuses for absent payloads.
test('with nothing measured and nothing sent there is no figure at all', () => {
    assert.equal(projectContext({ measured: null, sentChars: 0, streamedChars: 0 }), null);
});

test('a first turn projects from what it sent, and says it is an estimate', () => {
    assert.deepEqual(
        projectContext({ measured: null, sentChars: 40, streamedChars: 0 }),
        { used: 10, estimated: true }
    );
});

test('a nonsense measurement is treated as absent rather than trusted', () => {
    assert.equal(projectContext({ measured: -1, sentChars: 0, streamedChars: 0 }), null);
    assert.deepEqual(
        projectContext({ measured: Number.NaN, sentChars: 40, streamedChars: 0 }),
        { used: 10, estimated: true }
    );
});

// --------------------------------------------------------------- rendering --

const info = {
    engine: 'codex', model: 'gpt-5.6-sol', user: 'test-user',
    vaultPath: '/tmp/sherman/vault', contextWindow: 100000, threadId: null,
};
const usage = { input: 0, cachedInput: 0, output: 0, reasoning: 0, total: 0 };

const render = (props) => plain(renderToString(
    React.createElement(StatusBar, { info, usage, columns: 120, sessionStart: Date.now(), ...props }),
    { columns: 120 }
));

test('a measured meter prints a bare number and a solid bar', () => {
    const out = render({ contextUsed: 40000, contextEstimated: false });
    assert.match(out, /40\.0k\/100\.0k/);
    assert.match(out, /40%/);
    assert.doesNotMatch(out, /~/, 'a measured figure was marked as an estimate');
    assert.match(out, /█/, 'the measured bar lost its solid fill');
});

// The mark has to survive into the PLAIN text, because the narrow layouts drop
// to the percentage alone and a NO_COLOR terminal drops the tint entirely. An
// estimate distinguished only by ink reads as measured exactly where the
// operator can least check it.
test('an estimated meter marks both the figure and the percentage', () => {
    const out = render({ contextUsed: 40000, contextEstimated: true });
    assert.match(out, /~40\.0k\/100\.0k/, 'the token figure was not marked');
    assert.match(out, /~40%/, 'the percentage was not marked');
    assert.match(out, /▒/, 'the estimated bar did not use the provisional fill');
    assert.doesNotMatch(out, /█/, 'the estimated bar used the measured solid fill');
});

test('the mark survives every width the strip degrades through', () => {
    for (const columns of [120, 60, 40, 24, 14, 10]) {
        const out = plain(renderToString(
            React.createElement(StatusBar, {
                info, usage, columns, sessionStart: Date.now(),
                contextUsed: 40000, contextEstimated: true,
            }),
            { columns }
        ));
        if (!/40%/.test(out)) continue; // too narrow to show context at all
        assert.match(out, /~40%/, `${columns}-column strip dropped the estimate mark`);
    }
});

// Red means "over the window", which is a measured claim. An estimate that
// cannot see the system prompt or the files Codex read has not earned it.
test('an estimate over the window does not borrow the alarm colour', () => {
    chalk.level = 3;
    try {
        const styled = renderToString(
            React.createElement(StatusBar, {
                info, usage, columns: 120, sessionStart: Date.now(),
                contextUsed: 150000, contextEstimated: true,
            }),
            { columns: 120 }
        );
        const measuredOver = renderToString(
            React.createElement(StatusBar, {
                info, usage, columns: 120, sessionStart: Date.now(),
                contextUsed: 150000, contextEstimated: false,
            }),
            { columns: 120 }
        );
        assert.notEqual(styled, measuredOver, 'estimated and measured over-window render identically');
        assert.match(plain(styled), /~150\.0k/);
    } finally {
        chalk.level = 0;
    }
});
