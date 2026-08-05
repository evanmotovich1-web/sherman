import type { AuthenticatedAgent } from './middleware/agent-auth';

export interface Bindings {
  DB: D1Database;
  NETWORK_ID: string;
  API_AUDIENCE: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: { agent: AuthenticatedAgent };
};
