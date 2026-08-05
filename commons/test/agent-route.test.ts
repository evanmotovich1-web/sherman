import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import app from '../src/index';
import { canonicalRequest } from '../src/auth/device-signature';
import { SqliteD1Adapter } from './helpers/sqlite-d1';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(join(root, 'migrations', '0001_initial.sql'), 'utf8');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function fixture(): SqliteD1Adapter {
  const adapter = new SqliteD1Adapter();
  adapter.database.exec(migration);
  const insert = adapter.database.prepare.bind(adapter.database);
  insert('INSERT INTO networks VALUES (?, ?, ?)').run('network-test', 'Test', 1);
  insert(`INSERT INTO users (id, network_id, normalized_email, display_name, role, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`).run('owner-test', 'network-test', 'owner@example.test', 'Owner', 'member', 1);
  insert(`INSERT INTO agents (id, network_id, owner_user_id, display_name, created_at)
          VALUES (?, ?, ?, ?, ?)`).run('agent-test', 'network-test', 'owner-test', 'Agent', 1);
  insert(`INSERT INTO devices (id, network_id, owner_user_id, agent_id, public_key, label, enrolled_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    'device-test', 'network-test', 'owner-test', 'agent-test', publicPem, 'test', 1,
  );
  return adapter;
}

async function signedHeartbeat(idempotencyKey: string, nonce = 'nonce-heartbeat') {
  const timestamp = Math.floor(Date.now() / 1000);
  const input = {
    method: 'POST', url: 'https://commons.test/agent/v1/heartbeat', body: '',
    contentType: 'application/json', audience: 'https://commons.test', networkId: 'network-test',
    deviceId: 'device-test', timestamp, nonce, idempotencyKey,
  };
  const signature = sign(null, Buffer.from(await canonicalRequest(input)), privateKey).toString('base64');
  return { url: input.url, init: {
    method: input.method,
    headers: {
      'content-type': input.contentType,
      'x-sherman-protocol': 'SHERMAN-COMMONS-V2',
      'x-sherman-device': input.deviceId,
      'x-sherman-network': input.networkId,
      'x-sherman-timestamp': String(timestamp),
      'x-sherman-nonce': nonce,
      'x-sherman-idempotency-key': idempotencyKey,
      'x-sherman-signature': signature,
    },
  } satisfies RequestInit };
}

const bindings = (adapter: SqliteD1Adapter) => ({
  DB: adapter as unknown as D1Database,
  NETWORK_ID: 'network-test',
  API_AUDIENCE: 'https://commons.test',
});

describe('signed agent heartbeat', () => {
  it('atomically records one mutation and returns the prior result for an exact retry', async () => {
    const adapter = fixture();
    const firstRequest = await signedHeartbeat('heartbeat-1');
    const first = await app.request(firstRequest.url, firstRequest.init, bindings(adapter));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, replayed: false });

    const exactRetry = await app.request(firstRequest.url, firstRequest.init, bindings(adapter));
    expect(exactRetry.status).toBe(200);
    expect(await exactRetry.json()).toEqual({ ok: true, replayed: true });
    expect(adapter.database.prepare('SELECT COUNT(*) AS count FROM used_nonces').get()).toMatchObject({ count: 1 });
    adapter.database.close();
  });

  it('rejects nonce reuse under a different idempotency key', async () => {
    const adapter = fixture();
    const firstRequest = await signedHeartbeat('heartbeat-1');
    await app.request(firstRequest.url, firstRequest.init, bindings(adapter));
    const replayRequest = await signedHeartbeat('heartbeat-2');
    const replay = await app.request(replayRequest.url, replayRequest.init, bindings(adapter));
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: 'replay_detected' });
    adapter.database.close();
  });
});
