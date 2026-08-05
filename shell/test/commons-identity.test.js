import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { enrollDevice, identityPath, loadIdentity } from '../src/commons/identity.js';

test('enrollment creates a local Ed25519 identity without transmitting its private key', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-identity-'));
    let posted;
    try {
        const identity = await enrollDevice({
            home,
            enrollmentToken: 'one-time-test-code',
            label: 'test mac',
            enroll: async (body) => {
                posted = body;
                return {
                    network_id: 'network-test', device_id: 'device-test',
                    agent_id: 'agent-test', owner_display_name: 'Test Owner',
                    protocol: 'SHERMAN-COMMONS-V2',
                };
            },
        });

        assert.equal(posted.enrollment_token, 'one-time-test-code');
        assert.match(posted.public_key, /^-----BEGIN PUBLIC KEY-----/);
        assert.equal(Object.hasOwn(posted, 'private_key'), false);
        assert.equal(Object.hasOwn(posted, 'privateKey'), false);
        assert.equal(identity.deviceId, 'device-test');
        assert.match(identity.privateKey, /^-----BEGIN PRIVATE KEY-----/);
        assert.equal(statSync(identityPath(home)).mode & 0o777, 0o600);
        assert.deepEqual(loadIdentity(home), identity);
        assert.doesNotMatch(readFileSync(identityPath(home), 'utf8'), /one-time-test-code/);
        chmodSync(identityPath(home), 0o644);
        assert.throws(() => loadIdentity(home), /permissions/);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('a malformed identity is rejected rather than treated as unenrolled', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-bad-identity-'));
    try {
        mkdirSync(join(home, '.sherman', 'commons'), { recursive: true });
        writeFileSync(identityPath(home), '{broken', { mode: 0o600 });
        assert.throws(() => loadIdentity(home), /unreadable or invalid/);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('an invalid enrollment response is not persisted as an identity', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-invalid-response-'));
    try {
        await assert.rejects(() => enrollDevice({
            home,
            enrollmentToken: 'one-time-test-code',
            label: 'test mac',
            enroll: async () => ({ network_id: 'network-test' }),
        }), /invalid enrollment response/);
        assert.equal(loadIdentity(home), null);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});
