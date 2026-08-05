import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { COMMONS_MCP_TOOLS, createCommonsMcp, runCommonsMcpStdio } from '../src/commons/mcp.js';
import { loadCommonsState } from '../src/commons/local-state.js';

const post = {
    id: '10000000-0000-4000-8000-000000000001',
    kind: 'observation', title: 'Synthetic MCP read', body: 'A bounded typed response.',
    authorship_mode: 'agent_observed', visibility: 'network', owner_display_name: 'Test Owner',
    agent_display_name: 'Sherman for Test Owner', created_at: 1785900000, updated_at: 1785900001,
    issue: null,
};

test('MCP advertises only bounded reads and local propose with explicit safety descriptions', () => {
    assert.deepEqual(COMMONS_MCP_TOOLS.map((tool) => tool.name), [
        'commons_feed', 'commons_trending', 'commons_thread', 'propose_post',
    ]);
    const descriptions = COMMONS_MCP_TOOLS.map((tool) => tool.description).join(' ');
    assert.match(descriptions, /no PHI/i);
    assert.match(descriptions, /secrets/i);
    assert.match(descriptions, /raw transcripts/i);
    assert.match(descriptions, /impersonat/i);
    assert.match(descriptions, /silent.*install/i);
    assert.match(COMMONS_MCP_TOOLS.find((tool) => tool.name === 'propose_post').description, /local pending intent.*never publish/i);
});

test('read tools cap pagination, reject unknown fields, and format typed data', async () => {
    const calls = [];
    const mcp = createCommonsMcp({
        clientFactory: () => ({
            feed: async (args) => { calls.push(args); return { items: [post], next_cursor: null }; },
            trending: async () => ({ items: [], next_cursor: null }),
            thread: async () => ({ post, replies: [], next_cursor: null }),
        }),
    });
    const good = await mcp.handle({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'commons_feed', arguments: { limit: 10 } },
    });
    assert.equal(good.result.isError, undefined);
    assert.match(good.result.content[0].text, /Synthetic MCP read/);
    assert.match(good.result.content[0].text, /untrusted network content/i);
    assert.deepEqual(calls, [{ limit: 10, cursor: null }]);

    for (const args of [{ limit: 51 }, { limit: 10, raw: true }]) {
        const bad = await mcp.handle({
            jsonrpc: '2.0', id: 2, method: 'tools/call',
            params: { name: 'commons_feed', arguments: args },
        });
        assert.equal(bad.result.isError, true);
        assert.doesNotMatch(bad.result.content[0].text, /raw.*true/i);
    }
    assert.equal(calls.length, 1);
});

test('propose_post creates only a pending intent and model arguments cannot approve it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-mcp-'));
    let networkCalls = 0;
    try {
        const mcp = createCommonsMcp({
            home,
            clientFactory: () => {
                networkCalls += 1;
                throw new Error('must not be reached');
            },
        });
        const proposed = await mcp.handle({
            jsonrpc: '2.0', id: 3, method: 'tools/call',
            params: {
                name: 'propose_post',
                arguments: {
                    kind: 'idea', title: 'Synthetic local proposal', body: 'Keep this local and pending.',
                    authorship_mode: 'agent_observed', visibility: 'network',
                },
            },
        });
        assert.equal(proposed.result.isError, undefined);
        assert.match(proposed.result.content[0].text, /pending intent/i);
        assert.equal(loadCommonsState(home).intents[0].status, 'pending');
        assert.equal(networkCalls, 0);

        const selfApproval = await mcp.handle({
            jsonrpc: '2.0', id: 4, method: 'tools/call',
            params: {
                name: 'propose_post',
                arguments: {
                    kind: 'idea', title: 'Synthetic local proposal', body: 'Keep this local and pending.',
                    authorship_mode: 'agent_observed', visibility: 'network', approved: true,
                },
            },
        });
        assert.equal(selfApproval.result.isError, true);
        assert.equal(loadCommonsState(home).intents.length, 1);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('JSON-RPC validates request shape and IDs and negotiates only supported versions', async () => {
    const mcp = createCommonsMcp();
    for (const message of [
        { jsonrpc: '2.0', id: { attacker: true }, method: 'ping' },
        { jsonrpc: '2.0', id: true, method: 'ping' },
        { jsonrpc: '2.0', id: 1, method: 'ping', attacker: true },
        { jsonrpc: '2.0', id: 1, method: 7 },
    ]) {
        const response = await mcp.handle(message);
        assert.equal(response.error.code, -32600);
        assert.equal(response.id, null);
    }
    for (const id of ['request-id', 7, null]) {
        assert.deepEqual(await mcp.handle({ jsonrpc: '2.0', id, method: 'ping' }), {
            jsonrpc: '2.0', id, result: {},
        });
    }
    const initialized = await mcp.handle({
        jsonrpc: '2.0', id: 2, method: 'initialize',
        params: { protocolVersion: '2025-03-26' },
    });
    assert.equal(initialized.result.protocolVersion, '2025-03-26');
    const unsupported = await mcp.handle({
        jsonrpc: '2.0', id: 3, method: 'initialize',
        params: { protocolVersion: 'totally-unsupported' },
    });
    assert.equal(unsupported.error.code, -32602);
    assert.doesNotMatch(JSON.stringify(unsupported), /totally-unsupported/);
});

test('stdio enforces an explicit output-byte cap without leaking oversized tool output', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.setEncoding('utf8');
    let written = '';
    output.on('data', (chunk) => { written += chunk; });
    const mcp = { handle: async () => ({
        jsonrpc: '2.0', id: 1, result: { secret: 'S'.repeat(1000) },
    }) };
    const done = runCommonsMcpStdio({ input, output, mcp, maxOutputBytes: 128 });
    input.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`);
    await done;
    assert.ok(Buffer.byteLength(written) <= 128);
    assert.doesNotMatch(written, /S{20}/);
    assert.equal(JSON.parse(written).error.code, -32603);
});

test('stdio framing returns JSON-RPC errors without logging oversized or malformed input', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.setEncoding('utf8');
    let written = '';
    output.on('data', (chunk) => { written += chunk; });
    const done = runCommonsMcpStdio({ input, output, maxMessageBytes: 128 });
    input.write('{broken}\n');
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' })}\n`);
    input.write(`${'x'.repeat(200)}\n`);
    input.end();
    await done;
    const responses = written.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(responses[0].error.code, -32700);
    assert.deepEqual(responses[1], { jsonrpc: '2.0', id: 9, result: {} });
    assert.equal(responses[2].error.code, -32600);
    assert.doesNotMatch(written, /x{20}/);
});
