import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { consumeHumanMutationQuota } from '../src/rate-limit';
import { SqliteD1Adapter } from './helpers/sqlite-d1';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('human mutation quota retention', () => {
  it('atomically removes expired windows while consuming the current window', async () => {
    const db = new SqliteD1Adapter();
    for (const name of ['0001_initial.sql', '0002_api_security.sql', '0003_human_mutation_quotas.sql']) {
      await db.exec(readFileSync(join(root, 'migrations', name), 'utf8'));
    }
    db.database.exec(`
      INSERT INTO networks VALUES ('net-a', 'A', 1);
      INSERT INTO users (id, network_id, normalized_email, display_name, role, created_at)
        VALUES ('owner-a', 'net-a', 'a@example.test', 'A', 'member', 1);
      INSERT INTO human_mutation_quotas VALUES ('net-a', 'owner-a', 'publish', 60, 1, 60);
    `);
    await expect(consumeHumanMutationQuota(db as never, {
      networkId: 'net-a', actorUserId: 'owner-a', operation: 'publish', now: 200_000,
    })).resolves.toBe(true);
    expect(db.database.prepare('SELECT window_start FROM human_mutation_quotas ORDER BY window_start').all())
      .toEqual([{ window_start: 199_980 }]);
    db.database.close();
  });
});