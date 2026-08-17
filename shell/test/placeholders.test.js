import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'ink';
import chalk from 'chalk';

import { capabilityHints, hintFor, DEFAULT_HINT, HINT_INTERVAL_MS } from '../src/ui/placeholders.js';
import { Composer } from '../src/ui/Composer.js';
import { COMMANDS } from '../src/commands.js';

Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true });
Object.defineProperty(process.stdout, 'rows', { value: 24, configurable: true });
chalk.level = 0;

const ansi = /\x1b\[[0-9;]*m/g;
const plain = (value) => value.replace(ansi, '');

test('the resting line leads the rotation, so frame zero is the old composer', () => {
    const hints = capabilityHints();
    assert.equal(hints[0], DEFAULT_HINT);
    assert.equal(hintFor(hints, 0), DEFAULT_HINT);
    // And the rotation wraps rather than running out.
    assert.equal(hintFor(hints, hints.length), DEFAULT_HINT);
});

test('every command a hint teaches actually exists in the command table', () => {
    const names = new Set(COMMANDS.map((c) => c.name));
    for (const hint of capabilityHints()) {
        for (const [, name] of hint.matchAll(/\/([a-z]+)/g)) {
            assert.ok(names.has(name), `hint teaches /${name}, which is not a real command: "${hint}"`);
        }
    }
});

test('loaded skills join the rotation; an empty registry contributes nothing', () => {
    const withSkills = capabilityHints({
        skills: [{ name: 'invoice-audit', summary: 'Check an invoice batch' }],
    });
    assert.ok(withSkills.some((h) => h === 'try /invoice-audit — Check an invoice batch'));

    const bare = capabilityHints({ skills: [] });
    assert.ok(!bare.some((h) => h.includes('invoice-audit')));
    // A skill entry without a name is not a capability and must not render.
    const junk = capabilityHints({ skills: [{ summary: 'nameless' }] });
    assert.deepEqual(junk, bare);
});

test('the skill sample is capped so first-party hints keep their share', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `skill${i}`, summary: '' }));
    const hints = capabilityHints({ skills: many });
    assert.equal(hints.filter((h) => /^try \/skill\d+/.test(h)).length, 4);
});

test('the rotation cadence is a reading pace, not an animation', () => {
    assert.ok(HINT_INTERVAL_MS >= 3000);
});

test('a fresh composer renders the original placeholder byte-identically', () => {
    const output = plain(renderToString(React.createElement(Composer, {
        onSubmit: () => {},
        busy: false,
        columns: 80,
    })));
    assert.match(output, /Ask about company operations…/);
});

test('narrow composers keep the short static line', () => {
    const output = plain(renderToString(React.createElement(Composer, {
        onSubmit: () => {},
        busy: false,
        columns: 30,
    })));
    assert.match(output, /Ask about operations…/);
});
