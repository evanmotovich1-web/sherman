import { readFileSync } from 'node:fs';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import app from '../src/index';
import {
  EnrollmentService,
  hashEnrollmentToken,
  type EnrollmentRepository,
  type EnrollmentResult,
} from '../src/auth/enrollment';

class MemoryEnrollmentRepository implements EnrollmentRepository {
  private consumed = false;

  constructor(
    private readonly tokenHash: string,
    private readonly expiresAt: number,
    private readonly networkId = 'network-test',
  ) {}

  async consume(input: Parameters<EnrollmentRepository['consume']>[0]): Promise<EnrollmentResult | null> {
    if (
      this.consumed || input.tokenHash !== this.tokenHash ||
      input.networkId !== this.networkId || input.now >= this.expiresAt
    ) return null;
    this.consumed = true;
    return {
      networkId: this.networkId,
      deviceId: input.deviceId,
      agentId: 'agent-test',
      ownerDisplayName: 'Test Owner',
    };
  }
}

const enrollmentKeys = generateKeyPairSync('ed25519');
const enrollmentPublicKey = enrollmentKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const enrollmentToken = 'single-use-synthetic-token';
const enrollmentLabel = 'test mac';
const enrollmentProof = [
  'SHERMAN-COMMONS-ENROLL-V1',
  createHash('sha256').update(enrollmentToken).digest('hex'),
  createHash('sha256').update(enrollmentPublicKey).digest('hex'),
  enrollmentLabel,
].join('\n');

const request = {
  enrollment_token: enrollmentToken,
  public_key: enrollmentPublicKey,
  proof_signature: sign(null, Buffer.from(enrollmentProof), enrollmentKeys.privateKey).toString('base64'),
  label: enrollmentLabel,
};

class SqliteD1Statement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: SQLInputValue[] = [],
  ) {}

  bind(...values: SQLInputValue[]): SqliteD1Statement {
    return new SqliteD1Statement(this.database, this.sql, values);
  }

  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class SqliteD1Database {
  constructor(readonly database = new DatabaseSync(':memory:')) {}

  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this.database, sql);
  }

  async batch(statements: SqliteD1Statement[]): Promise<Array<{ meta: { changes: number } }>> {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

async function seededDatabase(networkId = 'network-test'): Promise<SqliteD1Database> {
  const adapter = new SqliteD1Database();
  adapter.database.exec('PRAGMA foreign_keys = ON');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  adapter.database.exec(readFileSync(join(root, 'migrations', '0001_initial.sql'), 'utf8'));
  const tokenHash = await hashEnrollmentToken(request.enrollment_token);
  adapter.database.prepare('INSERT INTO networks VALUES (?, ?, ?)').run(networkId, 'Test', 1);
  adapter.database.prepare(`
    INSERT INTO users (id, network_id, normalized_email, display_name, role, created_at)
    VALUES ('owner-test', ?, 'owner@example.test', 'Test Owner', 'member', 1)
  `).run(networkId);
  adapter.database.prepare(`
    INSERT INTO agents (id, network_id, owner_user_id, display_name, created_at)
    VALUES ('agent-test', ?, 'owner-test', 'Sherman for Test Owner', 1)
  `).run(networkId);
  adapter.database.prepare(`
    INSERT INTO enrollment_tokens (id, network_id, owner_user_id, agent_id, token_hash, expires_at, created_at)
    VALUES ('token-test', ?, 'owner-test', 'agent-test', ?, 4102444800, 1)
  `).run(networkId, tokenHash);
  return adapter;
}

describe('device enrollment', () => {
  it('hashes a one-time token and consumes it only once', async () => {
    const now = 1_785_900_000;
    const repository = new MemoryEnrollmentRepository(await hashEnrollmentToken(request.enrollment_token), now + 60);
    const service = new EnrollmentService(repository, 'network-test', () => now, () => 'device-test');

    await expect(service.enroll(request)).resolves.toEqual({
      network_id: 'network-test', device_id: 'device-test',
      agent_id: 'agent-test', owner_display_name: 'Test Owner',
      protocol: 'SHERMAN-COMMONS-V2',
    });
    await expect(service.enroll(request)).rejects.toMatchObject({ code: 'enrollment_unavailable' });
  });

  it('rejects expired and cross-network tokens with the same generic result', async () => {
    const now = 1_785_900_000;
    const hash = await hashEnrollmentToken(request.enrollment_token);
    for (const repository of [
      new MemoryEnrollmentRepository(hash, now),
      new MemoryEnrollmentRepository(hash, now + 60, 'other-network'),
    ]) {
      const service = new EnrollmentService(repository, 'network-test', () => now, () => 'device-test');
      await expect(service.enroll(request)).rejects.toMatchObject({ code: 'enrollment_unavailable' });
    }
  });

  it('uses a strict public-only request contract', async () => {
    const repository = new MemoryEnrollmentRepository(await hashEnrollmentToken(request.enrollment_token), 1_785_900_060);
    const service = new EnrollmentService(repository, 'network-test', () => 1_785_900_000, () => 'device-test');
    await expect(service.enroll({ ...request, private_key: 'not allowed' } as never)).rejects.toMatchObject({ code: 'invalid_enrollment' });
    await expect(service.enroll({ ...request, label: 'unsafe<script>' })).rejects.toMatchObject({ code: 'invalid_enrollment' });
    const alteredProof = `${request.proof_signature[0] === 'A' ? 'B' : 'A'}${request.proof_signature.slice(1)}`;
    await expect(service.enroll({ ...request, proof_signature: alteredProof })).rejects.toMatchObject({ code: 'invalid_enrollment' });
    await expect(service.enroll({
      ...request,
      public_key: '-----BEGIN PUBLIC KEY-----\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n-----END PUBLIC KEY-----\n',
    })).rejects.toMatchObject({ code: 'invalid_enrollment' });
  });

  it('atomically enrolls through the real route and D1 query contract', async () => {
    const adapter = await seededDatabase();
    const env = { DB: adapter as unknown as D1Database, NETWORK_ID: 'network-test' };
    const first = await app.request('https://commons.test/enrollment/v1/device', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
    }, env);
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({
      network_id: 'network-test', agent_id: 'agent-test', owner_display_name: 'Test Owner',
    });

    const replay = await app.request('https://commons.test/enrollment/v1/device', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
    }, env);
    expect(replay.status).toBe(409);
    expect(adapter.database.prepare('SELECT count(*) AS total FROM devices').get()).toMatchObject({ total: 1 });
    expect(adapter.database.prepare('SELECT consumed_at FROM enrollment_tokens').get()).toMatchObject({ consumed_at: expect.any(Number) });
    adapter.database.close();
  });

  it('does not reveal a valid token bound to another network', async () => {
    const adapter = await seededDatabase('other-network');
    const response = await app.request('https://commons.test/enrollment/v1/device', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
    }, { DB: adapter as unknown as D1Database, NETWORK_ID: 'network-test' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'enrollment_unavailable' });
    adapter.database.close();
  });

  it('rejects oversized enrollment bodies before JSON parsing', async () => {
    const adapter = await seededDatabase('network-test');
    const response = await app.request('https://commons.test/enrollment/v1/device', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(5000) }),
    }, { DB: adapter as unknown as D1Database, NETWORK_ID: 'network-test', API_AUDIENCE: 'https://commons.test' });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'request_too_large' });
    adapter.database.close();
  });
});
