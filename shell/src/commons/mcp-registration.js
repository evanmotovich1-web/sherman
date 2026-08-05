import {
    chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { loadIdentity } from './identity.js';
import { signedHeaders } from './signing.js';

const SERVER_NAME = 'sherman-commons';
const OWNER_ENV = 'SHERMAN_COMMONS_MCP_OWNER';
const CODEX_BEGIN = '# BEGIN SHERMAN-OWNED COMMONS MCP';
const CODEX_END = '# END SHERMAN-OWNED COMMONS MCP';
const MAX_HEARTBEAT_BYTES = 4096;

function serviceOrigin(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (Object.keys(value).some((key) => !['version', 'serviceUrl', 'autoPublishInventory'].includes(key))
        || value.version !== 1 || typeof value.autoPublishInventory !== 'boolean') return null;
    try {
        const url = new URL(value.serviceUrl);
        const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
        if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.search || url.hash) return null;
        return url.origin;
    } catch {
        return null;
    }
}

function readSettings(home) {
    try {
        const path = join(home, '.sherman', 'commons', 'settings.json');
        const metadata = lstatSync(path);
        if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o077) !== 0) return null;
        return serviceOrigin(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
        return null;
    }
}

async function boundedHeartbeat({ identity, origin, fetchImpl, timeoutMs }) {
    const url = new URL('/agent/v1/heartbeat', origin).href;
    const body = '{}';
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                ...signedHeaders({
                    privateKey: identity.privateKey,
                    method: 'POST', url, body, contentType: 'application/json', audience: origin,
                    networkId: identity.networkId, deviceId: identity.deviceId,
                    idempotencyKey: randomUUID(),
                }),
            },
            body,
            signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) return 'revoked';
        if (!response.ok) return 'unreachable';
        const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
        if (mediaType !== 'application/json') return 'malformed';
        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > MAX_HEARTBEAT_BYTES) return 'malformed';
        const chunks = [];
        let size = 0;
        const reader = response.body?.getReader();
        if (!reader) return 'malformed';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_HEARTBEAT_BYTES) {
                await reader.cancel().catch(() => {});
                return 'malformed';
            }
            chunks.push(Buffer.from(value));
        }
        const bytes = Buffer.concat(chunks, size);
        let value;
        try { value = JSON.parse(bytes.toString('utf8')); } catch { return 'malformed'; }
        if (!value || typeof value !== 'object' || Array.isArray(value)
            || Object.keys(value).some((key) => !['ok', 'replayed'].includes(key))
            || value.ok !== true || typeof value.replayed !== 'boolean') return 'malformed';
        return 'active';
    } catch {
        return timedOut ? 'timeout' : 'unreachable';
    } finally {
        clearTimeout(timer);
    }
}

function atomicWrite(path, text) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const pending = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(pending, text, { mode: 0o600, flag: 'wx' });
    renameSync(pending, path);
    chmodSync(path, 0o600);
}

function desiredServer(executablePath, mcpPath) {
    return {
        command: executablePath,
        args: [mcpPath],
        env: { [OWNER_ENV]: 'sherman' },
    };
}

function reconcileClaude({ path, active, executablePath, mcpPath }) {
    let config = { mcpServers: {} };
    if (existsSync(path)) {
        try { config = JSON.parse(readFileSync(path, 'utf8')); } catch { return false; }
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
    if (config.mcpServers === undefined) config.mcpServers = {};
    if (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) return false;
    const current = config.mcpServers[SERVER_NAME];
    const owned = current?.env?.[OWNER_ENV] === 'sherman';
    if (active) {
        if (current && !owned) return false;
        const desired = desiredServer(executablePath, mcpPath);
        if (JSON.stringify(current) === JSON.stringify(desired)) return false;
        config.mcpServers[SERVER_NAME] = desired;
    } else {
        if (!owned) return false;
        delete config.mcpServers[SERVER_NAME];
    }
    atomicWrite(path, `${JSON.stringify(config, null, 2)}\n`);
    return true;
}

function quoteToml(value) {
    return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function stripOwnedCodexBlocks(text) {
    let next = text;
    let removed = false;
    while (true) {
        const start = next.indexOf(CODEX_BEGIN);
        if (start < 0) return { text: next, removed };
        const end = next.indexOf(CODEX_END, start + CODEX_BEGIN.length);
        if (end < 0) {
            const ownedTail = next.slice(start + CODEX_BEGIN.length);
            const header = ownedTail.match(/^\s*\n\s*\[mcp_servers\.sherman-commons\]\s*\r?\n/);
            if (!header) return { text, removed: false };
            const bodyStart = start + CODEX_BEGIN.length + header[0].length;
            const following = next.slice(bodyStart).match(/^\s*\[[^\]\r\n]+\]\s*$/m);
            const after = following ? bodyStart + following.index : next.length;
            next = `${next.slice(0, start)}${next.slice(after)}`;
            removed = true;
            continue;
        }
        const after = end + CODEX_END.length;
        next = `${next.slice(0, start)}${next.slice(after).replace(/^\n{1,2}/, '')}`;
        removed = true;
    }
}

function hasUnownedCodexEntry(text) {
    return /^\s*\[\s*mcp_servers\.(?:sherman-commons|"sherman-commons"|'sherman-commons')\s*\]\s*$/m.test(text);
}

function reconcileCodex({ path, active, executablePath, mcpPath }) {
    const original = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const stripped = stripOwnedCodexBlocks(original);
    let next = stripped.text;
    if (active) {
        if (hasUnownedCodexEntry(next)) return false;
        const block = [
            CODEX_BEGIN,
            `[mcp_servers.${SERVER_NAME}]`,
            `command = ${quoteToml(executablePath)}`,
            `args = [${quoteToml(mcpPath)}]`,
            CODEX_END,
            '',
        ].join('\n');
        next = `${next}${next && !next.endsWith('\n') ? '\n' : ''}${next ? '\n' : ''}${block}`;
    }
    if (next === original) return false;
    atomicWrite(path, next);
    return true;
}

export async function reconcileCommonsMcpRegistration({
    engine,
    home = process.env.HOME,
    workspace,
    executablePath = process.execPath,
    mcpPath,
    codexConfigPath = join(process.env.CODEX_HOME || join(home, '.codex'), 'config.toml'),
    fetchImpl = globalThis.fetch,
    timeoutMs = 1500,
} = {}) {
    if (!['claude', 'codex'].includes(engine) || !isAbsolute(executablePath) || !isAbsolute(mcpPath)
        || typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) {
        return { active: false, changed: false, reason: 'invalid_local_configuration' };
    }
    let identity = null;
    let origin = null;
    try {
        identity = loadIdentity(home);
        origin = readSettings(home);
    } catch {
        // Treat malformed or unsafe local enrollment as inactive without reflecting details.
    }
    let reason = !identity ? 'unenrolled' : !origin ? 'malformed_settings' : null;
    if (!reason) reason = await boundedHeartbeat({ identity, origin, fetchImpl, timeoutMs });
    const active = reason === 'active';
    const changed = engine === 'claude'
        ? reconcileClaude({ path: join(workspace, '.mcp.json'), active, executablePath, mcpPath })
        : reconcileCodex({ path: codexConfigPath, active, executablePath, mcpPath });
    return { active, changed, reason };
}
