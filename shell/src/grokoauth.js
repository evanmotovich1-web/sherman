// Sherman-owned SuperGrok OAuth. Device-code sign-in against xAI directly.
// OpenCode is only the coding runtime. It never owns this credential and
// this module never runs `opencode auth login`.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const XAI_OAUTH_ISSUER = 'https://auth.x.ai';
export const XAI_OAUTH_DISCOVERY_URL = `${XAI_OAUTH_ISSUER}/.well-known/openid-configuration`;
export const XAI_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
export const XAI_OAUTH_SCOPE = 'openid profile email offline_access grok-cli:access api:access';
export const XAI_OAUTH_DEVICE_CODE_URL = `${XAI_OAUTH_ISSUER}/oauth2/device/code`;
export const DEFAULT_TOKEN_ENDPOINT = `${XAI_OAUTH_ISSUER}/oauth2/token`;
const STORE_NAME = 'grok-oauth.json';
const REFRESH_SKEW_MS = 60 * 60 * 1000;

function shermanHome(home) {
    return join(home || process.env.HOME || homedir(), '.sherman');
}

export function grokOAuthPath(home) {
    return join(shermanHome(home), STORE_NAME);
}

export function loadGrokOAuth(home) {
    try {
        const parsed = JSON.parse(readFileSync(grokOAuthPath(home), 'utf8'));
        if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'invalid store' };
        const refresh = typeof parsed.refresh_token === 'string' ? parsed.refresh_token : '';
        const access = typeof parsed.access_token === 'string' ? parsed.access_token : '';
        if (!refresh && !access) return { ok: false, reason: 'empty store' };
        return { ok: true, store: parsed };
    } catch (err) {
        if (err.code === 'ENOENT') return { ok: false, reason: 'missing' };
        return { ok: false, reason: 'unreadable store' };
    }
}

export function saveGrokOAuth(store, home) {
    const dir = shermanHome(home);
    mkdirSync(dir, { recursive: true });
    const path = grokOAuthPath(home);
    const body = `${JSON.stringify({ version: 1, ...store }, null, 2)}\n`;
    writeFileSync(path, body, { mode: 0o600 });
    chmodSync(path, 0o600);
    return path;
}

export function hasGrokOAuth(home) {
    const loaded = loadGrokOAuth(home);
    if (!loaded.ok) return false;
    const refresh = loaded.store.refresh_token;
    const access = loaded.store.access_token;
    return (typeof refresh === 'string' && refresh.length > 0)
        || (typeof access === 'string' && access.length > 0);
}

function formBody(fields) {
    return Object.entries(fields)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
}

async function postForm(url, fields) {
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
        },
        body: formBody(fields),
    });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    return { status: res.status, json, text };
}

async function tokenEndpoint() {
    try {
        const res = await fetch(XAI_OAUTH_DISCOVERY_URL, { headers: { Accept: 'application/json' } });
        if (!res.ok) return DEFAULT_TOKEN_ENDPOINT;
        const body = await res.json();
        const endpoint = typeof body.token_endpoint === 'string' ? body.token_endpoint : '';
        return endpoint.startsWith('https://auth.x.ai/') ? endpoint : DEFAULT_TOKEN_ENDPOINT;
    } catch {
        return DEFAULT_TOKEN_ENDPOINT;
    }
}

export function needsRefresh(store, now = Date.now()) {
    const expiresAt = Number(store?.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) return Boolean(store?.refresh_token);
    return now + REFRESH_SKEW_MS >= expiresAt;
}

export async function refreshGrokOAuth(home) {
    const loaded = loadGrokOAuth(home);
    if (!loaded.ok) return { ok: false, reason: loaded.reason };
    const refresh = loaded.store.refresh_token;
    if (!refresh) return { ok: false, reason: 'missing refresh token' };
    if (!needsRefresh(loaded.store)) {
        return { ok: true, access: loaded.store.access_token, refreshed: false };
    }
    const endpoint = loaded.store.token_endpoint || await tokenEndpoint();
    const { status, json } = await postForm(endpoint, {
        grant_type: 'refresh_token',
        client_id: XAI_OAUTH_CLIENT_ID,
        refresh_token: refresh,
    });
    if (status !== 200 || !json.access_token) {
        return { ok: false, reason: 'refresh failed — run sherman model grok and sign in again' };
    }
    const next = {
        ...loaded.store,
        access_token: json.access_token,
        refresh_token: json.refresh_token || refresh,
        expires_at: Date.now() + (Number(json.expires_in) || 21600) * 1000,
        token_endpoint: endpoint,
    };
    saveGrokOAuth(next, home);
    return { ok: true, access: next.access_token, refreshed: true };
}

export function injectGrokOAuth(env = process.env, home) {
    const loaded = loadGrokOAuth(home);
    if (!loaded.ok || !loaded.store.access_token) return { ok: false, injected: false };
    if (env.XAI_API_KEY === undefined || env.XAI_API_KEY === '') {
        env.XAI_API_KEY = loaded.store.access_token;
        return { ok: true, injected: true };
    }
    return { ok: true, injected: false };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loginGrokOAuth({ home, openBrowser = true, sleepFn = sleep } = {}) {
    const device = await postForm(XAI_OAUTH_DEVICE_CODE_URL, {
        client_id: XAI_OAUTH_CLIENT_ID,
        scope: XAI_OAUTH_SCOPE,
    });
    if (device.status !== 200 || !device.json.device_code || !device.json.user_code) {
        return { ok: false, reason: 'xAI device-code request failed' };
    }
    const url = device.json.verification_uri_complete || device.json.verification_uri;
    const userCode = device.json.user_code;
    process.stdout.write('\nSherman Grok OAuth (SuperGrok) — this is Sherman\'s sign-in, not OpenCode\'s.\n');
    process.stdout.write(`  1. Open: ${url}\n`);
    process.stdout.write(`  2. If asked, enter code: ${userCode}\n`);
    if (openBrowser && process.platform === 'darwin') {
        spawnSync('open', [url], { stdio: 'ignore' });
        process.stdout.write('  (Opened your browser.)\n');
    }
    process.stdout.write('Waiting for you to approve in the browser...\n');

    const endpoint = await tokenEndpoint();
    const deadline = Date.now() + Math.max(30, Number(device.json.expires_in) || 300) * 1000;
    let interval = Math.max(1, Number(device.json.interval) || 5) * 1000;
    while (Date.now() < deadline) {
        await sleepFn(interval);
        const token = await postForm(endpoint, {
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            client_id: XAI_OAUTH_CLIENT_ID,
            device_code: device.json.device_code,
        });
        if (token.status === 200 && token.json.access_token && token.json.refresh_token) {
            saveGrokOAuth({
                access_token: token.json.access_token,
                refresh_token: token.json.refresh_token,
                expires_at: Date.now() + (Number(token.json.expires_in) || 21600) * 1000,
                token_endpoint: endpoint,
            }, home);
            process.stdout.write('  signed in. Token stored in ~/.sherman/grok-oauth.json (chmod 600, never synced).\n');
            return { ok: true };
        }
        const err = String(token.json.error || '');
        if (err === 'authorization_pending') continue;
        if (err === 'slow_down') {
            interval = Math.min(interval + 1000, 30000);
            continue;
        }
        if (err === 'expired_token' || err === 'authorization_denied') {
            return { ok: false, reason: `xAI said ${err}` };
        }
        if (token.status >= 400 && err) return { ok: false, reason: `xAI said ${err}` };
    }
    return { ok: false, reason: 'timed out waiting for approval' };
}

async function cli(argv) {
    const flag = argv[0];
    if (flag === '--status') {
        process.stdout.write(hasGrokOAuth() ? 'signed-in\n' : 'signed-out\n');
        return hasGrokOAuth() ? 0 : 1;
    }
    if (flag === '--refresh') {
        const result = await refreshGrokOAuth();
        if (!result.ok) {
            process.stderr.write(`${result.reason}\n`);
            return 1;
        }
        return 0;
    }
    if (flag === '--access') {
        const ready = await refreshGrokOAuth();
        if (!ready.ok || !ready.access) {
            process.stderr.write(`${ready.reason || 'not signed in'}\n`);
            return 1;
        }
        process.stdout.write(ready.access);
        return 0;
    }
    if (flag === '--login') {
        if (!process.stdin.isTTY) {
            process.stderr.write('Grok OAuth needs a terminal. Run: sherman model grok\n');
            return 1;
        }
        const result = await loginGrokOAuth();
        if (!result.ok) {
            process.stderr.write(`${result.reason}\n`);
            return 1;
        }
        return 0;
    }
    process.stderr.write('Usage: grokoauth.js --status | --login | --refresh | --access\n');
    return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    cli(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
        process.stderr.write(`${err.message}\n`);
        process.exit(1);
    });
}
