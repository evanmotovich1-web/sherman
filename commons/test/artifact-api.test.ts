import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import app from '../src/index';
import { normalizeStoredBytes } from '../src/routes/artifacts';
import { canonicalRequest } from '../src/auth/device-signature';
import type { AccessTokenVerifier } from '../src/middleware/human-access';
import { SqliteD1Adapter } from './helpers/sqlite-d1';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrations = ['0001_initial.sql', '0002_api_security.sql', '0003_human_mutation_quotas.sql', '0004_artifact_delivery.sql']
  .map((name) => readFileSync(join(root, 'migrations', name), 'utf8')).join('\n');
const verifier: AccessTokenVerifier = { verify: async (token) => ({ sub: token, email: `${token}@example.test` }) };
const keyPairs = new Map<string, ReturnType<typeof generateKeyPairSync>>();

function fixture() {
  const db = new SqliteD1Adapter(); db.database.exec(migrations);
  const run = (sql: string, ...values: unknown[]) => db.database.prepare(sql).run(...values as never[]);
  for (const network of ['network-test', 'network-other']) run('INSERT INTO networks VALUES (?, ?, ?)', network, network, 1);
  run('INSERT INTO organizations (id, network_id, name, created_at) VALUES (?, ?, ?, ?)', 'org-a', 'network-test', 'A', 1);
  for (const [owner, network, org] of [['owner-1', 'network-test', 'org-a'], ['owner-2', 'network-test', 'org-a'], ['outsider', 'network-other', null]] as const) {
    const pair = generateKeyPairSync('ed25519'); keyPairs.set(owner, pair);
    run(`INSERT INTO users (id, network_id, organization_id, normalized_email, access_subject, display_name, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'member', 1)`, owner, network, org, `${owner}@example.test`, owner, owner);
    run('INSERT INTO agents (id, network_id, organization_id, owner_user_id, display_name, created_at) VALUES (?, ?, ?, ?, ?, 1)', `agent-${owner}`, network, org, owner, owner);
    run('INSERT INTO devices (id, network_id, owner_user_id, agent_id, public_key, label, enrolled_at) VALUES (?, ?, ?, ?, ?, ?, 1)',
      `device-${owner}`, network, owner, `agent-${owner}`, pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), 'test');
    run(`INSERT INTO artifact_publisher_keys (id, network_id, organization_id, owner_user_id, agent_id, device_id, public_key, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1)`, `publisher-${owner}`, network, org, owner, `agent-${owner}`, `device-${owner}`,
      pair.publicKey.export({ type: 'spki', format: 'pem' }).toString());
  }
  return db;
}

const env = (db: SqliteD1Adapter, overrides: Record<string, unknown> = {}) => ({
  DB: db as unknown as D1Database, NETWORK_ID: 'network-test', API_AUDIENCE: 'https://commons.test', HUMAN_ORIGIN: 'https://commons.test',
  ACCESS_VERIFIER: verifier, SCANNER_CALLBACK_TOKEN: 'scanner-test-token', SCANNER_VERSION: 'scanner-v1', SCAN_MAX_AGE_SECONDS: '86400', ...overrides,
});
const human = (owner: string) => ({ headers: { 'cf-access-jwt-assertion': owner, 'content-type': 'application/json' } });

function envelope(owner = 'owner-1', version = '1.0.0', name = 'synthetic-skill') {
  const text = `---\nname: ${name}\ncategory: test\ndescription: Synthetic artifact.\n---\n# Test\n`;
  const bytes = Buffer.from(text);
  const manifest = [{ path: 'SKILL.md', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
  const unsigned = { schema: 'SHERMAN-COMMONS-SKILL-V1', network_id: owner === 'outsider' ? 'network-other' : 'network-test', publisher_key_id: `publisher-${owner}`, name, version, compatibility: { node: '>=22' }, manifest };
  const digest = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
  return { ...unsigned, digest, signature: sign(null, Buffer.from(`SHERMAN-COMMONS-ARTIFACT-V1\n${digest}`), keyPairs.get(owner)!.privateKey).toString('base64'), files: [{ path: 'SKILL.md', content_base64: bytes.toString('base64') }] };
}

function replaceArtifactFile(value: ReturnType<typeof envelope>, path: string, bytes: Buffer) {
  value.manifest = [{ path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
  value.files = [{ path, content_base64: bytes.toString('base64') }];
  const unsigned = {
    schema: value.schema, network_id: value.network_id, publisher_key_id: value.publisher_key_id,
    name: value.name, version: value.version, compatibility: value.compatibility, manifest: value.manifest,
  };
  value.digest = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
  value.signature = sign(null, Buffer.from(`SHERMAN-COMMONS-ARTIFACT-V1\n${value.digest}`), keyPairs.get('owner-1')!.privateKey).toString('base64');
  return value;
}

async function agent(owner: string, path: string, body: unknown = null, method = 'POST', idempotencyKey = crypto.randomUUID()) {
  const text = body === null ? '' : JSON.stringify(body); const timestamp = Math.floor(Date.now() / 1000); const url = `https://commons.test${path}`;
  const input = { method, url, body: text, contentType: 'application/json', audience: 'https://commons.test', networkId: owner === 'outsider' ? 'network-other' : 'network-test', deviceId: `device-${owner}`, timestamp, nonce: crypto.randomUUID(), idempotencyKey };
  const signature = sign(null, Buffer.from(await canonicalRequest(input)), keyPairs.get(owner)!.privateKey).toString('base64');
  return { url, init: { method, body: body === null ? undefined : text, headers: { 'content-type': 'application/json', 'x-sherman-protocol': 'SHERMAN-COMMONS-V2', 'x-sherman-device': input.deviceId, 'x-sherman-network': input.networkId, 'x-sherman-timestamp': String(timestamp), 'x-sherman-nonce': input.nonce, 'x-sherman-idempotency-key': input.idempotencyKey, 'x-sherman-signature': signature } } };
}

async function publish(db: SqliteD1Adapter, value = envelope()) {
  const request = await agent('owner-1', '/device/v1/artifacts', value);
  return app.request(request.url, request.init, env(db));
}
async function scan(db: SqliteD1Adapter, id: string, value: Record<string, unknown>, token = 'scanner-test-token') {
  return app.request(`https://commons.test/scanner/v1/artifacts/${id}/result`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(value) }, env(db));
}

describe('secure artifact publication, scanner boundary, and delivery', () => {
  it('enumerates only this active device exact D1-trusted publisher keys', async () => {
    const db = fixture();
    const request = await agent('owner-1', '/device/v1/artifact-publisher-keys', null, 'GET');
    const response = await app.request(request.url, request.init, env(db));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ publisher_keys: [{
      id: 'publisher-owner-1', network_id: 'network-test', device_id: 'device-owner-1',
      public_key: keyPairs.get('owner-1')!.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    }] });
    db.database.prepare("UPDATE artifact_publisher_keys SET status = 'revoked', revoked_at = 2 WHERE id = 'publisher-owner-1'").run();
    const revokedRequest = await agent('owner-1', '/device/v1/artifact-publisher-keys', null, 'GET');
    expect(await (await app.request(revokedRequest.url, revokedRequest.init, env(db))).json()).toEqual({ publisher_keys: [] });
    db.database.close();
  });

  it('normalizes production D1 numeric BLOB arrays without changing bytes', () => {
    expect(normalizeStoredBytes([0, 127, 255])).toEqual(new Uint8Array([0, 127, 255]));
    expect(normalizeStoredBytes([0, -1, 256])).toBeNull();
  });

  it('quarantines an immutable signed upload and exposes metadata without bytes', async () => {
    const db = fixture(); const value = envelope(); const response = await publish(db, value);
    expect(response.status).toBe(202); const created = await response.json() as { id: string; scan_status: string };
    expect(created.scan_status).toBe('pending');
    const library = await app.request('https://commons.test/human/v1/library', human('owner-2'), env(db));
    expect(library.status).toBe(200); const payload = await library.json() as any;
    expect(payload.artifacts[0]).toMatchObject({ id: created.id, name: value.name, version: value.version, digest_sha256: value.digest, scan: { status: 'pending' }, endorsements: { available: false, count: 0 }, changelog: { available: false } });
    expect(JSON.stringify(payload)).not.toContain(value.files[0].content_base64);
    expect((await app.request(`https://commons.test/human/v1/artifacts/${created.id}/download`, human('owner-2'), env(db))).status).toBe(404);
    expect(() => db.database.prepare('UPDATE artifact_publications SET version = ? WHERE id = ?').run('2.0.0', created.id)).toThrow();
    db.database.close();
  });

  it('rejects malformed, oversized, digest/signature/key/version/cross-network abuse generically', async () => {
    const db = fixture();
    const malformed = envelope(); malformed.files[0].content_base64 = '!!!!';
    expect((await publish(db, malformed)).status).toBe(400);
    const digestMismatch = envelope(); digestMismatch.digest = '0'.repeat(64);
    expect((await publish(db, digestMismatch)).status).toBe(400);
    const signatureMismatch = envelope(); signatureMismatch.signature = Buffer.alloc(64).toString('base64');
    expect((await publish(db, signatureMismatch)).status).toBe(400);
    db.database.prepare("UPDATE artifact_publisher_keys SET status = 'revoked', revoked_at = 2 WHERE id = 'publisher-owner-1'").run();
    expect((await publish(db, envelope('owner-1', '2.0.0'))).status).toBe(400);
    db.database.prepare("UPDATE artifact_publisher_keys SET status = 'active', revoked_at = NULL WHERE id = 'publisher-owner-1'").run();
    expect((await publish(db)).status).toBe(202);
    expect((await publish(db)).status).toBe(409);
    const outside = envelope('outsider'); const outsideRequest = await agent('outsider', '/device/v1/artifacts', outside);
    expect((await app.request(outsideRequest.url, outsideRequest.init, env(db))).status).toBe(401);
    const huge = envelope(); huge.files[0].content_base64 = Buffer.alloc(1_048_577).toString('base64');
    expect((await publish(db, huge)).status).toBe(413);
    db.database.close();
  });

  it('rejects executable, credential, binary, secret, and possible-PHI bytes before persistence', async () => {
    const db = fixture();
    const unsafe = [
      replaceArtifactFile(envelope('owner-1', '1.0.1'), 'run.sh', Buffer.from('#!/bin/sh\nexit 0\n')),
      replaceArtifactFile(envelope('owner-1', '1.0.2'), 'credentials.txt', Buffer.from('safe placeholder\n')),
      replaceArtifactFile(envelope('owner-1', '1.0.3'), 'SKILL.md', Buffer.from([0xff, 0xfe, 0x00])),
      replaceArtifactFile(envelope('owner-1', '1.0.4'), 'SKILL.md', Buffer.from('api_key=synthetic-secret\n')),
      replaceArtifactFile(envelope('owner-1', '1.0.5'), 'SKILL.md', Buffer.from('MRN: synthetic-123\n')),
    ];
    for (const value of unsafe) {
      const response = await publish(db, value);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_request' });
    }
    expect(db.database.prepare('SELECT COUNT(*) AS count FROM artifact_quarantine_bytes').get()).toEqual({ count: 0 });
    db.database.close();
  });

  it('uses the shell canonical compatibility and sorted-manifest digest and honors exact request retries', async () => {
    const db = fixture(); const value: any = envelope();
    value.compatibility = { sherman: '>=0.1.0', node: '>=22' };
    const extra = Buffer.from('# Guide\n');
    value.manifest.push({ path: 'A.md', size: extra.length, sha256: createHash('sha256').update(extra).digest('hex') });
    value.files.push({ path: 'A.md', content_base64: extra.toString('base64') });
    value.manifest.reverse();
    const canonical = { schema: value.schema, network_id: value.network_id, publisher_key_id: value.publisher_key_id, name: value.name, version: value.version,
      compatibility: { node: '>=22', sherman: '>=0.1.0' }, manifest: [...value.manifest].sort((a, b) => a.path.localeCompare(b.path)) };
    value.digest = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    value.signature = sign(null, Buffer.from(`SHERMAN-COMMONS-ARTIFACT-V1\n${value.digest}`), keyPairs.get('owner-1')!.privateKey).toString('base64');
    const request = await agent('owner-1', '/device/v1/artifacts', value);
    expect((await app.request(request.url, request.init, env(db))).status).toBe(202);
    const retry = await app.request(request.url, request.init, env(db));
    expect(retry.status).toBe(202); expect(await retry.json()).toMatchObject({ replayed: true });
    db.database.close();
  });

  it('accepts only authenticated exact digest/version/scanner-bound results and serves only fresh passed bytes', async () => {
    const db = fixture(); const value = envelope(); const created = await (await publish(db, value)).json() as { id: string };
    const result = { status: 'passed', artifact_digest: value.digest, artifact_version: value.version, scanner_version: 'scanner-v1', scanned_at: Math.floor(Date.now() / 1000) };
    expect((await scan(db, created.id, result, 'wrong')).status).toBe(404);
    expect((await scan(db, created.id, { ...result, artifact_digest: '0'.repeat(64) })).status).toBe(404);
    expect((await scan(db, created.id, { ...result, artifact_version: '9.9.9' })).status).toBe(404);
    expect((await scan(db, created.id, { ...result, scanner_version: 'spoofed' })).status).toBe(404);
    expect((await scan(db, created.id, { ...result, scanned_at: 1 })).status).toBe(404);
    expect((await scan(db, created.id, result)).status).toBe(204);
    const staleLibrary = await app.request('https://commons.test/human/v1/library', human('owner-2'), env(db, { SCANNER_VERSION: 'scanner-v2' }));
    expect((await staleLibrary.json() as any).artifacts[0].scan.current).toBe(false);
    const download = await app.request(`https://commons.test/human/v1/artifacts/${created.id}/download`, human('owner-2'), env(db));
    expect(download.status).toBe(200); expect(download.headers.get('content-type')).toBe('application/vnd.sherman.commons-artifact+json');
    expect(Number(download.headers.get('content-length'))).toBeGreaterThan(0); expect(await download.json()).toMatchObject({ digest: value.digest, signature: value.signature });
    const deviceRequest = await agent('owner-2', `/device/v1/artifacts/${created.id}/download`, null, 'GET');
    const deviceDownload = await app.request(deviceRequest.url, deviceRequest.init, env(db));
    expect(deviceDownload.status).toBe(200);
    expect(await deviceDownload.json()).toMatchObject({
      artifact: { digest: value.digest, signature: value.signature },
      trust: {
        network_id: 'network-test', publisher_key_id: 'publisher-owner-1', device_id: 'device-owner-1',
        publisher_status: 'active', publisher_revoked_at: null, device_status: 'active', device_revoked_at: null,
        public_key: keyPairs.get('owner-1')!.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        current_scanner_version: 'scanner-v1',
        scan: { status: 'passed', scanner_version: 'scanner-v1', artifact_digest: value.digest, artifact_version: value.version },
      },
    });
    db.database.prepare("UPDATE devices SET status = 'revoked', revoked_at = 2 WHERE id = 'device-owner-1'").run();
    expect((await app.request(`https://commons.test/human/v1/artifacts/${created.id}/download`, human('owner-2'), env(db))).status).toBe(404);
    const revokedDownload = await agent('owner-2', `/device/v1/artifacts/${created.id}/download`, null, 'GET');
    expect((await app.request(revokedDownload.url, revokedDownload.init, env(db))).status).toBe(404);
    db.database.close();
  });

  it('never serves rejected bytes and detects post-scan quarantine-byte tampering', async () => {
    const db = fixture(); const rejectedValue = envelope('owner-1', '1.0.0', 'rejected-skill');
    const rejected = await (await publish(db, rejectedValue)).json() as { id: string };
    const now = Math.floor(Date.now() / 1000);
    expect((await scan(db, rejected.id, { status: 'rejected', artifact_digest: rejectedValue.digest, artifact_version: rejectedValue.version, scanner_version: 'scanner-v1', scanned_at: now })).status).toBe(204);
    expect((await app.request(`https://commons.test/human/v1/artifacts/${rejected.id}/download`, human('owner-2'), env(db))).status).toBe(404);
    const value = envelope('owner-1', '2.0.0', 'tamper-skill'); const created = await (await publish(db, value)).json() as { id: string };
    await scan(db, created.id, { status: 'passed', artifact_digest: value.digest, artifact_version: value.version, scanner_version: 'scanner-v1', scanned_at: now });
    db.database.prepare('DROP TRIGGER artifact_quarantine_bytes_no_update').run();
    db.database.prepare('UPDATE artifact_quarantine_bytes SET bundle_bytes = ? WHERE publication_id = ?').run(Buffer.from('{}'), created.id);
    expect((await app.request(`https://commons.test/human/v1/artifacts/${created.id}/download`, human('owner-2'), env(db))).status).toBe(404);
    db.database.close();
  });

  it('allows an immutable rescan after a prior result expires', async () => {
    const db = fixture(); const value = envelope(); const created = await (await publish(db, value)).json() as { id: string };
    const now = Math.floor(Date.now() / 1000);
    db.database.prepare(`INSERT INTO artifact_scan_results
      (id, network_id, publication_id, artifact_digest, artifact_version, scanner_version, status, scanned_at, expires_at, created_at)
      VALUES ('old', 'network-test', ?, ?, ?, 'scanner-v1', 'passed', ?, ?, ?)`)
      .run(created.id, value.digest, value.version, now - 90_000, now - 3_600, now - 90_000);
    const scannerFetch = await app.request(`https://commons.test/scanner/v1/artifacts/${created.id}`, { headers: { authorization: 'Bearer scanner-test-token' } }, env(db));
    expect(scannerFetch.status).toBe(200); expect((await scannerFetch.json() as any).digest).toBe(value.digest);
    expect((await scan(db, created.id, { status: 'passed', artifact_digest: value.digest, artifact_version: value.version, scanner_version: 'scanner-v1', scanned_at: now })).status).toBe(204);
    expect((await app.request(`https://commons.test/human/v1/artifacts/${created.id}/download`, human('owner-2'), env(db))).status).toBe(200);
    db.database.close();
  });
});
