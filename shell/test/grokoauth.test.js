import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    grokOAuthPath,
    hasGrokOAuth,
    injectGrokOAuth,
    loadGrokOAuth,
    needsRefresh,
    saveGrokOAuth,
} from '../src/grokoauth.js';

test('save/load is names-only on disk shape and never requires OpenCode', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-grok-oauth-'));
    try {
        assert.equal(hasGrokOAuth(home), false);
        saveGrokOAuth({
            access_token: 'access-test',
            refresh_token: 'refresh-test',
            expires_at: Date.now() + 10_000_000,
        }, home);
        assert.equal(hasGrokOAuth(home), true);
        const loaded = loadGrokOAuth(home);
        assert.equal(loaded.ok, true);
        assert.equal(loaded.store.refresh_token, 'refresh-test');
        const bytes = readFileSync(grokOAuthPath(home), 'utf8');
        assert.match(bytes, /refresh_token/);
        assert.doesNotMatch(bytes, /opencode/);
        const env = {};
        const injected = injectGrokOAuth(env, home);
        assert.equal(injected.injected, true);
        assert.equal(env.XAI_API_KEY, 'access-test');
        const already = { XAI_API_KEY: 'keep-me' };
        assert.equal(injectGrokOAuth(already, home).injected, false);
        assert.equal(already.XAI_API_KEY, 'keep-me');
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('needsRefresh is true when expiry is missing or inside the skew window', () => {
    assert.equal(needsRefresh({ refresh_token: 'r' }), true);
    assert.equal(needsRefresh({ refresh_token: 'r', expires_at: Date.now() + 90 * 60 * 1000 }), false);
    assert.equal(needsRefresh({ refresh_token: 'r', expires_at: Date.now() + 10 * 60 * 1000 }), true);
});
