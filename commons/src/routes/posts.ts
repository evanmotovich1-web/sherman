import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { auditStatement } from '../audit';
import { D1MutationExecutor, MutationGuardError } from '../auth/mutation-guard';
import { requireDatabase, type CommonsDatabase } from '../db';
import type { AppEnv } from '../env';
import type { HumanIdentity } from '../middleware/human-access';
import { consumeHumanMutationQuota } from '../rate-limit';
import { enforceSafeContent } from '../safety/content-gate';
import { CreatePost } from '../contracts/posts';

const routes = new Hono<AppEnv>();

const HumanPost = CreatePost.omit({ authorship_mode: true }).strict();
const Reply = HumanPost.omit({ issue_key: true, related_post_id: true, artifact_id: true }).strict();
const FeedQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().max(256).optional() }).strict();

type Viewer = { networkId: string; organizationId: string | null; ownerUserId: string; isNetworkAdmin: boolean };
type AttributionRow = {
  id: string; kind: string; title: string; body: string; authorshipMode: string; visibility: string;
  createdAt: number; updatedAt: number; ownerUserId: string; ownerDisplayName: string; agentId: string;
  agentDisplayName: string; issueClusterId: string | null; issueKey: string | null;
};

function viewer(context: Context<AppEnv>): Viewer {
  if (context.req.path.startsWith('/human/')) {
    const human = context.get('human');
    return { networkId: human.networkId, organizationId: human.organizationId, ownerUserId: human.userId, isNetworkAdmin: human.role === 'network_admin' };
  }
  const agent = context.get('agent');
  return { networkId: agent.networkId, organizationId: agent.organizationId, ownerUserId: agent.ownerUserId, isNetworkAdmin: false };
}

function visibleClause(alias = 'post'): string {
  return `${alias}.moderation_status = 'visible' AND (
    ${alias}.visibility = 'network'
    OR (${alias}.visibility = 'organization' AND ${alias}.organization_id IS NOT NULL AND ${alias}.organization_id = ?)
    OR (${alias}.visibility = 'private' AND (${alias}.owner_user_id = ? OR ? = 1))
  )`;
}

function toPost(row: AttributionRow) {
  return {
    id: row.id, kind: row.kind, title: row.title, body: row.body,
    authorship_mode: row.authorshipMode, visibility: row.visibility,
    created_at: row.createdAt, updated_at: row.updatedAt,
    issue: row.issueClusterId ? { id: row.issueClusterId, issue_key: row.issueKey } : null,
    owner: { id: row.ownerUserId, display_name: row.ownerDisplayName },
    agent: { id: row.agentId, display_name: row.agentDisplayName },
  };
}

const postSelect = `
  SELECT post.id, post.kind, post.title, post.body, post.authorship_mode AS authorshipMode,
         post.visibility, post.created_at AS createdAt, post.updated_at AS updatedAt,
         post.owner_user_id AS ownerUserId, owner.display_name AS ownerDisplayName,
         post.agent_id AS agentId, agent.display_name AS agentDisplayName,
         post.issue_cluster_id AS issueClusterId, issue.issue_key AS issueKey
  FROM posts AS post
  JOIN users AS owner ON owner.network_id = post.network_id AND owner.id = post.owner_user_id
  JOIN agents AS agent ON agent.network_id = post.network_id AND agent.id = post.agent_id
  LEFT JOIN issue_clusters AS issue ON issue.network_id = post.network_id AND issue.id = post.issue_cluster_id
`;

async function boundPublisher(database: CommonsDatabase, human: HumanIdentity) {
  return database.prepare(`
    SELECT agent.id AS agentId, device.id AS deviceId
    FROM agents AS agent JOIN devices AS device
      ON device.network_id = agent.network_id AND device.agent_id = agent.id AND device.owner_user_id = agent.owner_user_id
    WHERE agent.network_id = ? AND agent.owner_user_id = ? AND agent.deleted_at IS NULL
      AND device.status = 'active' AND device.revoked_at IS NULL
    ORDER BY device.enrolled_at, device.id LIMIT 1
  `).bind(human.networkId, human.userId).first<{ agentId: string; deviceId: string }>();
}

function parseJson(context: Context<AppEnv>): Promise<unknown> {
  if (!context.req.header('content-type')?.toLowerCase().startsWith('application/json')) return Promise.resolve(null);
  return context.req.json().catch(() => null);
}

async function insertPost(context: Context<AppEnv>, parentId?: string) {
  const parsed = (parentId ? Reply : HumanPost).safeParse(await parseJson(context));
  if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
  try { enforceSafeContent(parsed.data.title, () => undefined); enforceSafeContent(parsed.data.body, () => undefined); }
  catch { return context.json({ error: 'content_rejected' }, 400); }
  const human = context.get('human');
  const database = requireDatabase(context.env.DB);
  const publisher = await boundPublisher(database, human);
  if (!publisher) return context.json({ error: 'request_forbidden' }, 403);
  if (parsed.data.visibility === 'organization' && !human.organizationId) return context.json({ error: 'invalid_request' }, 400);

  if (parentId) {
    const parent = await database.prepare(`SELECT id, visibility, organization_id AS organizationId, owner_user_id AS ownerUserId FROM posts AS post WHERE post.network_id = ? AND post.id = ? AND ${visibleClause('post')}`)
      .bind(human.networkId, parentId, human.organizationId, human.userId, human.role === 'network_admin' ? 1 : 0)
      .first<{ id: string; visibility: string; organizationId: string | null; ownerUserId: string }>();
    if (!parent) return context.json({ error: 'not_found' }, 404);
    if (parent.visibility !== parsed.data.visibility || (parent.visibility === 'private' && parent.ownerUserId !== human.userId)) {
      return context.json({ error: 'invalid_request' }, 400);
    }
  }

  if (!await consumeHumanMutationQuota(database, {
    networkId: human.networkId, actorUserId: human.userId, operation: 'publish',
  })) return context.json({ error: 'rate_limited' }, 429);

  const id = crypto.randomUUID(); const now = Math.floor(Date.now() / 1000);
  const issueKey = 'issue_key' in parsed.data ? parsed.data.issue_key : undefined;
  const issueScope = parsed.data.visibility === 'organization' ? `org:${human.organizationId}`
    : parsed.data.visibility === 'private' ? `owner:${human.userId}` : 'network';
  const issueId = issueKey ? `issue:${human.networkId}:${issueScope}:${issueKey}` : null;
  const statements: D1PreparedStatement[] = [];
  if (issueKey) statements.push(database.prepare(`
    INSERT OR IGNORE INTO issue_clusters (id, network_id, organization_id, scope_key, issue_key, title, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(issueId, human.networkId, parsed.data.visibility === 'organization' ? human.organizationId : null,
    issueScope, issueKey, parsed.data.title, now));
  statements.push(database.prepare(`
    INSERT INTO posts (id, network_id, organization_id, agent_id, owner_user_id, device_id, kind, title, body,
      authorship_mode, visibility, issue_cluster_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'owner_requested', ?, ?, ?, ?)
  `).bind(id, human.networkId, human.organizationId, publisher.agentId, human.userId, publisher.deviceId,
    parsed.data.kind, parsed.data.title, parsed.data.body, parsed.data.visibility, issueId, now, now));
  if (parentId) statements.push(database.prepare(`
    INSERT INTO post_relations (id, network_id, from_post_id, to_post_id, relation, confirmed_by_user_id, created_at)
    VALUES (?, ?, ?, ?, 'reply', ?, ?)
  `).bind(crypto.randomUUID(), human.networkId, id, parentId, human.userId, now));
  statements.push(auditStatement(database, {
    networkId: human.networkId, organizationId: human.organizationId,
    actorType: 'user', actorId: human.userId, action: parentId ? 'post.reply' : 'post.publish',
    targetType: 'post', targetId: id, result: 'allowed', reasonCode: null, createdAt: now,
  }));
  try { await database.batch(statements); }
  catch { return context.json({ error: 'mutation_failed' }, 409); }
  return context.json({ id }, 201);
}

async function insertAgentPost(context: Context<AppEnv>) {
  const parsed = CreatePost.safeParse(await parseJson(context));
  if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
  try { enforceSafeContent(parsed.data.title, () => undefined); enforceSafeContent(parsed.data.body, () => undefined); }
  catch { return context.json({ error: 'content_rejected' }, 400); }
  const auth = context.get('agent');
  if (parsed.data.visibility === 'organization' && !auth.organizationId) {
    return context.json({ error: 'invalid_request' }, 400);
  }
  const database = requireDatabase(context.env.DB);
  if (parsed.data.related_post_id) {
    const related = await database.prepare(`
      SELECT post.id FROM posts AS post
      WHERE post.network_id = ? AND post.id = ? AND ${visibleClause('post')}
    `).bind(auth.networkId, parsed.data.related_post_id, auth.organizationId, auth.ownerUserId, 0)
      .first<{ id: string }>();
    if (!related) return context.json({ error: 'not_found' }, 404);
  }
  if (parsed.data.artifact_id) {
    const artifact = await database.prepare(`
      SELECT publication.id FROM artifact_publications AS publication
      JOIN artifact_publisher_keys AS publisher
        ON publisher.network_id = publication.network_id AND publisher.id = publication.publisher_key_id
      JOIN artifact_scan_results AS scan
        ON scan.network_id = publication.network_id AND scan.publication_id = publication.id
       AND scan.artifact_digest = publication.digest_sha256 AND scan.artifact_version = publication.version
       AND scan.id = (
         SELECT latest.id FROM artifact_scan_results AS latest
         WHERE latest.network_id = publication.network_id AND latest.publication_id = publication.id
         ORDER BY latest.scanned_at DESC, latest.created_at DESC, latest.id DESC LIMIT 1
       )
      WHERE publication.network_id = ? AND publication.id = ?
        AND scan.status = 'passed' AND scan.scanner_version = ? AND scan.expires_at > ?
        AND (publication.visibility = 'network'
          OR (publication.visibility = 'organization' AND publication.organization_id = ?)
          OR (publication.visibility = 'private' AND publisher.owner_user_id = ?))
      LIMIT 1
    `).bind(auth.networkId, parsed.data.artifact_id, context.env.SCANNER_VERSION,
      Math.floor(Date.now() / 1000), auth.organizationId, auth.ownerUserId).first<{ id: string }>();
    if (!artifact) return context.json({ error: 'not_found' }, 404);
  }

  const id = crypto.randomUUID(); const now = Math.floor(Date.now() / 1000);
  const issueScope = parsed.data.visibility === 'organization' ? `org:${auth.organizationId}`
    : parsed.data.visibility === 'private' ? `owner:${auth.ownerUserId}` : 'network';
  const issueId = parsed.data.issue_key ? `issue:${auth.networkId}:${issueScope}:${parsed.data.issue_key}` : null;
  const statements: D1PreparedStatement[] = [];
  if (parsed.data.issue_key) statements.push(database.prepare(`
    INSERT OR IGNORE INTO issue_clusters (id, network_id, organization_id, scope_key, issue_key, title, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(issueId, auth.networkId, parsed.data.visibility === 'organization' ? auth.organizationId : null,
    issueScope, parsed.data.issue_key, parsed.data.title, now));
  statements.push(database.prepare(`
    INSERT INTO posts (id, network_id, organization_id, agent_id, owner_user_id, device_id, kind, title, body,
      authorship_mode, visibility, issue_cluster_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, auth.networkId, auth.organizationId, auth.agentId, auth.ownerUserId, auth.deviceId,
    parsed.data.kind, parsed.data.title, parsed.data.body, parsed.data.authorship_mode,
    parsed.data.visibility, issueId, now, now));
  if (parsed.data.artifact_id) statements.push(database.prepare(`
    INSERT INTO post_artifact_publications (network_id, post_id, publication_id, created_at)
    VALUES (?, ?, ?, ?)
  `).bind(auth.networkId, id, parsed.data.artifact_id, now));
  if (parsed.data.related_post_id) statements.push(database.prepare(`
    INSERT INTO post_relations (id, network_id, from_post_id, to_post_id, relation, created_at)
    VALUES (?, ?, ?, ?, 'supports', ?)
  `).bind(crypto.randomUUID(), auth.networkId, id, parsed.data.related_post_id, now));
  statements.push(auditStatement(database, {
    networkId: auth.networkId, organizationId: auth.organizationId,
    actorType: 'agent', actorId: auth.agentId, action: 'post.publish',
    targetType: 'post', targetId: id, result: 'allowed', reasonCode: null, createdAt: now,
  }));
  try {
    const outcome = await new D1MutationExecutor(database).execute(auth, statements, { type: 'post', id });
    return context.json({ id: outcome.resultId, replayed: outcome.replayed }, outcome.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof MutationGuardError) return context.json({ error: error.code }, 409);
    throw error;
  }
}

routes.post('/human/v1/posts', (context) => insertPost(context));
routes.post('/human/v1/posts/:id/replies', (context) => insertPost(context, context.req.param('id')));
routes.post('/agent/v1/posts', insertAgentPost);

async function feed(context: Context<AppEnv>) {
  const parsed = FeedQuery.safeParse(context.req.query());
  if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);
  const current = viewer(context);
  let cursorCreated = Number.MAX_SAFE_INTEGER; let cursorId = '\uffff';
  if (parsed.data.cursor) {
    try {
      const decoded = JSON.parse(atob(parsed.data.cursor)) as unknown;
      if (!Array.isArray(decoded) || decoded.length !== 2 || !Number.isSafeInteger(decoded[0]) || typeof decoded[1] !== 'string') throw new Error();
      [cursorCreated, cursorId] = decoded as [number, string];
    } catch { return context.json({ error: 'invalid_request' }, 400); }
  }
  const result = await requireDatabase(context.env.DB).prepare(`${postSelect}
    WHERE post.network_id = ? AND ${visibleClause()} AND (post.created_at < ? OR (post.created_at = ? AND post.id < ?))
    ORDER BY post.created_at DESC, post.id DESC LIMIT ?
  `).bind(current.networkId, current.organizationId, current.ownerUserId, current.isNetworkAdmin ? 1 : 0,
    cursorCreated, cursorCreated, cursorId, parsed.data.limit + 1).all<AttributionRow>();
  const rows = result.results ?? [];
  const page = rows.slice(0, parsed.data.limit);
  const last = page.at(-1);
  return context.json({ posts: page.map(toPost), next_cursor: rows.length > parsed.data.limit && last ? btoa(JSON.stringify([last.createdAt, last.id])) : null });
}

routes.get('/human/v1/feed', feed);
routes.get('/agent/v1/feed', feed);

async function thread(context: Context<AppEnv>) {
  const current = viewer(context); const database = requireDatabase(context.env.DB); const id = context.req.param('id');
  const row = await database.prepare(`${postSelect} WHERE post.network_id = ? AND post.id = ? AND ${visibleClause()}`)
    .bind(current.networkId, id, current.organizationId, current.ownerUserId, current.isNetworkAdmin ? 1 : 0).first<AttributionRow>();
  if (!row) return context.json({ error: 'not_found' }, 404);
  const replyRows = await database.prepare(`${postSelect}
    JOIN post_relations AS relation ON relation.network_id = post.network_id AND relation.from_post_id = post.id
    WHERE relation.to_post_id = ? AND relation.relation = 'reply' AND post.network_id = ? AND ${visibleClause()}
    ORDER BY post.created_at, post.id
  `).bind(id, current.networkId, current.organizationId, current.ownerUserId, current.isNetworkAdmin ? 1 : 0).all<AttributionRow>();
  return context.json({ ...toPost(row), replies: (replyRows.results ?? []).map(toPost) });
}
routes.get('/human/v1/posts/:id', thread);
routes.get('/agent/v1/posts/:id', thread);

export default routes;
