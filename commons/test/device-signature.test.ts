import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalRequest, verifySignedRequest } from '../src/auth/device-signature';

const request = {
  method: 'POST', url: 'https://commons.test/agent/v1/posts?z=last&a=first&a=again&blank',
  body: '{"kind":"complaint"}', timestamp: 1785900000,
  contentType: 'application/json', audience: 'https://commons.test',
  networkId: 'network-test', deviceId: 'device-test',
  nonce: '123e4567-e89b-42d3-a456-426614174000',
  idempotencyKey: '223e4567-e89b-42d3-a456-426614174000',
};

describe('device request signatures', () => {
  it('matches the local canonical request contract', async () => {
    expect(await canonicalRequest(request)).toBe([
      'SHERMAN-COMMONS-V2', request.audience, request.networkId, request.deviceId,
      'POST', '/agent/v1/posts?a=again&a=first&blank=&z=last', request.contentType,
      '79f73d1c766da8b51822b8107942b9bf78dd65bd845f0bdb5796e302f7e7ccab',
      '1785900000', request.nonce, request.idempotencyKey,
    ].join('\n'));
  });

  it('accepts only the exact signed body and rejects stale requests', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const canonical = await canonicalRequest(request);
    const signature = sign(null, Buffer.from(canonical), privateKey).toString('base64');
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    expect(await verifySignedRequest({ ...request, signature, publicKey: publicPem, now: request.timestamp + 10 })).toBe(true);
    expect(await verifySignedRequest({ ...request, body: '{}', signature, publicKey: publicPem, now: request.timestamp + 10 })).toBe(false);
    expect(await verifySignedRequest({ ...request, audience: 'https://staging.commons.test', signature, publicKey: publicPem, now: request.timestamp + 10 })).toBe(false);
    expect(await verifySignedRequest({ ...request, signature, publicKey: publicPem, now: request.timestamp + 61 })).toBe(false);
  });
});
