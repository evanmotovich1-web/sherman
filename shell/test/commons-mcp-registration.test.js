import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { reconcileCommonsMcpRegistration } from '../src/commons/mcp-registration.js';
import { main as commonsMain } from '../bin/sherman-commons.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'sherman-commons-registration-'));
    const home = join(root, 'home');
    const workspace = join(root, 'workspace');
    const codexConfig = join(root, 'codex', 'config.toml');
    mkdirSync(join(home, '.sherman', 'commons'), { recursive: true });
    mkdirSync(workspace, { recursive: true });
    const cleanup = () => rmSync(root, { recursive: true, force: true });
    return { root, home, workspace, codexConfig, cleanup };
}

function enroll(home, serviceUrl = 'https://commons.example.test') {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const identity = {
        version: 1,
        networkId: 'network-1',
        deviceId: 'device-1',
        agentId: 'agent-1',
        ownerDisplayName: 'Test Owner',
        publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
    const directory = join(home, '.sherman', 'commons');
    for (const [name, value] of [
        ['identity.json', identity],
        ['settings.json', { version: 1, serviceUrl, autoPublishInventory: false }],
    ]) {
        const path = join(directory, name);
        writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
        chmodSync(path, 0o600);
    }
    return identity;
}

function activeFetch(calls = []) {
    return async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify({ ok: true, replayed: false }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    };
}

function ownedClaudeConfig(extra = {}) {
    return {
        mcpServers: {
            unrelated: { command: '/opt/unrelated', args: ['serve'] },
            'sherman-commons': {
                command: '/old/node', args: ['/old/mcp.js'],
                env: { SHERMAN_COMMONS_MCP_OWNER: 'sherman' },
            },
            ...extra,
        },
    };
}

const OWNED_CODEX = [
    'model = "gpt-test"',
    '',
    '[mcp_servers.unrelated]',
    'command = "/opt/unrelated"',
    '',
    '# BEGIN SHERMAN-OWNED COMMONS MCP',
    '[mcp_servers.sherman-commons]',
    'command = "/old/node"',
    'args = ["/old/mcp.js"]',
    '# END SHERMAN-OWNED COMMONS MCP',
    '',
].join('\n');

test('active enrolled Claude device gets a Sherman-owned Commons stdio MCP entry with absolute paths', async () => {
    const fx = fixture();
    try {
        enroll(fx.home);
        writeFileSync(join(fx.workspace, '.mcp.json'), JSON.stringify({
            mcpServers: { unrelated: { command: '/opt/unrelated', args: ['serve'] } },
        }));
        const calls = [];
        const result = await reconcileCommonsMcpRegistration({
            engine: 'claude', home: fx.home, workspace: fx.workspace,
            executablePath: '/absolute/node', mcpPath: '/absolute/sherman-commons-mcp.js',
            codexConfigPath: fx.codexConfig, fetchImpl: activeFetch(calls), timeoutMs: 50,
        });
        assert.deepEqual(result, { active: true, changed: true, reason: 'active' });
        const config = JSON.parse(readFileSync(join(fx.workspace, '.mcp.json'), 'utf8'));
        assert.deepEqual(config.mcpServers.unrelated, { command: '/opt/unrelated', args: ['serve'] });
        assert.deepEqual(config.mcpServers['sherman-commons'], {
            command: '/absolute/node', args: ['/absolute/sherman-commons-mcp.js'],
            env: { SHERMAN_COMMONS_MCP_OWNER: 'sherman' },
        });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, 'https://commons.example.test/agent/v1/heartbeat');
        assert.equal(calls[0].options.method, 'POST');
        assert.match(calls[0].options.headers['X-Sherman-Signature'], /^[A-Za-z0-9+/]+=*$/);
    } finally {
        fx.cleanup();
    }
});

test('unenrolled launch removes only a Sherman-owned stale Claude entry without probing', async () => {
    const fx = fixture();
    try {
        writeFileSync(join(fx.workspace, '.mcp.json'), JSON.stringify(ownedClaudeConfig()));
        let calls = 0;
        const result = await reconcileCommonsMcpRegistration({
            engine: 'claude', home: fx.home, workspace: fx.workspace,
            executablePath: '/absolute/node', mcpPath: '/absolute/mcp.js',
            codexConfigPath: fx.codexConfig,
            fetchImpl: async () => { calls += 1; throw new Error('must not probe'); }, timeoutMs: 25,
        });
        assert.deepEqual(result, { active: false, changed: true, reason: 'unenrolled' });
        const config = JSON.parse(readFileSync(join(fx.workspace, '.mcp.json'), 'utf8'));
        assert.deepEqual(config.mcpServers, { unrelated: { command: '/opt/unrelated', args: ['serve'] } });
        assert.equal(calls, 0);
    } finally { fx.cleanup(); }
});

test('active enrolled Codex device gets one marked absolute-path block and preserves unrelated TOML', async () => {
    const fx = fixture();
    try {
        enroll(fx.home);
        mkdirSync(join(fx.root, 'codex'), { recursive: true });
        writeFileSync(fx.codexConfig, 'model = "gpt-test"\n\n[mcp_servers.unrelated]\ncommand = "/opt/unrelated"\n');
        const result = await reconcileCommonsMcpRegistration({
            engine: 'codex', home: fx.home, workspace: fx.workspace,
            executablePath: '/absolute/node', mcpPath: '/absolute/mcp.js',
            codexConfigPath: fx.codexConfig, fetchImpl: activeFetch(), timeoutMs: 25,
        });
        assert.equal(result.active, true);
        const config = readFileSync(fx.codexConfig, 'utf8');
        assert.match(config, /\[mcp_servers\.unrelated\]/);
        assert.match(config, /# BEGIN SHERMAN-OWNED COMMONS MCP/);
        assert.match(config, /\[mcp_servers\.sherman-commons\]/);
        assert.match(config, /command = "\/absolute\/node"/);
        assert.match(config, /args = \["\/absolute\/mcp\.js"\]/);
        assert.equal((config.match(/\[mcp_servers\.sherman-commons\]/g) || []).length, 1);
    } finally { fx.cleanup(); }
});

test('revoked heartbeat removes only the marked Codex block and preserves unrelated config', async () => {
    const fx = fixture();
    try {
        enroll(fx.home);
        mkdirSync(join(fx.root, 'codex'), { recursive: true });
        writeFileSync(fx.codexConfig, OWNED_CODEX);
        const result = await reconcileCommonsMcpRegistration({
            engine: 'codex', home: fx.home, workspace: fx.workspace,
            executablePath: '/absolute/node', mcpPath: '/absolute/mcp.js', codexConfigPath: fx.codexConfig,
            fetchImpl: async () => new Response('{}', { status: 401 }), timeoutMs: 25,
        });
        assert.deepEqual(result, { active: false, changed: true, reason: 'revoked' });
        const config = readFileSync(fx.codexConfig, 'utf8');
        assert.match(config, /model = "gpt-test"/);
        assert.match(config, /\[mcp_servers\.unrelated\]/);
        assert.doesNotMatch(config, /sherman-commons|SHERMAN-OWNED COMMONS/);
    } finally { fx.cleanup(); }
});

test('revoked heartbeat removes every marked stale Codex block', async () => {
    const fx = fixture();
    try {
        enroll(fx.home);
        mkdirSync(join(fx.root, 'codex'), { recursive: true });
        writeFileSync(fx.codexConfig, `${OWNED_CODEX}\n${OWNED_CODEX}`);
        const result = await reconcileCommonsMcpRegistration({
            engine: 'codex', home: fx.home, workspace: fx.workspace,
            executablePath: '/absolute/node', mcpPath: '/absolute/mcp.js', codexConfigPath: fx.codexConfig,
            fetchImpl: async () => new Response('{}', { status: 401 }), timeoutMs: 25,
        });
        assert.equal(result.changed, true);
        assert.doesNotMatch(readFileSync(fx.codexConfig, 'utf8'), /sherman-commons|SHERMAN-OWNED COMMONS/);
    } finally { fx.cleanup(); }
});

test('revoked or unenrolled reconciliation removes a truncated owned Codex block without touching following config', async () => {
    for (const enrolled of [true, false]) {
        const fx = fixture();
        try {
            if (enrolled) enroll(fx.home);
            mkdirSync(join(fx.root, 'codex'), { recursive: true });
            writeFileSync(fx.codexConfig, [
                'model = "gpt-test"',
                '# BEGIN SHERMAN-OWNED COMMONS MCP',
                '[mcp_servers.sherman-commons]',
                'command = "/old/node"',
                'args = ["/old/mcp.js"]',
                '[mcp_servers.unrelated]',
                'command = "/opt/unrelated"',
                '',
            ].join('\n'));
            const result = await reconcileCommonsMcpRegistration({
                engine: 'codex', home: fx.home, workspace: fx.workspace,
                executablePath: '/absolute/node', mcpPath: '/absolute/mcp.js', codexConfigPath: fx.codexConfig,
                fetchImpl: enrolled
                    ? async () => new Response('{}', { status: 401 })
                    : async () => { throw new Error('must not probe'); },
                timeoutMs: 25,
            });
            assert.equal(result.active, false);
            assert.equal(result.changed, true);
            const config = readFileSync(fx.codexConfig, 'utf8');
            assert.doesNotMatch(config, /sherman-commons|SHERMAN-OWNED COMMONS|\/old\/node/);
            assert.match(config, /model = "gpt-test"/);
            assert.match(config, /\[mcp_servers\.unrelated\]/);
            assert.match(config, /command = "\/opt\/unrelated"/);
        } finally { fx.cleanup(); }
    }
});

test('timeout is short, nonfatal, removes stale ownership, and leaks no transport error', async () => {
    const fx = fixture();
    try {
        enroll(fx.home);
        writeFileSync(join(fx.workspace, '.mcp.json'), JSON.stringify(ownedClaudeConfig()));
        const secret = 'PRIVATE-TOKEN-DO-NOT-LEAK';
        const started = Date.now();
        const result = await reconcileCommonsMcpRegistration({
            engine: 'claude', home: fx.home, workspace: fx.workspace,
            executablePath: '/absolute/node', mcpPath: '/absolute/mcp.js', codexConfigPath: fx.codexConfig,
            fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(new Error(secret)), { once: true });
            }),
            timeoutMs: 20,
        });
        assert.deepEqual(result, { active: false, changed: true, reason: 'timeout' });
        assert.ok(Date.now() - started < 500);
        assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
        assert.doesNotMatch(readFileSync(join(fx.workspace, '.mcp.json'), 'utf8'), new RegExp(secret));
    } finally { fx.cleanup(); }
});

test('malformed settings never trigger a probe and remove only Sherman-owned stale registration', async () => {
    const fx = fixture();
    try {
        enroll(fx.home);
        const settings = join(fx.home, '.sherman', 'commons', 'settings.json');
        writeFileSync(settings, '{"version":1,"serviceUrl":"https://good.test","token":"secret"}\n');
        chmodSync(settings, 0o600);
        writeFileSync(join(fx.workspace, '.mcp.json'), JSON.stringify(ownedClaudeConfig()));
        let calls = 0;
        const result = await reconcileCommonsMcpRegistration({
            engine: 'claude', home: fx.home, workspace: fx.workspace,
            executablePath: '/absolute/node', mcpPath: '/absolute/mcp.js', codexConfigPath: fx.codexConfig,
            fetchImpl: async () => { calls += 1; throw new Error('secret'); }, timeoutMs: 25,
        });
        assert.deepEqual(result, { active: false, changed: true, reason: 'malformed_settings' });
        assert.equal(calls, 0);
        assert.doesNotMatch(readFileSync(join(fx.workspace, '.mcp.json'), 'utf8'), /token|secret/);
    } finally { fx.cleanup(); }
});

test('oversized chunked heartbeat is cancelled and cannot authorize registration', async () => {
    const fx = fixture();
    let cancelled = false;
    try {
        enroll(fx.home);
        const stream = new ReadableStream({
            start(controller) { controller.enqueue(new Uint8Array(5000)); },
            cancel() { cancelled = true; },
        });
        const result = await reconcileCommonsMcpRegistration({
            engine: 'claude', home: fx.home, workspace: fx.workspace,
            executablePath: '/absolute/node', mcpPath: '/absolute/mcp.js', codexConfigPath: fx.codexConfig,
            fetchImpl: async () => new Response(stream, {
                status: 200, headers: { 'content-type': 'application/json' },
            }), timeoutMs: 25,
        });
        assert.equal(result.active, false);
        assert.equal(result.reason, 'malformed');
        assert.equal(cancelled, true);
        assert.equal(existsSync(join(fx.workspace, '.mcp.json')), false);
    } finally { fx.cleanup(); }
});

test('a lookalike or non-JSON heartbeat content type cannot authorize registration', async () => {
    const fx = fixture();
    try {
        enroll(fx.home);
        for (const contentType of ['text/plain', 'application/json-patch+json']) {
            const result = await reconcileCommonsMcpRegistration({
                engine: 'claude', home: fx.home, workspace: fx.workspace,
                executablePath: '/absolute/node', mcpPath: '/absolute/mcp.js', codexConfigPath: fx.codexConfig,
                fetchImpl: async () => new Response(JSON.stringify({ ok: true, replayed: false }), {
                    status: 200, headers: { 'content-type': contentType },
                }), timeoutMs: 25,
            });
            assert.equal(result.active, false);
            assert.equal(result.reason, 'malformed');
        }
        assert.equal(existsSync(join(fx.workspace, '.mcp.json')), false);
    } finally { fx.cleanup(); }
});

test('permission-unsafe settings do not authorize registration', async () => {
    const fx = fixture();
    try {
        enroll(fx.home);
        const settings = join(fx.home, '.sherman', 'commons', 'settings.json');
        chmodSync(settings, 0o644);
        let calls = 0;
        const result = await reconcileCommonsMcpRegistration({
            engine: 'claude', home: fx.home, workspace: fx.workspace,
            executablePath: '/absolute/node', mcpPath: '/absolute/mcp.js', codexConfigPath: fx.codexConfig,
            fetchImpl: async () => { calls += 1; return activeFetch()(); }, timeoutMs: 25,
        });
        assert.equal(result.active, false);
        assert.equal(result.reason, 'malformed_settings');
        assert.equal(calls, 0);
        assert.equal(existsSync(join(fx.workspace, '.mcp.json')), false);
    } finally { fx.cleanup(); }
});

test('only localhost may use development HTTP and the signed audience matches it', async () => {
    const local = fixture();
    const remote = fixture();
    try {
        enroll(local.home, 'http://localhost:8787');
        const calls = [];
        const localResult = await reconcileCommonsMcpRegistration({
            engine: 'claude', home: local.home, workspace: local.workspace,
            executablePath: '/absolute/node', mcpPath: '/absolute/mcp.js', codexConfigPath: local.codexConfig,
            fetchImpl: activeFetch(calls), timeoutMs: 25,
        });
        assert.equal(localResult.active, true);
        assert.equal(calls[0].url, 'http://localhost:8787/agent/v1/heartbeat');

        enroll(remote.home, 'http://commons.example.test');
        let remoteCalls = 0;
        const remoteResult = await reconcileCommonsMcpRegistration({
            engine: 'claude', home: remote.home, workspace: remote.workspace,
            executablePath: '/absolute/node', mcpPath: '/absolute/mcp.js', codexConfigPath: remote.codexConfig,
            fetchImpl: async () => { remoteCalls += 1; return new Response('{}'); }, timeoutMs: 25,
        });
        assert.equal(remoteResult.active, false);
        assert.equal(remoteResult.reason, 'malformed_settings');
        assert.equal(remoteCalls, 0);
    } finally { local.cleanup(); remote.cleanup(); }
});

test('unowned Commons-named entries are preserved and never overwritten or removed', async () => {
    const claude = fixture();
    const codex = fixture();
    try {
        enroll(claude.home);
        const unownedClaude = { mcpServers: {
            'sherman-commons': { command: '/user/command', args: ['mine'] },
            unrelated: { command: '/other' },
        } };
        writeFileSync(join(claude.workspace, '.mcp.json'), JSON.stringify(unownedClaude));
        await reconcileCommonsMcpRegistration({
            engine: 'claude', home: claude.home, workspace: claude.workspace,
            executablePath: '/absolute/node', mcpPath: '/absolute/mcp.js', codexConfigPath: claude.codexConfig,
            fetchImpl: activeFetch(), timeoutMs: 25,
        });
        assert.deepEqual(JSON.parse(readFileSync(join(claude.workspace, '.mcp.json'), 'utf8')), unownedClaude);

        mkdirSync(join(codex.root, 'codex'), { recursive: true });
        writeFileSync(codex.codexConfig, '[mcp_servers.sherman-commons]\ncommand = "/user/command"\n');
        await reconcileCommonsMcpRegistration({
            engine: 'codex', home: codex.home, workspace: codex.workspace,
            executablePath: '/absolute/node', mcpPath: '/absolute/mcp.js', codexConfigPath: codex.codexConfig,
            fetchImpl: async () => { throw new Error('no probe when unenrolled'); }, timeoutMs: 25,
        });
        assert.equal(readFileSync(codex.codexConfig, 'utf8'), '[mcp_servers.sherman-commons]\ncommand = "/user/command"\n');
    } finally { claude.cleanup(); codex.cleanup(); }
});

test('hidden launcher bridge reconciles with derived absolute MCP path and emits only generic status', async () => {
    const fx = fixture();
    try {
        const calls = [];
        const output = [];
        const code = await commonsMain(
            ['--reconcile-mcp', 'codex', fx.workspace],
            { log: (line) => output.push(line), error: (line) => output.push(line) },
            { registration: async (input) => { calls.push(input); return { active: false, changed: true, reason: 'timeout' }; } },
        );
        assert.equal(code, 0);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].engine, 'codex');
        assert.equal(calls[0].home, process.env.HOME);
        assert.equal(calls[0].workspace, fx.workspace);
        assert.ok(calls[0].executablePath.startsWith('/'));
        assert.ok(calls[0].mcpPath.startsWith('/'));
        assert.match(calls[0].mcpPath, /sherman-commons-mcp\.js$/);
        assert.deepEqual(output, ['NOTE: Commons MCP was disabled because active enrollment could not be confirmed (timeout).']);
    } finally { fx.cleanup(); }
});

test('real launcher reconciles stale Codex ownership before engine handoff', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-launch-registration-'));
    const fakeBin = join(home, 'bin');
    const shermanHome = join(home, '.sherman');
    const codexHome = join(home, '.codex');
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(shermanHome, { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(shermanHome, 'config.json'), JSON.stringify({
        version: 2, engine: 'codex', user: 'fixture', vault_path: join(home, 'vault'),
    }));
    const codex = join(fakeBin, 'codex');
    writeFileSync(codex, '#!/bin/sh\nexit 0\n');
    chmodSync(codex, 0o700);
    const configPath = join(codexHome, 'config.toml');
    writeFileSync(configPath, OWNED_CODEX);
    try {
        const result = spawnSync(join(repoRoot, 'bin', 'sherman'), ['--raw'], {
            encoding: 'utf8',
            env: { ...process.env, HOME: home, PATH: `${fakeBin}:${process.env.PATH}`, SHERMAN_NO_FETCH: '1' },
            timeout: 15_000,
        });
        assert.equal(result.status, 0, result.stderr || result.stdout);
        const config = readFileSync(configPath, 'utf8');
        assert.match(config, /\[mcp_servers\.unrelated\]/);
        assert.doesNotMatch(config, /sherman-commons|SHERMAN-OWNED COMMONS/);
    } finally { rmSync(home, { recursive: true, force: true }); }
});
