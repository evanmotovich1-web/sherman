// Z.AI GLM backend — drives OpenCode headlessly and normalizes its JSON stream.
//
// OpenCode is the agent runtime because Z.AI officially supports it and its
// provider uses the Chat Completions protocol. Codex cannot be reused here:
// current Codex custom providers require the Responses protocol.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';

import { EngineSession, ev, emptyUsage, addUsage } from './session.js';

export const ZAI_MODEL = 'zai/glm-5.2';
export const ZAI_CONTEXT_WINDOW = 1_000_000;

const NOT_INSTALLED =
    'OpenCode is not installed. Install it with:\n' +
    '\n' +
    '    npm install -g opencode-ai\n' +
    '\n' +
    'Then run `opencode auth login`, select Z.AI, and run sherman again.';

// How long a spawned turn may produce NOTHING before it is declared stalled.
// OpenCode has no heartbeat, and its worst observed failure mode (seen live:
// 37 minutes of "initializing agent") is a child that hangs before its first
// byte of stdout — expired auth it cannot prompt for because stdin is ignored
// by design, a Z.AI network stall, or an MCP server wedged at startup. The
// timer covers ONLY the window before the first output line: once the stream
// is talking, a long silence is a slow tool call, and killing that would turn
// patience into a bug. Overridable through the env for tests and for
// operators on genuinely slow links.
export const FIRST_OUTPUT_STALL_MS = 120_000;

function firstOutputStallMs() {
    const raw = Number(process.env.SHERMAN_OPENCODE_STALL_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : FIRST_OUTPUT_STALL_MS;
}

function stallMessage(ms) {
    return (
        `OpenCode produced no output for ${Math.round(ms / 1000)}s and was stopped — the turn never started.\n` +
        'Likely causes, most common first:\n' +
        '  1. Wrong Z.AI plan — a Coding Plan key aimed at the general API: run `sherman model`, pick Z.AI, answer "Coding Plan".\n' +
        '  2. Z.AI balance exhausted — OpenCode retries the refusal silently; check your Z.AI account and recharge.\n' +
        '  3. Z.AI auth expired — run: opencode auth login\n' +
        '  4. Z.AI or the network is stalled — try: opencode run --model zai/glm-5.2 "hello"\n' +
        '  5. An MCP server is hanging at startup.\n' +
        'Nothing was lost; resend the prompt to retry.'
    );
}

/** Build the exact headless invocation. Never enable OpenCode sharing. */
export function openCodeArgs(config, text, sessionId) {
    const args = [
        'run', '--pure', '--format', 'json', '--model', ZAI_MODEL,
        '--agent', 'sherman',
        '--dir', config.workspacePath,
    ];
    if (sessionId) args.push('--session', sessionId);
    args.push(text);
    return args;
}

/** Convert the launcher's validated .mcp.json into OpenCode's MCP schema. */
export function openCodeMcpConfig(workspacePath, expectedDigest = null) {
    let servers;
    try {
        const path = `${workspacePath}/.mcp.json`;
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) return {};
        const bytes = readFileSync(path);
        if (expectedDigest !== null
            && createHash('sha256').update(bytes).digest('hex') !== expectedDigest) return {};
        servers = JSON.parse(bytes.toString('utf8')).mcpServers;
    } catch {
        return {};
    }
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return {};
    const mcp = {};
    for (const [name, server] of Object.entries(servers)) {
        if (!/^[A-Za-z0-9_-]+$/.test(name) || !server || typeof server !== 'object') continue;
        if (typeof server.command === 'string' && isAbsolute(server.command)
            && Array.isArray(server.args) && server.args.every((arg) => typeof arg === 'string')) {
            const local = {
                type: 'local',
                command: [server.command, ...server.args],
                enabled: true,
            };
            if (server.env && typeof server.env === 'object' && !Array.isArray(server.env)) {
                const environment = Object.entries(server.env)
                    .filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string');
                if (environment.length > 0) local.environment = Object.fromEntries(environment);
            }
            mcp[name] = local;
        } else if ((server.type === 'http' || server.type === 'remote')
            && typeof server.url === 'string' && server.url.startsWith('https://')) {
            const remote = { type: 'remote', url: server.url, enabled: true };
            if (server.headers && typeof server.headers === 'object' && !Array.isArray(server.headers)) {
                const headers = Object.entries(server.headers)
                    .filter(([key, value]) => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)
                        && typeof value === 'string');
                if (headers.length > 0) remote.headers = Object.fromEntries(headers);
            }
            mcp[name] = remote;
        }
    }
    return mcp;
}

/** Refuse config layers and symlink escapes outside Sherman's policy. */
export function assertIsolatedOpenCodeInputs(config) {
    let directory = config.workspacePath;
    while (true) {
        for (const name of ['opencode.json', 'opencode.jsonc', '.opencode']) {
            const candidate = join(directory, name);
            try {
                lstatSync(candidate);
                throw new Error(`Refusing inherited OpenCode project config at ${candidate}.`);
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
            }
        }
        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
    }

    // OpenCode's external_directory guard compares lexical paths and follows
    // links. The workspace is the operator-owned working tree; the separately
    // admitted vault is the sensitive boundary and must contain no links.
    for (const root of [config.vaultPath]) {
        const pending = [root];
        let visitedDirectories = 0;
        while (pending.length > 0) {
            const current = pending.pop();
            const stat = lstatSync(current);
            if (stat.isSymbolicLink()) {
                throw new Error(`Refusing symlink in OpenCode-accessible tree: ${current}`);
            }
            if (!stat.isDirectory()) continue;
            if (++visitedDirectories > 100_000) {
                throw new Error(`OpenCode-accessible tree is too large to validate safely: ${root}`);
            }
            for (const entry of readdirSync(current)) pending.push(join(current, entry));
        }
    }
}

/**
 * Inline permissions have higher precedence than user/project config. The vault
 * is the only path outside Sherman's disposable workspace that this backend is
 * allowed to touch. Read-only turns deny shell and writes instead of pretending
 * OpenCode has a filesystem sandbox it does not have.
 */
export function openCodeConfigForMode(
    config, mode = 'normal', admittedMcp = null, source = 'chat'
) {
    const vault = config.vaultPath.replace(/\/+$/, '');
    const allMcp = admittedMcp ?? openCodeMcpConfig(config.workspacePath);
    const allowPersonalWiki = source === 'skill:research-wiki';
    const readOnly = mode === 'read-only'
        || mode === 'isolated-read-only'
        || mode === 'browser-read-only';
    // The servers a turn actually starts. Long-term memory rides every engine
    // the same way (operator's instruction, 2026-08-12): normal turns start
    // mnemosyne and the personal wiki — the permission grant below meant
    // nothing while the server list never carried them. The research skill's
    // llmwiki carve-out stays. Read-only turns start nothing (see the spread
    // at the bottom): a local MCP can mutate host state during startup.
    const mcp = Object.fromEntries(Object.entries(allMcp).filter(
        ([name]) => (name === 'llmwiki' && (allowPersonalWiki || mode === 'normal'))
            || (name === 'mnemosyne' && mode === 'normal')
    ));
    const permission = {
        // Rules are last-match-wins: deny every external path, then open only
        // the configured vault subtree.
        external_directory: { '*': 'deny', [`${vault}/**`]: 'allow' },
        // Sherman owns workers above the engine seam. Deny the engine's task
        // tool so a child agent with looser permissions cannot bypass policy.
        task: 'deny',
    };
    for (const name of Object.keys(allMcp)) {
        if (allowPersonalWiki && name === 'llmwiki') continue;
        // The memory pair — mnemosyne (local store, no filesystem reach
        // beyond its own data dir) and the personal wiki — is what normal
        // turns keep. Read-only turns re-deny every MCP below, memory
        // included: a judge must not write memories about its own grading.
        if ((name === 'mnemosyne' || name === 'llmwiki') && !readOnly) continue;
        permission[`${name}_*`] = 'deny';
    }
    if (readOnly) {
        // Read-only turns keep the full wall: no shell at all, because bash
        // can route around every path-aware read/edit rule below.
        permission.bash = 'deny';
        permission.edit = 'deny';
        // Local/remote MCPs are host-side capabilities. A read-only promise
        // cannot assume each third-party tool is non-mutating.
        for (const name of Object.keys(allMcp)) permission[`${name}_*`] = 'deny';
        // The eval, verify, and win turns are TOLD to read the session logs
        // and eval verdicts under ~/.sherman, and this wall denied it — a
        // judge graded blind and said so in its own verdict. Read-only turns
        // cannot write (edit is denied above), so opening these directories
        // to reads un-blinds the judge without loosening any write boundary.
        // Read-only ONLY: a normal turn keeps the vault-only wall.
        const shermanHome = dirname(config.workspacePath.replace(/\/+$/, ''));
        permission.external_directory[`${shermanHome}/sessions/**`] = 'allow';
        permission.external_directory[`${shermanHome}/evals/**`] = 'allow';
        permission.external_directory[`${shermanHome}/win-sources/**`] = 'allow';
    } else {
        // Reads may cross into the configured vault, but model file tools may
        // not mutate it. apply_patch is denied outright because its movePath is
        // authorized separately by external_directory in OpenCode 1.18.x.
        // Normal turns get the shell — operator-granted parity with Codex,
        // whose sessions have always had one. Honest cost, stated rather
        // than hidden: bash is not path-aware, so the vault-write denial
        // below is enforceable only on the model file tools; for shell
        // commands it rides the operating contract. The operator weighed
        // that against a zai Sherman that could not run a single command
        // and chose the shell. Read-only turns are unchanged.
        permission.bash = 'allow';
        const workspaceOnlyEdit = { '*': 'allow', [`${vault}/**`]: 'deny' };
        permission.edit = workspaceOnlyEdit;
        permission.write = workspaceOnlyEdit;
        permission.patch = workspaceOnlyEdit;
        permission.apply_patch = 'deny';
    }
    if (mode === 'isolated-read-only') {
        permission.skill = 'deny';
        permission.webfetch = 'deny';
        permission.websearch = 'deny';
    }
    return JSON.stringify({
        share: 'disabled',
        default_agent: 'sherman',
        // A Coding Plan key is a real Z.AI credential the GENERAL endpoint
        // refuses with error 1113 — and OpenCode retries that refusal
        // silently, which read as an infinite hang until the stall detector
        // named it. Proven live: the same key, the same model, the coding
        // endpoint — a completion. The credential slot, provider id, and
        // pinned model all stay the same; only the door changes, and only
        // when the operator declared the Coding Plan at `sherman model`.
        ...(config.zaiPlan === 'coding'
            ? { provider: { zai: { options: { baseURL: 'https://api.z.ai/api/coding/paas/v4' } } } }
            : {}),
        permission,
        // Agent-level rules can override global rules in OpenCode. Define and
        // select Sherman's own primary agent so project defaults cannot replace
        // the boundary above.
        agent: {
            sherman: {
                description: 'Sherman policy-bound primary agent',
                mode: 'primary',
                permission,
            },
        },
        // Do not even start connector processes in a read-only mode: a local
        // MCP can mutate host state during startup before a tool call occurs.
        ...(!readOnly && Object.keys(mcp).length > 0 ? { mcp } : {}),
    });
}

function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function toolCategory(tool) {
    if (['read', 'glob', 'grep', 'list'].includes(tool)) return 'file-read';
    if (['edit', 'write', 'patch', 'apply_patch'].includes(tool)) return 'file-change';
    if (tool === 'bash') return 'shell-command';
    if (tool === 'task') return 'subagent';
    if (tool === 'webfetch' || tool === 'websearch') return 'web-search';
    return 'tool';
}

function toolLabel(part) {
    const tool = String(part?.tool || 'tool');
    const title = String(part?.state?.title || '').replace(/\s+/g, ' ').trim();
    return title ? `${tool} ${title}`.slice(0, 180) : tool;
}

/** Normalize one documented/probed OpenCode JSONL record. */
export function mapOpenCodeEvent(record) {
    if (!record || typeof record !== 'object') return [];
    const part = record.part || {};

    if (record.type === 'text' && typeof part.text === 'string' && part.text) {
        return [ev.message(part.text)];
    }
    if (record.type === 'reasoning' && typeof part.text === 'string' && part.text) {
        return [ev.reasoning(part.text)];
    }
    if (record.type === 'tool_use') {
        const state = part.state || {};
        const status = state.status || 'running';
        const completed = status === 'completed' || status === 'error' || status === 'failed';
        const failed = status === 'error' || status === 'failed';
        const started = finite(state.time?.start, null);
        const ended = finite(state.time?.end, null);
        return [ev.tool({
            id: String(part.callID || part.id || `${part.tool || 'tool'}-unknown`),
            phase: completed ? 'completed' : 'started',
            label: toolLabel(part),
            category: toolCategory(String(part.tool || '')),
            outcome: completed ? (failed ? 'failed' : 'succeeded') : 'running',
            durationMs: started !== null && ended !== null ? Math.max(0, ended - started) : null,
        })];
    }
    if (record.type === 'step_finish' && part.tokens) {
        const tokens = part.tokens;
        const input = finite(tokens.input);
        const output = finite(tokens.output);
        const reasoning = finite(tokens.reasoning);
        return [{
            kind: 'usage',
            usage: {
                input,
                cachedInput: finite(tokens.cache?.read),
                output,
                reasoning,
                total: finite(tokens.total, input + output + reasoning),
            },
        }];
    }
    if (record.type === 'error') {
        const message = record.error?.message
            || record.error?.data?.message
            || part.error?.message
            || part.error?.data?.message
            || record.message
            || 'OpenCode reported an error.';
        return [ev.error(String(message))];
    }
    return [];
}

export class OpenCodeSession extends EngineSession {
    /** @param {import('../config.js').ShermanConfig} config */
    constructor(config) {
        super();
        this._config = config;
        this._usage = emptyUsage();
        this._sessionId = null;
        this._child = null;
        this._interrupted = false;
        // The launcher rewrites .mcp.json immediately before starting Shell.
        // Snapshot it once so a model edit during turn N cannot become an
        // executable connector on turn N+1.
        const connectorDigest = process.env.SHERMAN_MCP_CONFIG_SHA256;
        this._admittedMcp = connectorDigest
            ? JSON.parse(JSON.stringify(openCodeMcpConfig(config.workspacePath, connectorDigest)))
            : {};
    }

    get info() {
        return {
            engine: 'zai',
            model: ZAI_MODEL.split('/')[1],
            user: this._config.user,
            vaultPath: this._config.vaultPath,
            threadId: this._sessionId,
            contextWindow: this._config.contextWindowTokens ?? ZAI_CONTEXT_WINDOW,
        };
    }

    get usage() {
        return this._usage;
    }

    async *send(request) {
        const normalized = typeof request === 'string' ? { text: request, mode: 'normal' } : request;
        const text = normalized?.text ?? '';
        const mode = normalized?.mode ?? 'normal';
        const turnUsage = emptyUsage();
        let sawMessage = false;
        let sawError = false;
        let malformedOutput = false;
        this._interrupted = false;
        yield ev.turnStart();

        let isolatedConfigDir;
        try {
            assertIsolatedOpenCodeInputs(this._config);
            isolatedConfigDir = mkdtempSync(join(tmpdir(), 'sherman-opencode-config-'));
            writeFileSync(join(isolatedConfigDir, 'opencode.json'), '{}', { mode: 0o600 });
        } catch (error) {
            yield ev.error(error.message);
            return;
        }

        const child = spawn('opencode', openCodeArgs(this._config, text, this._sessionId), {
            cwd: this._config.workspacePath,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                // Keep credentials in OpenCode's normal data store while
                // isolating all user configuration and custom tools.
                XDG_CONFIG_HOME: isolatedConfigDir,
                OPENCODE_CONFIG_DIR: isolatedConfigDir,
                OPENCODE_CONFIG: join(isolatedConfigDir, 'opencode.json'),
                OPENCODE_CONFIG_CONTENT: openCodeConfigForMode(
                    this._config, mode, this._admittedMcp, normalized?.source ?? 'chat'
                ),
            },
        });
        this._child = child;

        let stderr = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => {
            stderr = (stderr + chunk).slice(-4096);
        });

        const result = new Promise((resolve) => {
            child.once('error', (error) => resolve({ code: null, error }));
            child.once('close', (code, signal) => resolve({ code, signal, error: null }));
        });

        // The stall detector. Armed at spawn, disarmed by the first stdout
        // line — even a blank one, because any line proves the child is
        // talking. A stalled child is killed and the stall is REMEMBERED,
        // so the exit handling below can name what happened instead of
        // reporting a bare "OpenCode exited without a status".
        const stallMs = firstOutputStallMs();
        let stalled = false;
        let stallTimer = setTimeout(() => {
            if (child.exitCode === null) {
                stalled = true;
                child.kill('SIGTERM');
            }
        }, stallMs);

        const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
        for await (const line of lines) {
            if (stallTimer) {
                clearTimeout(stallTimer);
                stallTimer = null;
            }
            if (!line.trim()) continue;
            let record;
            try {
                record = JSON.parse(line);
            } catch {
                malformedOutput = true;
                continue;
            }
            if (typeof record.sessionID === 'string' && record.sessionID) {
                this._sessionId = record.sessionID;
            }
            for (const event of mapOpenCodeEvent(record)) {
                if (event.kind === 'usage') {
                    Object.assign(turnUsage, addUsage(turnUsage, event.usage));
                } else {
                    if (event.kind === 'message') sawMessage = true;
                    if (event.kind === 'error') sawError = true;
                    yield event;
                }
            }
        }

        const exit = await result;
        if (stallTimer) {
            clearTimeout(stallTimer);
            stallTimer = null;
        }
        this._child = null;
        rmSync(isolatedConfigDir, { recursive: true, force: true });
        if (this._interrupted) {
            yield ev.interrupted();
            return;
        }
        // Before the generic exit checks: a stall killed the child itself, so
        // the honest report is the stall and its repairs, not the kill signal.
        if (stalled) {
            yield ev.error(stallMessage(stallMs));
            return;
        }
        if (exit.error?.code === 'ENOENT') {
            yield ev.error(NOT_INSTALLED);
            return;
        }
        if (exit.error || exit.code !== 0) {
            const detail = stderr.trim() || exit.error?.message || `OpenCode exited ${exit.code ?? 'without a status'}.`;
            yield ev.error(detail);
            return;
        }
        if (malformedOutput) {
            yield ev.error('OpenCode returned malformed JSON output. The response was not accepted.');
            return;
        }
        if (!sawMessage && !sawError) {
            yield ev.error('OpenCode ended without an assistant response.');
        }
        this._usage = addUsage(this._usage, turnUsage);
        yield ev.turnEnd(turnUsage);
    }

    startNewThread() {
        this._sessionId = null;
        return true;
    }

    interrupt() {
        this._interrupted = true;
        this._child?.kill('SIGINT');
    }

    dispose() {
        this._child?.kill('SIGTERM');
        this._child = null;
    }
}
