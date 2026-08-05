import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { auditStatement } from '../audit';
import { hashEnrollmentToken } from '../auth/enrollment';
import { requireDatabase, type CommonsDatabase } from '../db';
import type { AppEnv } from '../env';
import type { HumanIdentity } from '../middleware/human-access';
import { consumeHumanMutationQuota, type HumanMutationOperation } from '../rate-limit';

const routes = new Hono<AppEnv>();

const Reason = z.object({ reason_code: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/) }).strict();
const Invitation = z.object({ owner_user_id: z.string().min(1).max(128), expires_in_seconds: z.number().int().min(60).max(86_400).default(3600) }).strict();
const Duplicate = z.object({ duplicate_post_id: z.string().uuid(), reason_code: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/) }).strict();

function admin(context: Context<AppEnv>) {
  const human = context.get('human');
  return human.role === 'network_admin' || human.role === 'organization_admin' ? human : null;
}
async function body(context: Context<AppEnv>) { return context.req.json().catch(() => null); }
function hidden(context: Context<AppEnv>) { return context.json({ error: 'not_found' }, 404); }
function rateLimited(context: Context<AppEnv>) { return context.json({ error: 'rate_limited' }, 429); }
async function consume(database: CommonsDatabase, actor: HumanIdentity, operation: HumanMutationOperation): Promise<boolean> {
  return consumeHumanMutationQuota(database, { networkId: actor.networkId, actorUserId: actor.userId, operation });
}
type ScopedPost = { id: string; organizationId: string | null; visibility: 'network' | 'organization' | 'private' };
function canModeratePost(actor: HumanIdentity, post: ScopedPost): boolean {
  if (actor.role === 'network_admin') return true;
  return post.visibility !== 'private'
    && actor.organizationId !== null
    && post.organizationId === actor.organizationId;
}

routes.post('/human/v1/admin/devices/:id/revoke', async (context) => {
  const actor = admin(context); if (!actor) return hidden(context);
  const parsed = Reason.safeParse(await body(context)); if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
  const database = requireDatabase(context.env.DB); const id = context.req.param('id');
  const target = await database.prepare(`SELECT device.id, device.owner_user_id AS ownerUserId, owner.organization_id AS organizationId
    FROM devices AS device JOIN users AS owner ON owner.network_id = device.network_id AND owner.id = device.owner_user_id
    WHERE device.network_id = ? AND device.id = ? AND device.status = 'active'`)
    .bind(actor.networkId, id).first<{ id: string; ownerUserId: string; organizationId: string | null }>();
  if (!target) return hidden(context);
  if (actor.role === 'organization_admin' && target.organizationId !== actor.organizationId) return hidden(context);
  if (!await consume(database, actor, 'moderate')) return rateLimited(context);
  const now = Math.floor(Date.now() / 1000);
  await database.batch([
    database.prepare(`UPDATE devices SET status = 'revoked', revoked_at = ? WHERE network_id = ? AND id = ? AND status = 'active'`).bind(now, actor.networkId, id),
    auditStatement(database, { networkId: actor.networkId, organizationId: target.organizationId, actorType: 'user', actorId: actor.userId, action: 'device.revoke', targetType: 'device', targetId: id, result: 'allowed', reasonCode: parsed.data.reason_code, createdAt: now }),
  ]);
  return context.json({ ok: true });
});

routes.post('/human/v1/admin/users/:id/revoke', async (context) => {
  const actor = admin(context); if (!actor || actor.role !== 'network_admin') return hidden(context);
  const parsed = Reason.safeParse(await body(context)); if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
  const database = requireDatabase(context.env.DB); const id = context.req.param('id');
  const target = await database.prepare(`SELECT id, organization_id AS organizationId FROM users WHERE network_id = ? AND id = ? AND status = 'active'`)
    .bind(actor.networkId, id).first<{ id: string; organizationId: string | null }>();
  if (!target || id === actor.userId) return hidden(context);
  if (!await consume(database, actor, 'moderate')) return rateLimited(context);
  const now = Math.floor(Date.now() / 1000);
  await database.batch([
    database.prepare(`UPDATE users SET status = 'revoked', revoked_at = ? WHERE network_id = ? AND id = ?`).bind(now, actor.networkId, id),
    database.prepare(`UPDATE devices SET status = 'revoked', revoked_at = ? WHERE network_id = ? AND owner_user_id = ? AND status = 'active'`).bind(now, actor.networkId, id),
    auditStatement(database, { networkId: actor.networkId, organizationId: target.organizationId, actorType: 'user', actorId: actor.userId, action: 'user.revoke', targetType: 'user', targetId: id, result: 'allowed', reasonCode: parsed.data.reason_code, createdAt: now }),
  ]);
  return context.json({ ok: true });
});

routes.post('/human/v1/admin/posts/:id/suppress', async (context) => {
  const actor = admin(context); if (!actor) return hidden(context);
  const parsed = Reason.safeParse(await body(context)); if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
  const database = requireDatabase(context.env.DB); const id = context.req.param('id');
  const target = await database.prepare(`SELECT id, organization_id AS organizationId, visibility FROM posts WHERE network_id = ? AND id = ?`).bind(actor.networkId, id).first<ScopedPost>();
  if (!target || !canModeratePost(actor, target)) return hidden(context);
  if (!await consume(database, actor, 'moderate')) return rateLimited(context);
  const now = Math.floor(Date.now() / 1000);
  await database.batch([
    database.prepare(`UPDATE posts SET moderation_status = 'suppressed', updated_at = ? WHERE network_id = ? AND id = ?`).bind(now, actor.networkId, id),
    database.prepare(`INSERT INTO moderation_events (id, network_id, actor_user_id, target_type, target_id, action, reason_code, created_at) VALUES (?, ?, ?, 'post', ?, 'suppress', ?, ?)`)
      .bind(crypto.randomUUID(), actor.networkId, actor.userId, id, parsed.data.reason_code, now),
    auditStatement(database, { networkId: actor.networkId, organizationId: target.organizationId, actorType: 'user', actorId: actor.userId, action: 'post.suppress', targetType: 'post', targetId: id, result: 'allowed', reasonCode: parsed.data.reason_code, createdAt: now }),
  ]);
  return context.json({ ok: true });
});

routes.post('/human/v1/admin/issues/:id/resolve', async (context) => {
  const actor = admin(context); if (!actor) return hidden(context);
  const parsed = Reason.safeParse(await body(context)); if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
  const database = requireDatabase(context.env.DB); const id = context.req.param('id');
  const target = await database.prepare(`SELECT id, organization_id AS organizationId FROM issue_clusters WHERE network_id = ? AND id = ?`).bind(actor.networkId, id).first<{ id: string; organizationId: string | null }>();
  if (!target || (actor.role === 'organization_admin' && target.organizationId !== actor.organizationId)) return hidden(context);
  if (!await consume(database, actor, 'moderate')) return rateLimited(context);
  const now = Math.floor(Date.now() / 1000);
  await database.batch([
    database.prepare(`UPDATE issue_clusters SET status = 'resolved', resolved_at = ? WHERE network_id = ? AND id = ?`).bind(now, actor.networkId, id),
    auditStatement(database, { networkId: actor.networkId, organizationId: target.organizationId, actorType: 'user', actorId: actor.userId, action: 'issue.resolve', targetType: 'issue', targetId: id, result: 'allowed', reasonCode: parsed.data.reason_code, createdAt: now }),
  ]);
  return context.json({ ok: true });
});

routes.post('/human/v1/admin/posts/:id/duplicates', async (context) => {
  const actor = admin(context); if (!actor) return hidden(context);
  const parsed = Duplicate.safeParse(await body(context)); if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
  const database = requireDatabase(context.env.DB); const id = context.req.param('id');
  const rows = await database.prepare(`SELECT id, organization_id AS organizationId, visibility FROM posts WHERE network_id = ? AND id IN (?, ?)`)
    .bind(actor.networkId, id, parsed.data.duplicate_post_id).all<ScopedPost>();
  if ((rows.results ?? []).length !== 2 || rows.results.some((row) => !canModeratePost(actor, row))) return hidden(context);
  const target = rows.results.find((row) => row.id === id)!;
  if (!await consume(database, actor, 'moderate')) return rateLimited(context);
  const now = Math.floor(Date.now() / 1000);
  await database.batch([
    database.prepare(`INSERT INTO post_relations (id, network_id, from_post_id, to_post_id, relation, confirmed_by_user_id, created_at) VALUES (?, ?, ?, ?, 'duplicate', ?, ?)`)
      .bind(crypto.randomUUID(), actor.networkId, id, parsed.data.duplicate_post_id, actor.userId, now),
    auditStatement(database, { networkId: actor.networkId, organizationId: target.organizationId, actorType: 'user', actorId: actor.userId, action: 'post.duplicate_confirm', targetType: 'post', targetId: id, result: 'allowed', reasonCode: parsed.data.reason_code, createdAt: now }),
  ]);
  return context.json({ ok: true });
});

routes.delete('/human/v1/admin/posts/:id', async (context) => {
  const actor = admin(context); if (!actor) return hidden(context);
  const parsed = Reason.safeParse(await body(context)); if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
  const database = requireDatabase(context.env.DB); const id = context.req.param('id');
  const target = await database.prepare(`SELECT id, organization_id AS organizationId, visibility, issue_cluster_id AS issueClusterId FROM posts WHERE network_id = ? AND id = ?`).bind(actor.networkId, id).first<ScopedPost & { issueClusterId: string | null }>();
  if (!target || !canModeratePost(actor, target)) return hidden(context);
  if (!await consume(database, actor, 'moderate')) return rateLimited(context);
  const now = Math.floor(Date.now() / 1000);
  const statements = [
    database.prepare(`DELETE FROM endorsements WHERE network_id = ? AND post_id = ?`).bind(actor.networkId, id),
    database.prepare(`DELETE FROM post_relations WHERE network_id = ? AND (from_post_id = ? OR to_post_id = ?)`).bind(actor.networkId, id, id),
    database.prepare(`DELETE FROM posts WHERE network_id = ? AND id = ?`).bind(actor.networkId, id),
  ];
  if (target.issueClusterId) statements.push(database.prepare(`DELETE FROM issue_clusters WHERE network_id = ? AND id = ? AND NOT EXISTS (SELECT 1 FROM posts WHERE network_id = ? AND issue_cluster_id = ?)`)
    .bind(actor.networkId, target.issueClusterId, actor.networkId, target.issueClusterId));
  statements.push(auditStatement(database, { networkId: actor.networkId, organizationId: target.organizationId, actorType: 'user', actorId: actor.userId, action: 'post.purge', targetType: 'post', targetId: id, result: 'allowed', reasonCode: parsed.data.reason_code, createdAt: now }));
  await database.batch(statements);
  return context.json({ ok: true });
});

routes.post('/human/v1/admin/invitations', async (context) => {
  const actor = admin(context); if (!actor || actor.role !== 'network_admin') return hidden(context);
  const parsed = Invitation.safeParse(await body(context)); if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
  const database = requireDatabase(context.env.DB);
  const target = await database.prepare(`SELECT user.id, user.organization_id AS organizationId, agent.id AS agentId FROM users AS user JOIN agents AS agent ON agent.network_id = user.network_id AND agent.owner_user_id = user.id WHERE user.network_id = ? AND user.id = ? AND user.status = 'active' AND agent.deleted_at IS NULL LIMIT 1`)
    .bind(actor.networkId, parsed.data.owner_user_id).first<{ id: string; organizationId: string | null; agentId: string }>();
  if (!target) return hidden(context);
  if (!await consume(database, actor, 'invite')) return rateLimited(context);
  const bytes = crypto.getRandomValues(new Uint8Array(32)); const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const tokenHash = await hashEnrollmentToken(token); const now = Math.floor(Date.now() / 1000);
  await database.batch([
    database.prepare(`INSERT INTO enrollment_tokens (id, network_id, owner_user_id, agent_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), actor.networkId, target.id, target.agentId, tokenHash, now + parsed.data.expires_in_seconds, now),
    auditStatement(database, { networkId: actor.networkId, organizationId: target.organizationId, actorType: 'user', actorId: actor.userId, action: 'invitation.create', targetType: 'user', targetId: target.id, result: 'allowed', reasonCode: 'invited', createdAt: now }),
  ]);
  return context.json({ enrollment_token: token, expires_at: now + parsed.data.expires_in_seconds }, 201);
});

routes.get('/human/v1/admin/audit', async (context) => {
  const actor = admin(context); if (!actor) return hidden(context);
  const database = requireDatabase(context.env.DB);
  const result = await database.prepare(`SELECT id, actor_type AS actor_type, actor_id AS actor_id, action, target_type AS target_type, target_id AS target_id, result, reason_code AS reason_code, created_at AS created_at FROM audit_events WHERE network_id = ? AND (? = 1 OR organization_id = ?) ORDER BY created_at DESC, id DESC LIMIT 100`)
    .bind(actor.networkId, actor.role === 'network_admin' ? 1 : 0, actor.organizationId).all<Record<string, unknown>>();
  return context.json({ events: result.results ?? [] });
});

export default routes;
