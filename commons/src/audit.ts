import type { CommonsDatabase } from './db';

export type AuditInput = {
  networkId: string;
  organizationId: string | null;
  actorType: 'user' | 'agent' | 'system';
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  result: 'allowed' | 'denied' | 'failed';
  reasonCode: string | null;
  createdAt?: number;
};

export function auditStatement(database: CommonsDatabase, input: AuditInput): D1PreparedStatement {
  return database.prepare(`
    INSERT INTO audit_events (id, network_id, organization_id, actor_type, actor_id, action, target_type, target_id, result, reason_code, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), input.networkId, input.organizationId, input.actorType, input.actorId, input.action,
    input.targetType, input.targetId, input.result, input.reasonCode,
    input.createdAt ?? Math.floor(Date.now() / 1000));
}
