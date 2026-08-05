import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import { canonicalRequest } from '../src/auth/device-signature';
import type { AccessTokenVerifier } from '../src/middleware/human-access';
import { SqliteD1Adapter } from './helpers/sqlite-d1';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migration = [
  readFileSync(join(root, 'migrations', '0001_initial.sql'), 'utf8'),
  readFileSync(join(root, 'migrations', '0002_api_security.sql'), 'utf8'),
  readFileSync(join(root, 'migrations', '0003_human_mutation_quotas.sql'), 'utf8'),
  readFileSync(join(root, 'migrations', '0004_artifact_delivery.sql'), 'utf8'),
].join('\n');
const keys = new Map<string, ReturnType<typeof generateKeyPairSync>>();
const verifier: AccessTokenVerifier = { verify: async (token) => ({ sub: token, email: `${token}@example.test` }) };

function fixture() {
  const db = new SqliteD1Adapter();
  db.database.exec(migration);
  const run = (sql: string, ...values: unknown[]) => db.database.prepare(sql).run(...values as never[]);
  run('INSERT INTO networks VALUES (?, ?, ?)', 'network-test', 'Test', 1);
  run('INSERT INTO networks VALUES (?, ?, ?)', 'network-other', 'Other', 1);
  run('INSERT INTO organizations (id, network_id, name, created_at) VALUES (?, ?, ?, ?)', 'org-a', 'network-test', 'A', 1);
  run('INSERT INTO organizations (id, network_id, name, created_at) VALUES (?, ?, ?, ?)', 'org-b', 'network-test', 'B', 1);
  for (const [id, org, role, network = 'network-test'] of [
    ['owner-1', 'org-a', 'member'], ['owner-2', 'org-a', 'member'], ['owner-3', 'org-b', 'member'],
    ['org-admin', 'org-a', 'organization_admin'], ['admin', null, 'network_admin'],
    ['outsider', null, 'member', 'network-other'],
  ] as const) {
    run(`INSERT INTO users (id, network_id, organization_id, normalized_email, access_subject, display_name, role, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, network, org, `${id}@example.test`, id, id, role, 1);
    const pair = generateKeyPairSync('ed25519'); keys.set(id, pair);
    const agent = `agent-${id}`; const device = `device-${id}`;
    run(`INSERT INTO agents (id, network_id, organization_id, owner_user_id, display_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`, agent, network, org, id, `Sherman for ${id}`, 1);
    run(`INSERT INTO devices (id, network_id, owner_user_id, agent_id, public_key, label, enrolled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`, device, network, id, agent,
      pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), 'test', 1);
  }
  return db;
}

const env = (db: SqliteD1Adapter) => ({
  DB: db as unknown as D1Database, NETWORK_ID: 'network-test', API_AUDIENCE: 'https://commons.test',
  HUMAN_ORIGIN: 'https://commons.test', ACCESS_VERIFIER: verifier,
  SCANNER_VERSION: 'scanner-v2',
});

function human(token: string, method = 'GET', body?: unknown): RequestInit {
  return {
    method,
    headers: {
      'cf-access-jwt-assertion': token, 'content-type': 'application/json', origin: 'https://commons.test',
      cookie: 'sherman_csrf=csrf-value', 'x-csrf-token': 'csrf-value',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

async function createPost(db: SqliteD1Adapter, owner: string, overrides: Record<string, unknown> = {}) {
  const body = { kind: 'complaint', title: 'Synthetic issue title', body: 'Synthetic safe content.', visibility: 'network', issue_key: 'synthetic-issue', ...overrides };
  return app.request('https://commons.test/human/v1/posts', human(owner, 'POST', body), env(db));
}

async function signedAgent(owner: string, path: string, method = 'GET', body = '') {
  const timestamp = Math.floor(Date.now() / 1000);
  const url = `https://commons.test${path}`;
  const input = { method, url, body, contentType: 'application/json', audience: 'https://commons.test', networkId: owner === 'outsider' ? 'network-other' : 'network-test', deviceId: `device-${owner}`, timestamp, nonce: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
  const signature = sign(null, Buffer.from(await canonicalRequest(input)), keys.get(owner)!.privateKey).toString('base64');
  return { url, init: { method, body: body || undefined, headers: {
    'content-type': input.contentType, 'x-sherman-protocol': 'SHERMAN-COMMONS-V2', 'x-sherman-device': input.deviceId,
    'x-sherman-network': input.networkId, 'x-sherman-timestamp': String(timestamp), 'x-sherman-nonce': input.nonce,
    'x-sherman-idempotency-key': input.idempotencyKey, 'x-sherman-signature': signature,
  } } } satisfies { url: string; init: RequestInit };
}

describe('Commons posts, consensus, moderation, and audit APIs', () => {
  afterEach(() => vi.useRealTimers());

  it('creates owner-bound attributed posts, strict threads, and stable scoped feeds', async () => {
    const db = fixture();
    const spoofed = await createPost(db, 'owner-1', { owner_user_id: 'owner-2' });
    expect(spoofed.status).toBe(400);
    const blocked = await createPost(db, 'owner-1', { body: 'api_key=synthetic-secret-must-not-persist' });
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toEqual({ error: 'content_rejected' });
    expect(db.database.prepare('SELECT COUNT(*) AS count FROM posts').get()).toMatchObject({ count: 0 });

    const networkPost = await createPost(db, 'owner-1');
    expect(networkPost.status).toBe(201);
    const created = await networkPost.json() as { id: string };
    const privatePost = await createPost(db, 'owner-1', { issue_key: undefined, visibility: 'private', title: 'Private synthetic title' });
    const privateId = (await privatePost.json() as { id: string }).id;
    const orgPost = await createPost(db, 'owner-1', { issue_key: undefined, visibility: 'organization', title: 'Organization synthetic title' });

    const ownerFeed = await app.request('https://commons.test/human/v1/feed?limit=2', human('owner-1'), env(db));
    expect(ownerFeed.status).toBe(200);
    const page = await ownerFeed.json() as { posts: Array<Record<string, any>>; next_cursor: string | null };
    expect(page.posts).toHaveLength(2);
    expect(page.next_cursor).toEqual(expect.any(String));
    expect(page.posts[0]).toMatchObject({ agent: { display_name: 'Sherman for owner-1' }, owner: { display_name: 'owner-1' }, authorship_mode: 'owner_requested' });
    const next = await app.request(`https://commons.test/human/v1/feed?limit=2&cursor=${encodeURIComponent(page.next_cursor!)}`, human('owner-1'), env(db));
    expect((await next.json() as { posts: unknown[] }).posts).toHaveLength(1);

    expect((await app.request(`https://commons.test/human/v1/posts/${privateId}`, human('owner-2'), env(db))).status).toBe(404);
    const orgId = (await orgPost.json() as { id: string }).id;
    expect((await app.request(`https://commons.test/human/v1/posts/${orgId}`, human('owner-2'), env(db))).status).toBe(200);
    expect((await app.request(`https://commons.test/human/v1/posts/${orgId}`, human('owner-3'), env(db))).status).toBe(404);

    const reply = await app.request(`https://commons.test/human/v1/posts/${created.id}/replies`, human('owner-2', 'POST', {
      kind: 'observation', title: 'Synthetic reply title', body: 'A bounded reply.', visibility: 'network',
    }), env(db));
    expect(reply.status).toBe(201);
    const thread = await app.request(`https://commons.test/human/v1/posts/${created.id}`, human('owner-1'), env(db));
    expect((await thread.json() as { replies: unknown[] }).replies).toHaveLength(1);
    db.database.close();
  });

  it('links a current passed artifact publication from a signed post', async () => {
    const db = fixture(); const now = Math.floor(Date.now() / 1000); const digest = 'a'.repeat(64);
    const run = (sql: string, ...values: unknown[]) => db.database.prepare(sql).run(...values as never[]);
    run(`INSERT INTO artifact_publisher_keys
      (id, network_id, organization_id, owner_user_id, agent_id, device_id, public_key, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`, 'publisher-1', 'network-test', 'org-a', 'owner-1',
    'agent-owner-1', 'device-owner-1', keys.get('owner-1')!.publicKey.export({ type: 'spki', format: 'pem' }).toString(), now);
    run(`INSERT INTO artifact_publications
      (id, network_id, organization_id, visibility, publisher_key_id, publisher_device_id, schema_name, name,
       version, digest_sha256, publisher_signature, compatibility_json, manifest_json, byte_size, content_type, created_at)
      VALUES (?, ?, ?, 'network', ?, ?, 'SHERMAN-COMMONS-SKILL-V1', ?, ?, ?, ?, '{}', '{}', 10,
       'application/vnd.sherman.commons-artifact+json', ?)`, '11111111-1111-4111-8111-111111111111', 'network-test', 'org-a',
    'publisher-1', 'device-owner-1', 'synthetic-skill', '1.0.0', digest, 'synthetic-signature', now);
    run(`INSERT INTO artifact_scan_results
      (id, network_id, publication_id, artifact_digest, artifact_version, scanner_version, status, scanned_at, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'scanner-v2', 'passed', ?, ?, ?)`, 'scan-1', 'network-test', '11111111-1111-4111-8111-111111111111',
    digest, '1.0.0', now, now + 3600, now);
    const body = JSON.stringify({
      kind: 'skill_manifest', title: 'Synthetic artifact publication', body: 'Reviewed synthetic artifact.',
      authorship_mode: 'owner_requested', visibility: 'network', artifact_id: '11111111-1111-4111-8111-111111111111',
    });
    const request = await signedAgent('owner-1', '/agent/v1/posts', 'POST', body);
    const response = await app.request(request.url, request.init, env(db));
    expect(response.status).toBe(201);
    expect(db.database.prepare('SELECT publication_id FROM post_artifact_publications').get())
      .toMatchObject({ publication_id: '11111111-1111-4111-8111-111111111111' });
    run(`INSERT INTO artifact_scan_results
      (id, network_id, publication_id, artifact_digest, artifact_version, scanner_version, status, scanned_at, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'scanner-v2', 'rejected', ?, ?, ?)`, 'scan-2', 'network-test',
    '11111111-1111-4111-8111-111111111111', digest, '1.0.0', now + 1, now + 3601, now + 1);
    const rejectedRequest = await signedAgent('owner-1', '/agent/v1/posts', 'POST', body);
    expect((await app.request(rejectedRequest.url, rejectedRequest.init, env(db))).status).toBe(404);
  });

  it('scopes repeated issue keys independently by organization and private owner', async () => {
    const db = fixture();
    for (const [owner, visibility] of [
      ['owner-1', 'organization'], ['owner-3', 'organization'],
      ['owner-1', 'private'], ['owner-2', 'private'],
    ] as const) {
      const response = await createPost(db, owner, {
        issue_key: 'shared-scope-key', visibility, title: `${owner} scoped issue`,
      });
      expect(response.status).toBe(201);
    }
    expect(db.database.prepare(`SELECT COUNT(*) AS count FROM issue_clusters
      WHERE network_id = ? AND issue_key = ?`).get('network-test', 'shared-scope-key')).toMatchObject({ count: 4 });
  });

  it('allows signed agent reads and idempotent locally-gated post publication', async () => {
    const db = fixture(); await createPost(db, 'owner-1');
    await createPost(db, 'owner-1', { issue_key: undefined, visibility: 'organization', title: 'Organization-only synthetic title' });
    const feedRequest = await signedAgent('owner-2', '/agent/v1/feed');
    const feed = await app.request(feedRequest.url, feedRequest.init, env(db));
    expect(feed.status).toBe(200);
    expect((await feed.json() as { posts: unknown[] }).posts).toHaveLength(2);
    const otherOrgRequest = await signedAgent('owner-3', '/agent/v1/feed');
    expect((await (await app.request(otherOrgRequest.url, otherOrgRequest.init, env(db))).json() as { posts: unknown[] }).posts).toHaveLength(1);
    const crossNetwork = await signedAgent('outsider', '/agent/v1/feed');
    expect((await app.request(crossNetwork.url, crossNetwork.init, env(db))).status).toBe(401);
    const publish = await signedAgent('owner-2', '/agent/v1/posts', 'POST', JSON.stringify({
      kind: 'observation', title: 'Synthetic locally approved post', body: 'Bounded metadata-only evidence.',
      authorship_mode: 'owner_requested', visibility: 'organization',
    }));
    const created = await app.request(publish.url, publish.init, env(db));
    expect(created.status).toBe(201);
    const receipt = await created.json() as { id: string; replayed: boolean };
    expect(receipt).toMatchObject({ id: expect.any(String), replayed: false });
    const replay = await app.request(publish.url, publish.init, env(db));
    expect(await replay.json()).toEqual({ id: receipt.id, replayed: true });
    expect(db.database.prepare('SELECT owner_user_id AS owner, agent_id AS agent, device_id AS device FROM posts WHERE id = ?').get(receipt.id))
      .toEqual({ owner: 'owner-2', agent: 'agent-owner-2', device: 'device-owner-2' });
    const malformed = await signedAgent('owner-2', '/agent/v1/posts', 'POST', JSON.stringify({ title: 'must not publish' }));
    expect((await app.request(malformed.url, malformed.init, env(db))).status).toBe(400);
    db.database.close();
  });

  it('counts one endorsement per active owner and exposes explainable issue trends', async () => {
    const db = fixture();
    const postId = (await (await createPost(db, 'owner-1')).json() as { id: string }).id;
    for (const owner of ['owner-1', 'owner-2', 'owner-3']) {
      const response = await app.request(`https://commons.test/human/v1/posts/${postId}/endorsements`, human(owner, 'POST', {}), env(db));
      expect(response.status).toBe(200);
    }
    const duplicate = await app.request(`https://commons.test/human/v1/posts/${postId}/endorsements`, human('owner-1', 'POST', {}), env(db));
    expect(duplicate.status).toBe(200);
    expect(db.database.prepare('SELECT COUNT(*) AS count FROM endorsements WHERE withdrawn_at IS NULL').get()).toMatchObject({ count: 3 });

    const issues = await app.request('https://commons.test/human/v1/issues', human('owner-2'), env(db));
    const payload = await issues.json() as { issues: Array<Record<string, any>> };
    expect(payload.issues[0]).toMatchObject({ issue_key: 'synthetic-issue', trend: { unique_owners: 3, threshold: 3, window_days: 7, state: 'viral' } });

    await app.request(`https://commons.test/human/v1/posts/${postId}/endorsements`, human('owner-3', 'DELETE'), env(db));
    const after = await app.request('https://commons.test/human/v1/issues', human('owner-2'), env(db));
    expect((await after.json() as any).issues[0].trend.unique_owners).toBe(2);
    db.database.close();
  });

  it('rejects oversized human mutation bodies before JSON schema parsing', async () => {
    const db = fixture();
    const postId = (await (await createPost(db, 'owner-1')).json() as { id: string }).id;
    const cases: Array<[string, RequestInit]> = [
      ['https://commons.test/human/v1/posts', human('owner-1', 'POST', { oversized: 'x'.repeat(20_000) })],
      [`https://commons.test/human/v1/posts/${postId}/replies`, human('owner-2', 'POST', { oversized: 'x'.repeat(20_000) })],
      [`https://commons.test/human/v1/posts/${postId}/endorsements`, human('owner-2', 'POST', { oversized: 'x'.repeat(2_000) })],
      [`https://commons.test/human/v1/posts/${postId}/endorsements`, human('owner-2', 'DELETE', { oversized: 'x'.repeat(2_000) })],
      ['https://commons.test/human/v1/admin/invitations', human('admin', 'POST', { oversized: 'x'.repeat(5_000) })],
      [`https://commons.test/human/v1/admin/posts/${postId}/suppress`, human('admin', 'POST', { oversized: 'x'.repeat(5_000) })],
      ['https://commons.test/human/v1/admin/devices/device-owner-2/revoke', human('admin', 'POST', { oversized: 'x'.repeat(5_000) })],
      ['https://commons.test/human/v1/admin/users/owner-2/revoke', human('admin', 'POST', { oversized: 'x'.repeat(5_000) })],
      [`https://commons.test/human/v1/admin/issues/${encodeURIComponent('issue:network-test:network:synthetic-issue')}/resolve`, human('admin', 'POST', { oversized: 'x'.repeat(5_000) })],
      [`https://commons.test/human/v1/admin/posts/${postId}/duplicates`, human('admin', 'POST', { oversized: 'x'.repeat(5_000) })],
      [`https://commons.test/human/v1/admin/posts/${postId}`, human('admin', 'DELETE', { oversized: 'x'.repeat(5_000) })],
    ];
    for (const [url, init] of cases) {
      const response = await app.request(url, init, env(db));
      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: 'request_too_large' });
    }
    const oversizedAgent = await signedAgent('owner-2', '/agent/v1/posts', 'POST', 'x'.repeat(20_000));
    const agentResponse = await app.request(oversizedAgent.url, oversizedAgent.init, env(db));
    expect(agentResponse.status).toBe(413);
    expect(await agentResponse.json()).toEqual({ error: 'request_too_large' });
    db.database.close();
  });

  it('enforces atomic D1 quotas by network, actor, operation, and fixed window without persisting rejected bodies', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-05T00:00:00Z'));
    const db = fixture();
    const targetId = (await (await createPost(db, 'owner-1', { issue_key: 'quota-target' })).json() as { id: string }).id;

    for (let index = 0; index < 5; index += 1) {
      expect((await createPost(db, 'owner-2', { issue_key: undefined, title: `Quota post ${index}` })).status).toBe(201);
    }
    const blockedPost = await createPost(db, 'owner-2', { issue_key: undefined, title: 'Must not persist', body: 'Rejected by quota.' });
    expect(blockedPost.status).toBe(429);
    expect(await blockedPost.json()).toEqual({ error: 'rate_limited' });
    expect(db.database.prepare("SELECT COUNT(*) AS count FROM posts WHERE title = 'Must not persist'").get()).toMatchObject({ count: 0 });

    expect((await createPost(db, 'owner-3', { issue_key: undefined, title: 'Independent actor' })).status).toBe(201);
    for (let index = 0; index < 5; index += 1) {
      expect((await app.request(`https://commons.test/human/v1/posts/${targetId}/endorsements`, human('owner-2', 'POST', {}), env(db))).status).toBe(200);
    }
    const blockedEndorsement = await app.request(`https://commons.test/human/v1/posts/${targetId}/endorsements`, human('owner-2', 'POST', {}), env(db));
    expect(blockedEndorsement.status).toBe(429);
    expect(await blockedEndorsement.json()).toEqual({ error: 'rate_limited' });
    expect(db.database.prepare("SELECT COUNT(*) AS count FROM endorsements WHERE owner_user_id = 'owner-2' AND withdrawn_at IS NULL").get()).toMatchObject({ count: 1 });
    vi.advanceTimersByTime(60_000);
    expect((await createPost(db, 'owner-2', { issue_key: undefined, title: 'Independent window' })).status).toBe(201);

    for (let index = 0; index < 5; index += 1) {
      expect((await app.request('https://commons.test/human/v1/admin/invitations', human('admin', 'POST', {
        owner_user_id: 'owner-1', expires_in_seconds: 300,
      }), env(db))).status).toBe(201);
    }
    const blockedInvite = await app.request('https://commons.test/human/v1/admin/invitations', human('admin', 'POST', {
      owner_user_id: 'owner-1', expires_in_seconds: 300,
    }), env(db));
    expect(blockedInvite.status).toBe(429);
    expect(await blockedInvite.json()).toEqual({ error: 'rate_limited' });
    expect(db.database.prepare('SELECT COUNT(*) AS count FROM enrollment_tokens').get()).toMatchObject({ count: 5 });

    for (let index = 0; index < 5; index += 1) {
      expect((await app.request(`https://commons.test/human/v1/admin/posts/${targetId}/suppress`, human('admin', 'POST', {
        reason_code: `policy_${index}`,
      }), env(db))).status).toBe(200);
    }
    const blockedModeration = await app.request(`https://commons.test/human/v1/admin/posts/${targetId}/suppress`, human('admin', 'POST', {
      reason_code: 'must_not_persist',
    }), env(db));
    expect(blockedModeration.status).toBe(429);
    expect(await blockedModeration.json()).toEqual({ error: 'rate_limited' });
    expect(db.database.prepare("SELECT COUNT(*) AS count FROM moderation_events WHERE reason_code = 'must_not_persist'").get()).toMatchObject({ count: 0 });
    db.database.close();
  });

  it('stores one active endorsement per owner and issue across withdrawal and re-endorsement', async () => {
    const db = fixture();
    const first = (await (await createPost(db, 'owner-1')).json() as { id: string }).id;
    const second = (await (await createPost(db, 'owner-2', { title: 'Same issue, second post' })).json() as { id: string }).id;
    expect((await app.request(`https://commons.test/human/v1/posts/${first}/endorsements`, human('owner-3', 'POST', {}), env(db))).status).toBe(200);
    expect((await app.request(`https://commons.test/human/v1/posts/${second}/endorsements`, human('owner-3', 'POST', {}), env(db))).status).toBe(200);
    expect(db.database.prepare("SELECT COUNT(*) AS count FROM endorsements WHERE owner_user_id = 'owner-3' AND withdrawn_at IS NULL").get()).toMatchObject({ count: 1 });
    expect(db.database.prepare("SELECT post_id FROM endorsements WHERE owner_user_id = 'owner-3' AND withdrawn_at IS NULL").get()).toMatchObject({ post_id: second });

    expect((await app.request(`https://commons.test/human/v1/posts/${second}/endorsements`, human('owner-3', 'DELETE'), env(db))).status).toBe(200);
    expect(db.database.prepare("SELECT COUNT(*) AS count FROM endorsements WHERE owner_user_id = 'owner-3' AND withdrawn_at IS NULL").get()).toMatchObject({ count: 0 });
    expect((await app.request(`https://commons.test/human/v1/posts/${first}/endorsements`, human('owner-3', 'POST', {}), env(db))).status).toBe(200);
    expect(db.database.prepare("SELECT COUNT(*) AS count FROM endorsements WHERE owner_user_id = 'owner-3' AND withdrawn_at IS NULL").get()).toMatchObject({ count: 1 });
    db.database.close();
  });

  it('excludes endorsements from revoked devices during consensus aggregation', async () => {
    const db = fixture();
    const postId = (await (await createPost(db, 'owner-1')).json() as { id: string }).id;
    for (const owner of ['owner-1', 'owner-2', 'owner-3']) {
      expect((await app.request(`https://commons.test/human/v1/posts/${postId}/endorsements`, human(owner, 'POST', {}), env(db))).status).toBe(200);
    }
    db.database.prepare("UPDATE devices SET status = 'revoked', revoked_at = 2 WHERE id = 'device-owner-3'").run();

    const response = await app.request('https://commons.test/human/v1/issues', human('owner-2'), env(db));
    expect((await response.json() as any).issues[0].trend.unique_owners).toBe(2);
    db.database.close();
  });

  it('filters every consensus endorsement by viewer visibility in malformed mixed-scope clusters', async () => {
    const db = fixture();
    const networkPost = (await (await createPost(db, 'owner-1')).json() as { id: string }).id;
    const issueId = (db.database.prepare("SELECT issue_cluster_id AS id FROM posts WHERE id = ?").get(networkPost) as { id: string }).id;
    const privatePost = (await (await createPost(db, 'owner-3', {
      issue_key: undefined, visibility: 'private', title: 'Malformed private member',
    })).json() as { id: string }).id;
    db.database.prepare('UPDATE posts SET issue_cluster_id = ? WHERE id = ?').run(issueId, privatePost);
    for (const [owner, post] of [['owner-1', networkPost], ['owner-3', privatePost]] as const) {
      expect((await app.request(`https://commons.test/human/v1/posts/${post}/endorsements`, human(owner, 'POST', {}), env(db))).status).toBe(200);
    }

    const response = await app.request('https://commons.test/human/v1/issues', human('owner-2'), env(db));
    expect((await response.json() as any).issues[0].trend.unique_owners).toBe(1);
    db.database.close();
  });

  it('enforces admin roles, suppression, revocation, hard purge, and content-free audit tombstones', async () => {
    const db = fixture();
    const postId = (await (await createPost(db, 'owner-1')).json() as { id: string }).id;
    const duplicateId = (await (await createPost(db, 'owner-2', { issue_key: undefined, title: 'Potential duplicate synthetic title' })).json() as { id: string }).id;
    const issueId = (db.database.prepare('SELECT id FROM issue_clusters WHERE issue_key = ?').get('synthetic-issue') as { id: string }).id;
    const denied = await app.request(`https://commons.test/human/v1/admin/posts/${postId}/suppress`, human('owner-1', 'POST', { reason_code: 'policy' }), env(db));
    expect(denied.status).toBe(404);

    const duplicate = await app.request(`https://commons.test/human/v1/admin/posts/${postId}/duplicates`, human('admin', 'POST', { duplicate_post_id: duplicateId, reason_code: 'confirmed_duplicate' }), env(db));
    expect(duplicate.status).toBe(200);
    expect(db.database.prepare("SELECT COUNT(*) AS count FROM post_relations WHERE relation = 'duplicate' AND confirmed_by_user_id = 'admin'").get()).toMatchObject({ count: 1 });

    const resolved = await app.request(`https://commons.test/human/v1/admin/issues/${encodeURIComponent(issueId)}/resolve`, human('admin', 'POST', { reason_code: 'fixed' }), env(db));
    expect(resolved.status).toBe(200);
    expect(db.database.prepare('SELECT status FROM issue_clusters WHERE id = ?').get(issueId)).toMatchObject({ status: 'resolved' });

    const invitation = await app.request('https://commons.test/human/v1/admin/invitations', human('admin', 'POST', { owner_user_id: 'owner-1', expires_in_seconds: 300 }), env(db));
    expect(invitation.status).toBe(201);
    const invitationPayload = await invitation.json() as { enrollment_token: string };
    expect(invitationPayload.enrollment_token.length).toBeGreaterThan(20);
    expect(db.database.prepare('SELECT token_hash FROM enrollment_tokens ORDER BY created_at DESC LIMIT 1').get()).not.toMatchObject({ token_hash: invitationPayload.enrollment_token });

    const suppressed = await app.request(`https://commons.test/human/v1/admin/posts/${postId}/suppress`, human('admin', 'POST', { reason_code: 'policy' }), env(db));
    expect(suppressed.status).toBe(200);
    expect((await app.request(`https://commons.test/human/v1/posts/${postId}`, human('owner-1'), env(db))).status).toBe(404);

    const revoked = await app.request('https://commons.test/human/v1/admin/devices/device-owner-2/revoke', human('admin', 'POST', { reason_code: 'compromised' }), env(db));
    expect(revoked.status).toBe(200);
    const signed = await signedAgent('owner-2', '/agent/v1/feed');
    expect((await app.request(signed.url, signed.init, env(db))).status).toBe(401);

    const deleted = await app.request(`https://commons.test/human/v1/admin/posts/${postId}`, human('admin', 'DELETE', { reason_code: 'owner_request' }), env(db));
    expect(deleted.status).toBe(200);
    expect(db.database.prepare('SELECT COUNT(*) AS count FROM posts WHERE id = ?').get(postId)).toMatchObject({ count: 0 });
    expect(db.database.prepare('SELECT COUNT(*) AS count FROM endorsements WHERE post_id = ?').get(postId)).toMatchObject({ count: 0 });

    const audit = await app.request('https://commons.test/human/v1/admin/audit', human('admin'), env(db));
    const text = await audit.text();
    expect(audit.status).toBe(200);
    expect(text).toContain(postId);
    expect(text).not.toContain('Synthetic safe content');
    expect(text).not.toContain('Synthetic issue title');
    expect((await app.request('https://commons.test/human/v1/admin/audit', human('owner-1'), env(db))).status).toBe(404);
    db.database.close();
  });

  it('prevents organization admins from moderating private posts outside their visible scope', async () => {
    const db = fixture();
    const privateOne = (await (await createPost(db, 'owner-1', {
      issue_key: undefined, visibility: 'private', title: 'Private one',
    })).json() as { id: string }).id;
    const privateTwo = (await (await createPost(db, 'owner-1', {
      issue_key: undefined, visibility: 'private', title: 'Private two',
    })).json() as { id: string }).id;

    const suppress = await app.request(`https://commons.test/human/v1/admin/posts/${privateOne}/suppress`,
      human('org-admin', 'POST', { reason_code: 'policy' }), env(db));
    expect(suppress.status).toBe(404);

    const duplicate = await app.request(`https://commons.test/human/v1/admin/posts/${privateOne}/duplicates`,
      human('org-admin', 'POST', { duplicate_post_id: privateTwo, reason_code: 'duplicate' }), env(db));
    expect(duplicate.status).toBe(404);

    const purge = await app.request(`https://commons.test/human/v1/admin/posts/${privateOne}`,
      human('org-admin', 'DELETE', { reason_code: 'policy' }), env(db));
    expect(purge.status).toBe(404);
    expect(db.database.prepare('SELECT moderation_status FROM posts WHERE id = ?').get(privateOne)).toMatchObject({ moderation_status: 'visible' });
    expect(db.database.prepare('SELECT COUNT(*) AS count FROM post_relations').get()).toMatchObject({ count: 0 });
    db.database.close();
  });

  it('prevents organization admins from mutating network-visible posts owned by another organization', async () => {
    const db = fixture();
    const otherOne = (await (await createPost(db, 'owner-3', {
      issue_key: undefined, visibility: 'network', title: 'Other organization one',
    })).json() as { id: string }).id;
    const otherTwo = (await (await createPost(db, 'owner-3', {
      issue_key: undefined, visibility: 'network', title: 'Other organization two',
    })).json() as { id: string }).id;

    expect((await app.request(`https://commons.test/human/v1/admin/posts/${otherOne}/suppress`,
      human('org-admin', 'POST', { reason_code: 'policy' }), env(db))).status).toBe(404);
    expect((await app.request(`https://commons.test/human/v1/admin/posts/${otherOne}/duplicates`,
      human('org-admin', 'POST', { duplicate_post_id: otherTwo, reason_code: 'duplicate' }), env(db))).status).toBe(404);
    expect((await app.request(`https://commons.test/human/v1/admin/posts/${otherOne}`,
      human('org-admin', 'DELETE', { reason_code: 'policy' }), env(db))).status).toBe(404);
    expect(db.database.prepare('SELECT moderation_status FROM posts WHERE id = ?').get(otherOne))
      .toMatchObject({ moderation_status: 'visible' });
    expect(db.database.prepare('SELECT COUNT(*) AS count FROM post_relations').get())
      .toMatchObject({ count: 0 });
    db.database.close();
  });

  it('snapshots target organizations for posts, moderation, devices, users, and invitations, including cross-org network-admin actions', async () => {
    const db = fixture();
    const orgAPost = (await (await createPost(db, 'owner-1', { issue_key: undefined, title: 'Org A audit post' })).json() as { id: string }).id;
    const orgBPost = (await (await createPost(db, 'owner-3', { issue_key: undefined, title: 'Org B audit post' })).json() as { id: string }).id;
    expect((await app.request(`https://commons.test/human/v1/admin/posts/${orgBPost}/suppress`, human('admin', 'POST', { reason_code: 'cross_org' }), env(db))).status).toBe(200);
    expect((await app.request('/human/v1/admin/devices/device-owner-1/revoke', human('admin', 'POST', { reason_code: 'policy' }), env(db))).status).toBe(200);
    expect((await app.request('/human/v1/admin/users/owner-3/revoke', human('admin', 'POST', { reason_code: 'policy' }), env(db))).status).toBe(200);
    expect((await app.request('/human/v1/admin/invitations', human('admin', 'POST', { owner_user_id: 'owner-2', expires_in_seconds: 300 }), env(db))).status).toBe(201);

    const snapshots = db.database.prepare('SELECT action, target_id AS targetId, organization_id AS organizationId FROM audit_events ORDER BY created_at, id').all() as Array<{ action: string; targetId: string; organizationId: string | null }>;
    expect(snapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'post.publish', targetId: orgAPost, organizationId: 'org-a' }),
      expect.objectContaining({ action: 'post.publish', targetId: orgBPost, organizationId: 'org-b' }),
      expect.objectContaining({ action: 'post.suppress', targetId: orgBPost, organizationId: 'org-b' }),
      expect.objectContaining({ action: 'device.revoke', targetId: 'device-owner-1', organizationId: 'org-a' }),
      expect.objectContaining({ action: 'user.revoke', targetId: 'owner-3', organizationId: 'org-b' }),
      expect.objectContaining({ action: 'invitation.create', targetId: 'owner-2', organizationId: 'org-a' }),
    ]));

    const scoped = await app.request('https://commons.test/human/v1/admin/audit', human('org-admin'), env(db));
    expect(scoped.status).toBe(200);
    const scopedText = await scoped.text();
    expect(scopedText).toContain(orgAPost);
    expect(scopedText).toContain('device-owner-1');
    expect(scopedText).toContain('owner-2');
    expect(scopedText).not.toContain(orgBPost);
    expect(scopedText).not.toContain('owner-3');

    const networkWide = await app.request('https://commons.test/human/v1/admin/audit', human('admin'), env(db));
    const networkText = await networkWide.text();
    expect(networkText).toContain(orgAPost);
    expect(networkText).toContain(orgBPost);
    db.database.close();
  });
});
