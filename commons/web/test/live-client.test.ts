import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveClientError, LiveCommonsClient } from '../src/data/live-client';

const post = {
  id: 'post-1', kind: 'complaint', title: 'Live post', body: 'From the API',
  authorship_mode: 'agent_observed', visibility: 'network', created_at: 1_700_000_000,
  updated_at: 1_700_000_010, issue: { id: 'issue-1', issue_key: 'live-post' },
  owner: { id: 'owner-1', display_name: 'Evan' }, agent: { id: 'agent-1', display_name: 'Sherman' },
};

function jsonResponse(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

function clientFor(response: Response | (() => Promise<Response>), options: { timeoutMs?: number; maxBodyBytes?: number } = {}) {
  const fetcher = vi.fn(typeof response === 'function' ? response : async () => response);
  return { client: new LiveCommonsClient({ fetcher, now: () => 1_700_000_120_000, ...options }), fetcher };
}

afterEach(() => vi.useRealTimers());

describe('LiveCommonsClient', () => {
  it('uses credentialed same-origin GET and maps a closed feed response', async () => {
    const { client, fetcher } = clientFor(jsonResponse({ posts: [post], next_cursor: null }));

    const result = await client.listFeed();
    expect(result).toEqual([expect.objectContaining({
      id: 'post-1', owner: 'Evan', title: 'Live post', age: '2m ago', issueKey: 'live-post',
    })]);
    expect(result[0]).not.toHaveProperty('agreementCount');
    expect(result[0]).not.toHaveProperty('moderationState');
    expect(fetcher).toHaveBeenCalledWith('/human/v1/feed', expect.objectContaining({
      method: 'GET', credentials: 'include', headers: { accept: 'application/json' },
    }));
    expect(client.sourceLabel).toBe('Live Commons API — read only');
  });

  it('maps the deployed trending response without inventing artifact availability', async () => {
    const { client } = clientFor(jsonResponse({ issues: [{
      id: 'issue-1', issue_key: 'live-post', title: 'Live post', status: 'open',
      trend: { unique_owners: 3, recent_owners: 2, threshold: 3, window_days: 7, recent_window_hours: 24, state: 'viral' },
    }] }));
    await expect(client.listTrending()).resolves.toEqual([expect.objectContaining({
      issueKey: 'live-post', state: 'viral', uniqueOwners: 3, recentOwners: 2,
    })]);
  });

  it('maps a thread and its replies from the human GET route', async () => {
    const reply = { ...post, id: 'reply-1', issue: null };
    const { client, fetcher } = clientFor(jsonResponse({ ...post, replies: [reply] }));
    await expect(client.getThread('post /1')).resolves.toEqual(expect.objectContaining({
      root: expect.objectContaining({ id: 'post-1' }), replies: [expect.objectContaining({ id: 'reply-1' })],
    }));
    expect(fetcher).toHaveBeenCalledWith('/human/v1/posts/post%20%2F1', expect.any(Object));
  });

  it.each([401, 403])('returns a generic access error for %s without echoing the body', async (status) => {
    const { client } = clientFor(jsonResponse({ error: '<secret server detail>' }, { status }));
    await expect(client.listFeed()).rejects.toMatchObject({ code: 'access', message: 'Commons access is unavailable.' });
    await client.listFeed().catch((error: LiveClientError) => expect(error.message).not.toContain('secret'));
  });

  it('treats a missing thread as not found', async () => {
    const { client } = clientFor(jsonResponse({ error: 'not_found' }, { status: 404 }));
    await expect(client.getThread('missing')).resolves.toBeNull();
  });

  it('returns a retryable generic rate-limit error for 429', async () => {
    const { client } = clientFor(jsonResponse({ error: 'internal quota details' }, { status: 429 }));
    await expect(client.listTrending()).rejects.toMatchObject({ code: 'rate_limit', message: 'Commons is busy. Please retry shortly.' });
  });

  it('aborts requests at the configured timeout', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const client = new LiveCommonsClient({ fetcher, timeoutMs: 5 });
    const result = client.listFeed();
    const rejection = expect(result).rejects.toMatchObject({ code: 'timeout', message: 'Commons took too long to respond.' });
    await vi.advanceTimersByTimeAsync(5);
    await rejection;
  });

  it('keeps the timeout active while streaming the response body', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(new Response(new ReadableStream({
      start(controller) {
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
      },
    }), { headers: { 'content-type': 'application/json' } })));
    const client = new LiveCommonsClient({ fetcher, timeoutMs: 5 });
    const result = client.listFeed();
    const rejection = expect(result).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(5);
    await rejection;
  });

  it('rejects oversized bodies while reading the response stream', async () => {
    const { client } = clientFor(jsonResponse({ posts: [post], next_cursor: null }), { maxBodyBytes: 20 });
    await expect(client.listFeed()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it.each([
    ['malformed JSON', new Response('{', { headers: { 'content-type': 'application/json' } })],
    ['wrong content type', new Response('{}', { headers: { 'content-type': 'text/html' } })],
    ['lookalike content type', new Response(JSON.stringify({ posts: [post], next_cursor: null }), {
      headers: { 'content-type': 'application/json-patch+json' },
    })],
    ['unknown top-level fields', jsonResponse({ posts: [], next_cursor: null, surprise: true })],
    ['unknown nested fields', jsonResponse({ posts: [{ ...post, secret: true }], next_cursor: null })],
    ['wrong field types', jsonResponse({ posts: [{ ...post, created_at: 'yesterday' }], next_cursor: null })],
  ])('rejects %s with one generic validation error', async (_label, response) => {
    const { client } = clientFor(response);
    await expect(client.listFeed()).rejects.toMatchObject({
      code: 'invalid_response', message: 'Commons returned an invalid response.',
    });
  });
});
