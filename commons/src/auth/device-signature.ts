const PROTOCOL = 'SHERMAN-COMMONS-V2';

export type CanonicalRequestInput = {
  method: string;
  url: string;
  body: string;
  contentType: string;
  audience: string;
  networkId: string;
  deviceId: string;
  timestamp: number;
  nonce: string;
  idempotencyKey: string;
};

type VerifyInput = CanonicalRequestInput & {
  signature: string;
  publicKey: string;
  now: number;
};

function field(value: unknown, name: string): string {
  const normalized = String(value ?? '');
  if (!normalized || normalized.length > 512 || /[\r\n]/.test(normalized)) throw new Error(`invalid ${name}`);
  return normalized;
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
}

function comparePair([aKey, aValue]: [string, string], [bKey, bValue]: [string, string]): number {
  if (aKey < bKey) return -1;
  if (aKey > bKey) return 1;
  if (aValue < bValue) return -1;
  if (aValue > bValue) return 1;
  return 0;
}

function normalizedPathAndQuery(urlValue: string): { origin: string; pathAndQuery: string } {
  const url = new URL(urlValue);
  if (url.username || url.password || url.hash) throw new Error('invalid request URL');
  const path = url.pathname.split('/').map((part) => encodeRfc3986(decodeURIComponent(part))).join('/');
  const pairs = [...url.searchParams.entries()].sort(comparePair);
  const query = pairs.map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`).join('&');
  return { origin: url.origin, pathAndQuery: `${path}${query ? `?${query}` : ''}` };
}

export function canonicalRequestTarget(urlValue: string): string {
  return normalizedPathAndQuery(urlValue).pathAndQuery;
}

function normalizedContentType(value: string): string {
  return field(value, 'content type').split(';').map((part) => part.trim().toLowerCase()).join(';');
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes))));
}

export async function canonicalRequest(input: CanonicalRequestInput): Promise<string> {
  const { origin, pathAndQuery } = normalizedPathAndQuery(input.url);
  const audience = new URL(field(input.audience, 'audience')).origin;
  if (origin !== audience) throw new Error('request URL does not match audience');
  if (!Number.isSafeInteger(input.timestamp)) throw new Error('invalid timestamp');
  return [
    PROTOCOL,
    audience,
    field(input.networkId, 'network ID'),
    field(input.deviceId, 'device ID'),
    field(input.method, 'method').toUpperCase(),
    pathAndQuery,
    normalizedContentType(input.contentType),
    await sha256Hex(input.body ?? ''),
    String(input.timestamp),
    field(input.nonce, 'nonce'),
    field(input.idempotencyKey, 'idempotency key'),
  ].join('\n');
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function decodePem(value: string): Uint8Array {
  return decodeBase64(value.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, ''));
}

export async function verifySignedRequest(input: VerifyInput): Promise<boolean> {
  if (!Number.isSafeInteger(input.timestamp) || Math.abs(input.now - input.timestamp) > 60) return false;
  try {
    const key = await crypto.subtle.importKey('spki', toArrayBuffer(decodePem(input.publicKey)), { name: 'Ed25519' }, false, ['verify']);
    const canonical = new TextEncoder().encode(await canonicalRequest(input));
    return crypto.subtle.verify(
      'Ed25519', key, toArrayBuffer(decodeBase64(input.signature)), toArrayBuffer(canonical),
    );
  } catch {
    return false;
  }
}
