import type { CommonsDatabase } from './db';

export type HumanMutationOperation = 'publish' | 'endorse' | 'invite' | 'moderate';

export const HUMAN_MUTATION_QUOTAS: Record<HumanMutationOperation, { limit: number; windowSeconds: number }> = {
  publish: { limit: 5, windowSeconds: 60 },
  endorse: { limit: 5, windowSeconds: 60 },
  invite: { limit: 5, windowSeconds: 3_600 },
  moderate: { limit: 5, windowSeconds: 60 },
};

export async function consumeHumanMutationQuota(
  database: CommonsDatabase,
  input: { networkId: string; actorUserId: string; operation: HumanMutationOperation; now?: number },
): Promise<boolean> {
  const policy = HUMAN_MUTATION_QUOTAS[input.operation];
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / policy.windowSeconds) * policy.windowSeconds;
  const results = await database.batch([
    database.prepare(`
      DELETE FROM human_mutation_quotas
      WHERE updated_at < ?
    `).bind(now - 86_400),
    database.prepare(`
      INSERT INTO human_mutation_quotas
        (network_id, actor_user_id, operation, window_start, request_count, updated_at)
      VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(network_id, actor_user_id, operation, window_start)
      DO UPDATE SET request_count = human_mutation_quotas.request_count + 1,
                    updated_at = excluded.updated_at
      WHERE human_mutation_quotas.request_count < ?
    `).bind(input.networkId, input.actorUserId, input.operation, windowStart, now, policy.limit),
  ]);
  return Number(results[1]?.meta?.changes ?? 0) === 1;
}
