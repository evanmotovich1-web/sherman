import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const launcher = join(root, 'bin', 'sherman');

function commons(args, { home, env = {} } = {}) {
    return spawnSync(launcher, ['commons', ...args], {
        encoding: 'utf8',
        env: {
            ...process.env,
            HOME: home,
            PATH: process.env.PATH,
            SHERMAN_NO_BROWSER: '1',
            ...env,
        },
        timeout: 10_000,
    });
}

test('standalone commons status uses the Node client without config or an engine', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-cli-'));
    try {
        const result = commons(['status'], { home });
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /Commons is not enrolled/i);
        assert.doesNotMatch(`${result.stdout}${result.stderr}`, /Codex is not installed|Setting up Sherman/);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('standalone commons errors never echo an enrollment token', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-cli-token-'));
    const token = 'one-time-super-secret-token';
    try {
        const result = commons(['enroll', token], { home });
        assert.notEqual(result.status, 0);
        assert.match(`${result.stdout}${result.stderr}`, /approved HTTPS Commons service URL/i);
        assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(token));
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});
