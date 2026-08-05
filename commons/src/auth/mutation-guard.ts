import type { CommonsDatabase } from '../db';
import type { AuthenticatedAgent } from '../middleware/agent-auth';

export type MutationResult = {
  replayed: boolean;
  resultType: string;
  resultId: string;
};

type StoredIdempotency = {
  method: string;
  path: string;
  bodySha256: string;
  resultType: string;
  resultId: string;
  expiresAt: number;
};

export class MutationGuardError extends Error {
  constructor(public readonly code: 'idempotency_conflict' | 'replay_detected' | 'mutation_failed') {
    super(code);
  }
}

function exactRetry(auth: AuthenticatedAgent, stored: StoredIdempotency): boolean {
  return stored.method === auth.method && stored.path === auth.requestTarget &&
    stored.bodySha256 === auth.bodySha256;
}

export class D1MutationExecutor {
  constructor(
    private readonly database: CommonsDatabase,
    private readonly clock: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  private async prior(auth: AuthenticatedAgent): Promise<StoredIdempotency | null> {
    const row = await this.database.prepare(`
      SELECT method, path, body_sha256 AS bodySha256,
             result_type AS resultType, result_id AS resultId, expires_at AS expiresAt
      FROM idempotency_keys
      WHERE network_id = ? AND device_id = ? AND idempotency_key = ?
    `).bind(auth.networkId, auth.deviceId, auth.idempotencyKey).first<StoredIdempotency>();
    return row ?? null;
  }

  private async nonceUsed(auth: AuthenticatedAgent): Promise<boolean> {
    const row = await this.database.prepare(`
      SELECT 1 AS used FROM used_nonces
      WHERE network_id = ? AND device_id = ? AND nonce = ?
    `).bind(auth.networkId, auth.deviceId, auth.nonce).first<{ used: number }>();
    return Boolean(row);
  }

  async replay(auth: AuthenticatedAgent): Promise<MutationResult | null> {
    const now = this.clock();
    const prior = await this.prior(auth);
    if (!prior || prior.expiresAt < now) return null;
    if (!exactRetry(auth, prior)) throw new MutationGuardError('idempotency_conflict');
    return { replayed: true, resultType: prior.resultType, resultId: prior.resultId };
  }

  async execute(
    auth: AuthenticatedAgent,
    operation: D1PreparedStatement | D1PreparedStatement[],
    result: { type: string; id: string },
  ): Promise<MutationResult> {
    const now = this.clock();
    const replay = await this.replay(auth);
    if (replay) return replay;

    const statements = [
      this.database.prepare('DELETE FROM used_nonces WHERE device_id = ? AND expires_at < ?').bind(auth.deviceId, now),
      this.database.prepare('DELETE FROM idempotency_keys WHERE device_id = ? AND expires_at < ?').bind(auth.deviceId, now),
      this.database.prepare(`
        INSERT INTO used_nonces (id, network_id, device_id, nonce, used_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), auth.networkId, auth.deviceId, auth.nonce, now, now + 600),
      this.database.prepare(`
        INSERT INTO idempotency_keys (
          id, network_id, device_id, idempotency_key, method, path, body_sha256,
          result_type, result_id, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(), auth.networkId, auth.deviceId, auth.idempotencyKey,
        auth.method, auth.requestTarget, auth.bodySha256, result.type, result.id,
        now, now + 604_800,
      ),
      ...(Array.isArray(operation) ? operation : [operation]),
    ];

    try {
      await this.database.batch(statements);
      return { replayed: false, resultType: result.type, resultId: result.id };
    } catch {
      const after = await this.prior(auth);
      if (after && after.expiresAt >= now) {
        if (!exactRetry(auth, after)) throw new MutationGuardError('idempotency_conflict');
        return { replayed: true, resultType: after.resultType, resultId: after.resultId };
      }
      if (await this.nonceUsed(auth)) throw new MutationGuardError('replay_detected');
      throw new MutationGuardError('mutation_failed');
    }
  }
}
