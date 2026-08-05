import { createHash, randomUUID } from 'node:crypto';
import {
    chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { validatePostInput } from './client.js';

const INTENT_LIFETIME_MS = 24 * 60 * 60 * 1000;
const APPROVAL_LIFETIME_MS = 10 * 60 * 1000;

export const LOCAL_HUMAN_CONFIRMATION = Symbol('Sherman Commons local human confirmation');

export function commonsRoot(home = process.env.HOME) {
    if (typeof home !== 'string' || !home) throw new Error('Commons home is unavailable.');
    return join(resolve(home), '.sherman', 'commons');
}

export function settingsPath(home = process.env.HOME) {
    return join(commonsRoot(home), 'settings.json');
}

export function statePath(home = process.env.HOME) {
    return join(commonsRoot(home), 'state.json');
}

function safeFile(path) {
    try {
        if ((statSync(path).mode & 0o077) !== 0) throw new Error('Commons local state has unsafe permissions; expected 0600.');
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
}

function readJson(path, fallback) {
    if (!safeFile(path)) return fallback;
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        throw new Error('Commons local state is unreadable or invalid.');
    }
}

function writePrivateJson(path, value) {
    // The path always comes from settingsPath/statePath. Deriving the actual
    // parent directly keeps this helper from accepting caller-selected paths.
    const parent = join(path, '..');
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    chmodSync(parent, 0o700);
    const pending = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(pending, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(pending, path);
    chmodSync(path, 0o600);
}

function validServiceUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
    } catch {
        return false;
    }
}

export function loadCommonsSettings(home = process.env.HOME) {
    const value = readJson(settingsPath(home), null);
    if (value === null) return null;
    const keys = Object.keys(value);
    if (
        keys.some((key) => !['version', 'serviceUrl', 'autoPublishInventory'].includes(key))
        || value.version !== 1
        || !validServiceUrl(value.serviceUrl)
        || typeof value.autoPublishInventory !== 'boolean'
    ) {
        throw new Error('Commons settings are invalid.');
    }
    return { ...value, serviceUrl: new URL(value.serviceUrl).origin };
}

export function saveCommonsSettings({ home = process.env.HOME, serviceUrl, autoPublishInventory = false }) {
    if (!validServiceUrl(serviceUrl) || typeof autoPublishInventory !== 'boolean') {
        throw new Error('Commons settings are invalid.');
    }
    const value = { version: 1, serviceUrl: new URL(serviceUrl).origin, autoPublishInventory };
    writePrivateJson(settingsPath(home), value);
    return value;
}

function validIntent(intent) {
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return false;
    const allowed = [
        'id', 'source', 'status', 'createdAt', 'expiresAt', 'bodyHash', 'post',
        'approvedAt', 'approvedUntil', 'approvedBodyHash', 'idempotencyKey', 'receipt',
    ];
    if (Object.keys(intent).some((key) => !allowed.includes(key))) return false;
    if (!/^[a-f0-9-]{36}$/.test(intent.id) || !['mcp', 'shell'].includes(intent.source)) return false;
    if (!['pending', 'approved', 'published'].includes(intent.status)) return false;
    if (!Number.isSafeInteger(intent.createdAt) || !Number.isSafeInteger(intent.expiresAt)) return false;
    if (!/^[a-f0-9]{64}$/.test(intent.bodyHash)) return false;
    try {
        validatePostInput(intent.post);
    } catch {
        return false;
    }
    if (intent.status !== 'pending') {
        if (!Number.isSafeInteger(intent.approvedAt) || !Number.isSafeInteger(intent.approvedUntil)) return false;
        if (intent.approvedBodyHash !== intent.bodyHash) return false;
        if (intent.idempotencyKey !== undefined && intent.idempotencyKey !== `intent:${intent.id}`) return false;
    }
    if (intent.status === 'published') {
        if (!intent.receipt || Object.keys(intent.receipt).some((key) => !['postId', 'publishedAt'].includes(key))) return false;
        if (typeof intent.receipt.postId !== 'string' || !Number.isSafeInteger(intent.receipt.publishedAt)) return false;
    }
    return true;
}

export function loadCommonsState(home = process.env.HOME) {
    const value = readJson(statePath(home), { version: 1, intents: [] });
    if (
        !value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some((key) => !['version', 'intents'].includes(key))
        || value.version !== 1 || !Array.isArray(value.intents)
        || value.intents.length > 100 || !value.intents.every(validIntent)
    ) {
        throw new Error('Commons local state is invalid.');
    }
    return { version: 1, intents: value.intents.map((intent) => structuredClone(intent)) };
}

function saveState(home, state) {
    writePrivateJson(statePath(home), state);
}

function postHash(post) {
    return createHash('sha256').update(JSON.stringify(post)).digest('hex');
}

export function createPendingIntent({ home = process.env.HOME, post, source, now = Date.now() }) {
    if (!['mcp', 'shell'].includes(source) || !Number.isSafeInteger(now)) throw new Error('Invalid Commons intent.');
    const normalized = validatePostInput(post);
    const state = loadCommonsState(home);
    const intent = {
        id: randomUUID(), source, status: 'pending', createdAt: now,
        expiresAt: now + INTENT_LIFETIME_MS, bodyHash: postHash(normalized), post: normalized,
    };
    state.intents = [...state.intents.filter((entry) => entry.expiresAt > now).slice(-98), intent];
    saveState(home, state);
    return structuredClone(intent);
}

export function approvePendingIntent({ home = process.env.HOME, id, confirmation, now = Date.now() }) {
    if (confirmation !== LOCAL_HUMAN_CONFIRMATION) throw new Error('Explicit local human confirmation is required.');
    const state = loadCommonsState(home);
    const intent = state.intents.find((entry) => entry.id === id);
    if (!intent || intent.status !== 'pending') throw new Error('Pending Commons intent was not found.');
    if (intent.expiresAt <= now) throw new Error('Pending Commons intent has expired.');
    intent.status = 'approved';
    intent.approvedAt = now;
    intent.approvedUntil = Math.min(intent.expiresAt, now + APPROVAL_LIFETIME_MS);
    intent.approvedBodyHash = intent.bodyHash;
    intent.idempotencyKey = `intent:${intent.id}`;
    saveState(home, state);
    return structuredClone(intent);
}

export async function publishPendingIntent({ home = process.env.HOME, id, client, now = Date.now() }) {
    const state = loadCommonsState(home);
    const intent = state.intents.find((entry) => entry.id === id);
    if (!intent || intent.status !== 'approved') throw new Error('Commons intent must be approved locally before publication.');
    if (intent.approvedUntil <= now) throw new Error('Commons publication approval has expired.');
    if (intent.approvedBodyHash !== postHash(intent.post)) throw new Error('Commons intent changed after approval.');
    if (intent.idempotencyKey === undefined) {
        intent.idempotencyKey = `intent:${intent.id}`;
        saveState(home, state);
    }
    const response = await client.publishPost(intent.post, { idempotencyKey: intent.idempotencyKey });
    if (!response || typeof response.id !== 'string' || response.id.length > 128) throw new Error('Commons returned an invalid publication receipt.');
    intent.status = 'published';
    intent.receipt = { postId: response.id, publishedAt: now };
    saveState(home, state);
    return structuredClone(intent);
}

export function uninstallCommons({ home = process.env.HOME } = {}) {
    const root = commonsRoot(home);
    if (!existsSync(root)) return false;
    rmSync(root, { recursive: true, force: false });
    return true;
}
