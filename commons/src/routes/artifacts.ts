import { Hono } from 'hono';

import { auditStatement } from '../audit';
import { D1MutationExecutor, MutationGuardError } from '../auth/mutation-guard';
import { requireDatabase, type CommonsDatabase } from '../db';
import type { AppEnv } from '../env';
import { checkContent } from '../safety/content-gate';

const routes = new Hono<AppEnv>();
const SCHEMA = 'SHERMAN-COMMONS-SKILL-V1';
const MEDIA_TYPE = 'application/vnd.sherman.commons-artifact+json';
const MAX_FILES = 100;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_EXPANDED_BYTES = 1024 * 1024;
const MAX_SCAN_CLOCK_SKEW = 300;
const HEX = /^[a-f0-9]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const ALLOWED_EXTENSIONS = new Set(['.md', '.json', '.txt']);
const CREDENTIAL_FILE = /^(?:\.env(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|.*\.(?:pem|key|p12|pfx))$/i;
const EXECUTABLE_FILE = /\.(?:sh|bash|zsh|fish|py|pyw|js|mjs|cjs|ts|tsx|jsx|exe|dll|dylib|so|bat|cmd|ps1|com|app|jar|wasm)$/i;

type Json = Record<string, unknown>;
type ArtifactEnvelope = {
  schema: string; network_id: string; publisher_key_id: string; name: string; version: string;
  compatibility: Record<string, string>; manifest: Array<{ path: string; size: number; sha256: string }>;
};
type ParsedBundle = { envelope: ArtifactEnvelope; digest: string; signature: string; bytes: Uint8Array; manifestJson: string; compatibilityJson: string };

routes.get('/device/v1/artifact-publisher-keys', async (context) => {
  const actor = context.get('agent');
  const result = await requireDatabase(context.env.DB).prepare(`SELECT key.id, key.network_id AS networkId,
      key.device_id AS deviceId, key.public_key AS publicKey
    FROM artifact_publisher_keys AS key JOIN devices AS device
      ON device.network_id = key.network_id AND device.id = key.device_id
    WHERE key.network_id = ? AND key.owner_user_id = ? AND key.agent_id = ? AND key.device_id = ?
      AND key.status = 'active' AND key.revoked_at IS NULL
      AND device.status = 'active' AND device.revoked_at IS NULL
    ORDER BY key.id LIMIT 20`)
    .bind(actor.networkId, actor.ownerUserId, actor.agentId, actor.deviceId).all<any>();
  return context.json({ publisher_keys: result.results.map((row) => ({
    id: row.id, network_id: row.networkId, device_id: row.deviceId, public_key: row.publicKey,
  })) }, 200, { 'cache-control': 'private, no-store' });
});

export function normalizeStoredBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (!Array.isArray(value) || value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) return null;
  return Uint8Array.from(value);
}

class ArtifactInputError extends Error { constructor(readonly tooLarge = false) { super('invalid_artifact'); } }
const exact = (value: unknown, keys: string[]): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const string = (value: unknown, max = 4096): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\r\n]/.test(value);

function safePath(value: unknown): value is string {
  if (!string(value, 240) || value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false;
  const parts = value.split('/');
  return parts.length <= 8 && parts.every((part) => part && part !== '.' && part !== '..' && !part.startsWith('.'));
}
function safeArtifactPath(value: unknown): value is string {
  if (!safePath(value)) return false;
  const filename = value.split('/').at(-1)!;
  const extension = filename.includes('.') ? `.${filename.split('.').at(-1)!.toLowerCase()}` : '';
  return !CREDENTIAL_FILE.test(filename) && !EXECUTABLE_FILE.test(filename) && ALLOWED_EXTENSIONS.has(extension);
}
function safeArtifactBytes(bytes: Uint8Array): boolean {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return false; }
  const content = checkContent(text, MAX_FILE_BYTES);
  return content.allowed && !/\b(?:date of birth|dob|social security number|ssn)\s*[:#]\s*\S+/i.test(text);
}
function decodeBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !BASE64.test(value)) throw new ArtifactInputError();
  try {
    const binary = atob(value); const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (btoa(binary) !== value) throw new ArtifactInputError();
    return bytes;
  } catch { throw new ArtifactInputError(); }
}
async function sha256(bytes: Uint8Array | string): Promise<string> {
  const input = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', input.slice().buffer))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function pemBytes(pem: string): Uint8Array {
  const encoded = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
  return decodeBase64(encoded);
}
async function verifySignature(publicKey: string, digest: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('spki', pemBytes(publicKey).slice().buffer, { name: 'Ed25519' }, false, ['verify']);
    return crypto.subtle.verify('Ed25519', key, decodeBase64(signature).slice().buffer, new TextEncoder().encode(`SHERMAN-COMMONS-ARTIFACT-V1\n${digest}`).buffer);
  } catch { return false; }
}

async function parseBundle(raw: string, expectedNetwork: string): Promise<ParsedBundle> {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new ArtifactInputError(); }
  const keys = ['schema', 'network_id', 'publisher_key_id', 'name', 'version', 'compatibility', 'manifest', 'digest', 'signature', 'files'];
  if (!exact(value, keys) || value.schema !== SCHEMA || value.network_id !== expectedNetwork
    || !string(value.publisher_key_id, 128) || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(value.name))
    || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(String(value.version))
    || !HEX.test(String(value.digest)) || !string(value.signature, 1024)
    || !exact(value.compatibility, Object.keys(value.compatibility as object)) || Array.isArray(value.compatibility)
    || !Array.isArray(value.manifest) || !Array.isArray(value.files)
    || value.manifest.length === 0 || value.manifest.length > MAX_FILES || value.files.length !== value.manifest.length) throw new ArtifactInputError();
  const compatibility = value.compatibility as Json;
  if (Object.keys(compatibility).length === 0 || Object.keys(compatibility).some((key) => !['node', 'sherman'].includes(key) || !string(compatibility[key], 80))) throw new ArtifactInputError();
  const files = new Map<string, Uint8Array>();
  for (const file of value.files) {
    if (!exact(file, ['path', 'content_base64']) || !safeArtifactPath(file.path) || files.has(file.path)) throw new ArtifactInputError();
    const bytes = decodeBase64(file.content_base64); if (bytes.length > MAX_FILE_BYTES) throw new ArtifactInputError(true);
    if (!safeArtifactBytes(bytes)) throw new ArtifactInputError();
    files.set(file.path, bytes);
  }
  const manifest: ArtifactEnvelope['manifest'] = []; let expanded = 0; const paths = new Set<string>();
  for (const item of value.manifest) {
    if (!exact(item, ['path', 'size', 'sha256']) || !safeArtifactPath(item.path) || paths.has(item.path)
      || !Number.isSafeInteger(item.size) || Number(item.size) < 0 || Number(item.size) > MAX_FILE_BYTES || !HEX.test(String(item.sha256))) throw new ArtifactInputError();
    paths.add(item.path); const bytes = files.get(item.path); expanded += Number(item.size);
    if (!bytes || bytes.length !== item.size || await sha256(bytes) !== item.sha256) throw new ArtifactInputError();
    manifest.push({ path: item.path, size: Number(item.size), sha256: String(item.sha256) });
  }
  if (expanded > MAX_EXPANDED_BYTES) throw new ArtifactInputError(true);
  manifest.sort((left, right) => left.path.localeCompare(right.path));
  const normalizedCompatibility: Record<string, string> = {};
  for (const key of ['node', 'sherman']) if (compatibility[key] !== undefined) normalizedCompatibility[key] = String(compatibility[key]);
  const envelope: ArtifactEnvelope = { schema: SCHEMA, network_id: expectedNetwork, publisher_key_id: value.publisher_key_id, name: String(value.name), version: String(value.version), compatibility: normalizedCompatibility, manifest };
  if (await sha256(JSON.stringify(envelope)) !== value.digest) throw new ArtifactInputError();
  return { envelope, digest: value.digest, signature: value.signature, bytes: new TextEncoder().encode(raw), manifestJson: JSON.stringify(manifest), compatibilityJson: JSON.stringify(normalizedCompatibility) };
}

type Publisher = { publicKey: string; organizationId: string | null; deviceId: string };
async function trustedPublisher(database: CommonsDatabase, networkId: string, keyId: string, deviceId: string): Promise<Publisher | null> {
  return database.prepare(`SELECT key.public_key AS publicKey, key.organization_id AS organizationId, key.device_id AS deviceId
    FROM artifact_publisher_keys AS key JOIN devices AS device
      ON device.network_id = key.network_id AND device.id = key.device_id
    WHERE key.network_id = ? AND key.id = ? AND key.device_id = ? AND key.status = 'active' AND key.revoked_at IS NULL
      AND device.status = 'active' AND device.revoked_at IS NULL`).bind(networkId, keyId, deviceId).first<Publisher>();
}

routes.post('/device/v1/artifacts', async (context) => {
  const database = requireDatabase(context.env.DB); const actor = context.get('agent'); const raw = await context.req.text();
  let parsed: ParsedBundle;
  try { parsed = await parseBundle(raw, actor.networkId); }
  catch (error) {
    await auditStatement(database, { networkId: actor.networkId, organizationId: actor.organizationId, actorType: 'agent', actorId: actor.agentId, action: 'artifact.publish', targetType: 'artifact', targetId: null, result: 'denied', reasonCode: 'invalid_artifact' }).run();
    return context.json({ error: error instanceof ArtifactInputError && error.tooLarge ? 'request_too_large' : 'invalid_request' }, error instanceof ArtifactInputError && error.tooLarge ? 413 : 400);
  }
  const publisher = await trustedPublisher(database, actor.networkId, parsed.envelope.publisher_key_id, actor.deviceId);
  if (!publisher || !await verifySignature(publisher.publicKey, parsed.digest, parsed.signature)) {
    await auditStatement(database, { networkId: actor.networkId, organizationId: actor.organizationId, actorType: 'agent', actorId: actor.agentId, action: 'artifact.publish', targetType: 'artifact', targetId: null, result: 'denied', reasonCode: 'publisher_verification_failed' }).run();
    return context.json({ error: 'invalid_request' }, 400);
  }
  const executor = new D1MutationExecutor(database);
  try {
    const replay = await executor.replay(actor);
    if (replay) return context.json({ id: replay.resultId, scan_status: 'pending', replayed: true }, 202);
  } catch (error) {
    if (error instanceof MutationGuardError) return context.json({ error: error.code }, 409);
    throw error;
  }
  const collision = await database.prepare('SELECT id FROM artifact_publications WHERE network_id = ? AND publisher_key_id = ? AND name = ? AND version = ?')
    .bind(actor.networkId, parsed.envelope.publisher_key_id, parsed.envelope.name, parsed.envelope.version).first<{ id: string }>();
  if (collision) return context.json({ error: 'version_conflict' }, 409);
  const id = crypto.randomUUID(); const now = Math.floor(Date.now() / 1000);
  const publication = database.prepare(`INSERT INTO artifact_publications
    (id, network_id, organization_id, visibility, publisher_key_id, publisher_device_id, schema_name, name, version, digest_sha256,
      publisher_signature, compatibility_json, manifest_json, byte_size, content_type, created_at)
    VALUES (?, ?, ?, 'network', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, actor.networkId, publisher.organizationId, parsed.envelope.publisher_key_id, actor.deviceId, SCHEMA, parsed.envelope.name,
      parsed.envelope.version, parsed.digest, parsed.signature, parsed.compatibilityJson, parsed.manifestJson, parsed.bytes.byteLength, MEDIA_TYPE, now);
  const quarantine = database.prepare(`INSERT INTO artifact_quarantine_bytes
    (network_id, publication_id, digest_sha256, byte_size, bundle_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(actor.networkId, id, parsed.digest, parsed.bytes.byteLength, parsed.bytes, now);
  try {
    const result = await executor.execute(actor, [publication, quarantine,
      auditStatement(database, { networkId: actor.networkId, organizationId: publisher.organizationId, actorType: 'agent', actorId: actor.agentId, action: 'artifact.publish', targetType: 'artifact', targetId: id, result: 'allowed', reasonCode: 'quarantined', createdAt: now })], { type: 'artifact', id });
    return context.json({ id: result.resultId, scan_status: 'pending', replayed: result.replayed }, 202);
  } catch (error) {
    if (error instanceof MutationGuardError) return context.json({ error: error.code }, error.code === 'mutation_failed' ? 503 : 409);
    throw error;
  }
});

function scannerAuthorized(request: Request, token: string | undefined): boolean {
  if (!token || token.length < 16) return false;
  const provided = request.headers.get('authorization'); if (provided !== `Bearer ${token}`) return false;
  let difference = provided.length ^ (`Bearer ${token}`).length;
  for (let index = 0; index < provided.length; index += 1) difference |= provided.charCodeAt(index) ^ (`Bearer ${token}`).charCodeAt(index);
  return difference === 0;
}

routes.get('/scanner/v1/artifacts/:id', async (context) => {
  if (!scannerAuthorized(context.req.raw, context.env.SCANNER_CALLBACK_TOKEN)) return context.json({ error: 'not_found' }, 404);
  const database = requireDatabase(context.env.DB); const row = await database.prepare(`SELECT bytes.bundle_bytes AS bytes, publication.content_type AS contentType,
      publication.byte_size AS byteSize, publication.digest_sha256 AS digest, publication.version AS version
    FROM artifact_publications AS publication JOIN artifact_quarantine_bytes AS bytes
      ON bytes.network_id = publication.network_id AND bytes.publication_id = publication.id
    WHERE publication.network_id = ? AND publication.id = ? AND NOT EXISTS (
      SELECT 1 FROM artifact_scan_results
      WHERE network_id = publication.network_id AND publication_id = publication.id AND expires_at > ?)`)
    .bind(context.env.NETWORK_ID, context.req.param('id'), Math.floor(Date.now() / 1000))
    .first<{ bytes: unknown; contentType: string; byteSize: number; digest: string; version: string }>();
  if (!row) return context.json({ error: 'not_found' }, 404);
  const bytes = normalizeStoredBytes(row.bytes);
  if (!bytes || bytes.byteLength !== row.byteSize) return context.json({ error: 'not_found' }, 404);
  return new Response(bytes.slice().buffer, { headers: { 'content-type': row.contentType, 'content-length': String(row.byteSize), 'x-artifact-digest': row.digest, 'x-artifact-version': row.version, 'cache-control': 'no-store' } });
});

routes.post('/scanner/v1/artifacts/:id/result', async (context) => {
  if (!scannerAuthorized(context.req.raw, context.env.SCANNER_CALLBACK_TOKEN) || !context.env.SCANNER_VERSION) return context.json({ error: 'not_found' }, 404);
  let value: unknown; try { value = await context.req.json(); } catch { return context.json({ error: 'not_found' }, 404); }
  if (!exact(value, ['status', 'artifact_digest', 'artifact_version', 'scanner_version', 'scanned_at'])
    || !['passed', 'rejected'].includes(String(value.status)) || !HEX.test(String(value.artifact_digest)) || !string(value.artifact_version, 80)
    || value.scanner_version !== context.env.SCANNER_VERSION || !Number.isSafeInteger(value.scanned_at)) return context.json({ error: 'not_found' }, 404);
  const database = requireDatabase(context.env.DB); const id = context.req.param('id');
  const publication = await database.prepare(`SELECT version, digest_sha256 AS digest FROM artifact_publications
    WHERE network_id = ? AND id = ?`).bind(context.env.NETWORK_ID, id).first<{ version: string; digest: string }>();
  const now = Math.floor(Date.now() / 1000); const maxAge = Number(context.env.SCAN_MAX_AGE_SECONDS ?? '86400');
  if (!publication || publication.version !== value.artifact_version || publication.digest !== value.artifact_digest
    || Number(value.scanned_at) > now + MAX_SCAN_CLOCK_SKEW || Number(value.scanned_at) < now - maxAge || !Number.isSafeInteger(maxAge) || maxAge < 60) return context.json({ error: 'not_found' }, 404);
  try {
    await database.batch([
      database.prepare(`INSERT INTO artifact_scan_results
        (id, network_id, publication_id, artifact_digest, artifact_version, scanner_version, status, scanned_at, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), context.env.NETWORK_ID, id, publication.digest, publication.version, value.scanner_version, value.status, value.scanned_at, Number(value.scanned_at) + maxAge, now),
      auditStatement(database, { networkId: context.env.NETWORK_ID, organizationId: null, actorType: 'system', actorId: null, action: 'artifact.scan_result', targetType: 'artifact', targetId: id, result: 'allowed', reasonCode: String(value.status), createdAt: now }),
    ]);
  } catch { return context.json({ error: 'not_found' }, 404); }
  return new Response(null, { status: 204 });
});

const visibility = `(publication.visibility = 'network'
  OR (publication.visibility = 'organization' AND publication.organization_id = ?)
  OR (publication.visibility = 'private' AND key.owner_user_id = ?))`;

routes.get('/human/v1/library', async (context) => {
  const human = context.get('human'); const database = requireDatabase(context.env.DB); const now = Math.floor(Date.now() / 1000);
  const result = await database.prepare(`SELECT publication.id, publication.name, publication.version, publication.digest_sha256 AS digest,
      publication.compatibility_json AS compatibilityJson, publication.manifest_json AS manifestJson, publication.created_at AS createdAt,
      key.id AS publisherKeyId, key.status AS publisherStatus, scan.status AS scanStatus, scan.scanner_version AS scannerVersion,
      scan.scanned_at AS scannedAt, scan.expires_at AS expiresAt
    FROM artifact_publications AS publication JOIN artifact_publisher_keys AS key
      ON key.network_id = publication.network_id AND key.id = publication.publisher_key_id
    LEFT JOIN artifact_scan_results AS scan ON scan.network_id = publication.network_id AND scan.id = (
      SELECT latest.id FROM artifact_scan_results AS latest
      WHERE latest.network_id = publication.network_id AND latest.publication_id = publication.id
      ORDER BY latest.scanned_at DESC, latest.created_at DESC, latest.id DESC LIMIT 1)
    WHERE publication.network_id = ? AND ${visibility} ORDER BY publication.created_at DESC, publication.id DESC LIMIT 5`)
    .bind(human.networkId, human.organizationId, human.userId).all<any>();
  return context.json({ artifacts: result.results.map((row) => ({
    id: row.id, name: row.name, version: row.version, digest_sha256: row.digest, publisher_key_id: row.publisherKeyId,
    publisher: { status: row.publisherStatus }, compatibility: JSON.parse(row.compatibilityJson), files: JSON.parse(row.manifestJson), created_at: row.createdAt,
    scan: row.scanStatus ? { status: row.scanStatus, scanner_version: row.scannerVersion, scanned_at: row.scannedAt, expires_at: row.expiresAt, current: row.expiresAt > now && row.scannerVersion === context.env.SCANNER_VERSION } : { status: 'pending' },
    endorsements: { available: false, count: 0 }, changelog: { available: false },
  })) });
});

async function validDownload(database: CommonsDatabase, networkId: string, id: string, organizationId: string | null, userId: string, now: number, scannerVersion: string) {
  const row = await database.prepare(`SELECT publication.*, bytes.bundle_bytes AS bundleBytes, bytes.byte_size AS storedSize,
      key.public_key AS publicKey, key.status AS publisherStatus, key.revoked_at AS publisherRevokedAt,
      device.status AS deviceStatus, device.revoked_at AS deviceRevokedAt,
      scan.status AS scanStatus, scan.scanner_version AS scannerVersion, scan.artifact_digest AS scanDigest,
      scan.artifact_version AS scanVersion, scan.scanned_at AS scannedAt, scan.expires_at AS expiresAt
    FROM artifact_publications AS publication
    JOIN artifact_quarantine_bytes AS bytes ON bytes.network_id = publication.network_id AND bytes.publication_id = publication.id
    JOIN artifact_publisher_keys AS key ON key.network_id = publication.network_id AND key.id = publication.publisher_key_id
    JOIN devices AS device ON device.network_id = key.network_id AND device.id = key.device_id
    JOIN artifact_scan_results AS scan ON scan.network_id = publication.network_id AND scan.id = (
      SELECT latest.id FROM artifact_scan_results AS latest
      WHERE latest.network_id = publication.network_id AND latest.publication_id = publication.id
      ORDER BY latest.scanned_at DESC, latest.created_at DESC, latest.id DESC LIMIT 1)
    WHERE publication.network_id = ? AND publication.id = ? AND ${visibility}
      AND key.status = 'active' AND key.revoked_at IS NULL AND device.status = 'active' AND device.revoked_at IS NULL
      AND scan.status = 'passed' AND scan.expires_at > ? AND scan.artifact_digest = publication.digest_sha256
      AND scan.artifact_version = publication.version AND scan.scanner_version = ? AND scan.scanned_at <= ?`)
    .bind(networkId, id, organizationId, userId, now, scannerVersion, now).first<any>();
  if (!row) return null;
  const bytes = normalizeStoredBytes(row.bundleBytes);
  if (!bytes) return null;
  if (bytes.byteLength !== row.byte_size || bytes.byteLength !== row.storedSize) return null;
  let parsed: ParsedBundle; try { parsed = await parseBundle(new TextDecoder().decode(bytes), networkId); } catch { return null; }
  if (parsed.digest !== row.digest_sha256 || parsed.signature !== row.publisher_signature || parsed.envelope.publisher_key_id !== row.publisher_key_id
    || parsed.envelope.version !== row.version || parsed.envelope.name !== row.name || !await verifySignature(row.publicKey, parsed.digest, parsed.signature)) return null;
  let artifact: unknown; try { artifact = JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
  return { bytes, contentType: row.content_type as string, artifact, row };
}

routes.get('/human/v1/artifacts/:id/download', async (context) => {
  const human = context.get('human');
  if (!context.env.SCANNER_VERSION) return context.json({ error: 'not_found' }, 404);
  const result = await validDownload(requireDatabase(context.env.DB), human.networkId, context.req.param('id'), human.organizationId, human.userId, Math.floor(Date.now() / 1000), context.env.SCANNER_VERSION);
  if (!result) return context.json({ error: 'not_found' }, 404);
  return new Response(result.bytes.slice().buffer, { headers: { 'content-type': result.contentType, 'content-length': String(result.bytes.byteLength), 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
});

routes.get('/device/v1/artifacts/:id/download', async (context) => {
  const actor = context.get('agent');
  if (!context.env.SCANNER_VERSION) return context.json({ error: 'not_found' }, 404);
  const result = await validDownload(requireDatabase(context.env.DB), actor.networkId, context.req.param('id'), actor.organizationId,
    actor.ownerUserId, Math.floor(Date.now() / 1000), context.env.SCANNER_VERSION);
  if (!result) return context.json({ error: 'not_found' }, 404);
  return context.json({
    artifact: result.artifact,
    trust: {
      network_id: result.row.network_id, publisher_key_id: result.row.publisher_key_id,
      device_id: result.row.publisher_device_id, public_key: result.row.publicKey,
      publisher_status: result.row.publisherStatus, publisher_revoked_at: result.row.publisherRevokedAt,
      device_status: result.row.deviceStatus, device_revoked_at: result.row.deviceRevokedAt,
      current_scanner_version: context.env.SCANNER_VERSION,
      scan: {
        status: result.row.scanStatus, scanner_version: result.row.scannerVersion,
        artifact_digest: result.row.scanDigest, artifact_version: result.row.scanVersion,
        scanned_at: result.row.scannedAt, expires_at: result.row.expiresAt,
      },
    },
  }, 200, { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
});

export default routes;
