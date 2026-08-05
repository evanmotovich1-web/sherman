import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = join(root, 'migrations', '0001_initial.sql');
const expectedTables = [
  'agents', 'artifact_versions', 'artifacts', 'audit_events', 'devices',
  'endorsements', 'enrollment_tokens', 'idempotency_keys', 'issue_clusters', 'moderation_events',
  'networks', 'organizations', 'post_relations', 'posts', 'used_nonces', 'users',
];

function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(migrationPath, 'utf8'));
  return db;
}

function uniqueIndexColumns(db: DatabaseSync, table: string): string[][] {
  const indexes = db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string; unique: number }>;
  return indexes
    .filter((index) => index.unique === 1)
    .map((index) => (db.prepare(`PRAGMA index_info(${index.name})`).all() as Array<{ name: string }>).map((row) => row.name));
}

describe('initial D1 schema', () => {
  it('creates every identity, content, consensus, artifact, and audit table', () => {
    const db = migratedDatabase();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(expectedTables);
    db.close();
  });

  it('enforces the anti-impersonation and anti-sybil uniqueness boundaries', () => {
    const db = migratedDatabase();
    expect(uniqueIndexColumns(db, 'users')).toContainEqual(['network_id', 'normalized_email']);
    expect(uniqueIndexColumns(db, 'devices')).toContainEqual(['public_key']);
    expect(uniqueIndexColumns(db, 'endorsements')).toContainEqual(['post_id', 'owner_user_id']);
    expect(uniqueIndexColumns(db, 'used_nonces')).toContainEqual(['device_id', 'nonce']);
    expect(uniqueIndexColumns(db, 'artifacts')).toContainEqual(['publisher_agent_id', 'name']);
    expect(uniqueIndexColumns(db, 'artifact_versions')).toContainEqual(['artifact_id', 'version']);
    db.close();
  });

  it('stores no private keys, bearer tokens, connector values, or raw transcripts', () => {
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase();
    for (const forbidden of ['private_key', 'bearer_token', 'secret_value', 'raw_transcript', 'session_prompt']) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it('rejects cross-network foreign-key tuples at the database boundary', () => {
    const db = migratedDatabase();
    db.exec(`
      INSERT INTO networks VALUES ('net-a', 'A', 1), ('net-b', 'B', 1);
      INSERT INTO organizations (id, network_id, name, created_at) VALUES ('org-a', 'net-a', 'A', 1);
    `);
    expect(() => db.exec(`
      INSERT INTO users (id, network_id, organization_id, normalized_email, display_name, role, created_at)
      VALUES ('user-b', 'net-b', 'org-a', 'b@example.test', 'B', 'member', 1);
    `)).toThrow(/FOREIGN KEY/);
    db.close();
  });

  it('bounds nonce retention and request idempotency per device', () => {
    const db = migratedDatabase();
    const nonceColumns = (db.prepare('PRAGMA table_info(used_nonces)').all() as Array<{ name: string }>).map((row) => row.name);
    expect(nonceColumns).toContain('expires_at');
    expect(uniqueIndexColumns(db, 'idempotency_keys')).toContainEqual(['device_id', 'idempotency_key']);
    db.close();
  });

  it('rejects devices and posts whose owner, agent, and device attribution disagree', () => {
    const db = migratedDatabase();
    db.exec(`
      INSERT INTO networks VALUES ('net-a', 'A', 1);
      INSERT INTO users (id, network_id, normalized_email, display_name, role, created_at) VALUES
        ('owner-a', 'net-a', 'a@example.test', 'A', 'member', 1),
        ('owner-b', 'net-a', 'b@example.test', 'B', 'member', 1);
      INSERT INTO agents (id, network_id, owner_user_id, display_name, created_at) VALUES
        ('agent-a', 'net-a', 'owner-a', 'A agent', 1),
        ('agent-b', 'net-a', 'owner-b', 'B agent', 1);
    `);
    expect(() => db.exec(`
      INSERT INTO devices (id, network_id, owner_user_id, agent_id, public_key, label, enrolled_at)
      VALUES ('device-bad', 'net-a', 'owner-a', 'agent-b', 'public-key-bad', 'bad', 1);
    `)).toThrow(/FOREIGN KEY/);
    db.exec(`
      INSERT INTO devices (id, network_id, owner_user_id, agent_id, public_key, label, enrolled_at)
      VALUES ('device-a', 'net-a', 'owner-a', 'agent-a', 'public-key-a', 'good', 1);
    `);
    expect(() => db.exec(`
      INSERT INTO posts (
        id, network_id, agent_id, owner_user_id, device_id, kind, title, body,
        authorship_mode, visibility, created_at, updated_at
      ) VALUES (
        'post-bad', 'net-a', 'agent-b', 'owner-b', 'device-a', 'observation',
        'Mismatch', 'Mismatch', 'agent_observed', 'private', 1, 1
      );
    `)).toThrow(/FOREIGN KEY/);
    db.close();
  });
});
