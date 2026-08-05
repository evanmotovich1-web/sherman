import { Hono } from 'hono';

import { auditStatement } from '../audit';
import { D1MutationExecutor, MutationGuardError } from '../auth/mutation-guard';
import { requireDatabase } from '../db';
import type { AppEnv } from '../env';
import { checkContent } from '../safety/content-gate';

const routes = new Hono<AppEnv>();
const MAX_BODY_BYTES = 128 * 1024;
const MAX_ITEMS = 700;
const HEX = /^[a-f0-9]{64}$/;
const NAME = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;

type Json = Record<string, unknown>;
type InventoryItem = {
  type: 'skill' | 'connector';
  hash: string;
  metadata: Json;
  available: boolean;
  metadataJson: string;
};

class InventoryInputError extends Error {
  constructor(readonly tooLarge = false) {
    super('invalid_inventory');
  }
}

function exact(value: unknown, keys: string[]): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function safeString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && !/[\r\n]/.test(value) && checkContent(value).allowed;
}

function skillMetadata(value: unknown): Json | null {
  const keys = ['name', 'category', 'summary', 'description', 'manifest_sha256', 'source_scope', 'content_available'];
  if (!exact(value, keys) || !NAME.test(String(value.name))
    || !safeString(value.category, 80) || !safeString(value.summary, 240) || !safeString(value.description, 500)
    || !HEX.test(String(value.manifest_sha256)) || !['bundled', 'personal'].includes(String(value.source_scope))
    || value.content_available !== false) return null;
  return {
    name: value.name,
    category: value.category,
    summary: value.summary,
    description: value.description,
    manifest_sha256: value.manifest_sha256,
    source_scope: value.source_scope,
    content_available: false,
  };
}

function connectorMetadata(value: unknown): Json | null {
  const keys = ['name', 'summary', 'transport', 'requires', 'signup_host', 'source_scope', 'content_available', 'manifest_sha256'];
  if (!exact(value, keys) || !NAME.test(String(value.name)) || !safeString(value.summary, 240)
    || !['stdio', 'http'].includes(String(value.transport)) || !Array.isArray(value.requires) || value.requires.length > 50
    || value.requires.some((name) => typeof name !== 'string' || !SECRET_NAME.test(name))
    || new Set(value.requires).size !== value.requires.length
    || JSON.stringify(value.requires) !== JSON.stringify([...value.requires].sort())
    || (value.signup_host !== null && (typeof value.signup_host !== 'string' || !HOST.test(value.signup_host)))
    || !['bundled', 'personal'].includes(String(value.source_scope)) || value.content_available !== false
    || !HEX.test(String(value.manifest_sha256))) return null;
  return {
    name: value.name,
    summary: value.summary,
    transport: value.transport,
    requires: value.requires,
    signup_host: value.signup_host,
    source_scope: value.source_scope,
    content_available: false,
    manifest_sha256: value.manifest_sha256,
  };
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function parseItem(value: unknown): Promise<InventoryItem> {
  const active = exact(value, ['type', 'hash', 'metadata']);
  const tombstone = exact(value, ['type', 'hash', 'metadata', 'available']) && value.available === false;
  if ((!active && !tombstone) || !['skill', 'connector'].includes(String(value.type)) || !HEX.test(String(value.hash))) {
    throw new InventoryInputError();
  }
  const type = value.type as 'skill' | 'connector';
  const metadata = type === 'skill' ? skillMetadata(value.metadata) : connectorMetadata(value.metadata);
  if (!metadata) throw new InventoryInputError();
  const available = active;
  const canonical = available ? { type, metadata } : { type, metadata, available: false };
  if (await sha256(JSON.stringify(canonical)) !== value.hash) throw new InventoryInputError();
  const metadataJson = JSON.stringify(metadata);
  if (new TextEncoder().encode(metadataJson).byteLength > 4096) throw new InventoryInputError();
  return { type, hash: value.hash as string, metadata, available, metadataJson };
}

async function parseInventory(raw: string): Promise<{ hash: string; items: InventoryItem[] }> {
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new InventoryInputError(true);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new InventoryInputError(); }
  if (!exact(value, ['hash', 'upserts', 'removals']) || !HEX.test(String(value.hash))
    || !Array.isArray(value.upserts) || value.upserts.length === 0 || value.upserts.length > MAX_ITEMS
    || !Array.isArray(value.removals) || value.removals.length !== 0) throw new InventoryInputError();
  const items = await Promise.all(value.upserts.map(parseItem));
  const identities = new Set(items.map((item) => `${item.type}\0${String(item.metadata.name)}`));
  if (identities.size !== items.length) throw new InventoryInputError();
  return { hash: value.hash as string, items };
}

routes.post('/device/v1/inventory', async (context) => {
  const database = requireDatabase(context.env.DB);
  const actor = context.get('agent');
  let inventory: { hash: string; items: InventoryItem[] };
  try {
    inventory = await parseInventory(await context.req.text());
  } catch (error) {
    const tooLarge = error instanceof InventoryInputError && error.tooLarge;
    return context.json({ error: tooLarge ? 'request_too_large' : 'invalid_request' }, tooLarge ? 413 : 400);
  }

  const executor = new D1MutationExecutor(database);
  try {
    const replay = await executor.replay(actor);
    if (replay) return context.json({ accepted: true, hash: replay.resultId });
  } catch (error) {
    if (error instanceof MutationGuardError) return context.json({ error: error.code }, 409);
    throw error;
  }

  const now = Math.floor(Date.now() / 1000);
  const statements = inventory.items.map((item) => database.prepare(`INSERT INTO device_inventory_items
    (network_id, device_id, item_type, item_name, item_hash, metadata_json, available, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(network_id, device_id, item_type, item_name) DO UPDATE SET
      item_hash = excluded.item_hash, metadata_json = excluded.metadata_json,
      available = excluded.available, updated_at = excluded.updated_at`)
    .bind(actor.networkId, actor.deviceId, item.type, item.metadata.name, item.hash, item.metadataJson, item.available ? 1 : 0, now));
  statements.push(database.prepare(`INSERT INTO device_inventory_state
    (network_id, device_id, inventory_hash, synced_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(network_id, device_id) DO UPDATE SET
      inventory_hash = excluded.inventory_hash, synced_at = excluded.synced_at`)
    .bind(actor.networkId, actor.deviceId, inventory.hash, now));
  statements.push(auditStatement(database, {
    networkId: actor.networkId,
    organizationId: actor.organizationId,
    actorType: 'agent',
    actorId: actor.agentId,
    action: 'inventory.sync',
    targetType: 'device',
    targetId: actor.deviceId,
    result: 'allowed',
    reasonCode: 'metadata_only',
    createdAt: now,
  }));

  try {
    const result = await executor.execute(actor, statements, { type: 'inventory', id: inventory.hash });
    return context.json({ accepted: true, hash: result.resultId });
  } catch (error) {
    if (error instanceof MutationGuardError) {
      return context.json({ error: error.code }, error.code === 'mutation_failed' ? 503 : 409);
    }
    throw error;
  }
});

export default routes;
