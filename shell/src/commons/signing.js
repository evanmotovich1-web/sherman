import { createHash, randomUUID, sign } from 'node:crypto';

const PROTOCOL = 'SHERMAN-COMMONS-V2';

function field(value, name) {
    const normalized = String(value ?? '');
    if (!normalized || normalized.length > 512 || /[\r\n]/.test(normalized)) {
        throw new Error(`invalid ${name}`);
    }
    return normalized;
}

function encodeRfc3986(value) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) => (
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    ));
}

function comparePair([aKey, aValue], [bKey, bValue]) {
    if (aKey < bKey) return -1;
    if (aKey > bKey) return 1;
    if (aValue < bValue) return -1;
    if (aValue > bValue) return 1;
    return 0;
}

function normalizedPathAndQuery(urlValue) {
    const url = new URL(urlValue);
    if (url.username || url.password || url.hash) throw new Error('invalid request URL');
    const path = url.pathname.split('/').map((part) => encodeRfc3986(decodeURIComponent(part))).join('/');
    const pairs = [...url.searchParams.entries()].sort(comparePair);
    const query = pairs.map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`).join('&');
    return { origin: url.origin, pathAndQuery: `${path}${query ? `?${query}` : ''}` };
}

function normalizedContentType(value) {
    return field(value, 'content type').split(';').map((part) => part.trim().toLowerCase()).join(';');
}

export function canonicalRequest(input) {
    const { origin, pathAndQuery } = normalizedPathAndQuery(input.url);
    const audience = new URL(field(input.audience, 'audience')).origin;
    if (origin !== audience) throw new Error('request URL does not match audience');
    const digest = createHash('sha256').update(input.body ?? '').digest('hex');
    return [
        PROTOCOL,
        audience,
        field(input.networkId, 'network ID'),
        field(input.deviceId, 'device ID'),
        field(input.method, 'method').toUpperCase(),
        pathAndQuery,
        normalizedContentType(input.contentType),
        digest,
        String(input.timestamp),
        field(input.nonce, 'nonce'),
        field(input.idempotencyKey, 'idempotency key'),
    ].join('\n');
}

export function signedHeaders({
    privateKey,
    timestamp = Math.floor(Date.now() / 1000),
    nonce = randomUUID(),
    idempotencyKey = randomUUID(),
    ...request
}) {
    const canonical = canonicalRequest({ ...request, timestamp, nonce, idempotencyKey });
    const signature = sign(null, Buffer.from(canonical), privateKey).toString('base64');
    return {
        'X-Sherman-Protocol': PROTOCOL,
        'X-Sherman-Device': request.deviceId,
        'X-Sherman-Network': request.networkId,
        'X-Sherman-Timestamp': String(timestamp),
        'X-Sherman-Nonce': nonce,
        'X-Sherman-Idempotency-Key': idempotencyKey,
        'X-Sherman-Signature': signature,
    };
}
