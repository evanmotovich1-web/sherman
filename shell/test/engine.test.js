import test from 'node:test';
import assert from 'node:assert/strict';

import { CodexSession, mcpServerKeysFromToml } from '../src/engine/codex.js';

function session() {
    return new CodexSession({
        engine: 'codex',
        user: 'test-user',
        vaultPath: '/tmp/sherman-test/vault',
        workspacePath: '/tmp/sherman-test/workspace',
    });
}

function map(instance, type, item) {
    return instance._mapLine(JSON.stringify({ type, item }));
}

test('read-only requests change real sandbox posture without writable roots', () => {
    const instance = session();
    const args = instance._argsFor({ text: 'plan safely', mode: 'read-only', source: 'plan' });
    assert.ok(args.includes('sandbox_mode="read-only"'));
    assert.ok(args.includes('approval_policy="never"'));
    assert.equal(args.some((arg) => arg.includes('writable_roots')), false);
    assert.equal(args.includes('plan safely'), true);
    assert.equal(args.some((arg) => arg.includes('dangerously')), false);

    const isolated = instance._argsFor({
        text: 'plan without host tools', mode: 'isolated-read-only', source: 'plan',
    });
    assert.ok(isolated.includes('sandbox_mode="read-only"'));
    assert.ok(isolated.includes('orchestrator.mcp.enabled=false'));
    assert.ok(isolated.includes('orchestrator.skills.enabled=false'));
    assert.ok(isolated.includes('web_search="disabled"'));
    assert.ok(isolated.includes('features.apps=false'));
    assert.ok(isolated.includes('features.browser_use=false'));
    assert.ok(isolated.includes('features.computer_use=false'));
    assert.ok(isolated.includes('features.goals=false'));
    assert.ok(isolated.includes('features.hooks=false'));
    assert.ok(isolated.includes('features.plugins=false'));
    assert.ok(isolated.includes('features.tool_suggest=false'));
    assert.equal(isolated.some((arg) => arg.includes('writable_roots')), false);

    instance._configuredMcpServerKeys = ['obsidian', '"server.with.dots"'];
    const withServers = instance._argsFor({
        text: 'plan with MCP disabled', mode: 'isolated-read-only', source: 'plan',
    });
    assert.ok(withServers.includes('mcp_servers.obsidian.enabled=false'));
    assert.ok(withServers.includes('mcp_servers."server.with.dots".enabled=false'));

    const worker = instance._argsFor({
        text: 'one turn worker', mode: 'isolated-read-only', source: 'subagent',
    });
    assert.ok(worker.includes('--ephemeral'));
    assert.equal(isolated.includes('--ephemeral'), false);

    const normal = instance._argsFor('answer normally');
    assert.ok(normal.includes('sandbox_mode="workspace-write"'));
    assert.ok(normal.some((arg) => arg.includes('writable_roots')));
});

test('extracts configured MCP names without reading values', () => {
    const config = [
        'model = "gpt-test"',
        '[mcp_servers.obsidian]',
        'url = "http://example.invalid"',
        '[mcp_servers.node_repl.env]',
        'SECRET = "not returned"',
        '[mcp_servers."server.with.dots"]',
        '[unrelated]',
    ].join('\n');
    assert.deepEqual(
        mcpServerKeysFromToml(config),
        ['obsidian', 'node_repl', '"server.with.dots"']
    );
});

test('maps rich Codex activities and truthful outcomes', () => {
    const instance = session();

    const [mcpStart] = map(instance, 'item.started', {
        id: 'mcp-1', type: 'mcp_tool_call', server: 'obsidian', tool: 'search', status: 'in_progress',
    });
    const [mcpDone] = map(instance, 'item.completed', {
        id: 'mcp-1', type: 'mcp_tool_call', status: 'failed',
    });
    assert.equal(mcpStart.label, 'mcp obsidian.search');
    assert.equal(mcpStart.category, 'mcp');
    assert.equal(mcpDone.label, 'mcp obsidian.search');
    assert.equal(mcpDone.outcome, 'failed');
    assert.equal(typeof mcpDone.durationMs, 'number');

    const [search] = map(instance, 'item.started', {
        id: 'web-1', type: 'web_search', query: 'diagnostic lab operations',
    });
    assert.equal(search.label, 'search diagnostic lab operations');
    assert.equal(search.category, 'web-search');

    const [worker] = map(instance, 'item.started', {
        id: 'agent-1', type: 'collab_tool_call', tool: 'spawn_agent', status: 'in_progress',
    });
    assert.equal(worker.label, 'spawn subagent');
    assert.equal(worker.category, 'subagent');

    const [plan] = map(instance, 'item.updated', {
        id: 'todo-1', type: 'todo_list', items: [
            { text: 'inspect', completed: true },
            { text: 'report', completed: false },
        ],
    });
    assert.equal(plan.phase, 'updated');
    assert.equal(plan.label, 'plan 1/2 steps');
});

test('does not call redirected cat a read and preserves completion-only patches', () => {
    const instance = session();
    const [exec] = map(instance, 'item.started', {
        id: 'exec-1', type: 'command_execution', command: 'cat input > output', status: 'in_progress',
    });
    assert.match(exec.label, /^exec /);

    const [patch] = map(instance, 'item.completed', {
        id: 'patch-1', type: 'file_change',
        changes: [{ path: '/tmp/sherman-test/vault/wiki/new.md', kind: 'add' }],
        status: 'completed',
    });
    assert.equal(patch.label, 'patch wiki/new.md');
    assert.equal(patch.outcome, 'succeeded');
    assert.equal(patch.durationMs, null);
});
