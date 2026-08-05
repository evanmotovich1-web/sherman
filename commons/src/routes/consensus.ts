import { Hono, type Context } from 'hono';

import { auditStatement } from '../audit';
import { requireDatabase } from '../db';
import type { AppEnv } from '../env';
import { consumeHumanMutationQuota } from '../rate-limit';
import { scoreTrend } from '../trending';

const routes = new Hono<AppEnv>();

async function mutateEndorsement(context: Context<AppEnv>, withdraw: boolean) {
  const human = context.get('human'); const database = requireDatabase(context.env.DB); const postId = context.req.param('id');
  const post = await database.prepare(`
    SELECT id, issue_cluster_id AS issueClusterId, organization_id AS organizationId FROM posts WHERE network_id = ? AND id = ? AND moderation_status = 'visible' AND (
      visibility = 'network' OR (visibility = 'organization' AND organization_id = ?)
      OR (visibility = 'private' AND (owner_user_id = ? OR ? = 1))
    )
  `).bind(human.networkId, postId, human.organizationId, human.userId, human.role === 'network_admin' ? 1 : 0).first<{ id: string; issueClusterId: string | null; organizationId: string | null }>();
  if (!post) return context.json({ error: 'not_found' }, 404);
  const publisher = await database.prepare(`
    SELECT agent.id AS agentId, device.id AS deviceId FROM agents AS agent JOIN devices AS device
      ON device.network_id = agent.network_id AND device.agent_id = agent.id AND device.owner_user_id = agent.owner_user_id
    WHERE agent.network_id = ? AND agent.owner_user_id = ? AND agent.deleted_at IS NULL
      AND device.status = 'active' AND device.revoked_at IS NULL ORDER BY device.enrolled_at, device.id LIMIT 1
  `).bind(human.networkId, human.userId).first<{ agentId: string; deviceId: string }>();
  if (!publisher) return context.json({ error: 'request_forbidden' }, 403);
  if (!await consumeHumanMutationQuota(database, {
    networkId: human.networkId, actorUserId: human.userId, operation: 'endorse',
  })) return context.json({ error: 'rate_limited' }, 429);
  const now = Math.floor(Date.now() / 1000);
  if (withdraw) {
    await database.batch([
      database.prepare(`UPDATE endorsements SET withdrawn_at = ? WHERE network_id = ? AND post_id = ? AND owner_user_id = ? AND withdrawn_at IS NULL`)
        .bind(now, human.networkId, postId, human.userId),
      auditStatement(database, { networkId: human.networkId, organizationId: post.organizationId, actorType: 'user', actorId: human.userId,
        action: 'endorsement.withdraw', targetType: 'post', targetId: post.id, result: 'allowed', reasonCode: null, createdAt: now }),
    ]);
  } else {
    const withdrawPrevious = post.issueClusterId
      ? database.prepare(`UPDATE endorsements SET withdrawn_at = ? WHERE network_id = ? AND issue_cluster_id = ? AND owner_user_id = ? AND withdrawn_at IS NULL`)
        .bind(now, human.networkId, post.issueClusterId, human.userId)
      : database.prepare(`UPDATE endorsements SET withdrawn_at = ? WHERE network_id = ? AND post_id = ? AND owner_user_id = ? AND withdrawn_at IS NULL`)
        .bind(now, human.networkId, postId, human.userId);
    await database.batch([
      withdrawPrevious,
      database.prepare(`
        INSERT INTO endorsements (id, network_id, post_id, issue_cluster_id, owner_user_id, agent_id, device_id, created_at, withdrawn_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(post_id, owner_user_id) DO UPDATE SET issue_cluster_id = excluded.issue_cluster_id,
          agent_id = excluded.agent_id, device_id = excluded.device_id, created_at = excluded.created_at, withdrawn_at = NULL
      `).bind(crypto.randomUUID(), human.networkId, postId, post.issueClusterId, human.userId, publisher.agentId, publisher.deviceId, now),
      auditStatement(database, { networkId: human.networkId, organizationId: post.organizationId, actorType: 'user', actorId: human.userId,
        action: 'endorsement.create', targetType: 'post', targetId: post.id, result: 'allowed', reasonCode: null, createdAt: now }),
    ]);
  }
  return context.json({ ok: true });
}

routes.post('/human/v1/posts/:id/endorsements', (context) => mutateEndorsement(context, false));
routes.delete('/human/v1/posts/:id/endorsements', (context) => mutateEndorsement(context, true));

type IssueRow = { id: string; issueKey: string; title: string; status: 'open' | 'resolved' | 'suppressed' };
type EndorsementRow = { ownerId: string; createdAt: number };

async function issues(context: Context<AppEnv>) {
  const humanPath = context.req.path.startsWith('/human/');
  const identity = humanPath ? context.get('human') : context.get('agent');
  const networkId = identity.networkId; const organizationId = identity.organizationId;
  const ownerId = humanPath ? context.get('human').userId : context.get('agent').ownerUserId;
  const isAdmin = humanPath && context.get('human').role === 'network_admin';
  const database = requireDatabase(context.env.DB);
  const result = await database.prepare(`
    SELECT DISTINCT issue.id, issue.issue_key AS issueKey, issue.title, issue.status
    FROM issue_clusters AS issue JOIN posts AS post
      ON post.network_id = issue.network_id AND post.issue_cluster_id = issue.id
    WHERE issue.network_id = ? AND issue.status != 'suppressed' AND post.moderation_status = 'visible' AND (
      post.visibility = 'network' OR (post.visibility = 'organization' AND post.organization_id = ?)
      OR (post.visibility = 'private' AND (post.owner_user_id = ? OR ? = 1))
    ) ORDER BY issue.created_at DESC, issue.id DESC
  `).bind(networkId, organizationId, ownerId, isAdmin ? 1 : 0).all<IssueRow>();
  const now = Math.floor(Date.now() / 1000); const output = [];
  for (const issue of result.results ?? []) {
    const endorsements = await database.prepare(`
      SELECT endorsement.owner_user_id AS ownerId, MAX(endorsement.created_at) AS createdAt
      FROM endorsements AS endorsement
      JOIN posts AS post ON post.network_id = endorsement.network_id AND post.id = endorsement.post_id
      JOIN users AS owner ON owner.network_id = endorsement.network_id AND owner.id = endorsement.owner_user_id
      JOIN devices AS device ON device.network_id = endorsement.network_id AND device.id = endorsement.device_id
        AND device.owner_user_id = endorsement.owner_user_id AND device.agent_id = endorsement.agent_id
      WHERE endorsement.network_id = ? AND post.issue_cluster_id = ? AND endorsement.withdrawn_at IS NULL
        AND post.moderation_status = 'visible' AND owner.status = 'active' AND owner.revoked_at IS NULL AND owner.deleted_at IS NULL
        AND device.status = 'active' AND device.revoked_at IS NULL
        AND (
          post.visibility = 'network' OR (post.visibility = 'organization' AND post.organization_id = ?)
          OR (post.visibility = 'private' AND (post.owner_user_id = ? OR ? = 1))
        )
      GROUP BY endorsement.owner_user_id
    `).bind(networkId, issue.id, organizationId, ownerId, isAdmin ? 1 : 0).all<EndorsementRow>();
    const trend = scoreTrend((endorsements.results ?? []).map((row) => ({ ownerId: row.ownerId, createdAt: row.createdAt, active: true })), { now, issueStatus: issue.status });
    output.push({ id: issue.id, issue_key: issue.issueKey, title: issue.title, status: issue.status, trend: {
      unique_owners: trend.uniqueOwners, recent_owners: trend.recentOwners, threshold: 3, window_days: 7, recent_window_hours: 24, state: trend.state,
    } });
  }
  return context.json({ issues: output });
}

routes.get('/human/v1/issues', issues);
routes.get('/agent/v1/issues', issues);

export default routes;
