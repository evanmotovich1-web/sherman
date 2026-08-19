import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describeModels, inventory, pickRoute } from '../src/localmodels.js';

function fixture(keys = {}) {
    const home = mkdtempSync(join(tmpdir(), 'sherman-models-'));
    mkdirSync(home, { recursive: true });
    if (Object.keys(keys).length > 0) {
        writeFileSync(
            join(home, 'keys.json'),
            `${JSON.stringify({ version: 1, keys }, null, 2)}\n`,
            { mode: 0o600 },
        );
    }
    return home;
}

test('inventory reports installed engines and names-only key sources', () => {
    const home = fixture({ DEEPSEEK_API_KEY: 'sk-test-not-a-real-key', GROQ_API_KEY: 'gsk-test' });
    try {
        const snap = inventory({
            home,
            env: { ANTHROPIC_API_KEY: 'env-not-a-real-key', EMPTY: '' },
            engineAvailable: (name) => name === 'claude' || name === 'deepseek',
        });
        assert.deepEqual(snap.ready, ['claude', 'deepseek']);
        const claude = snap.engines.find((entry) => entry.engine === 'claude');
        const deepseek = snap.engines.find((entry) => entry.engine === 'deepseek');
        const codex = snap.engines.find((entry) => entry.engine === 'codex');
        assert.equal(claude.ready, true);
        assert.deepEqual(claude.keys, [{ name: 'ANTHROPIC_API_KEY', where: 'environment' }]);
        assert.equal(deepseek.ready, true);
        assert.deepEqual(deepseek.keys, [{ name: 'DEEPSEEK_API_KEY', where: 'store' }]);
        assert.equal(codex.ready, false);
        assert.deepEqual(snap.extras, [{ name: 'GROQ_API_KEY', where: 'store' }]);
        const text = describeModels({
            home,
            env: { ANTHROPIC_API_KEY: 'env-not-a-real-key' },
            engineAvailable: (name) => name === 'claude' || name === 'deepseek',
        });
        assert.match(text, /Ready to route/);
        assert.match(text, /\/subagent --engine claude/);
        assert.match(text, /\/subagent --engine deepseek/);
        assert.match(text, /GROQ_API_KEY/);
        assert.doesNotMatch(text, /sk-test-not-a-real-key/);
        assert.doesNotMatch(text, /env-not-a-real-key/);
        assert.doesNotMatch(text, /gsk-test/);
        assert.match(text, /Key names only/);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('deepseek without its key is not ready even when opencode is installed', () => {
    const home = fixture();
    try {
        const snap = inventory({
            home,
            env: {},
            engineAvailable: (name) => name === 'deepseek' || name === 'zai',
        });
        const deepseek = snap.engines.find((entry) => entry.engine === 'deepseek');
        const zai = snap.engines.find((entry) => entry.engine === 'zai');
        assert.equal(deepseek.installed, true);
        assert.equal(deepseek.ready, false);
        assert.deepEqual(deepseek.missingKeys, ['DEEPSEEK_API_KEY']);
        assert.equal(zai.ready, true);
        const text = describeModels({
            home,
            env: {},
            engineAvailable: (name) => name === 'deepseek' || name === 'zai',
        });
        assert.match(text, /Needs a key/);
        assert.match(text, /\/key DEEPSEEK_API_KEY/);
        assert.match(text, /Ready to route/);
        assert.match(text, /\/subagent --engine zai/);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('describeModels never prints a secret from the environment or the store', () => {
    const home = fixture({ OPENAI_API_KEY: 'sk-secret-store-value' });
    try {
        const text = describeModels({
            home,
            env: { OPENROUTER_API_KEY: 'sk-secret-env-value' },
            engineAvailable: () => false,
        });
        assert.match(text, /Not installed/);
        assert.match(text, /OPENAI_API_KEY is present/);
        assert.match(text, /OPENROUTER_API_KEY/);
        assert.doesNotMatch(text, /sk-secret-store-value/);
        assert.doesNotMatch(text, /sk-secret-env-value/);
        assert.match(text, /does not scan the disk for secrets/);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('pickRoute prefers a ready named engine and refuses a missing one', () => {
    const home = fixture({ DEEPSEEK_API_KEY: 'sk-test' });
    const options = {
        home,
        env: {},
        engineAvailable: (name) => name === 'codex' || name === 'deepseek',
    };
    try {
        assert.deepEqual(pickRoute('deepseek', options), {
            engine: 'deepseek',
            model: 'deepseek/deepseek-chat via OpenCode',
            reason: 'requested engine is ready',
        });
        assert.equal(pickRoute('claude', options).engine, null);
        assert.match(pickRoute('claude', options).reason, /not installed/);
        assert.equal(pickRoute(null, options).engine, 'codex');
        assert.equal(pickRoute(null, { home, env: {}, engineAvailable: () => false }).engine, null);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});
