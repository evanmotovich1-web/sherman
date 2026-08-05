import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { canonicalRequest } from '../src/auth/device-signature';
import type { AppEnv } from '../src/env';
import workerApp from '../src/index';
import { agentAuth } from '../src/middleware/agent-auth';
import inventoryRoutes from '../src/routes/inventory';
import { SqliteD1Adapter } from './helpers/sqlite-d1';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrations = [
  '0001_initial.sql', '0002_api_security.sql', '0003_human_mutation_quotas.sql',
  '0004_artifact_delivery.sql', '0005_inventory.sql',
].map((name) => readFileSync(join(root, 'migrations', name), 'utf8')).join('\n');
const keyPairs = new Map<string, ReturnType<typeof generateKeyPairSync>>();
const app = new Hono<AppEnv>();
app.use('/device/v1/*', agentAuth);
app.route('/', inventoryRoutes);

function fixture(): SqliteD1Adapter {
  const db = new SqliteD1Adapter();
  db.database.exec(migrations);
  db.database.prepare('INSERT INTO networks VALUES (?, ?, ?)').run('network-test', 'Test', 1);
  for (const owner of ['owner-1', 'owner-2']) {
    const pair = generateKeyPairSync('ed25519');
    keyPairs.set(owner, pair);
    db.database.prepare(`INSERT INTO users
      (id, network_id, normalized_email, access_subject, display_name, role, created_at)
      VALUES (?, 'network-test', ?, ?, ?, 'member', 1)`)
      .run(owner, `${owner}@example.test`, owner, owner);
    db.database.prepare(`INSERT INTO agents
      (id, network_id, owner_user_id, display_name, created_at)
      VALUES (?, 'network-test', ?, ?, 1)`).run(`agent-${owner}`, owner, owner);
    db.database.prepare(`INSERT INTO devices
      (id, network_id, owner_user_id, agent_id, public_key, label, enrolled_at)
      VALUES (?, 'network-test', ?, ?, ?, 'test', 1)`)
      .run(`device-${owner}`, owner, `agent-${owner}`, pair.publicKey.export({ type: 'spki', format: 'pem' }).toString());
  }
  return db;
}

const env = (db: SqliteD1Adapter) => ({
  DB: db as unknown as D1Database,
  NETWORK_ID: 'network-test',
  API_AUDIENCE: 'https://commons.test',
});

async function signedInventory(owner: string, body: unknown, idempotencyKey = crypto.randomUUID()) {
  const text = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const input = {
    method: 'POST', url: 'https://commons.test/device/v1/inventory', body: text,
    contentType: 'application/json', audience: 'https://commons.test', networkId: 'network-test',
    deviceId: `device-${owner}`, timestamp, nonce: crypto.randomUUID(), idempotencyKey,
  };
  const signature = sign(null, Buffer.from(await canonicalRequest(input)), keyPairs.get(owner)!.privateKey).toString('base64');
  return { url: input.url, init: {
    method: input.method,
    body: text,
    headers: {
      'content-type': input.contentType,
      'x-sherman-protocol': 'SHERMAN-COMMONS-V2',
      'x-sherman-device': input.deviceId,
      'x-sherman-network': input.networkId,
      'x-sherman-timestamp': String(timestamp),
      'x-sherman-nonce': input.nonce,
      'x-sherman-idempotency-key': idempotencyKey,
      'x-sherman-signature': signature,
    },
  } satisfies RequestInit };
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const skillMetadata = {
  name: 'safe-skill', category: 'operations', summary: 'Bounded metadata summary',
  description: 'Bounded metadata description', manifest_sha256: '1'.repeat(64),
  source_scope: 'bundled', content_available: false,
};
const connectorMetadata = {
  name: 'safe-connector', summary: 'Bounded connector summary', transport: 'stdio',
  requires: ['EXAMPLE_API_KEY'], signup_host: 'example.test', source_scope: 'personal',
  content_available: false, manifest_sha256: '2'.repeat(64),
};
const upsert = (type: 'skill' | 'connector', metadata: Record<string, unknown>) => ({
  type, hash: digest({ type, metadata }), metadata,
});

async function post(db: SqliteD1Adapter, owner: string, body: unknown) {
  const request = await signedInventory(owner, body);
  return app.request(request.url, request.init, env(db));
}

describe('signed device inventory', () => {
  it('is mounted on the production worker under the signed device boundary', async () => {
    const db = fixture();
    const body = { hash: 'a'.repeat(64), upserts: [upsert('skill', skillMetadata)], removals: [] };
    const request = await signedInventory('owner-1', body);
    const response = await workerApp.request(request.url, request.init, env(db));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, hash: body.hash });
    db.database.close();
  });

  it('stores only closed-world metadata under the authenticated network and device', async () => {
    const db = fixture();
    const body = {
      hash: 'a'.repeat(64),
      upserts: [upsert('skill', skillMetadata), upsert('connector', connectorMetadata)],
      removals: [],
    };
    const response = await post(db, 'owner-1', body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, hash: body.hash });

    const rows = db.database.prepare(`SELECT network_id, device_id, item_type, item_name, available, metadata_json
      FROM device_inventory_items ORDER BY item_type`).all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.map(({ network_id, device_id, item_type, item_name, available }) => (
      { network_id, device_id, item_type, item_name, available }
    ))).toEqual([
      { network_id: 'network-test', device_id: 'device-owner-1', item_type: 'connector', item_name: 'safe-connector', available: 1 },
      { network_id: 'network-test', device_id: 'device-owner-1', item_type: 'skill', item_name: 'safe-skill', available: 1 },
    ]);
    expect(rows.map((row) => JSON.parse(String(row.metadata_json)))).toEqual([connectorMetadata, skillMetadata]);
    expect(db.database.prepare('SELECT * FROM device_inventory_state').get()).toMatchObject({
      network_id: 'network-test', device_id: 'device-owner-1', inventory_hash: body.hash,
    });
    expect((db.database.prepare('PRAGMA table_info(device_inventory_items)').all() as Array<{ name: string }>)
      .map((column) => column.name)).not.toContain('agent_id');
    expect((await post(db, 'owner-1', body)).status).toBe(200);
    expect(db.database.prepare('SELECT COUNT(*) AS count FROM device_inventory_items').get()).toEqual({ count: 2 });
    db.database.close();
  });

  it('keeps device-scoped unavailable tombstones and returns an exact retry receipt', async () => {
    const db = fixture();
    const active = { hash: 'b'.repeat(64), upserts: [upsert('skill', skillMetadata)], removals: [] };
    expect((await post(db, 'owner-1', active)).status).toBe(200);

    const metadata = { ...skillMetadata, content_available: false };
    const item = { type: 'skill' as const, hash: digest({ type: 'skill', metadata, available: false }), metadata, available: false };
    const body = { hash: 'c'.repeat(64), upserts: [item], removals: [] };
    const request = await signedInventory('owner-1', body, '123e4567-e89b-42d3-a456-426614174000');
    const first = await app.request(request.url, request.init, env(db));
    const retry = await app.request(request.url, request.init, env(db));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ accepted: true, hash: body.hash });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ accepted: true, hash: body.hash });
    expect(db.database.prepare(`SELECT item_name, available, metadata_json FROM device_inventory_items
      WHERE network_id = 'network-test' AND device_id = 'device-owner-1'`).get()).toEqual({
      item_name: 'safe-skill', available: 0, metadata_json: JSON.stringify(metadata),
    });

    const other = { hash: 'd'.repeat(64), upserts: [upsert('skill', skillMetadata)], removals: [] };
    expect((await post(db, 'owner-2', other)).status).toBe(200);
    expect(db.database.prepare(`SELECT device_id, available FROM device_inventory_items
      WHERE item_type = 'skill' AND item_name = 'safe-skill' ORDER BY device_id`).all()).toEqual([
      { device_id: 'device-owner-1', available: 0 },
      { device_id: 'device-owner-2', available: 1 },
    ]);
    db.database.close();
  });

  it('rejects destructive removals, unsafe or non-canonical metadata, and oversized bodies', async () => {
    const db = fixture();
    const unsafe = { ...skillMetadata, summary: 'API_KEY=synthetic-secret' };
    for (const body of [
      { hash: 'e'.repeat(64), upserts: [], removals: [{ type: 'skill', name: 'safe-skill' }] },
      { hash: 'f'.repeat(64), upserts: [upsert('skill', unsafe)], removals: [] },
      { hash: '0'.repeat(64), upserts: [{ ...upsert('skill', skillMetadata), source: '/Users/private/skill' }], removals: [] },
    ]) {
      const response = await post(db, 'owner-1', body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_request' });
    }
    const oversized = await post(db, 'owner-1', {
      hash: '9'.repeat(64), upserts: [], removals: [], padding: 'x'.repeat(131_073),
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: 'request_too_large' });
    expect(db.database.prepare('SELECT COUNT(*) AS count FROM device_inventory_items').get()).toEqual({ count: 0 });
    expect((await app.request('https://commons.test/agent/v1/inventory', { method: 'POST' }, env(db))).status).toBe(404);
    db.database.close();
  });
});
