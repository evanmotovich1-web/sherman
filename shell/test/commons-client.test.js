import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { CommonsClient, CommonsError } from '../src/commons/client.js';

function identity() {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    return {
        networkId: 'network-test',
        deviceId: 'device-test',
        agentId: 'agent-test',
        ownerDisplayName: 'Test Owner',
        publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
}

const wirePost = {
        id: '10000000-0000-4000-8000-000000000001',
        kind: 'observation',
        title: 'Synthetic operational note',
        body: 'A bounded test post.',
        authorship_mode: 'agent_observed',
        visibility: 'network',
        created_at: 1785900000,
        updated_at: 1785900001,
        issue: null,
        owner: { id: 'owner-test', display_name: 'Test Owner' },
        agent: { id: 'agent-test', display_name: 'Sherman for Test Owner' },
};
const feed = {
    items: [{
        id: wirePost.id, kind: wirePost.kind, title: wirePost.title, body: wirePost.body,
        authorship_mode: wirePost.authorship_mode, visibility: wirePost.visibility,
        owner_display_name: 'Test Owner', agent_display_name: 'Sherman for Test Owner',
        created_at: wirePost.created_at, updated_at: wirePost.updated_at, issue: null,
    }],
    next_cursor: null,
};
const wireFeed = { posts: [wirePost], next_cursor: null };

test('signed reads retry once with fresh signatures and reject unknown response fields', async () => {
    const calls = [];
    const client = new CommonsClient({
        serviceUrl: 'https://commons.test',
        identity: identity(),
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            if (calls.length === 1) throw new TypeError('synthetic offline detail');
            return Response.json(wireFeed);
        },
    });

    assert.deepEqual(await client.feed({ limit: 10 }), feed);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.method, 'GET');
    assert.match(calls[0].options.headers['X-Sherman-Signature'], /^[A-Za-z0-9+/]+=*$/);
    assert.notEqual(calls[0].options.headers['X-Sherman-Nonce'], calls[1].options.headers['X-Sherman-Nonce']);

    const closedWorld = new CommonsClient({
        serviceUrl: 'https://commons.test', identity: identity(),
        fetchImpl: async () => Response.json({ ...wireFeed, raw_server_debug: 'must not escape' }),
    });
    await assert.rejects(() => closedWorld.feed(), (error) => (
        error instanceof CommonsError
        && error.code === 'invalid_response'
        && !error.message.includes('must not escape')
    ));
});

test('thread and trending normalize the deployed read contracts with closed-world fields', async () => {
    const issue = {
        id: 'issue:network-test:network:synthetic-issue', issue_key: 'synthetic-issue',
        title: 'Synthetic issue', status: 'open',
        trend: {
            unique_owners: 3, recent_owners: 2, threshold: 3,
            window_days: 7, recent_window_hours: 24, state: 'viral',
        },
    };
    const client = new CommonsClient({
        serviceUrl: 'https://commons.test', identity: identity(),
        fetchImpl: async (url) => {
            if (url.includes('/issues')) return Response.json({ issues: [issue] });
            return Response.json({ ...wirePost, replies: [wirePost] });
        },
    });
    assert.deepEqual(await client.trending({ limit: 10 }), { items: [issue], next_cursor: null });
    assert.deepEqual(await client.thread(wirePost.id, { limit: 10 }), {
        post: feed.items[0], replies: [feed.items[0]], next_cursor: null,
    });
});

test('writes are signed, never retried, and transport errors are redacted', async () => {
    let calls = 0;
    const client = new CommonsClient({
        serviceUrl: 'https://commons.test', identity: identity(),
        fetchImpl: async () => {
            calls += 1;
            throw new TypeError('Authorization: Bearer synthetic-secret-value');
        },
    });
    await assert.rejects(() => client.publishPost({
        kind: 'idea', title: 'Synthetic bounded proposal', body: 'Try a bounded local test.',
        authorship_mode: 'agent_observed', visibility: 'network',
    }), (error) => (
        error instanceof CommonsError
        && error.code === 'offline'
        && !error.message.includes('synthetic-secret-value')
    ));
    assert.equal(calls, 1);

    const successful = new CommonsClient({
        serviceUrl: 'https://commons.test', identity: identity(),
        fetchImpl: async () => Response.json({ id: 'post-server-id', replayed: false }, { status: 201 }),
    });
    assert.deepEqual(await successful.publishPost({
        kind: 'idea', title: 'Synthetic bounded proposal', body: 'Try a bounded local test.',
        authorship_mode: 'agent_observed', visibility: 'network',
    }, { idempotencyKey: 'intent:synthetic' }), { id: 'post-server-id', replayed: false });
});

test('inventory sync uses the signed device boundary and a hash-bound idempotency key', async () => {
    let call;
    const hash = 'a'.repeat(64);
    const client = new CommonsClient({
        serviceUrl: 'https://commons.test', identity: identity(),
        fetchImpl: async (url, options) => {
            call = { url, options };
            return Response.json({ accepted: true, hash });
        },
    });
    assert.deepEqual(await client.upsertInventory({ hash, upserts: [], removals: [] }), {
        accepted: true, hash,
    });
    assert.equal(call.url, 'https://commons.test/device/v1/inventory');
    assert.equal(call.options.headers['X-Sherman-Idempotency-Key'], `inventory:${hash}`);
});

test('artifact device APIs use closed schemas and candidate-bound write idempotency without retry', async () => {
    const calls = [];
    const publisher = identity();
    const client = new CommonsClient({
        serviceUrl: 'https://commons.test', identity: publisher,
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            if (url.endsWith('/artifact-publisher-keys')) return Response.json({ publisher_keys: [{
                id: 'publisher-test', network_id: publisher.networkId, device_id: publisher.deviceId,
                public_key: publisher.publicKey,
            }] });
            return Response.json({ id: 'artifact-server-id', scan_status: 'pending', replayed: false }, { status: 202 });
        },
    });
    assert.deepEqual(await client.publisherKeys(), [{
        id: 'publisher-test', network_id: publisher.networkId, device_id: publisher.deviceId,
        public_key: publisher.publicKey,
    }]);
    const receipt = await client.publishArtifact({ schema: 'synthetic' }, { idempotencyKey: 'artifact-candidate:abc' });
    assert.deepEqual(receipt, { id: 'artifact-server-id', scan_status: 'pending', replayed: false });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.headers['X-Sherman-Idempotency-Key'], 'artifact-candidate:abc');

    let failedCalls = 0;
    const failing = new CommonsClient({
        serviceUrl: 'https://commons.test', identity: publisher,
        fetchImpl: async () => { failedCalls += 1; throw new Error('raw bundle body'); },
    });
    await assert.rejects(() => failing.publishArtifact({ schema: 'synthetic' }, { idempotencyKey: 'artifact-candidate:abc' }),
        (error) => error.code === 'offline' && !error.message.includes('raw bundle body'));
    assert.equal(failedCalls, 1);
});

test('artifact download response is bounded and rejects caller-injected trust fields', async () => {
    const publisher = identity();
    const manifest = [{ path: 'SKILL.md', size: 4, sha256: '0'.repeat(64) }];
    const response = {
        artifact: {
            schema: 'SHERMAN-COMMONS-SKILL-V1', network_id: 'network-test', publisher_key_id: 'publisher-test',
            name: 'skill', version: '1.0.0', compatibility: { node: '>=22' }, manifest,
            digest: '0'.repeat(64), signature: 'AA==', files: [{ path: 'SKILL.md', content_base64: 'dGVzdA==' }],
        },
        trust: {
            network_id: 'network-test', publisher_key_id: 'publisher-test', device_id: 'device-test', public_key: publisher.publicKey,
            publisher_status: 'active', publisher_revoked_at: null, device_status: 'active', device_revoked_at: null,
            current_scanner_version: 'scanner-v2',
            scan: { status: 'passed', scanner_version: 'scanner-v2', artifact_digest: '0'.repeat(64), artifact_version: '1.0.0', scanned_at: 1785900000, expires_at: 1785903600 },
        },
    };
    const client = new CommonsClient({ serviceUrl: 'https://commons.test', identity: publisher, fetchImpl: async () => Response.json(response) });
    assert.deepEqual(await client.downloadArtifact('artifact-test'), response);
    const poisoned = structuredClone(response); poisoned.trust.caller_supplied = true;
    const closed = new CommonsClient({ serviceUrl: 'https://commons.test', identity: publisher, fetchImpl: async () => Response.json(poisoned) });
    await assert.rejects(() => closed.downloadArtifact('artifact-test'), (error) => error.code === 'invalid_response');
});

test('timeouts, revocation, unavailable routes, and oversized responses are distinct', async (t) => {
    await t.test('timeout', async () => {
        const client = new CommonsClient({
            serviceUrl: 'https://commons.test', identity: identity(), timeoutMs: 5, readRetries: 0,
            fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(Object.assign(new Error('late detail'), { name: 'AbortError' })));
            }),
        });
        await assert.rejects(() => client.feed(), (error) => error.code === 'timeout');
    });

    await t.test('revoked', async () => {
        const client = new CommonsClient({
            serviceUrl: 'https://commons.test', identity: identity(),
            fetchImpl: async () => Response.json({ error: 'device_revoked', raw: 'hidden' }, { status: 401 }),
        });
        await assert.rejects(() => client.feed(), (error) => (
            error.code === 'revoked' && !error.message.includes('hidden')
        ));
    });

    await t.test('route unavailable', async () => {
        const client = new CommonsClient({
            serviceUrl: 'https://commons.test', identity: identity(),
            fetchImpl: async () => Response.json({ error: 'not_found' }, { status: 404 }),
        });
        await assert.rejects(() => client.feed(), (error) => error.code === 'service_unavailable');
    });

    await t.test('response cap', async () => {
        const client = new CommonsClient({
            serviceUrl: 'https://commons.test', identity: identity(), maxResponseBytes: 64, readRetries: 0,
            fetchImpl: async () => new Response(JSON.stringify({ value: 'x'.repeat(200) })),
        });
        await assert.rejects(() => client.feed(), (error) => error.code === 'response_too_large');
    });
});

test('pagination inputs are capped before a request is made', async () => {
    let called = false;
    const client = new CommonsClient({
        serviceUrl: 'https://commons.test', identity: identity(),
        fetchImpl: async () => {
            called = true;
            return Response.json(feed);
        },
    });
    await assert.rejects(() => client.feed({ limit: 51 }), (error) => error.code === 'invalid_request');
    await assert.rejects(() => client.feed({ cursor: 'x'.repeat(513) }), (error) => error.code === 'invalid_request');
    assert.equal(called, false);
});
