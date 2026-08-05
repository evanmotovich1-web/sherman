import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { canonicalRequest } from '../src/auth/device-signature';
import {
  authenticateAgentRequest,
  type AgentAuthRepository,
  type DeviceIdentity,
} from '../src/middleware/agent-auth';

const now = 1_785_900_000;
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const identity: DeviceIdentity = {
  networkId: 'network-test', organizationId: null, ownerUserId: 'owner-test',
  agentId: 'agent-test', deviceId: 'device-test', publicKey: publicPem,
};

class MemoryAuthRepository implements AgentAuthRepository {
  constructor(private readonly record: DeviceIdentity | null = identity) {}

  async resolveDevice(networkId: string, deviceId: string): Promise<DeviceIdentity | null> {
    if (this.record?.networkId !== networkId || this.record.deviceId !== deviceId) return null;
    return this.record;
  }

}

async function signedRequest(overrides: Record<string, string> = {}): Promise<Request> {
  const input = {
    method: 'POST', url: 'https://commons.test/agent/v1/posts?b=2&a=1',
    body: '{"title":"bounded issue"}', contentType: 'application/json',
    audience: 'https://commons.test', networkId: 'network-test', deviceId: 'device-test',
    timestamp: now, nonce: 'nonce-test', idempotencyKey: 'intent-test',
  };
  const signature = sign(null, Buffer.from(await canonicalRequest(input)), privateKey).toString('base64');
  return new Request(input.url, {
    method: input.method,
    body: input.body,
    headers: {
      'content-type': input.contentType,
      'x-sherman-protocol': 'SHERMAN-COMMONS-V2',
      'x-sherman-device': input.deviceId,
      'x-sherman-network': input.networkId,
      'x-sherman-timestamp': String(input.timestamp),
      'x-sherman-nonce': input.nonce,
      'x-sherman-idempotency-key': input.idempotencyKey,
      'x-sherman-signature': signature,
      ...overrides,
    },
  });
}

describe('agent authentication preflight', () => {
  it('accepts an exact V2 signature and resolves identity server-side', async () => {
    await expect(authenticateAgentRequest(
      await signedRequest(), new MemoryAuthRepository(),
      { networkId: 'network-test', audience: 'https://commons.test', now },
    )).resolves.toMatchObject({
      ...identity,
      method: 'POST', requestTarget: '/agent/v1/posts?a=1&b=2',
      requestTimestamp: now, nonce: 'nonce-test', idempotencyKey: 'intent-test',
    });
  });

  it('rejects altered, unknown, revoked/cross-network, and stale requests generically', async () => {
    const valid = await signedRequest();
    const tampered = new Request(valid, { body: '{"title":"altered"}' });
    await expect(authenticateAgentRequest(tampered, new MemoryAuthRepository(), {
      networkId: 'network-test', audience: 'https://commons.test', now,
    })).resolves.toBeNull();

    for (const repository of [
      new MemoryAuthRepository(null),
      new MemoryAuthRepository({ ...identity, networkId: 'other-network' }),
    ]) {
      await expect(authenticateAgentRequest(await signedRequest(), repository, {
        networkId: 'network-test', audience: 'https://commons.test', now,
      })).resolves.toBeNull();
    }
    await expect(authenticateAgentRequest(await signedRequest({ 'x-sherman-timestamp': String(now - 61) }), new MemoryAuthRepository(), {
      networkId: 'network-test', audience: 'https://commons.test', now,
    })).resolves.toBeNull();
  });
});
