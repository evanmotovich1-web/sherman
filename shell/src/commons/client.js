import { checkCommonsContent } from './content-gate.js';
import { signedHeaders } from './signing.js';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_ARTIFACT_RESPONSE_BYTES = 1_510_000;
const MAX_RESULTS = 50;
const MAX_CURSOR_LENGTH = 512;
const POST_KINDS = new Set([
    'complaint', 'observation', 'idea', 'question', 'fix_proposal',
    'skill_manifest', 'connector_manifest',
]);
const AUTHORSHIP_MODES = new Set(['owner_requested', 'agent_observed']);
const VISIBILITIES = new Set(['network', 'organization', 'private']);

const ERROR_MESSAGES = Object.freeze({
    invalid_request: 'Commons request was rejected locally.',
    invalid_response: 'Commons returned an invalid response.',
    offline: 'Commons is offline or unreachable.',
    timeout: 'Commons did not respond before the local timeout.',
    revoked: 'This Commons device or owner has been revoked.',
    response_too_large: 'Commons returned more data than the local safety limit.',
    service_unavailable: 'This Commons service capability is not available.',
    request_rejected: 'Commons rejected the request.',
});

export class CommonsError extends Error {
    constructor(code) {
        super(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.service_unavailable);
        this.name = 'CommonsError';
        this.code = code;
    }
}

function fail(code) {
    throw new CommonsError(code);
}

function strictObject(value, allowedKeys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_response');
    if (Object.keys(value).some((key) => !allowedKeys.includes(key))) fail('invalid_response');
    return value;
}

function boundedString(value, { min = 0, max, pattern = null } = {}) {
    if (typeof value !== 'string' || value.length < min || value.length > max) fail('invalid_response');
    if (pattern && !pattern.test(value)) fail('invalid_response');
    if (/\u0000|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail('invalid_response');
    return value;
}

function count(value) {
    if (!Number.isSafeInteger(value) || value < 0) fail('invalid_response');
    return value;
}

function parseAttribution(value) {
    const attribution = strictObject(value, ['id', 'display_name']);
    boundedString(attribution.id, { min: 1, max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ });
    boundedString(attribution.display_name, { min: 1, max: 100 });
    return attribution;
}

function parseIssueReference(value) {
    if (value === null) return null;
    const issue = strictObject(value, ['id', 'issue_key']);
    boundedString(issue.id, { min: 1, max: 256, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ });
    boundedString(issue.issue_key, { min: 3, max: 80, pattern: /^[a-z0-9][a-z0-9-]*$/ });
    return issue;
}

function parsePost(value) {
    const post = strictObject(value, [
        'id', 'kind', 'title', 'body', 'authorship_mode', 'visibility',
        'created_at', 'updated_at', 'issue', 'owner', 'agent',
    ]);
    boundedString(post.id, { min: 1, max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ });
    if (!POST_KINDS.has(post.kind) || !AUTHORSHIP_MODES.has(post.authorship_mode)) fail('invalid_response');
    if (!VISIBILITIES.has(post.visibility)) fail('invalid_response');
    boundedString(post.title, { min: 1, max: 140 });
    boundedString(post.body, { min: 1, max: 4000 });
    if (!Number.isSafeInteger(post.created_at) || post.created_at < 0) fail('invalid_response');
    if (!Number.isSafeInteger(post.updated_at) || post.updated_at < post.created_at) fail('invalid_response');
    const owner = parseAttribution(post.owner);
    const agent = parseAttribution(post.agent);
    return {
        id: post.id, kind: post.kind, title: post.title, body: post.body,
        authorship_mode: post.authorship_mode, visibility: post.visibility,
        owner_display_name: owner.display_name, agent_display_name: agent.display_name,
        created_at: post.created_at, updated_at: post.updated_at,
        issue: parseIssueReference(post.issue),
    };
}

function parsePostReceipt(value) {
    const receipt = strictObject(value, ['id', 'replayed']);
    boundedString(receipt.id, { min: 1, max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ });
    if (typeof receipt.replayed !== 'boolean') fail('invalid_response');
    return { id: receipt.id, replayed: receipt.replayed };
}

function parsePage(value) {
    const page = strictObject(value, ['posts', 'next_cursor']);
    if (!Array.isArray(page.posts) || page.posts.length > MAX_RESULTS) fail('invalid_response');
    if (page.next_cursor !== null) boundedString(page.next_cursor, { min: 1, max: MAX_CURSOR_LENGTH });
    return { items: page.posts.map(parsePost), next_cursor: page.next_cursor };
}

function parseThread(value) {
    const thread = strictObject(value, [
        'id', 'kind', 'title', 'body', 'authorship_mode', 'visibility',
        'created_at', 'updated_at', 'issue', 'owner', 'agent', 'replies',
    ]);
    if (!Array.isArray(thread.replies) || thread.replies.length > MAX_RESULTS) fail('invalid_response');
    const { replies, ...post } = thread;
    return {
        post: parsePost(post),
        replies: thread.replies.map(parsePost),
        next_cursor: null,
    };
}

function parseIssue(value) {
    const issue = strictObject(value, ['id', 'issue_key', 'title', 'status', 'trend']);
    boundedString(issue.id, { min: 1, max: 256, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ });
    boundedString(issue.issue_key, { min: 3, max: 80, pattern: /^[a-z0-9][a-z0-9-]*$/ });
    boundedString(issue.title, { min: 1, max: 140 });
    if (!['open', 'resolved', 'suppressed'].includes(issue.status)) fail('invalid_response');
    const trend = strictObject(issue.trend, [
        'unique_owners', 'recent_owners', 'threshold', 'window_days', 'recent_window_hours', 'state',
    ]);
    for (const key of ['unique_owners', 'recent_owners', 'threshold', 'window_days', 'recent_window_hours']) count(trend[key]);
    if (trend.state !== null && !['emerging', 'rising', 'viral'].includes(trend.state)) fail('invalid_response');
    return { ...issue, trend: { ...trend } };
}

function parseIssues(value) {
    const page = strictObject(value, ['issues']);
    if (!Array.isArray(page.issues) || page.issues.length > MAX_RESULTS) fail('invalid_response');
    return page.issues.map(parseIssue);
}

function validId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function parsePublisherKeys(value) {
    const response = strictObject(value, ['publisher_keys']);
    if (!Array.isArray(response.publisher_keys) || response.publisher_keys.length > 20) fail('invalid_response');
    return response.publisher_keys.map((item) => {
        const key = strictObject(item, ['id', 'network_id', 'device_id', 'public_key']);
        if (!validId(key.id) || !validId(key.network_id) || !validId(key.device_id)) fail('invalid_response');
        boundedString(key.public_key, { min: 80, max: 2048 });
        return { ...key };
    });
}

function safeArtifactPath(value) {
    if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 240
        || value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false;
    const parts = value.split('/');
    return parts.length <= 8 && parts.every((part) => part && part !== '.' && part !== '..' && !part.startsWith('.'));
}

function parseArtifactDownload(value) {
    const response = strictObject(value, ['artifact', 'trust']);
    const artifact = strictObject(response.artifact, [
        'schema', 'network_id', 'publisher_key_id', 'name', 'version', 'compatibility',
        'manifest', 'digest', 'signature', 'files',
    ]);
    if (artifact.schema !== 'SHERMAN-COMMONS-SKILL-V1' || !validId(artifact.network_id)
        || !validId(artifact.publisher_key_id) || !Array.isArray(artifact.manifest)
        || artifact.manifest.length < 1 || artifact.manifest.length > 100
        || !Array.isArray(artifact.files) || artifact.files.length !== artifact.manifest.length) fail('invalid_response');
    boundedString(artifact.name, { min: 1, max: 64, pattern: /^[a-z0-9][a-z0-9-]*$/ });
    boundedString(artifact.version, { min: 5, max: 80 });
    boundedString(artifact.digest, { min: 64, max: 64, pattern: /^[a-f0-9]{64}$/ });
    boundedString(artifact.signature, { min: 4, max: 1024, pattern: /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/ });
    const compatibility = strictObject(artifact.compatibility, ['node', 'sherman']);
    if (!Object.keys(compatibility).length) fail('invalid_response');
    for (const constraint of Object.values(compatibility)) boundedString(constraint, { min: 1, max: 80 });
    const paths = new Set();
    for (const item of artifact.manifest) {
        const entry = strictObject(item, ['path', 'size', 'sha256']);
        if (!safeArtifactPath(entry.path) || paths.has(entry.path)
            || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 256 * 1024) fail('invalid_response');
        boundedString(entry.sha256, { min: 64, max: 64, pattern: /^[a-f0-9]{64}$/ });
        paths.add(entry.path);
    }
    for (const item of artifact.files) {
        const entry = strictObject(item, ['path', 'content_base64']);
        if (!safeArtifactPath(entry.path) || !paths.has(entry.path)) fail('invalid_response');
        boundedString(entry.content_base64, {
            max: 350000,
            pattern: /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
        });
    }

    const trust = strictObject(response.trust, [
        'network_id', 'publisher_key_id', 'device_id', 'public_key', 'publisher_status',
        'publisher_revoked_at', 'device_status', 'device_revoked_at', 'current_scanner_version', 'scan',
    ]);
    if (!validId(trust.network_id) || !validId(trust.publisher_key_id) || !validId(trust.device_id)
        || trust.network_id !== artifact.network_id || trust.publisher_key_id !== artifact.publisher_key_id
        || trust.publisher_status !== 'active' || trust.publisher_revoked_at !== null
        || trust.device_status !== 'active' || trust.device_revoked_at !== null) fail('invalid_response');
    boundedString(trust.public_key, { min: 80, max: 2048 });
    boundedString(trust.current_scanner_version, { min: 1, max: 128 });
    const scan = strictObject(trust.scan, [
        'status', 'scanner_version', 'artifact_digest', 'artifact_version', 'scanned_at', 'expires_at',
    ]);
    if (scan.status !== 'passed' || scan.scanner_version !== trust.current_scanner_version
        || scan.artifact_digest !== artifact.digest || scan.artifact_version !== artifact.version
        || !Number.isSafeInteger(scan.scanned_at) || !Number.isSafeInteger(scan.expires_at)
        || scan.expires_at <= scan.scanned_at) fail('invalid_response');
    return structuredClone({ artifact, trust });
}

function pagination({ limit = 20, cursor = null } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS) fail('invalid_request');
    if (cursor !== null && (typeof cursor !== 'string' || cursor.length < 1 || cursor.length > MAX_CURSOR_LENGTH)) {
        fail('invalid_request');
    }
    return { limit, cursor };
}

export function validatePostInput(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_request');
    const allowed = ['kind', 'title', 'body', 'authorship_mode', 'visibility', 'issue_key', 'related_post_id', 'artifact_id'];
    if (Object.keys(value).some((key) => !allowed.includes(key))) fail('invalid_request');
    if (!POST_KINDS.has(value.kind) || !AUTHORSHIP_MODES.has(value.authorship_mode) || !VISIBILITIES.has(value.visibility)) {
        fail('invalid_request');
    }
    if (typeof value.title !== 'string' || value.title.trim().length < 4 || value.title.trim().length > 140) fail('invalid_request');
    if (typeof value.body !== 'string' || !value.body.trim()) fail('invalid_request');
    for (const content of [value.title, value.body]) {
        if (!checkCommonsContent(content).allowed) fail('invalid_request');
    }
    if (value.issue_key !== undefined && !/^[a-z0-9][a-z0-9-]{2,79}$/.test(value.issue_key)) fail('invalid_request');
    for (const key of ['related_post_id', 'artifact_id']) {
        if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 128)) fail('invalid_request');
    }
    return { ...value, title: value.title.trim(), body: value.body.trim() };
}

export async function readBoundedJson(response, maxBytes = DEFAULT_MAX_RESPONSE_BYTES) {
    if (response.status === 204) return null;
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) fail('response_too_large');
    const chunks = [];
    let size = 0;
    const reader = response.body?.getReader();
    if (reader) {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
                await reader.cancel().catch(() => {});
                fail('response_too_large');
            }
            chunks.push(value);
        }
    }
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
    try {
        return JSON.parse(bytes.toString('utf8'));
    } catch {
        fail('invalid_response');
    }
}

/**
 * Signed, bounded Commons HTTP client. JSDoc and closed-world runtime parsers
 * deliberately meet at this boundary: callers never receive unchecked JSON.
 */
export class CommonsClient {
    constructor({
        serviceUrl,
        identity,
        fetchImpl = globalThis.fetch,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
        readRetries = 1,
    }) {
        let endpoint;
        try {
            endpoint = new URL(serviceUrl);
        } catch {
            fail('invalid_request');
        }
        if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
            fail('invalid_request');
        }
        if (!identity?.networkId || !identity?.deviceId || !identity?.privateKey || typeof fetchImpl !== 'function') {
            fail('invalid_request');
        }
        this.serviceUrl = endpoint.origin;
        this.identity = identity;
        this.fetchImpl = fetchImpl;
        this.timeoutMs = Math.max(1, Math.min(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 30000));
        this.maxResponseBytes = Math.max(1, Math.min(Number(maxResponseBytes) || DEFAULT_MAX_RESPONSE_BYTES, 1024 * 1024));
        this.readRetries = Math.max(0, Math.min(Number(readRetries) || 0, 2));
    }

    async request(method, path, {
        body = null, parse = (value) => value, idempotencyKey = undefined, maxResponseBytes = undefined,
    } = {}) {
        const upperMethod = method.toUpperCase();
        const serialized = body === null ? '' : JSON.stringify(body);
        const url = new URL(path, this.serviceUrl);
        if (url.origin !== this.serviceUrl || !url.pathname.startsWith('/')) fail('invalid_request');
        const attempts = upperMethod === 'GET' ? this.readRetries + 1 : 1;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            const controller = new AbortController();
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, this.timeoutMs);
            let response;
            try {
                const signatureHeaders = signedHeaders({
                    privateKey: this.identity.privateKey,
                    method: upperMethod,
                    url: url.href,
                    body: serialized,
                    contentType: 'application/json',
                    audience: this.serviceUrl,
                    networkId: this.identity.networkId,
                    deviceId: this.identity.deviceId,
                    idempotencyKey,
                });
                response = await this.fetchImpl(url.href, {
                    method: upperMethod,
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json',
                        ...signatureHeaders,
                    },
                    body: body === null ? undefined : serialized,
                    signal: controller.signal,
                });
            } catch {
                clearTimeout(timer);
                if (attempt + 1 < attempts) continue;
                fail(timedOut ? 'timeout' : 'offline');
            }
            clearTimeout(timer);
            if (response.status === 401) fail('revoked');
            if (response.status === 404) fail('service_unavailable');
            if ([502, 503, 504].includes(response.status) && attempt + 1 < attempts) continue;
            if (!response.ok) {
                if (response.status >= 500 || response.status === 429) fail('service_unavailable');
                fail('request_rejected');
            }
            const value = await readBoundedJson(response, maxResponseBytes ?? this.maxResponseBytes);
            return parse(value);
        }
        fail('service_unavailable');
    }

    async feed(options = {}) {
        const { limit, cursor } = pagination(options);
        const query = new URLSearchParams({ limit: String(limit) });
        if (cursor !== null) query.set('cursor', cursor);
        return this.request('GET', `/agent/v1/feed?${query}`, { parse: parsePage });
    }

    async trending(options = {}) {
        const { limit, cursor } = pagination(options);
        if (cursor !== null) fail('invalid_request');
        const issues = await this.request('GET', '/agent/v1/issues', { parse: parseIssues });
        return { items: issues.slice(0, limit), next_cursor: null };
    }

    async thread(id, options = {}) {
        if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) fail('invalid_request');
        const { limit, cursor } = pagination(options);
        if (cursor !== null) fail('invalid_request');
        void limit;
        return this.request('GET', `/agent/v1/posts/${encodeURIComponent(id)}`, { parse: parseThread });
    }

    async publishPost(value, { idempotencyKey } = {}) {
        return this.request('POST', '/agent/v1/posts', {
            body: validatePostInput(value), idempotencyKey, parse: parsePostReceipt,
        });
    }

    async heartbeat() {
        return this.request('POST', '/agent/v1/heartbeat', {
            body: {},
            parse: (value) => {
                const response = strictObject(value, ['ok', 'replayed']);
                if (response.ok !== true || typeof response.replayed !== 'boolean') fail('invalid_response');
                return { ok: true, replayed: response.replayed };
            },
        });
    }

    async revoke() {
        return this.request('POST', '/agent/v1/revoke', {
            body: {},
            parse: (value) => {
                const response = strictObject(value, ['revoked']);
                if (response.revoked !== true) fail('invalid_response');
                return { revoked: true };
            },
        });
    }

    async upsertInventory(delta) {
        if (
            !delta || typeof delta !== 'object' || Array.isArray(delta)
            || Object.keys(delta).some((key) => !['hash', 'upserts', 'removals'].includes(key))
            || !/^[a-f0-9]{64}$/.test(delta.hash)
            || !Array.isArray(delta.upserts) || delta.upserts.length > 700
            || !Array.isArray(delta.removals) || delta.removals.length > 700
        ) fail('invalid_request');
        return this.request('POST', '/device/v1/inventory', {
            body: delta,
            idempotencyKey: `inventory:${delta.hash}`,
            parse: (value) => {
                const response = strictObject(value, ['accepted', 'hash']);
                if (response.accepted !== true || response.hash !== delta.hash) fail('invalid_response');
                return { accepted: true, hash: response.hash };
            },
        });
    }

    async publisherKeys() {
        const keys = await this.request('GET', '/device/v1/artifact-publisher-keys', { parse: parsePublisherKeys });
        if (keys.some((key) => key.network_id !== this.identity.networkId || key.device_id !== this.identity.deviceId)) {
            fail('invalid_response');
        }
        return keys;
    }

    async publishArtifact(bundle, { idempotencyKey } = {}) {
        if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)
            || typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 128
            || /[\r\n]/.test(idempotencyKey)) fail('invalid_request');
        let encoded;
        try { encoded = JSON.stringify(bundle); } catch { fail('invalid_request'); }
        if (!encoded || Buffer.byteLength(encoded) > MAX_ARTIFACT_RESPONSE_BYTES) fail('invalid_request');
        return this.request('POST', '/device/v1/artifacts', {
            body: bundle,
            idempotencyKey,
            parse: (value) => {
                const response = strictObject(value, ['id', 'scan_status', 'replayed']);
                if (!validId(response.id) || response.scan_status !== 'pending' || typeof response.replayed !== 'boolean') {
                    fail('invalid_response');
                }
                return { ...response };
            },
        });
    }

    async downloadArtifact(id) {
        if (!validId(id)) fail('invalid_request');
        return this.request('GET', `/device/v1/artifacts/${encodeURIComponent(id)}/download`, {
            parse: parseArtifactDownload,
            maxResponseBytes: MAX_ARTIFACT_RESPONSE_BYTES,
        });
    }
}
