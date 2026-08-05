import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { EnrollmentError, EnrollmentService, type EnrollmentConsumeInput, type EnrollmentRepository, type EnrollmentResult } from '../auth/enrollment';
import { requireDatabase, type CommonsDatabase } from '../db';
import type { AppEnv } from '../env';

export class D1EnrollmentRepository implements EnrollmentRepository {
  constructor(private readonly database: CommonsDatabase) {}

  async consume(input: EnrollmentConsumeInput): Promise<EnrollmentResult | null> {
    try {
      const insert = this.database.prepare(`
        INSERT INTO devices (id, network_id, owner_user_id, agent_id, public_key, label, enrolled_at)
        SELECT ?, token.network_id, token.owner_user_id, token.agent_id, ?, ?, ?
        FROM enrollment_tokens AS token
        JOIN agents AS agent
          ON agent.network_id = token.network_id
         AND agent.id = token.agent_id
         AND agent.owner_user_id = token.owner_user_id
         AND agent.deleted_at IS NULL
        JOIN users AS owner
          ON owner.network_id = token.network_id
         AND owner.id = token.owner_user_id
         AND owner.status = 'active'
         AND owner.deleted_at IS NULL
        WHERE token.token_hash = ?
          AND token.network_id = ?
          AND token.consumed_at IS NULL
          AND token.expires_at > ?
      `).bind(input.deviceId, input.publicKey, input.label, input.now, input.tokenHash, input.networkId, input.now);
      const consume = this.database.prepare(`
        UPDATE enrollment_tokens
        SET consumed_at = ?
        WHERE token_hash = ?
          AND network_id = ?
          AND consumed_at IS NULL
          AND EXISTS (
            SELECT 1 FROM devices
            WHERE id = ? AND network_id = enrollment_tokens.network_id
          )
      `).bind(input.now, input.tokenHash, input.networkId, input.deviceId);
      const results = await this.database.batch([insert, consume]);
      if (Number(results[0]?.meta?.changes ?? 0) !== 1 || Number(results[1]?.meta?.changes ?? 0) !== 1) return null;
      const row = await this.database.prepare(`
        SELECT device.network_id AS networkId, device.id AS deviceId,
               device.agent_id AS agentId, owner.display_name AS ownerDisplayName
        FROM devices AS device
        JOIN users AS owner
          ON owner.network_id = device.network_id
         AND owner.id = device.owner_user_id
        WHERE device.id = ? AND device.network_id = ?
      `).bind(input.deviceId, input.networkId).first<EnrollmentResult>();
      return row ?? null;
    } catch {
      return null;
    }
  }
}

const routes = new Hono<AppEnv>();

routes.use('/enrollment/v1/device', bodyLimit({
  maxSize: 4096,
  onError: (context) => context.json({ error: 'request_too_large' }, 413),
}));

routes.post('/enrollment/v1/device', async (context) => {
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return context.json({ error: 'invalid_enrollment' }, 400);
  }
  const service = new EnrollmentService(
    new D1EnrollmentRepository(requireDatabase(context.env.DB)),
    context.env.NETWORK_ID,
  );
  try {
    return context.json(await service.enroll(body), 201);
  } catch (error) {
    if (error instanceof EnrollmentError) {
      const status = error.code === 'invalid_enrollment' ? 400 : 409;
      return context.json({ error: error.code }, status);
    }
    return context.json({ error: 'enrollment_unavailable' }, 409);
  }
});

export default routes;
