import { verifyWithJwks } from 'hono/jwt';
import { createMiddleware } from 'hono/factory';

import { requireDatabase } from '../db';
import type { AppEnv } from '../env';

export type AccessClaims = { sub: string; email: string; identityNonce?: string };
export interface AccessTokenVerifier { verify(token: string): Promise<AccessClaims> }

export type HumanIdentity = {
  networkId: string;
  organizationId: string | null;
  userId: string;
  displayName: string;
  role: 'member' | 'organization_admin' | 'network_admin';
};

type VerifyOptions = {
  issuer: string;
  audience: string;
  keys?: JsonWebKey[];
  jwksUri?: string;
};

export async function verifyCloudflareAccessToken(token: string, options: VerifyOptions): Promise<AccessClaims> {
  const payload = await verifyWithJwks(token, {
    keys: options.keys as never,
    jwks_uri: options.jwksUri,
    allowedAlgorithms: ['RS256'],
    verification: { iss: options.issuer, aud: options.audience, exp: true, nbf: true, iat: true },
  });
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)
    || typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)
    || typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string' || !payload.email
    || typeof payload.identity_nonce !== 'string' || !payload.identity_nonce.trim() || payload.identity_nonce.length > 256) {
    throw new Error('invalid_access_claims');
  }
  return { sub: payload.sub, email: payload.email.toLowerCase(), identityNonce: payload.identity_nonce };
}

class RemoteAccessVerifier implements AccessTokenVerifier {
  constructor(private readonly issuer: string, private readonly audience: string) {}
  verify(token: string): Promise<AccessClaims> {
    return verifyCloudflareAccessToken(token, {
      issuer: this.issuer,
      audience: this.audience,
      jwksUri: `${this.issuer}/cdn-cgi/access/certs`,
    });
  }
}

function csrfAllowed(request: Request, expectedOrigin: string | undefined): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return true;
  if (!expectedOrigin || request.headers.get('origin') !== expectedOrigin) return false;
  const supplied = request.headers.get('x-csrf-token');
  if (!supplied || supplied.length > 256) return false;
  const cookies = request.headers.get('cookie')?.split(';').map((part) => part.trim()) ?? [];
  const cookie = cookies.find((part) => part.startsWith('sherman_csrf='))?.slice('sherman_csrf='.length);
  return Boolean(cookie && cookie === supplied);
}

export const humanAccess = createMiddleware<AppEnv>(async (context, next) => {
  const token = context.req.header('cf-access-jwt-assertion');
  if (!token || token.length > 16_384) return context.json({ error: 'authentication_failed' }, 401);
  try {
    const teamDomain = context.env.CF_ACCESS_TEAM_DOMAIN;
    const audience = context.env.CF_ACCESS_AUD;
    const verifier = context.env.ACCESS_VERIFIER ?? (teamDomain && audience
      ? new RemoteAccessVerifier(`https://${teamDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`, audience)
      : null);
    if (!verifier) return context.json({ error: 'authentication_failed' }, 401);
    const claims = await verifier.verify(token);
    if (!csrfAllowed(context.req.raw, context.env.HUMAN_ORIGIN)) {
      return context.json({ error: 'request_forbidden' }, 403);
    }
    const database = requireDatabase(context.env.DB);
    const identity = await database.prepare(`
      SELECT network_id AS networkId, organization_id AS organizationId, id AS userId,
             display_name AS displayName, role
      FROM users
      WHERE network_id = ? AND access_subject = ?
        AND status = 'active' AND revoked_at IS NULL AND deleted_at IS NULL
    `).bind(context.env.NETWORK_ID, claims.sub).first<HumanIdentity>();
    if (!identity) return context.json({ error: 'authentication_failed' }, 401);
    context.set('human', identity);
  } catch {
    return context.json({ error: 'authentication_failed' }, 401);
  }
  await next();
});
