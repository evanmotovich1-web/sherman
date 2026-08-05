import { describe, expect, it } from 'vitest';

import app from '../src/index';

describe('health endpoint', () => {
  it('returns liveness without exposing network data', async () => {
    const response = await app.request('https://commons.test/healthz');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: 'sherman-commons' });
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
});
