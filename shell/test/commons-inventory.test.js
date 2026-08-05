import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    buildCommonsInventory,
    inventoryStatePath,
    prepareInventoryDelta,
    recordInventorySync,
} from '../src/commons/inventory.js';
import { saveCommonsSettings } from '../src/commons/local-state.js';

function fixtureRoot() {
    const root = mkdtempSync(join(tmpdir(), 'sherman-commons-inventory-root-'));
    mkdirSync(join(root, 'skills', 'safe-skill'), { recursive: true });
    writeFileSync(join(root, 'skills', 'safe-skill', 'SKILL.md'), [
        '---',
        'name: safe-skill',
        'category: operations',
        'summary: improve a bounded local workflow',
        'description: Use for bounded synthetic operations work.',
        'private-note: must not publish',
        '---',
        '',
        '# Raw instructions',
        'A raw transcript and arbitrary local file content must not be inventoried.',
    ].join('\n'));
    mkdirSync(join(root, 'agent'), { recursive: true });
    writeFileSync(join(root, 'agent', 'connectors.json'), JSON.stringify({
        connectors: [{
            name: 'synthetic-connector', summary: 'bounded synthetic search', transport: 'http',
            requires: ['SYNTHETIC_API_TOKEN'], autoEnable: false,
            signup: 'https://signup.connector.test/account?campaign=private',
            url: 'https://connector.test/mcp',
            headers: { Authorization: 'Bearer synthetic-secret-value' },
            env: { SYNTHETIC_API_TOKEN: 'synthetic-secret-value' },
            commandCandidates: ['/Users/example/private/tool'],
            args: ['/Users/example/private/data'],
        }],
    }));
    return root;
}

test('inventory is deterministic approved metadata only, with secret names but never values', () => {
    const root = fixtureRoot();
    try {
        const first = buildCommonsInventory({ root });
        const second = buildCommonsInventory({ root });
        assert.deepEqual(first, second);
        assert.match(first.hash, /^[a-f0-9]{64}$/);
        assert.deepEqual(first.skills, [{
            name: 'safe-skill', category: 'operations',
            summary: 'improve a bounded local workflow',
            description: 'Use for bounded synthetic operations work.',
            manifest_sha256: first.skills[0].manifest_sha256,
            source_scope: 'bundled', content_available: false,
        }]);
        assert.match(first.skills[0].manifest_sha256, /^[a-f0-9]{64}$/);
        assert.deepEqual(first.connectors, [{
            name: 'synthetic-connector', summary: 'bounded synthetic search',
            transport: 'http', requires: ['SYNTHETIC_API_TOKEN'],
            signup_host: 'signup.connector.test',
            manifest_sha256: first.connectors[0].manifest_sha256,
            source_scope: 'bundled', content_available: false,
        }]);
        assert.match(first.connectors[0].manifest_sha256, /^[a-f0-9]{64}$/);
        const serialized = JSON.stringify(first);
        assert.doesNotMatch(serialized, /synthetic-secret-value|\/Users\/|Authorization|commandCandidates|private-note|Raw instructions|raw transcript/i);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('unsafe approved metadata is omitted with reason codes and never reflected', () => {
    const root = fixtureRoot();
    try {
        mkdirSync(join(root, 'skills', 'unsafe-skill'), { recursive: true });
        writeFileSync(join(root, 'skills', 'unsafe-skill', 'SKILL.md'), [
            '---', 'name: unsafe-skill', 'category: operations',
            'summary: API_KEY=synthetic-should-not-escape',
            'description: bounded description', '---', '', '# body',
        ].join('\n'));
        const inventory = buildCommonsInventory({ root });
        assert.equal(inventory.skills.some((skill) => skill.name === 'unsafe-skill'), false);
        assert.deepEqual(inventory.rejected, [{ type: 'skill', name: 'unsafe-skill', reason_code: 'credential' }]);
        assert.doesNotMatch(JSON.stringify(inventory), /synthetic-should-not-escape/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('connectors without a signup URL publish an explicit null host instead of disappearing', () => {
    const root = fixtureRoot();
    try {
        writeFileSync(join(root, 'agent', 'connectors.json'), JSON.stringify({
            connectors: [{
                name: 'local-connector', summary: 'bounded local connector', transport: 'stdio',
                requires: [], signup: null, commandCandidates: ['/private/local/tool'],
            }],
        }));
        const inventory = buildCommonsInventory({ root });
        assert.equal(inventory.connectors.length, 1);
        assert.equal(inventory.connectors[0].signup_host, null);
        assert.equal(inventory.connectors[0].content_available, false);
        assert.doesNotMatch(JSON.stringify(inventory), /private\/local/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('delta/upsert state is opt-in, 0600, and advances only after a typed receipt', () => {
    const root = fixtureRoot();
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-inventory-home-'));
    try {
        const inventory = buildCommonsInventory({ root });
        saveCommonsSettings({ home, serviceUrl: 'https://commons.test', autoPublishInventory: false });
        assert.deepEqual(prepareInventoryDelta({ home, inventory }), {
            enabled: false, hash: inventory.hash, upserts: [], removals: [],
        });

        saveCommonsSettings({ home, serviceUrl: 'https://commons.test', autoPublishInventory: true });
        const delta = prepareInventoryDelta({ home, inventory });
        assert.equal(delta.enabled, true);
        assert.equal(delta.upserts.length, 2);
        assert.deepEqual(delta.removals, []);
        recordInventorySync({
            home, inventory, receipt: { accepted: true, hash: inventory.hash }, syncedAt: 1785900000000,
        });
        assert.equal(statSync(inventoryStatePath(home)).mode & 0o777, 0o600);
        assert.deepEqual(prepareInventoryDelta({ home, inventory }), {
            enabled: true, hash: inventory.hash, upserts: [], removals: [],
        });
        assert.throws(
            () => recordInventorySync({
                home, inventory, receipt: { accepted: true, hash: '0'.repeat(64) }, syncedAt: 1785900001000,
            }),
            /receipt/i,
        );

        rmSync(join(root, 'skills', 'safe-skill'), { recursive: true, force: true });
        const withoutSkill = buildCommonsInventory({ root });
        const deletionDelta = prepareInventoryDelta({ home, inventory: withoutSkill });
        assert.deepEqual(deletionDelta.removals, []);
        const tombstone = deletionDelta.upserts.find((item) => item.type === 'skill');
        assert.equal(tombstone.available, false);
        assert.equal(tombstone.metadata.name, 'safe-skill');
        assert.equal(tombstone.metadata.summary, inventory.skills[0].summary);
        assert.equal(tombstone.metadata.source_scope, inventory.skills[0].source_scope);
        assert.equal(tombstone.metadata.manifest_sha256, inventory.skills[0].manifest_sha256);
        assert.equal(tombstone.metadata.content_available, false);
    } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(home, { recursive: true, force: true });
    }
});
