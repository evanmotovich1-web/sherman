import { createMiddleware } from 'hono/factory';

import { canonicalRequestTarget, sha256Hex, verifySignedRequest } from '../auth/device-signature';
import { requireDatabase, type CommonsDatabase } from '../db';
import type { AppEnv } from '../env';

export type DeviceIdentity = {
  networkId: string;
  organizationId: string | null;
  ownerUserId: string;
  agentId: string;
  deviceId: string;
  publicKey: string;
};

export type AuthenticatedAgent = DeviceIdentity & {
  method: string;
  requestTarget: string;
  bodySha256: string;
  requestTimestamp: number;
  nonce: string;
  idempotencyKey: string;
};

export interface AgentAuthRepository {
  resolveDevice(networkId: string, deviceId: string): Promise<DeviceIdentity | null>;
}

export class D1AgentAuthRepository implements AgentAuthRepository {
  constructor(private readonly database: CommonsDatabase) {}

  async resolveDevice(networkId: string, deviceId: string): Promise<DeviceIdentity | null> {
    const row = await this.database.prepare(`
      SELECT device.network_id AS networkId,
             owner.organization_id AS organizationId,
             device.owner_user_id AS ownerUserId,
             device.agent_id AS agentId,
             device.id AS deviceId,
             device.public_key AS publicKey
      FROM devices AS device
      JOIN users AS owner
        ON owner.network_id = device.network_id
       AND owner.id = device.owner_user_id
      JOIN agents AS agent
        ON agent.network_id = device.network_id
       AND agent.id = device.agent_id
       AND agent.owner_user_id = owner.id
      WHERE device.network_id = ?
        AND device.id = ?
        AND device.status = 'active'
        AND device.revoked_at IS NULL
        AND owner.status = 'active'
        AND owner.revoked_at IS NULL
        AND owner.deleted_at IS NULL
        AND agent.deleted_at IS NULL
    `).bind(networkId, deviceId).first<DeviceIdentity>();
    return row ?? null;
  }

}

type AuthOptions = { networkId: string; audience: string; now: number };

function header(request: Request, name: string): string | null {
  const value = request.headers.get(name);
  return value && value.length <= 4096 && !/[\r\n]/.test(value) ? value : null;
}

export async function authenticateAgentRequest(
  request: Request,
  repository: AgentAuthRepository,
  options: AuthOptions,
): Promise<AuthenticatedAgent | null> {
  try {
    if (header(request, 'x-sherman-protocol') !== 'SHERMAN-COMMONS-V2') return null;
    const networkId = header(request, 'x-sherman-network');
    const deviceId = header(request, 'x-sherman-device');
    const nonce = header(request, 'x-sherman-nonce');
    const idempotencyKey = header(request, 'x-sherman-idempotency-key');
    const signature = header(request, 'x-sherman-signature');
    const timestamp = Number(header(request, 'x-sherman-timestamp'));
    const contentType = header(request, 'content-type');
    if (
      networkId !== options.networkId || !deviceId || !nonce || !idempotencyKey ||
      !signature || !contentType || !Number.isSafeInteger(timestamp)
    ) return null;
    const identity = await repository.resolveDevice(networkId, deviceId);
    if (!identity) return null;
    const body = await request.clone().text();
    const valid = await verifySignedRequest({
      method: request.method,
      url: request.url,
      body,
      contentType,
      audience: options.audience,
      networkId,
      deviceId,
      timestamp,
      nonce,
      idempotencyKey,
      signature,
      publicKey: identity.publicKey,
      now: options.now,
    });
    if (!valid) return null;
    return {
      ...identity,
      method: request.method.toUpperCase(),
      requestTarget: canonicalRequestTarget(request.url),
      bodySha256: await sha256Hex(body),
      requestTimestamp: timestamp,
      nonce,
      idempotencyKey,
    };
  } catch {
    return null;
  }
}

export const agentAuth = createMiddleware<AppEnv>(async (context, next) => {
  const identity = await authenticateAgentRequest(
    context.req.raw,
    new D1AgentAuthRepository(requireDatabase(context.env.DB)),
    {
      networkId: context.env.NETWORK_ID,
      audience: context.env.API_AUDIENCE,
      now: Math.floor(Date.now() / 1000),
    },
  );
  if (!identity) return context.json({ error: 'authentication_failed' }, 401);
  context.set('agent', identity);
  await next();
});
