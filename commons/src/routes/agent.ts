import { Hono } from 'hono';

import { D1MutationExecutor, MutationGuardError } from '../auth/mutation-guard';
import { requireDatabase } from '../db';
import type { AppEnv } from '../env';
import { agentAuth } from '../middleware/agent-auth';

const routes = new Hono<AppEnv>();

routes.use('/agent/v1/*', agentAuth);

routes.post('/agent/v1/heartbeat', async (context) => {
  const database = requireDatabase(context.env.DB);
  const authentication = context.get('agent');
  const executor = new D1MutationExecutor(database);
  const seenAt = Math.floor(Date.now() / 1000);
  const operation = database.prepare(`
    UPDATE devices
    SET last_seen_at = ?
    WHERE network_id = ? AND id = ? AND owner_user_id = ? AND agent_id = ? AND status = 'active'
  `).bind(
    seenAt, authentication.networkId, authentication.deviceId,
    authentication.ownerUserId, authentication.agentId,
  );
  try {
    const result = await executor.execute(authentication, operation, {
      type: 'device', id: authentication.deviceId,
    });
    return context.json({ ok: true, replayed: result.replayed });
  } catch (error) {
    if (error instanceof MutationGuardError) {
      const status = error.code === 'mutation_failed' ? 503 : 409;
      return context.json({ error: error.code }, status);
    }
    throw error;
  }
});

export default routes;
