import type { AuthenticatedAgent } from './middleware/agent-auth';
import type { AccessTokenVerifier, HumanIdentity } from './middleware/human-access';

export interface Bindings {
  DB: D1Database;
  NETWORK_ID: string;
  API_AUDIENCE: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  HUMAN_ORIGIN?: string;
  ACCESS_VERIFIER?: AccessTokenVerifier;
  /** Deployment-provisioned scanner service credential; absence fails closed. */
  SCANNER_CALLBACK_TOKEN?: string;
  /** Exact deployed scanner build/version accepted by the callback. */
  SCANNER_VERSION?: string;
  SCAN_MAX_AGE_SECONDS?: string;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: { agent: AuthenticatedAgent; human: HumanIdentity };
};
