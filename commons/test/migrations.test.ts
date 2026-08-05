import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationPaths = [
  join(root, 'migrations', '0001_initial.sql'),
  join(root, 'migrations', '0002_api_security.sql'),
  join(root, 'migrations', '0003_human_mutation_quotas.sql'),
  join(root, 'migrations', '0004_artifact_delivery.sql'),
  join(root, 'migrations', '0005_inventory.sql'),
];
const expectedTables = [
  'agents', 'artifact_publications', 'artifact_publisher_keys', 'artifact_quarantine_bytes', 'artifact_scan_results',
  'artifact_versions', 'artifacts', 'audit_events', 'device_inventory_items', 'device_inventory_state', 'devices',
  'endorsements', 'enrollment_tokens', 'human_mutation_quotas', 'idempotency_keys', 'issue_clusters', 'moderation_events',
  'networks', 'organizations', 'post_artifact_publications', 'post_relations', 'posts', 'used_nonces', 'users',
];

function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const migrationPath of migrationPaths) db.exec(readFileSync(migrationPath, 'utf8'));
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
    expect(uniqueIndexColumns(db, 'users')).toContainEqual(['network_id', 'access_subject']);
    expect(uniqueIndexColumns(db, 'devices')).toContainEqual(['public_key']);
    expect(uniqueIndexColumns(db, 'endorsements')).toContainEqual(['post_id', 'owner_user_id']);
    expect(uniqueIndexColumns(db, 'endorsements')).toContainEqual(['network_id', 'issue_cluster_id', 'owner_user_id']);
    expect(uniqueIndexColumns(db, 'used_nonces')).toContainEqual(['device_id', 'nonce']);
    expect(uniqueIndexColumns(db, 'artifacts')).toContainEqual(['publisher_agent_id', 'name']);
    expect(uniqueIndexColumns(db, 'artifact_versions')).toContainEqual(['artifact_id', 'version']);
    expect(uniqueIndexColumns(db, 'artifact_publications')).toContainEqual(['network_id', 'publisher_key_id', 'name', 'version']);
    db.close();
  });

  it('upgrades Access identity without weakening network-scoped issue keys', () => {
    const db = migratedDatabase();
    const userColumns = (db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map((row) => row.name);
    expect(userColumns).toContain('access_subject');
    db.exec(`
      INSERT INTO networks VALUES ('net-scoped', 'Scoped', 1), ('net-other', 'Other', 1);
      INSERT INTO issue_clusters (id, network_id, issue_key, title, created_at) VALUES
        ('issue-one', 'net-scoped', 'same-key', 'One', 1),
        ('issue-other', 'net-other', 'same-key', 'Other network', 1);
    `);
    expect(() => db.exec(`INSERT INTO issue_clusters (id, network_id, issue_key, title, created_at)
      VALUES ('issue-two', 'net-scoped', 'same-key', 'Two', 2)`)).toThrow(/UNIQUE/);
    db.close();
  });

  it('applies the forward API migration transactionally with existing referencing posts', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(readFileSync(migrationPaths[0], 'utf8'));
    db.exec(`
      INSERT INTO networks VALUES ('net-a', 'A', 1);
      INSERT INTO users (id, network_id, normalized_email, display_name, role, created_at)
        VALUES ('owner-a', 'net-a', 'a@example.test', 'A', 'member', 1);
      INSERT INTO agents (id, network_id, owner_user_id, display_name, created_at)
        VALUES ('agent-a', 'net-a', 'owner-a', 'Agent A', 1);
      INSERT INTO devices (id, network_id, owner_user_id, agent_id, public_key, label, enrolled_at)
        VALUES ('device-a', 'net-a', 'owner-a', 'agent-a', 'public-a', 'A', 1);
      INSERT INTO issue_clusters (id, network_id, issue_key, title, created_at)
        VALUES ('issue-a', 'net-a', 'issue-a', 'Issue A', 1);
      INSERT INTO posts (id, network_id, agent_id, owner_user_id, device_id, kind, title, body,
        authorship_mode, visibility, issue_cluster_id, created_at, updated_at)
        VALUES ('post-a', 'net-a', 'agent-a', 'owner-a', 'device-a', 'observation', 'A', 'A',
        'owner_requested', 'network', 'issue-a', 1, 1);
      BEGIN IMMEDIATE;
    `);
    expect(() => {
      db.exec(readFileSync(migrationPaths[1], 'utf8'));
      db.exec('COMMIT');
    }).not.toThrow();
    expect(db.prepare("SELECT issue_cluster_id FROM posts WHERE id = 'post-a'").get())
      .toEqual({ issue_cluster_id: 'issue-a' });
    db.close();
  });

  it('migrates duplicate active issue endorsements by retaining only the newest owner endorsement', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(migrationPaths[0], 'utf8'));
    db.exec(`
      INSERT INTO networks VALUES ('net-a', 'A', 1);
      INSERT INTO users (id, network_id, normalized_email, display_name, role, created_at)
        VALUES ('owner-a', 'net-a', 'a@example.test', 'A', 'member', 1);
      INSERT INTO agents (id, network_id, owner_user_id, display_name, created_at)
        VALUES ('agent-a', 'net-a', 'owner-a', 'Agent A', 1);
      INSERT INTO devices (id, network_id, owner_user_id, agent_id, public_key, label, enrolled_at)
        VALUES ('device-a', 'net-a', 'owner-a', 'agent-a', 'public-a', 'A', 1);
      INSERT INTO issue_clusters (id, network_id, issue_key, title, created_at)
        VALUES ('issue-a', 'net-a', 'issue-a', 'Issue A', 1);
      INSERT INTO posts (id, network_id, agent_id, owner_user_id, device_id, kind, title, body, authorship_mode, visibility, issue_cluster_id, created_at, updated_at)
        VALUES
          ('post-old', 'net-a', 'agent-a', 'owner-a', 'device-a', 'observation', 'Old', 'Old', 'owner_requested', 'network', 'issue-a', 1, 1),
          ('post-new', 'net-a', 'agent-a', 'owner-a', 'device-a', 'observation', 'New', 'New', 'owner_requested', 'network', 'issue-a', 2, 2);
      INSERT INTO endorsements (id, network_id, post_id, owner_user_id, agent_id, device_id, created_at)
        VALUES
          ('endorsement-old', 'net-a', 'post-old', 'owner-a', 'agent-a', 'device-a', 1),
          ('endorsement-new', 'net-a', 'post-new', 'owner-a', 'agent-a', 'device-a', 2);
    `);
    db.exec(readFileSync(migrationPaths[1], 'utf8'));
    expect(db.prepare("SELECT id FROM endorsements WHERE withdrawn_at IS NULL").all()).toEqual([{ id: 'endorsement-new' }]);
    expect(db.prepare("SELECT withdrawn_at FROM endorsements WHERE id = 'endorsement-old'").get()).toMatchObject({ withdrawn_at: 1 });
    expect(() => db.exec("UPDATE endorsements SET withdrawn_at = NULL WHERE id = 'endorsement-old'")).toThrow(/UNIQUE/);
    expect(() => db.exec("UPDATE endorsements SET issue_cluster_id = NULL WHERE id = 'endorsement-new'")).toThrow(/endorsement_issue_mismatch/);
    expect(() => db.exec("UPDATE endorsements SET issue_cluster_id = 'bogus' WHERE id = 'endorsement-new'")).toThrow(/endorsement_issue_mismatch/);
    db.close();
  });

  it('applies artifact delivery as a forward-only migration over the committed schema', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const path of migrationPaths.slice(0, 3)) db.exec(readFileSync(path, 'utf8'));
    db.exec(`INSERT INTO networks VALUES ('net-a', 'A', 1);
      INSERT INTO users (id, network_id, normalized_email, display_name, role, created_at)
        VALUES ('owner-a', 'net-a', 'a@example.test', 'A', 'member', 1);
      INSERT INTO agents (id, network_id, owner_user_id, display_name, created_at)
        VALUES ('agent-a', 'net-a', 'owner-a', 'A', 1);
      INSERT INTO devices (id, network_id, owner_user_id, agent_id, public_key, label, enrolled_at)
        VALUES ('device-a', 'net-a', 'owner-a', 'agent-a', 'public-a', 'A', 1);`);
    expect(() => db.exec(readFileSync(migrationPaths[3], 'utf8'))).not.toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='artifact_publications'").get()).toEqual({ name: 'artifact_publications' });
    db.close();
  });

  it('stores no private keys, bearer tokens, connector values, or raw transcripts', () => {
    const sql = migrationPaths.map((migrationPath) => readFileSync(migrationPath, 'utf8')).join('\n').toLowerCase();
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
