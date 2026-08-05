import { generateKeyPairSync, sign as rsaSign } from 'node:crypto';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import app from '../src/index';
import type { AppEnv } from '../src/env';
import { humanAccess, verifyCloudflareAccessToken, type AccessTokenVerifier } from '../src/middleware/human-access';
import { redactedErrorHandler } from '../src/middleware/redacted-errors';

const now = Math.floor(Date.now() / 1000);
const issuer = 'https://team.cloudflareaccess.com';
const audience = 'access-audience';

async function keyFixture() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: 'jwk' });
  const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const kid = 'access-key';
  return { keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' }], privatePem, kid };
}

function token(claims: Record<string, unknown>, privatePem: string, kid: string): string {
  const encoded = [
    Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
  ];
  return `${encoded.join('.')}.${rsaSign('RSA-SHA256', Buffer.from(encoded.join('.')), privatePem).toString('base64url')}`;
}

describe('verified Cloudflare Access human identity', () => {
  it('verifies signature, issuer, audience, and expiry against JWKS', async () => {
    const key = await keyFixture();
    const valid = token({ sub: 'access-user', email: 'owner@example.test', identity_nonce: 'access-session-nonce', iss: issuer, aud: audience, iat: now, exp: now + 60 }, key.privatePem, key.kid);
    await expect(verifyCloudflareAccessToken(valid, { issuer, audience, keys: key.keys })).resolves.toMatchObject({ sub: 'access-user', email: 'owner@example.test', identityNonce: 'access-session-nonce' });

    for (const claims of [
      { iss: 'https://attacker.invalid', aud: audience, exp: now + 60 },
      { iss: issuer, aud: 'wrong-audience', exp: now + 60 },
      { iss: issuer, aud: audience, exp: now - 1 },
    ]) {
      const invalid = token({ sub: 'access-user', email: 'owner@example.test', identity_nonce: 'access-session-nonce', iat: now - 120, ...claims }, key.privatePem, key.kid);
      await expect(verifyCloudflareAccessToken(invalid, { issuer, audience, keys: key.keys })).rejects.toThrow();
    }
  });

  it('requires a bounded nonempty Cloudflare Access identity nonce claim', async () => {
    const key = await keyFixture();
    for (const identityNonce of [undefined, '', 'x'.repeat(257)]) {
      const claims: Record<string, unknown> = {
        sub: 'access-user', email: 'owner@example.test', identity_nonce: identityNonce,
        iss: issuer, aud: audience, iat: now, exp: now + 60,
      };
      if (identityNonce === undefined) delete claims.identity_nonce;
      await expect(verifyCloudflareAccessToken(token(claims, key.privatePem, key.kid), {
        issuer, audience, keys: key.keys,
      })).rejects.toThrow('invalid_access_claims');
    }
  });

  it('requires both issued-at and expiry lifetime claims', async () => {
    const key = await keyFixture();
    for (const missing of ['iat', 'exp'] as const) {
      const claims: Record<string, unknown> = {
        sub: 'access-user', email: 'owner@example.test', identity_nonce: 'access-session-nonce',
        iss: issuer, aud: audience, iat: now, exp: now + 60,
      };
      delete claims[missing];
      await expect(verifyCloudflareAccessToken(token(claims, key.privatePem, key.kid), {
        issuer, audience, keys: key.keys,
      })).rejects.toThrow('invalid_access_claims');
    }
  });

  it('rejects oversized human mutations before JWT verification or identity lookup', async () => {
    let verificationCalls = 0;
    const verifier: AccessTokenVerifier = {
      verify: async () => {
        verificationCalls += 1;
        return { sub: 'access-user', email: 'owner@example.test' };
      },
    };
    const response = await app.request('https://commons.test/human/v1/admin/invitations', {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': 'valid', 'content-type': 'application/json' },
      body: JSON.stringify({ oversized: 'x'.repeat(2_000) }),
    }, {
      NETWORK_ID: 'network-test', API_AUDIENCE: 'https://commons.test', ACCESS_VERIFIER: verifier,
    });
    expect(response.status).toBe(413);
    expect(verificationCalls).toBe(0);
  });

  it('does not trust identity headers or unverified JWT claims', async () => {
    const response = await app.request('https://commons.test/human/v1/audit', {
      headers: { 'cf-access-authenticated-user-email': 'admin@example.test' },
    }, { NETWORK_ID: 'network-test', API_AUDIENCE: 'https://commons.test', CF_ACCESS_AUD: audience, CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com' });
    expect(response.status).toBe(401);
  });

  it('requires same-origin double-submit CSRF on browser mutations', async () => {
    const verifier: AccessTokenVerifier = { verify: async () => ({ sub: 'access-user', email: 'owner@example.test' }) };
    const response = await app.request('https://commons.test/human/v1/posts', {
      method: 'POST', headers: { 'cf-access-jwt-assertion': 'valid' }, body: '{}',
    }, { NETWORK_ID: 'network-test', API_AUDIENCE: 'https://commons.test', HUMAN_ORIGIN: 'https://commons.test', ACCESS_VERIFIER: verifier });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'request_forbidden' });
  });

  it('lets downstream failures reach the global redacted 500 handler', async () => {
    const downstream = new Hono<AppEnv>();
    downstream.use('*', humanAccess);
    downstream.get('/failure', () => { throw new Error('sensitive downstream detail'); });
    downstream.onError(redactedErrorHandler);
    const verifier: AccessTokenVerifier = { verify: async () => ({ sub: 'access-user', email: 'owner@example.test' }) };
    const database = { prepare: () => ({ bind: () => ({ first: async () => ({
      networkId: 'network-test', organizationId: 'org-a', userId: 'owner-1', displayName: 'Owner', role: 'member',
    }) }) }) };
    const response = await downstream.request('/failure', {
      headers: { 'cf-access-jwt-assertion': 'valid' },
    }, { DB: database as unknown as D1Database, NETWORK_ID: 'network-test', API_AUDIENCE: 'https://commons.test', ACCESS_VERIFIER: verifier });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error' });
  });
});
