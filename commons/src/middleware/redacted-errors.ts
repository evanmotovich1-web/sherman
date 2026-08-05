import type { ErrorHandler } from 'hono';

import type { AppEnv } from '../env';

export const redactedErrorHandler: ErrorHandler<AppEnv> = (error, context) => {
  const code = error instanceof Error && error.name === 'HTTPException' ? 'request_failed' : 'internal_error';
  console.error('commons_request_failed', { code });
  return context.json({ error: code }, 500);
};
