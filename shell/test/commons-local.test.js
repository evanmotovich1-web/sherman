import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    LOCAL_HUMAN_CONFIRMATION,
    approvePendingIntent,
    createPendingIntent,
    loadCommonsState,
    publishPendingIntent,
    saveCommonsSettings,
    settingsPath,
    uninstallCommons,
} from '../src/commons/local-state.js';

const post = {
    kind: 'idea',
    title: 'Synthetic local workflow',
    body: 'Keep publication behind a local human gate.',
    authorship_mode: 'agent_observed',
    visibility: 'network',
};

test('settings and pending publication intents are 0600 and contain no approval shortcut', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-local-'));
    try {
        saveCommonsSettings({ home, serviceUrl: 'https://commons.test', autoPublishInventory: false });
        assert.equal(statSync(settingsPath(home)).mode & 0o777, 0o600);

        const intent = createPendingIntent({ home, post, source: 'mcp', now: 1785900000000 });
        assert.equal(intent.status, 'pending');
        assert.match(intent.bodyHash, /^[a-f0-9]{64}$/);
        assert.equal(Object.hasOwn(intent, 'approved'), false);
        const serialized = readFileSync(join(home, '.sherman', 'commons', 'state.json'), 'utf8');
        assert.doesNotMatch(serialized, /private.?key|enrollment.?token/i);
        assert.equal(statSync(join(home, '.sherman', 'commons', 'state.json')).mode & 0o777, 0o600);

        assert.throws(
            () => approvePendingIntent({ home, id: intent.id, confirmation: true, now: 1785900001000 }),
            /local human confirmation/i,
        );
        const approved = approvePendingIntent({
            home, id: intent.id, confirmation: LOCAL_HUMAN_CONFIRMATION, now: 1785900001000,
        });
        assert.equal(approved.status, 'approved');
        assert.equal(approved.approvedBodyHash, intent.bodyHash);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('publishing requires an unexpired hash-bound approval and records only typed receipt data', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-publish-'));
    try {
        const pending = createPendingIntent({ home, post, source: 'shell', now: 1785900000000 });
        await assert.rejects(
            () => publishPendingIntent({ home, id: pending.id, client: { publishPost: async () => ({}) }, now: 1785900001000 }),
            /approved locally/i,
        );
        approvePendingIntent({
            home, id: pending.id, confirmation: LOCAL_HUMAN_CONFIRMATION, now: 1785900001000,
        });
        const published = await publishPendingIntent({
            home,
            id: pending.id,
            now: 1785900002000,
            client: {
                publishPost: async (value) => {
                    assert.deepEqual(value, post);
                    return { id: 'post-test' };
                },
            },
        });
        assert.equal(published.status, 'published');
        assert.deepEqual(published.receipt, { postId: 'post-test', publishedAt: 1785900002000 });
        assert.equal(loadCommonsState(home).intents[0].status, 'published');
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('an approved intent persists and reuses one idempotency key across an uncertain retry', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-idempotency-'));
    try {
        const pending = createPendingIntent({ home, post, source: 'shell', now: 1785900000000 });
        const approved = approvePendingIntent({
            home, id: pending.id, confirmation: LOCAL_HUMAN_CONFIRMATION, now: 1785900001000,
        });
        assert.equal(approved.idempotencyKey, `intent:${pending.id}`);
        let firstKey;
        await assert.rejects(() => publishPendingIntent({
            home, id: pending.id, now: 1785900002000,
            client: { publishPost: async (_value, options) => { firstKey = options.idempotencyKey; throw new Error('uncertain'); } },
        }), /uncertain/);
        assert.equal(loadCommonsState(home).intents[0].status, 'approved');
        let retryKey;
        const published = await publishPendingIntent({
            home, id: pending.id, now: 1785900003000,
            client: { publishPost: async (_value, options) => { retryKey = options.idempotencyKey; return { id: 'post-test' }; } },
        });
        assert.equal(firstKey, approved.idempotencyKey);
        assert.equal(retryKey, approved.idempotencyKey);
        assert.equal(published.status, 'published');
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('uninstall cleanup removes local Commons identity, settings, pending state, and quarantine', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-uninstall-'));
    try {
        saveCommonsSettings({ home, serviceUrl: 'https://commons.test', autoPublishInventory: false });
        createPendingIntent({ home, post, source: 'shell' });
        assert.equal(uninstallCommons({ home }), true);
        assert.equal(loadCommonsState(home).intents.length, 0);
        assert.equal(uninstallCommons({ home }), false);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});
