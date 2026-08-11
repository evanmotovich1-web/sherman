import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    CodexSession,
    findRolloutPath,
    latestTokenCount,
    mcpServerKeysFromToml,
} from '../src/engine/codex.js';

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
    assert.equal(args.includes('features.computer_use=true'), false);
    assert.equal(args.includes('features.browser_use=true'), false);
    assert.equal(args.includes('features.browser_use_external=true'), false);
    assert.ok(args.includes('features.computer_use=false'));
    assert.ok(args.includes('features.browser_use=false'));
    assert.ok(args.includes('features.browser_use_external=false'));

    const browserReadOnly = instance._argsFor({
        text: 'inspect non-PHI mail', mode: 'browser-read-only', source: 'email',
    });
    assert.ok(browserReadOnly.includes('sandbox_mode="read-only"'));
    assert.ok(browserReadOnly.includes('features.computer_use=false'));
    assert.ok(browserReadOnly.includes('features.browser_use=false'));
    assert.equal(browserReadOnly.some((arg) => arg.includes('writable_roots')), false);

    const forgedBrowserReadOnly = instance._argsFor({
        text: 'browse from chat', mode: 'browser-read-only', source: 'chat',
    });
    assert.ok(forgedBrowserReadOnly.includes('sandbox_mode="read-only"'));
    assert.ok(forgedBrowserReadOnly.includes('features.browser_use=false'));
    assert.equal(forgedBrowserReadOnly.includes('features.browser_use=true'), false);

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
    assert.equal(normal.some((arg) => arg.includes('writable_roots')), false);
    assert.ok(normal.includes('features.browser_use=false'));
    assert.ok(normal.includes('features.browser_use_external=false'));
    assert.ok(normal.includes('features.computer_use=false'));
    assert.equal(isolated.includes('features.browser_use=true'), false);
    assert.equal(isolated.includes('features.computer_use=true'), false);

    instance._configuredMcpServerKeys = ['llmwiki', 'exa'];
    const chat = instance._argsFor({ text: 'ordinary turn', mode: 'normal', source: 'chat' });
    assert.ok(chat.includes('mcp_servers.llmwiki.enabled=false'));
    assert.ok(chat.includes('mcp_servers.exa.enabled=false'));
    const personalWiki = instance._argsFor({
        text: 'explicit personal wiki turn', mode: 'normal', source: 'skill:research-wiki',
    });
    assert.equal(personalWiki.includes('mcp_servers.llmwiki.enabled=false'), false);
    assert.ok(personalWiki.includes('mcp_servers.exa.enabled=false'));
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

test('ordinary Codex turns disable MCP servers from a custom CODEX_HOME', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-codex-home-'));
    const oldCodexHome = process.env.CODEX_HOME;
    try {
        writeFileSync(join(home, 'config.toml'), '[mcp_servers.untrusted]\ncommand = "placeholder"\n');
        process.env.CODEX_HOME = home;
        const instance = session();
        const args = instance._argsFor({ text: 'ordinary', mode: 'normal', source: 'chat' });
        assert.ok(args.includes('mcp_servers.untrusted.enabled=false'));
    } finally {
        if (oldCodexHome === undefined) delete process.env.CODEX_HOME;
        else process.env.CODEX_HOME = oldCodexHome;
        rmSync(home, { recursive: true, force: true });
    }
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
    // Every change an `add` is a creation, and the trace says so.
    assert.equal(patch.label, 'create wiki/new.md');
    assert.equal(patch.category, 'file-create');
    assert.equal(patch.outcome, 'succeeded');
    assert.equal(patch.durationMs, null);
});

test('a read command and a shell command report different categories', () => {
    // Same evidence the label already used: `cat file` is the read shape seen in
    // the real 0.145.0 stream, anything with shell operators stays an exec.
    const codex = session();

    const [read] = map(codex, 'item.started', {
        id: 'r1', type: 'command_execution', command: '/bin/bash -lc "cat scanner.js"',
    });
    assert.equal(read.category, 'read');
    assert.equal(read.label, 'read scanner.js');

    const [exec] = map(codex, 'item.started', {
        id: 'c1', type: 'command_execution', command: '/bin/bash -lc "npm test"',
    });
    assert.equal(exec.category, 'command');
    assert.equal(exec.label, 'exec npm test');

    // A pipe is not a simple read, so it must not be softened into one.
    const [piped] = map(codex, 'item.started', {
        id: 'p1', type: 'command_execution', command: '/bin/bash -lc "cat a | rm -rf b"',
    });
    assert.equal(piped.category, 'command');
});

test('locating commands report file-search; compound ones stay honest execs', () => {
    const codex = session();

    // The label keeps the command verbatim: grep, find and ls are different
    // searches, so the binary name is information, not noise.
    const [grep] = map(codex, 'item.started', {
        id: 's1', type: 'command_execution', command: '/bin/bash -lc "grep -rn boundary skills"',
    });
    assert.equal(grep.category, 'file-search');
    assert.equal(grep.label, 'grep -rn boundary skills');

    const [ls] = map(codex, 'item.started', {
        id: 's2', type: 'command_execution', command: '/bin/bash -lc "ls vault/wiki"',
    });
    assert.equal(ls.category, 'file-search');

    // Shell operators disqualify, exactly as they do for reads.
    const [piped] = map(codex, 'item.started', {
        id: 's3', type: 'command_execution', command: '/bin/bash -lc "grep -rn x . | xargs rm"',
    });
    assert.equal(piped.category, 'command');

    // A prefix is not a binary: `lsof` must not be softened into a find.
    const [lsof] = map(codex, 'item.started', {
        id: 's4', type: 'command_execution', command: '/bin/bash -lc "lsof -i :3000"',
    });
    assert.equal(lsof.category, 'command');
});

test('a mixed file-change batch stays a patch; only all-adds create', () => {
    const codex = session();
    const [mixed] = map(codex, 'item.completed', {
        id: 'm1', type: 'file_change', status: 'completed',
        changes: [
            { path: '/tmp/sherman-test/vault/wiki/new.md', kind: 'add' },
            { path: '/tmp/sherman-test/vault/wiki/old.md', kind: 'update' },
        ],
    });
    assert.equal(mixed.category, 'file-change');
    assert.match(mixed.label, /^patch /);
});

// --------------------------------------------------------------------------
// Live-context measurement from the rollout file. Fixture lines mirror the
// real 0.145.0 rollout shape byte-for-byte where it matters:
// {"type":"event_msg","payload":{"type":"token_count","info":{...}}}.
// --------------------------------------------------------------------------

const THREAD = '019fac02-b871-73e2-97f1-4ee7b62ab4a0';

function rolloutLine(lastInput, lastTotal, window) {
    return JSON.stringify({
        timestamp: '2026-07-29T03:55:08.395Z',
        type: 'event_msg',
        payload: {
            type: 'token_count',
            info: {
                total_token_usage: {
                    input_tokens: 109112, cached_input_tokens: 83968,
                    cache_write_input_tokens: 0, output_tokens: 184,
                    reasoning_output_tokens: 27, total_tokens: 109296,
                },
                last_token_usage: {
                    input_tokens: lastInput, cached_input_tokens: 21248,
                    cache_write_input_tokens: 0, output_tokens: 34,
                    reasoning_output_tokens: 0, total_tokens: lastTotal,
                },
                model_context_window: window,
            },
        },
    });
}

function writeRollout(home, lines) {
    const dir = join(home, 'sessions', '2026', '07', '29');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `rollout-2026-07-29T00-00-00-${THREAD}.jsonl`);
    writeFileSync(path, lines.join('\n') + '\n');
    return path;
}

test('the rollout file is found by thread id, newest date first', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-rollout-find-'));
    try {
        const path = writeRollout(home, [rolloutLine(100, 120, 258400)]);
        // A decoy from an older day that must not shadow the real thread.
        mkdirSync(join(home, 'sessions', '2025', '01', '01'), { recursive: true });
        writeFileSync(
            join(home, 'sessions', '2025', '01', '01', 'rollout-old-other-thread.jsonl'),
            '{}\n'
        );
        assert.equal(findRolloutPath(THREAD, join(home, 'sessions')), path);
        assert.equal(findRolloutPath('no-such-thread', join(home, 'sessions')), null);
        assert.equal(findRolloutPath(THREAD, join(home, 'nowhere')), null);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('latestTokenCount reads the newest measurement and survives junk lines', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-rollout-tail-'));
    try {
        const path = writeRollout(home, [
            rolloutLine(10_000, 10_050, 258400),
            '{"type":"event_msg","payload":{"type":"agent_message"}}',
            rolloutLine(22_544, 22_578, 258400),
            'not json at all',
        ]);
        assert.deepEqual(latestTokenCount(path), { used: 22_578, window: 258400 });

        // No token_count at all is absence, not zero.
        const empty = writeRollout(home, ['{"type":"event_msg","payload":{"type":"other"}}']);
        assert.equal(latestTokenCount(empty), null);
        assert.equal(latestTokenCount(join(home, 'missing.jsonl')), null);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('turn.completed carries a measured context event, and its absence stays absent', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-rollout-events-'));
    const oldCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = home;
    try {
        writeRollout(home, [rolloutLine(22_544, 22_578, 258400)]);

        const codex = session();
        codex._mapLine(JSON.stringify({ type: 'thread.started', thread_id: THREAD }));
        const events = codex._mapLine(JSON.stringify({
            type: 'turn.completed',
            usage: { input_tokens: 1_566_800, cached_input_tokens: 0, output_tokens: 184 },
        }));

        // The measurement rides ahead of turn-end, so a UI acting at the turn
        // boundary has already seen the live figure — never the 1.57M bill.
        assert.deepEqual(
            events.map((e) => e.kind),
            ['context', 'turn-end']
        );
        assert.equal(events[0].used, 22_578);
        assert.equal(events[0].window, 258400);
        // The measured window supersedes the table's guess in info too.
        assert.equal(codex.info.contextWindow, 258400);
        // The bill still lands where it belongs: accounting.
        assert.equal(events[1].usage.input, 1_566_800);

        // A thread with no rollout file emits no context event at all.
        const bare = session();
        bare._mapLine(JSON.stringify({ type: 'thread.started', thread_id: 'unwritten-thread' }));
        const bareEvents = bare._mapLine(JSON.stringify({
            type: 'turn.completed',
            usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 1 },
        }));
        assert.deepEqual(bareEvents.map((e) => e.kind), ['turn-end']);
    } finally {
        process.env.CODEX_HOME = oldCodexHome ?? '';
        if (oldCodexHome === undefined) delete process.env.CODEX_HOME;
        rmSync(home, { recursive: true, force: true });
    }
});

// Probed against codex 0.146.0: error items carry their text in `message`
// (not `text`), and housekeeping notes arrive AS error items on turns that
// complete normally. Both behaviors are load-bearing for the background
// workers — see the error case in _mapItem.
test('error items surface item.message, and known advisories are not errors', () => {
    const instance = session();

    // A real complaint in the 0.146.0 field lands verbatim as an error.
    const real = map(instance, 'item.completed', {
        id: 'e1', type: 'error', message: 'stream error: 429 Too Many Requests',
    });
    assert.equal(real[0].kind, 'error');
    assert.equal(real[0].message, 'stream error: 429 Too Many Requests');

    // The skills-budget housekeeping note is an advisory, not a failure.
    const note = map(instance, 'item.completed', {
        id: 'e2', type: 'error',
        message: 'Skill descriptions were shortened to fit the 2% skills context budget. Codex can still see every skill.',
    });
    assert.equal(note[0].kind, 'advisory');
    assert.match(note[0].message, /skills context budget/);

    // An empty error item still names what codex printed to stderr.
    instance._stderrTail = 'line one\nauth failed: token expired';
    const empty = map(instance, 'item.completed', { id: 'e3', type: 'error' });
    assert.equal(empty[0].kind, 'error');
    assert.match(empty[0].message, /auth failed: token expired/);
});
