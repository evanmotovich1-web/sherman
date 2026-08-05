import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { D1MutationExecutor } from '../src/auth/mutation-guard';
import type { CommonsDatabase } from '../src/db';
import type { AuthenticatedAgent } from '../src/middleware/agent-auth';
import { SqliteD1Adapter } from './helpers/sqlite-d1';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(join(root, 'migrations', '0001_initial.sql'), 'utf8');

function fixture() {
  const adapter = new SqliteD1Adapter();
  adapter.database.exec(migration);
  adapter.database.exec(`
    INSERT INTO networks VALUES ('network-test', 'Test', 1);
    INSERT INTO users (id, network_id, normalized_email, display_name, role, created_at)
      VALUES ('owner-test', 'network-test', 'owner@example.test', 'Owner', 'member', 1);
    INSERT INTO agents (id, network_id, owner_user_id, display_name, created_at)
      VALUES ('agent-test', 'network-test', 'owner-test', 'Agent', 1);
    INSERT INTO devices (id, network_id, owner_user_id, agent_id, public_key, label, enrolled_at)
      VALUES ('device-test', 'network-test', 'owner-test', 'agent-test', 'public-key', 'test', 1);
  `);
  const auth: AuthenticatedAgent = {
    networkId: 'network-test', organizationId: null, ownerUserId: 'owner-test',
    agentId: 'agent-test', deviceId: 'device-test', publicKey: 'public-key',
    method: 'POST', requestTarget: '/agent/v1/posts', bodySha256: 'digest-a',
    requestTimestamp: 1_785_900_000, nonce: 'nonce-a', idempotencyKey: 'request-a',
  };
  return { adapter, auth };
}

function auditInsert(adapter: SqliteD1Adapter, id: string) {
  return adapter.prepare(`
    INSERT INTO audit_events (
      id, network_id, actor_type, actor_id, action, target_type, target_id, result, created_at
    ) VALUES (?, 'network-test', 'agent', 'agent-test', 'post.create', 'post', ?, 'allowed', 1785900000)
  `).bind(`audit-${id}`, id) as unknown as D1PreparedStatement;
}

describe('atomic mutation replay and idempotency guard', () => {
  it('commits nonce, idempotency result, and mutation once, then replays the exact result', async () => {
    const { adapter, auth } = fixture();
    const executor = new D1MutationExecutor(adapter as unknown as CommonsDatabase, () => 1_785_900_000);
    await expect(executor.execute(auth, auditInsert(adapter, 'post-a'), { type: 'post', id: 'post-a' })).resolves.toEqual({
      replayed: false, resultType: 'post', resultId: 'post-a',
    });
    await expect(executor.execute(auth, auditInsert(adapter, 'post-a'), { type: 'post', id: 'post-a' })).resolves.toEqual({
      replayed: true, resultType: 'post', resultId: 'post-a',
    });
    expect(adapter.database.prepare('SELECT COUNT(*) AS count FROM audit_events').get()).toMatchObject({ count: 1 });
    expect(adapter.database.prepare('SELECT COUNT(*) AS count FROM used_nonces').get()).toMatchObject({ count: 1 });
    adapter.database.close();
  });

  it('rejects changed requests under the same idempotency key and nonce replay under a new key', async () => {
    const { adapter, auth } = fixture();
    const executor = new D1MutationExecutor(adapter as unknown as CommonsDatabase, () => 1_785_900_000);
    await executor.execute(auth, auditInsert(adapter, 'post-a'), { type: 'post', id: 'post-a' });
    await expect(executor.execute(
      { ...auth, bodySha256: 'digest-b' }, auditInsert(adapter, 'post-b'), { type: 'post', id: 'post-b' },
    )).rejects.toMatchObject({ code: 'idempotency_conflict' });
    await expect(executor.execute(
      { ...auth, idempotencyKey: 'request-b' }, auditInsert(adapter, 'post-b'), { type: 'post', id: 'post-b' },
    )).rejects.toMatchObject({ code: 'replay_detected' });
    expect(adapter.database.prepare('SELECT COUNT(*) AS count FROM audit_events').get()).toMatchObject({ count: 1 });
    adapter.database.close();
  });

  it('rolls back replay records when the mutation fails', async () => {
    const { adapter, auth } = fixture();
    const executor = new D1MutationExecutor(adapter as unknown as CommonsDatabase, () => 1_785_900_000);
    const invalid = adapter.prepare('INSERT INTO missing_table VALUES (1)') as unknown as D1PreparedStatement;
    await expect(executor.execute(auth, invalid, { type: 'post', id: 'post-a' }))
      .rejects.toMatchObject({ code: 'mutation_failed' });
    expect(adapter.database.prepare('SELECT COUNT(*) AS count FROM used_nonces').get()).toMatchObject({ count: 0 });
    expect(adapter.database.prepare('SELECT COUNT(*) AS count FROM idempotency_keys').get()).toMatchObject({ count: 0 });
    adapter.database.close();
  });
});
