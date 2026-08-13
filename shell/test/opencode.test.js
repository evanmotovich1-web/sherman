import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import {
    assertIsolatedOpenCodeInputs,
    OpenCodeSession,
    mapOpenCodeEvent,
    openCodeArgs,
    openCodeConfigForMode,
    openCodeMcpConfig,
} from '../src/engine/opencode.js';
import { selectBackend } from '../src/engine/index.js';

const config = {
    engine: 'zai',
    user: 'test-user',
    vaultPath: '/tmp/sherman-test/vault',
    workspacePath: '/tmp/sherman-test/workspace',
    configPath: '/tmp/sherman-test/config.json',
};

test('Z.AI backend is selectable and advertises the pinned GLM model', () => {
    const selected = selectBackend(config);
    assert.equal(selected instanceof OpenCodeSession, true);
    assert.equal(selected.info.engine, 'zai');
    assert.equal(selected.info.model, 'glm-5.2');
    assert.equal(selected.info.contextWindow, 1_000_000);
});

test('OpenCode argv pins Z.AI GLM and resumes the exact session without sharing', () => {
    const fresh = openCodeArgs(config, 'hello', null);
    assert.deepEqual(fresh, [
        'run', '--pure', '--format', 'json', '--model', 'zai/glm-5.2',
        '--agent', 'sherman',
        '--dir', config.workspacePath, 'hello',
    ]);

    const resumed = openCodeArgs(config, 'again', 'ses_123');
    assert.deepEqual(resumed, [
        'run', '--pure', '--format', 'json', '--model', 'zai/glm-5.2',
        '--agent', 'sherman',
        '--dir', config.workspacePath, '--session', 'ses_123', 'again',
    ]);
    assert.equal(resumed.includes('--share'), false);
    assert.equal(resumed.includes('--auto'), false);
});

test('OpenCode permissions allow only the named vault outside the workspace', () => {
    const normal = JSON.parse(openCodeConfigForMode(config, 'normal'));
    assert.deepEqual(normal.permission.external_directory, {
        '*': 'deny',
        '/tmp/sherman-test/vault/**': 'allow',
    });
    assert.equal(normal.share, 'disabled');
    // Normal turns carry the shell — operator-granted parity with Codex.
    // The wall that matters stays below: read-only turns deny bash outright.
    assert.equal(normal.permission.bash, 'allow');
    assert.equal(normal.permission.task, 'deny');
    assert.equal(normal.permission.apply_patch, 'deny');
    assert.deepEqual(normal.permission.edit, {
        '*': 'allow',
        '/tmp/sherman-test/vault/**': 'deny',
    });
    assert.equal(normal.default_agent, 'sherman');
    assert.deepEqual(normal.agent.sherman.permission, normal.permission);

    const readOnly = JSON.parse(openCodeConfigForMode(config, 'read-only'));
    assert.equal(readOnly.permission.edit, 'deny');
    assert.equal(readOnly.permission.bash, 'deny');

    const isolated = JSON.parse(openCodeConfigForMode(config, 'isolated-read-only'));
    assert.equal(isolated.permission.task, 'deny');
    assert.equal(isolated.permission.skill, 'deny');
    assert.equal(isolated.permission.webfetch, 'deny');
    assert.equal(isolated.permission.websearch, 'deny');

    const browser = JSON.parse(openCodeConfigForMode(config, 'browser-read-only'));
    assert.equal(browser.permission.edit, 'deny');
    assert.equal(browser.permission.webfetch, undefined);
});

test('OpenCode receives the exact validated Sherman MCP connectors', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'sherman-opencode-mcp-'));
    try {
        writeFileSync(join(workspace, '.mcp.json'), JSON.stringify({
            mcpServers: {
                llmwiki: { command: '/safe/python', args: ['wiki.py'], env: { MODE: 'safe' } },
                mnemosyne: { command: '/safe/mnemosyne', args: ['mcp'] },
                exa: { type: 'http', url: 'https://mcp.example.test', headers: { Authorization: 'test-placeholder' } },
                ['__proto__']: { command: '/unsafe', args: [] },
            },
        }));
        const mcp = openCodeMcpConfig(workspace);
        const digest = createHash('sha256').update(readFileSync(join(workspace, '.mcp.json'))).digest('hex');
        assert.deepEqual(openCodeMcpConfig(workspace, digest), mcp);
        assert.deepEqual(openCodeMcpConfig(workspace, '0'.repeat(64)), {});
        assert.deepEqual(mcp.llmwiki, {
            type: 'local', command: ['/safe/python', 'wiki.py'], enabled: true,
            environment: { MODE: 'safe' },
        });
        assert.deepEqual(mcp.exa, {
            type: 'remote', url: 'https://mcp.example.test', enabled: true,
            headers: { Authorization: 'test-placeholder' },
        });
        assert.equal(Object.hasOwn(mcp, '__proto__'), false);
        // A normal turn starts the memory pair — mnemosyne and the personal
        // wiki — and keeps their permission open; everything else configured
        // stays denied and unstarted. Memory rides every engine the same way.
        const ordinary = JSON.parse(openCodeConfigForMode(
            { ...config, workspacePath: workspace }, 'normal', mcp, 'chat'
        ));
        assert.deepEqual(ordinary.mcp, { llmwiki: mcp.llmwiki, mnemosyne: mcp.mnemosyne });
        assert.equal(ordinary.permission['llmwiki_*'], undefined);
        assert.equal(ordinary.permission['mnemosyne_*'], undefined);
        assert.equal(ordinary.permission['exa_*'], 'deny');
        const explicitWiki = JSON.parse(openCodeConfigForMode(
            { ...config, workspacePath: workspace }, 'normal', mcp, 'skill:research-wiki'
        ));
        assert.deepEqual(explicitWiki.mcp, { llmwiki: mcp.llmwiki, mnemosyne: mcp.mnemosyne });
        assert.equal(explicitWiki.permission['exa_*'], 'deny');
        const readOnly = JSON.parse(openCodeConfigForMode(
            { ...config, workspacePath: workspace },
            'read-only',
        ));
        assert.equal(readOnly.permission['llmwiki_*'], 'deny');
        assert.equal(readOnly.permission['mnemosyne_*'], 'deny');
        assert.equal(readOnly.permission['exa_*'], 'deny');
        assert.equal(readOnly.mcp, undefined);

        const mcpPath = join(workspace, '.mcp.json');
        const target = join(workspace, 'untrusted-mcp.json');
        rmSync(mcpPath);
        writeFileSync(target, JSON.stringify({ mcpServers: { unsafe: { command: '/unsafe', args: [] } } }));
        symlinkSync(target, mcpPath);
        assert.deepEqual(openCodeMcpConfig(workspace), {});
    } finally {
        rmSync(workspace, { recursive: true, force: true });
    }
});

test('OpenCode refuses inherited project config and symlink escapes', () => {
    const root = mkdtempSync(join(tmpdir(), 'sherman-opencode-boundary-'));
    const workspace = join(root, 'workspace');
    const vault = join(root, 'vault');
    mkdirSync(workspace);
    mkdirSync(vault);
    try {
        const boundary = { workspacePath: workspace, vaultPath: vault };
        assert.doesNotThrow(() => assertIsolatedOpenCodeInputs(boundary));
        writeFileSync(join(workspace, 'opencode.json'), '{"mcp":{"unsafe":{"type":"local"}}}');
        assert.throws(() => assertIsolatedOpenCodeInputs(boundary), /Refusing inherited OpenCode project config/);
        rmSync(join(workspace, 'opencode.json'));
        symlinkSync('/tmp', join(vault, 'escape'));
        assert.throws(() => assertIsolatedOpenCodeInputs(boundary), /Refusing symlink/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('OpenCode JSON events normalize text, tools, errors, and usage', () => {
    assert.deepEqual(mapOpenCodeEvent({
        type: 'text', sessionID: 'ses_1', part: { text: 'hello' },
    }), [{ kind: 'message', text: 'hello' }]);

    const [tool] = mapOpenCodeEvent({
        type: 'tool_use',
        part: {
            tool: 'read', callID: 'call_1',
            state: { status: 'completed', title: 'policy.md', time: { start: 10, end: 25 } },
        },
    });
    assert.equal(tool.kind, 'tool');
    assert.equal(tool.phase, 'completed');
    assert.equal(tool.label, 'read policy.md');
    assert.equal(tool.outcome, 'succeeded');
    assert.equal(tool.durationMs, 15);

    assert.deepEqual(mapOpenCodeEvent({
        type: 'error', error: { message: 'provider rejected request' },
    }), [{ kind: 'error', message: 'provider rejected request' }]);
    assert.deepEqual(mapOpenCodeEvent({
        type: 'error', error: { data: { message: 'authentication failed' } },
    }), [{ kind: 'error', message: 'authentication failed' }]);

    assert.deepEqual(mapOpenCodeEvent({
        type: 'step_finish',
        part: { tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 40 } } },
    }), [{
        kind: 'usage',
        usage: { input: 100, cachedInput: 40, output: 20, reasoning: 5, total: 125 },
    }]);
});

test('OpenCode session drives the JSON transport and resumes its returned session', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sherman-opencode-'));
    const stub = join(dir, 'opencode');
    const capture = join(dir, 'capture.jsonl');
    const runtimeConfig = {
        ...config,
        workspacePath: dir,
        vaultPath: join(dir, 'vault'),
    };
    writeFileSync(stub, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.SHERMAN_OPENCODE_TEST_CAPTURE,
  JSON.stringify({ argv: process.argv.slice(2), config: JSON.parse(process.env.OPENCODE_CONFIG_CONTENT),
    xdgConfigHome: process.env.XDG_CONFIG_HOME, configDir: process.env.OPENCODE_CONFIG_DIR }) + '\\n');
if (process.env.SHERMAN_OPENCODE_TEST_SILENT === '1') process.exit(0);
console.log(JSON.stringify({ type: 'step_start', sessionID: 'ses_transport', part: {} }));
console.log(JSON.stringify({ type: 'text', sessionID: 'ses_transport', part: { text: 'transport ok' } }));
if (process.env.SHERMAN_OPENCODE_TEST_MALFORMED === '1') console.log('{truncated');
console.log(JSON.stringify({ type: 'step_finish', sessionID: 'ses_transport', part: {
  tokens: { total: 13, input: 10, output: 2, reasoning: 1, cache: { read: 4 } }
} }));
`);
    chmodSync(stub, 0o755);
    mkdirSync(runtimeConfig.vaultPath);
    const initialMcp = JSON.stringify({ mcpServers: { safe: { command: '/bin/true', args: [] } } });
    writeFileSync(join(dir, '.mcp.json'), initialMcp);

    const previousPath = process.env.PATH;
    const previousCapture = process.env.SHERMAN_OPENCODE_TEST_CAPTURE;
    const previousSilent = process.env.SHERMAN_OPENCODE_TEST_SILENT;
    const previousMcpDigest = process.env.SHERMAN_MCP_CONFIG_SHA256;
    process.env.PATH = `${dir}${delimiter}${previousPath}`;
    process.env.SHERMAN_OPENCODE_TEST_CAPTURE = capture;
    process.env.SHERMAN_MCP_CONFIG_SHA256 = createHash('sha256').update(initialMcp).digest('hex');
    try {
        const session = new OpenCodeSession(runtimeConfig);
        const first = [];
        for await (const event of session.send('first')) first.push(event);
        assert.equal(
            first.some((event) => event.kind === 'message' && event.text === 'transport ok'),
            true,
            JSON.stringify(first),
        );
        assert.equal(first.at(-1).kind, 'turn-end');
        assert.equal(session.info.threadId, 'ses_transport');

        writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
            mcpServers: { injected: { command: '/bin/false', args: [] } },
        }));
        for await (const _event of session.send('second')) { /* consume */ }
        const calls = readFileSync(capture, 'utf8').trim().split('\n').map(JSON.parse);
        assert.equal(calls.length, 2);
        assert.equal(calls[0].argv.includes('--session'), false);
        assert.deepEqual(calls[1].argv.slice(-3), ['--session', 'ses_transport', 'second']);
        assert.equal(calls[0].config.share, 'disabled');
        assert.equal(calls[0].config.permission.bash, 'allow');
        assert.equal(calls[0].config.mcp, undefined);
        assert.equal(calls[1].config.mcp, undefined);
        assert.equal(calls[0].config.permission['safe_*'], 'deny');
        assert.match(calls[0].xdgConfigHome, /sherman-opencode-config-/);
        assert.equal(calls[0].configDir, calls[0].xdgConfigHome);

        process.env.SHERMAN_OPENCODE_TEST_SILENT = '1';
        const silentSession = new OpenCodeSession(runtimeConfig);
        const silent = [];
        for await (const event of silentSession.send('silent')) silent.push(event);
        assert.equal(silent.some((event) => (
            event.kind === 'error' && event.message === 'OpenCode ended without an assistant response.'
        )), true);

        process.env.SHERMAN_OPENCODE_TEST_SILENT = '0';
        process.env.SHERMAN_OPENCODE_TEST_MALFORMED = '1';
        const malformedSession = new OpenCodeSession(runtimeConfig);
        const malformed = [];
        for await (const event of malformedSession.send('malformed')) malformed.push(event);
        assert.equal(malformed.some((event) => (
            event.kind === 'error' && /malformed JSON/.test(event.message)
        )), true, JSON.stringify(malformed));
        assert.equal(malformed.some((event) => event.kind === 'turn-end'), false);
    } finally {
        process.env.PATH = previousPath;
        if (previousCapture === undefined) delete process.env.SHERMAN_OPENCODE_TEST_CAPTURE;
        else process.env.SHERMAN_OPENCODE_TEST_CAPTURE = previousCapture;
        if (previousSilent === undefined) delete process.env.SHERMAN_OPENCODE_TEST_SILENT;
        else process.env.SHERMAN_OPENCODE_TEST_SILENT = previousSilent;
        if (previousMcpDigest === undefined) delete process.env.SHERMAN_MCP_CONFIG_SHA256;
        else process.env.SHERMAN_MCP_CONFIG_SHA256 = previousMcpDigest;
        delete process.env.SHERMAN_OPENCODE_TEST_MALFORMED;
        rmSync(dir, { recursive: true, force: true });
    }
});

// The stall detector. Seen live: an OpenCode child that hung before its first
// byte of stdout left the shell showing "initializing agent" for 37 minutes,
// because the transport waits on stdout with no heartbeat. A turn that
// produces nothing within the window is now killed and NAMED — the error
// carries the repairs, most common first — instead of being waited on
// forever. The window covers only the time before the first output line;
// the healthy-transport test above proves a talking child is never touched.
test('a turn that produces no output is stopped and named, not waited on forever', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sherman-opencode-stall-'));
    const stub = join(dir, 'opencode');
    writeFileSync(stub, `#!/usr/bin/env node
// Hang silently: no stdout, no exit — the observed failure mode.
setInterval(() => {}, 1000);
`);
    chmodSync(stub, 0o755);
    const runtimeConfig = {
        ...config,
        workspacePath: dir,
        vaultPath: join(dir, 'vault'),
    };
    mkdirSync(runtimeConfig.vaultPath);

    const previousPath = process.env.PATH;
    const previousStall = process.env.SHERMAN_OPENCODE_STALL_MS;
    process.env.PATH = `${dir}${delimiter}${previousPath}`;
    process.env.SHERMAN_OPENCODE_STALL_MS = '250';
    try {
        const session = new OpenCodeSession(runtimeConfig);
        const events = [];
        const started = Date.now();
        for await (const event of session.send('hang')) events.push(event);
        const waited = Date.now() - started;

        const stall = events.find((event) => event.kind === 'error');
        assert.ok(stall, JSON.stringify(events));
        assert.match(stall.message, /produced no output for \ds and was stopped/);
        assert.match(stall.message, /opencode auth login/);
        assert.match(stall.message, /resend the prompt to retry/);
        // The stall is the whole story: no turn-end pretending the turn ran,
        // and the wait was the configured window, not a human noticing.
        assert.equal(events.some((event) => event.kind === 'turn-end'), false);
        assert.ok(waited < 5000, `stall detection took ${waited}ms`);
    } finally {
        process.env.PATH = previousPath;
        if (previousStall === undefined) delete process.env.SHERMAN_OPENCODE_STALL_MS;
        else process.env.SHERMAN_OPENCODE_STALL_MS = previousStall;
        rmSync(dir, { recursive: true, force: true });
    }
});

// The Coding Plan door. A Coding Plan key is a real Z.AI credential that the
// GENERAL endpoint refuses with error 1113 — and OpenCode retries the refusal
// silently, which presented live as an endless "initializing agent" until the
// stall detector named it. When the operator declared the Coding Plan at
// `sherman model`, the generated OpenCode config re-aims the SAME provider,
// credential slot, and pinned model at the coding endpoint; on the default
// API plan the config is byte-identical to what it always was.
test('the coding plan re-aims the zai provider; the api plan changes nothing', () => {
    const coding = JSON.parse(openCodeConfigForMode({ ...config, zaiPlan: 'coding' }));
    assert.equal(
        coding.provider.zai.options.baseURL,
        'https://api.z.ai/api/coding/paas/v4'
    );

    const api = JSON.parse(openCodeConfigForMode({ ...config, zaiPlan: 'api' }));
    assert.equal(api.provider, undefined);
    const legacy = JSON.parse(openCodeConfigForMode(config));
    assert.equal(legacy.provider, undefined);
});
