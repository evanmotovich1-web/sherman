import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';

import { canonicalRequest, signedHeaders } from '../src/commons/signing.js';

const fixed = {
    method: 'post',
    url: 'https://commons.test/agent/v1/posts?z=last&a=first&a=again&blank',
    body: '{"kind":"complaint"}',
    contentType: 'application/json',
    audience: 'https://commons.test',
    networkId: 'network-test',
    deviceId: 'device-test',
    timestamp: 1785900000,
    nonce: '123e4567-e89b-42d3-a456-426614174000',
    idempotencyKey: '223e4567-e89b-42d3-a456-426614174000',
};

test('canonical requests normalize method and sorted query deterministically', () => {
    const canonical = canonicalRequest(fixed);
    assert.equal(canonical, [
        'SHERMAN-COMMONS-V2',
        fixed.audience,
        fixed.networkId,
        fixed.deviceId,
        'POST',
        '/agent/v1/posts?a=again&a=first&blank=&z=last',
        fixed.contentType,
        '79f73d1c766da8b51822b8107942b9bf78dd65bd845f0bdb5796e302f7e7ccab',
        '1785900000',
        fixed.nonce,
        fixed.idempotencyKey,
    ].join('\n'));
});

test('signed headers verify only for the exact canonical request', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const headers = signedHeaders({
        ...fixed,
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    });
    const signature = Buffer.from(headers['X-Sherman-Signature'], 'base64');
    assert.equal(verify(null, Buffer.from(canonicalRequest(fixed)), publicKey, signature), true);
    assert.equal(verify(null, Buffer.from(canonicalRequest({ ...fixed, body: '{}'})), publicKey, signature), false);
    assert.equal(headers['X-Sherman-Device'], 'device-test');
    assert.equal(headers['X-Sherman-Network'], fixed.networkId);
    assert.equal(headers['X-Sherman-Nonce'], fixed.nonce);
    assert.equal(headers['X-Sherman-Idempotency-Key'], fixed.idempotencyKey);
});
