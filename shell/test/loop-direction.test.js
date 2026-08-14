// The direction layer: what the loop reads to orient itself, and the ONLY pen
// it holds for writing back — every operation routes through the retention
// validation stack, operator-marked lines survive any model rewrite, and the
// audit log is shell-composed, bounded, and sanitized.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    readDirection, operatorLinesSurvive, applyDirectionOperations, appendLoopLog,
} from '../src/loop/direction.js';

function tempVault() {
    const vaultPath = mkdtempSync(join(tmpdir(), 'sherman-direction-'));
    mkdirSync(join(vaultPath, 'direction'), { recursive: true });
    return vaultPath;
}

test('readDirection returns empties for a missing layer and content for a real one', () => {
    const bare = mkdtempSync(join(tmpdir(), 'sherman-direction-bare-'));
    try {
        assert.deepEqual(readDirection(bare), { goals: null, threads: [], log: null });
    } finally {
        rmSync(bare, { recursive: true, force: true });
    }

    const vaultPath = tempVault();
    try {
        writeFileSync(join(vaultPath, 'direction', 'goals.md'), '- goal one\n');
        writeFileSync(join(vaultPath, 'direction', 'thread-smoke.md'), 'status: open\n');
        writeFileSync(join(vaultPath, 'direction', 'log.md'), 'line\n');
        const direction = readDirection(vaultPath);
        assert.equal(direction.goals, '- goal one\n');
        assert.deepEqual(direction.threads, [{ name: 'thread-smoke.md', content: 'status: open\n' }]);
        assert.equal(direction.log, 'line\n');
    } finally {
        rmSync(vaultPath, { recursive: true, force: true });
    }
});

test('operator lines are immune to model rewrites', () => {
    const existing = '- [operator] never drop PHI rule\n- old goal\n';
    assert.equal(operatorLinesSurvive(existing, '- new goal\n'), false);
    assert.equal(operatorLinesSurvive(existing, '- [operator] never drop PHI rule\n- new goal\n'), true);
    // No existing file means nothing to protect.
    assert.equal(operatorLinesSurvive(null, '- anything\n'), true);
});

test('applyDirectionOperations rejects log.md and operator drops, applies the rest', () => {
    const vaultPath = tempVault();
    try {
        writeFileSync(join(vaultPath, 'direction', 'goals.md'), '- [operator] hold the gates\n- old\n');
        const { applied, rejected } = applyDirectionOperations({
            vaultPath,
            operations: [
                { path: 'log.md', content: 'forged audit line\n' },
                { path: 'goals.md', content: '- fresh goals only\n' },
                { path: 'thread-baseline.md', content: 'status: open\nnext: run the baseline\n' },
            ],
        });
        assert.deepEqual(applied, ['thread-baseline.md']);
        assert.equal(rejected.length, 2);
        assert.match(rejected.find((r) => r.path === 'log.md').reason, /audit log/);
        assert.match(rejected.find((r) => r.path === 'goals.md').reason, /operator/);
        assert.equal(
            readFileSync(join(vaultPath, 'direction', 'thread-baseline.md'), 'utf8'),
            'status: open\nnext: run the baseline\n'
        );
        // The protected goals file is untouched.
        assert.equal(
            readFileSync(join(vaultPath, 'direction', 'goals.md'), 'utf8'),
            '- [operator] hold the gates\n- old\n'
        );
    } finally {
        rmSync(vaultPath, { recursive: true, force: true });
    }
});

test('a validator rejection becomes a rejected entry, never a throw', () => {
    const vaultPath = tempVault();
    try {
        const { applied, rejected } = applyDirectionOperations({
            vaultPath,
            operations: [{ path: 'thread-bad.md', content: 'patient John Smith has diabetes' }],
        });
        assert.deepEqual(applied, []);
        assert.equal(rejected.length, 1);
        assert.match(rejected[0].reason, /possible_phi/);
    } finally {
        rmSync(vaultPath, { recursive: true, force: true });
    }
});

test('appendLoopLog rotates at 30 lines and sanitizes control bytes', () => {
    const vaultPath = tempVault();
    try {
        for (let i = 1; i <= 35; i++) {
            assert.equal(appendLoopLog({ vaultPath, line: `iteration ${i} [31mpick[0m` }), true);
        }
        const log = readFileSync(join(vaultPath, 'direction', 'log.md'), 'utf8');
        const lines = log.trimEnd().split('\n');
        assert.equal(lines.length, 30, 'the log keeps only the last 30 lines');
        assert.equal(lines[0].includes('iteration 6'), true);
        assert.equal(lines.at(-1).includes('iteration 35'), true);
        assert.equal(log.includes(''), false, 'ESC bytes must not reach the vault');
    } finally {
        rmSync(vaultPath, { recursive: true, force: true });
    }
});

test('a line the validator refuses is recorded as withheld, never silently dropped', () => {
    const vaultPath = tempVault();
    try {
        // 1000 identical characters truncate to 200, which still trips the
        // credential-blob screen — the audit entry must land redacted.
        assert.equal(appendLoopLog({ vaultPath, line: 'x'.repeat(1000) }), true);
        const log = readFileSync(join(vaultPath, 'direction', 'log.md'), 'utf8');
        assert.match(log, /entry withheld by the retention validator/);
        assert.equal(log.includes('xxx'), false);
    } finally {
        rmSync(vaultPath, { recursive: true, force: true });
    }
});
