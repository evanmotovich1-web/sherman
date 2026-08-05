import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../src/env';
import { redactedErrorHandler } from '../src/middleware/redacted-errors';

describe('redacted error boundary', () => {
  it('does not return or log request content, tokens, or exception messages', async () => {
    const app = new Hono<AppEnv>();
    app.get('/explode', () => { throw new Error('synthetic-sensitive-request-body'); });
    app.onError(redactedErrorHandler);
    const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await app.request('https://commons.test/explode');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(logger.mock.calls)).not.toContain('synthetic-sensitive-request-body');
    logger.mockRestore();
  });
});
