import { createHash, randomUUID } from 'node:crypto';
import {
    chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkCommonsContent } from './content-gate.js';
import { commonsRoot, loadCommonsSettings } from './local-state.js';
import { parseFrontMatter } from '../registry.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MAX_SKILLS = 500;
const MAX_CONNECTORS = 200;

function digest(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function bytesDigest(value) {
    return createHash('sha256').update(value).digest('hex');
}

function safeText(value, max) {
    if (typeof value !== 'string' || !value || value.length > max) return 'invalid_type';
    return checkCommonsContent(value).reason_code;
}

function rejection(type, name, reasonCode) {
    return {
        type,
        name: typeof name === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(name) ? name : '(invalid)',
        reason_code: reasonCode || 'invalid_type',
    };
}

function skillsFrom(root, rejected, sourceScope) {
    const directory = join(root, 'skills');
    let entries;
    try {
        entries = readdirSync(directory, { withFileTypes: true });
    } catch {
        return [];
    }
    const skills = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_SKILLS)) {
        if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(entry.name)) continue;
        const path = join(directory, entry.name, 'SKILL.md');
        let text;
        try {
            if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) {
                rejected.push(rejection('skill', entry.name, 'invalid_type'));
                continue;
            }
            text = readFileSync(path, 'utf8');
        } catch {
            rejected.push(rejection('skill', entry.name, 'invalid_type'));
            continue;
        }
        const fields = parseFrontMatter(text);
        if (!fields || fields.name !== entry.name) {
            rejected.push(rejection('skill', entry.name, 'invalid_type'));
            continue;
        }
        const approved = {
            name: fields.name,
            category: fields.category,
            summary: fields.summary || fields.description,
            description: fields.description,
            manifest_sha256: bytesDigest(text),
            source_scope: sourceScope,
            content_available: false,
        };
        let reasonCode = null;
        for (const [key, max] of [['name', 80], ['category', 80], ['summary', 240], ['description', 500]]) {
            reasonCode = safeText(approved[key], max);
            if (reasonCode) break;
        }
        if (reasonCode) {
            rejected.push(rejection('skill', entry.name, reasonCode));
            continue;
        }
        skills.push(approved);
    }
    return skills;
}

function signupHost(value) {
    if (value === undefined || value === null) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return false;
        return url.hostname.toLowerCase();
    } catch {
        return false;
    }
}

function connectorsFrom(root, rejected, sourceScope) {
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(join(root, 'agent', 'connectors.json'), 'utf8'));
    } catch {
        return [];
    }
    if (!Array.isArray(parsed?.connectors)) return [];
    const connectors = [];
    for (const entry of parsed.connectors.slice(0, MAX_CONNECTORS)) {
        const name = entry?.name;
        if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(name ?? '')) {
            rejected.push(rejection('connector', name, 'invalid_type'));
            continue;
        }
        const requires = Array.isArray(entry.requires) ? [...new Set(entry.requires)].sort() : [];
        const signup_host = signupHost(entry.signup);
        const manifest = {
            name, summary: entry.summary, transport: entry.transport, requires,
            signup_host,
            source_scope: sourceScope,
            content_available: false,
        };
        const approved = { ...manifest, manifest_sha256: digest(manifest) };
        let reasonCode = safeText(approved.name, 80) || safeText(approved.summary, 240);
        if (!['stdio', 'http'].includes(approved.transport)) reasonCode = reasonCode || 'invalid_type';
        if (signup_host === false || (typeof signup_host === 'string' && safeText(signup_host, 253))) {
            reasonCode = reasonCode || 'invalid_type';
        }
        if (requires.length > 50 || requires.some((secretName) => (
            typeof secretName !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(secretName)
        ))) reasonCode = reasonCode || 'invalid_type';
        if (reasonCode) {
            rejected.push(rejection('connector', name, reasonCode));
            continue;
        }
        connectors.push(approved);
    }
    return connectors.sort((a, b) => a.name.localeCompare(b.name));
}

export function buildCommonsInventory({ root = REPO_ROOT, sourceScope = 'bundled' } = {}) {
    if (!['bundled', 'personal'].includes(sourceScope)) throw new Error('Commons inventory source scope is invalid.');
    const rejected = [];
    const value = {
        version: 1,
        skills: skillsFrom(root, rejected, sourceScope).sort((a, b) => a.name.localeCompare(b.name)),
        connectors: connectorsFrom(root, rejected, sourceScope),
        rejected: rejected.sort((a, b) => `${a.type}:${a.name}`.localeCompare(`${b.type}:${b.name}`)),
    };
    return { ...value, hash: digest(value) };
}

export function inventoryStatePath(home = process.env.HOME) {
    return join(commonsRoot(home), 'inventory-state.json');
}

function itemMap(inventory) {
    const items = new Map();
    for (const [type, values] of [['skill', inventory.skills], ['connector', inventory.connectors]]) {
        for (const metadata of values) {
            const key = `${type}:${metadata.name}`;
            items.set(key, { type, hash: digest({ type, metadata }), metadata });
        }
    }
    return items;
}

function loadInventoryState(home) {
    const path = inventoryStatePath(home);
    try {
        if ((statSync(path).mode & 0o077) !== 0) throw new Error('Commons inventory state has unsafe permissions.');
    } catch (error) {
        if (error?.code === 'ENOENT') return {
            version: 1, inventoryHash: null, itemHashes: {}, itemMetadata: {}, syncedAt: null,
        };
        throw error;
    }
    let value;
    try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('Commons inventory state is invalid.'); }
    if (
        !value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some((key) => !['version', 'inventoryHash', 'itemHashes', 'itemMetadata', 'syncedAt'].includes(key))
        || value.version !== 1 || (value.inventoryHash !== null && !/^[a-f0-9]{64}$/.test(value.inventoryHash))
        || !value.itemHashes || typeof value.itemHashes !== 'object' || Array.isArray(value.itemHashes)
        || Object.values(value.itemHashes).some((hash) => !/^[a-f0-9]{64}$/.test(hash))
        || !value.itemMetadata || typeof value.itemMetadata !== 'object' || Array.isArray(value.itemMetadata)
        || Object.keys(value.itemMetadata).some((key) => !Object.hasOwn(value.itemHashes, key))
        || (value.syncedAt !== null && !Number.isSafeInteger(value.syncedAt))
    ) throw new Error('Commons inventory state is invalid.');
    return value;
}

function writeInventoryState(home, state) {
    const path = inventoryStatePath(home);
    const parent = join(path, '..');
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    chmodSync(parent, 0o700);
    const pending = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(pending, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(pending, path);
    chmodSync(path, 0o600);
}

export function prepareInventoryDelta({ home = process.env.HOME, inventory }) {
    const settings = loadCommonsSettings(home);
    if (!settings?.autoPublishInventory) {
        return { enabled: false, hash: inventory.hash, upserts: [], removals: [] };
    }
    const previous = loadInventoryState(home);
    const current = itemMap(inventory);
    const upserts = [];
    for (const [key, item] of current) {
        if (previous.itemHashes[key] !== item.hash) upserts.push(item);
    }
    for (const key of Object.keys(previous.itemHashes).filter((value) => !current.has(value)).sort()) {
        const [type] = key.split(':', 1);
        const metadata = previous.itemMetadata[key];
        if (!metadata) throw new Error('Commons inventory state cannot preserve deletion metadata.');
        upserts.push({
            type,
            hash: digest({ type, metadata, available: false }),
            metadata: { ...metadata, content_available: false },
            available: false,
        });
    }
    return { enabled: true, hash: inventory.hash, upserts, removals: [] };
}

export function recordInventorySync({ home = process.env.HOME, inventory, receipt, syncedAt = Date.now() }) {
    if (
        !receipt || typeof receipt !== 'object' || Array.isArray(receipt)
        || Object.keys(receipt).some((key) => !['accepted', 'hash'].includes(key))
        || receipt.accepted !== true || receipt.hash !== inventory.hash
        || !Number.isSafeInteger(syncedAt)
    ) throw new Error('Commons inventory receipt is invalid.');
    const hashes = {};
    const metadata = {};
    for (const [key, item] of itemMap(inventory)) {
        hashes[key] = item.hash;
        metadata[key] = item.metadata;
    }
    writeInventoryState(home, {
        version: 1, inventoryHash: inventory.hash, itemHashes: hashes, itemMetadata: metadata, syncedAt,
    });
}
