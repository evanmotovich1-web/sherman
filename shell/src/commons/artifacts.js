import {
    createHash, createPublicKey, randomUUID, sign, verify,
} from 'node:crypto';
import {
    chmodSync, closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync, mkdirSync,
    openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkCommonsContent } from './content-gate.js';
import { commonsRoot } from './local-state.js';
import { parseFrontMatter } from '../registry.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCHEMA = 'SHERMAN-COMMONS-SKILL-V1';
const MAX_FILES = 100;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.md', '.json', '.txt']);
const TRUSTED_SCAN_VERSION = '1';
const MAX_TRUSTED_SCAN_AGE_MS = 24 * 60 * 60 * 1000;
const CREDENTIAL_FILE = /^(?:\.env(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|.*\.(?:pem|key|p12|pfx))$/i;
const EXECUTABLE_FILE = /\.(?:sh|bash|zsh|fish|py|pyw|js|mjs|cjs|ts|tsx|jsx|exe|dll|dylib|so|bat|cmd|ps1|com|app|jar|wasm)$/i;

export function artifactInstallConfirmation(id, digest, reviewDigest) {
    if (typeof id !== 'string' || !id
        || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)
        || typeof reviewDigest !== 'string' || !/^[a-f0-9]{64}$/.test(reviewDigest)) {
        throw new Error('Artifact installation confirmation could not be constructed.');
    }
    return `INSTALL ${id} ${digest} REVIEW ${reviewDigest}`;
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function validName(value) {
    return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

function validVersion(value) {
    return typeof value === 'string' && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function normalizeCompatibility(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Artifact compatibility is invalid.');
    if (Object.keys(value).some((key) => !['node', 'sherman'].includes(key))) throw new Error('Artifact compatibility has unknown fields.');
    const normalized = {};
    for (const key of ['node', 'sherman']) {
        if (value[key] === undefined) continue;
        if (typeof value[key] !== 'string' || !value[key] || value[key].length > 80 || /[\r\n]/.test(value[key])) {
            throw new Error('Artifact compatibility is invalid.');
        }
        normalized[key] = value[key];
    }
    if (!Object.keys(normalized).length) throw new Error('Artifact compatibility is required.');
    return normalized;
}

function extension(path) {
    const index = path.lastIndexOf('.');
    return index < 0 ? '' : path.slice(index).toLowerCase();
}

function safeRelativePath(value, { file = true } = {}) {
    if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 240) throw new Error('Artifact path is invalid.');
    if (value.includes('\0') || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
        throw new Error('Artifact path is invalid.');
    }
    const parts = value.split('/');
    const filename = parts.at(-1);
    if (file && CREDENTIAL_FILE.test(filename)) throw new Error('Artifact credential files are forbidden.');
    if (parts.length > 8 || parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) {
        throw new Error('Artifact path traversal or hidden path is forbidden.');
    }
    if (file && (EXECUTABLE_FILE.test(filename) || !ALLOWED_EXTENSIONS.has(extension(filename)))) {
        throw new Error('Artifact executable or unsupported file type is forbidden.');
    }
    return parts.join('/');
}

function scanBytes(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length > MAX_FILE_BYTES) throw new Error('Artifact file size is unsafe.');
    const text = bytes.toString('utf8');
    if (text.includes('\uFFFD') || !Buffer.from(text, 'utf8').equals(bytes)) throw new Error('Artifact file is not supported UTF-8 text.');
    const safety = checkCommonsContent(text);
    if (!safety.allowed) throw new Error(`Artifact safety scan rejected content (${safety.reason_code}).`);
    if (/\b(?:date of birth|dob|social security number|ssn)\s*[:#]\s*\S+/i.test(text)) {
        throw new Error('Artifact safety scan rejected content (possible_phi).');
    }
    return text;
}

function sameFile(left, right) {
    return left.dev === right.dev && left.ino === right.ino;
}

function secureReadFile(path, root) {
    const rootReal = realpathSync(root);
    const before = lstatSync(path);
    if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1 || (before.mode & 0o111) !== 0) {
        throw new Error('Artifact links, executable files, and special files are forbidden.');
    }
    const resolved = realpathSync(path);
    if (resolved !== rootReal && !resolved.startsWith(`${rootReal}${sep}`)) {
        throw new Error('Artifact path escaped its approved root.');
    }
    let fd;
    try {
        fd = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.nlink !== 1 || !sameFile(before, opened)) {
            throw new Error('Artifact file changed during validation.');
        }
        const bytes = readFileSync(fd);
        const afterRead = fstatSync(fd);
        const afterPath = lstatSync(path);
        if (!sameFile(opened, afterRead) || !sameFile(opened, afterPath) || afterPath.isSymbolicLink()) {
            throw new Error('Artifact file changed during validation.');
        }
        return bytes;
    } finally {
        if (fd !== undefined) closeSync(fd);
    }
}

function validateSkillFrontMatter(text, name) {
    const fields = parseFrontMatter(text);
    if (!fields || fields.name !== name || !fields.category || !fields.description) {
        throw new Error('Artifact SKILL.md metadata is invalid.');
    }
}

function walkSkill(directory, name) {
    const rootMetadata = lstatSync(directory);
    if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) throw new Error('Artifact root must be a regular directory.');
    const rootReal = realpathSync(directory);
    const collected = [];
    function walk(current, prefix = '') {
        const currentMetadata = lstatSync(current);
        const currentReal = realpathSync(current);
        if (currentMetadata.isSymbolicLink() || !currentMetadata.isDirectory()
            || (currentReal !== rootReal && !currentReal.startsWith(`${rootReal}${sep}`))) {
            throw new Error('Artifact directory changed or escaped its approved root.');
        }
        const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const absolute = join(current, entry.name);
            const metadata = lstatSync(absolute);
            const relative = safeRelativePath(prefix ? `${prefix}/${entry.name}` : entry.name, {
                file: metadata.isFile() || metadata.isSymbolicLink(),
            });
            if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())) {
                throw new Error('Artifact links and special files are forbidden; only regular files are supported.');
            }
            if (metadata.isDirectory()) {
                walk(absolute, relative);
                continue;
            }
            if (metadata.nlink !== 1) throw new Error('Artifact hard links are forbidden.');
            if ((metadata.mode & 0o111) !== 0) throw new Error('Artifact executable files are forbidden.');
            const bytes = secureReadFile(absolute, directory);
            const text = scanBytes(bytes);
            collected.push({ path: relative, bytes, text });
            if (collected.length > MAX_FILES) throw new Error('Artifact has too many files.');
        }
    }
    walk(directory);
    if (!collected.some((file) => file.path === 'SKILL.md')) throw new Error('Artifact must contain SKILL.md.');
    validateSkillFrontMatter(collected.find((file) => file.path === 'SKILL.md').text, name);
    if (collected.reduce((total, file) => total + file.bytes.length, 0) > MAX_TOTAL_BYTES) {
        throw new Error('Artifact expanded size exceeds the safety limit.');
    }
    return collected.sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeManifest(value) {
    if (!Array.isArray(value) || !value.length || value.length > MAX_FILES) throw new Error('Artifact manifest is invalid.');
    const seen = new Set();
    let total = 0;
    const manifest = value.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)
            || Object.keys(entry).some((key) => !['path', 'size', 'sha256'].includes(key))) {
            throw new Error('Artifact manifest has unknown fields.');
        }
        const path = safeRelativePath(entry.path);
        if (seen.has(path)) throw new Error('Artifact manifest has duplicate paths.');
        seen.add(path);
        if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE_BYTES) throw new Error('Artifact manifest size is invalid.');
        if (!/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Artifact manifest checksum is invalid.');
        total += entry.size;
        return { path, size: entry.size, sha256: entry.sha256 };
    }).sort((a, b) => a.path.localeCompare(b.path));
    if (total > MAX_TOTAL_BYTES) throw new Error('Artifact expanded size exceeds the safety limit.');
    return manifest;
}

function envelopeForDigest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Artifact envelope is invalid.');
    if (value.schema !== SCHEMA || !validName(value.name) || !validVersion(value.version)) throw new Error('Artifact envelope is invalid.');
    const networkId = value.network_id ?? null;
    const publisherKeyId = value.publisher_key_id ?? null;
    for (const id of [networkId, publisherKeyId]) {
        if (id !== null && (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))) {
            throw new Error('Artifact attribution is invalid.');
        }
    }
    return {
        schema: SCHEMA,
        network_id: networkId,
        publisher_key_id: publisherKeyId,
        name: value.name,
        version: value.version,
        compatibility: normalizeCompatibility(value.compatibility),
        manifest: normalizeManifest(value.manifest),
    };
}

export function computeArtifactDigest(value) {
    return sha256(JSON.stringify(envelopeForDigest(value)));
}

export function artifactSignaturePayload(digest) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Artifact digest is invalid.');
    return `SHERMAN-COMMONS-ARTIFACT-V1\n${digest}`;
}

export function artifactStatePath(home = process.env.HOME) {
    return join(commonsRoot(home), 'artifact-state.json');
}

function validateStateRecord(record, type) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
    const common = ['id', 'status', 'createdAt', 'name', 'version', 'compatibility', 'manifest', 'digest'];
    const publicationFields = [
        'networkId', 'publisherKeyId', 'publishedDigest', 'serverId', 'scanStatus', 'publishedAt',
    ];
    const allowed = type === 'publication'
        ? [...common, ...publicationFields]
        : [...common, 'networkId', 'publisherKeyId', 'verification', 'diff', 'reviewDigest', 'reviewedAt', 'installedAt', 'receiptId'];
    if (Object.keys(record).some((key) => !allowed.includes(key))) return false;
    if (typeof record.id !== 'string' || !validName(record.name) || !validVersion(record.version)) return false;
    if (!Number.isSafeInteger(record.createdAt) || !/^[a-f0-9]{64}$/.test(record.digest)) return false;
    try {
        normalizeCompatibility(record.compatibility);
        normalizeManifest(record.manifest);
    } catch { return false; }
    if (type === 'publication') {
        if (record.status === 'pending') return publicationFields.every((key) => !Object.hasOwn(record, key));
        return record.status === 'published'
            && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(record.networkId)
            && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(record.publisherKeyId)
            && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(record.serverId)
            && /^[a-f0-9]{64}$/.test(record.publishedDigest)
            && record.scanStatus === 'pending'
            && Number.isSafeInteger(record.publishedAt);
    }
    if (!['quarantined', 'installed'].includes(record.status)) return false;
    if (!Array.isArray(record.diff) || record.diff.some((item) => (
        !item || Object.keys(item).some((key) => !['path', 'change'].includes(key))
        || !['add', 'modify', 'remove'].includes(item.change)
    ))) return false;
    if (!record.verification || Object.keys(record.verification).some((key) => !['checksum', 'digest', 'signature', 'scan'].includes(key))) return false;
    const hasReview = Object.hasOwn(record, 'reviewDigest') || Object.hasOwn(record, 'reviewedAt');
    if (hasReview && (!/^[a-f0-9]{64}$/.test(record.reviewDigest) || !Number.isSafeInteger(record.reviewedAt))) return false;
    if (record.status === 'installed' && (!Number.isSafeInteger(record.installedAt) || typeof record.receiptId !== 'string')) return false;
    return true;
}

export function loadArtifactState(home = process.env.HOME) {
    const path = artifactStatePath(home);
    try {
        if ((statSync(path).mode & 0o077) !== 0) throw new Error('Commons artifact state has unsafe permissions.');
    } catch (error) {
        if (error?.code === 'ENOENT') return { version: 1, publications: [], adoptions: [] };
        throw error;
    }
    let value;
    try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('Commons artifact state is invalid.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some((key) => !['version', 'publications', 'adoptions'].includes(key))
        || value.version !== 1 || !Array.isArray(value.publications) || value.publications.length > 100
        || !Array.isArray(value.adoptions) || value.adoptions.length > 100
        || !value.publications.every((record) => validateStateRecord(record, 'publication'))
        || !value.adoptions.every((record) => validateStateRecord(record, 'adoption'))) {
        throw new Error('Commons artifact state is invalid.');
    }
    return structuredClone(value);
}

function saveArtifactState(home, state) {
    const path = artifactStatePath(home);
    const parent = join(path, '..');
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    chmodSync(parent, 0o700);
    const pending = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(pending, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(pending, path);
}

function personalSkillsRoot(home) {
    return join(home, '.sherman', 'skills');
}

function assertPersonalSkillsRoot(home) {
    for (const path of [join(home, '.sherman'), personalSkillsRoot(home)]) {
        if (!existsSync(path)) continue;
        const metadata = lstatSync(path);
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
            throw new Error('The approved personal skill root cannot be a symbolic link or non-directory.');
        }
    }
}

export function prepareSkillPublication({
    home = process.env.HOME, name, version, compatibility, now = Date.now(),
}) {
    if (!validName(name) || !validVersion(version) || !Number.isSafeInteger(now)) throw new Error('Artifact publication input is invalid.');
    assertPersonalSkillsRoot(home);
    const skillRoot = join(personalSkillsRoot(home), name);
    const rootMetadata = lstatSync(skillRoot);
    if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) throw new Error('Artifact source must be a regular personal skill directory.');
    const files = walkSkill(skillRoot, name);
    const manifest = files.map((file) => ({ path: file.path, size: file.bytes.length, sha256: sha256(file.bytes) }));
    const envelope = { schema: SCHEMA, name, version, compatibility: normalizeCompatibility(compatibility), manifest };
    const digest = computeArtifactDigest(envelope);
    const state = loadArtifactState(home);
    const existing = state.publications.find((record) => record.digest === digest);
    if (existing) return existing;
    const publication = {
        id: randomUUID(), status: 'pending', createdAt: now, name, version,
        compatibility: envelope.compatibility, manifest, digest,
    };
    state.publications = [...state.publications.slice(-98), publication];
    saveArtifactState(home, state);
    return structuredClone(publication);
}

export function buildSkillPublicationBundle({
    home = process.env.HOME, id, networkId, publisherKeyId, privateKey,
}) {
    for (const value of [networkId, publisherKeyId]) {
        if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
            throw new Error('Artifact publisher attribution is invalid.');
        }
    }
    const publication = loadArtifactState(home).publications.find((record) => record.id === id);
    if (!publication || publication.status !== 'pending') throw new Error('Pending artifact publication was not found.');
    assertPersonalSkillsRoot(home);
    const source = join(personalSkillsRoot(home), publication.name);
    const files = walkSkill(source, publication.name);
    const manifest = files.map((file) => ({
        path: file.path, size: file.bytes.length, sha256: sha256(file.bytes),
    }));
    const candidate = {
        schema: SCHEMA,
        name: publication.name,
        version: publication.version,
        compatibility: publication.compatibility,
        manifest,
    };
    if (computeArtifactDigest(candidate) !== publication.digest
        || JSON.stringify(manifest) !== JSON.stringify(publication.manifest)) {
        throw new Error('Artifact source changed after local preparation; prepare it again.');
    }
    const envelope = {
        schema: SCHEMA,
        network_id: networkId,
        publisher_key_id: publisherKeyId,
        name: publication.name,
        version: publication.version,
        compatibility: publication.compatibility,
        manifest,
    };
    const digest = computeArtifactDigest(envelope);
    let signature;
    try {
        signature = sign(null, Buffer.from(artifactSignaturePayload(digest)), privateKey).toString('base64');
    } catch {
        throw new Error('Artifact publisher signing key is invalid.');
    }
    return {
        ...envelope,
        digest,
        signature,
        files: files.map((file) => ({ path: file.path, content_base64: file.bytes.toString('base64') })),
    };
}

export function recordSkillPublication({
    home = process.env.HOME, id, bundle, receipt, publishedAt = Date.now(),
}) {
    if (!Number.isSafeInteger(publishedAt) || !receipt || typeof receipt !== 'object' || Array.isArray(receipt)
        || Object.keys(receipt).some((key) => !['id', 'scan_status', 'replayed'].includes(key))
        || typeof receipt.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(receipt.id)
        || receipt.scan_status !== 'pending' || typeof receipt.replayed !== 'boolean') {
        throw new Error('Artifact publication receipt is invalid.');
    }
    const state = loadArtifactState(home);
    const publication = state.publications.find((record) => record.id === id);
    if (!publication || publication.status !== 'pending' || !bundle || typeof bundle !== 'object'
        || bundle.name !== publication.name || bundle.version !== publication.version
        || JSON.stringify(bundle.compatibility) !== JSON.stringify(publication.compatibility)
        || JSON.stringify(bundle.manifest) !== JSON.stringify(publication.manifest)
        || computeArtifactDigest(bundle) !== bundle.digest
        || typeof bundle.network_id !== 'string' || typeof bundle.publisher_key_id !== 'string') {
        throw new Error('Artifact publication receipt does not match the pending bundle.');
    }
    Object.assign(publication, {
        status: 'published',
        networkId: bundle.network_id,
        publisherKeyId: bundle.publisher_key_id,
        publishedDigest: bundle.digest,
        serverId: receipt.id,
        scanStatus: receipt.scan_status,
        publishedAt,
    });
    saveArtifactState(home, state);
    return structuredClone(publication);
}

function decodeBundle(bundle) {
    const allowed = [
        'schema', 'network_id', 'publisher_key_id', 'name', 'version',
        'compatibility', 'manifest', 'digest', 'signature', 'files',
    ];
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)
        || Object.keys(bundle).some((key) => !allowed.includes(key))) throw new Error('Artifact bundle has unknown fields.');
    const envelope = envelopeForDigest(bundle);
    if (!envelope.network_id || !envelope.publisher_key_id) throw new Error('Artifact publisher attribution is required.');
    if (!/^[a-f0-9]{64}$/.test(bundle.digest) || bundle.digest !== computeArtifactDigest(envelope)) {
        throw new Error('Artifact digest verification failed.');
    }
    if (!Array.isArray(bundle.files) || bundle.files.length !== envelope.manifest.length) throw new Error('Artifact files do not match the manifest.');
    const byPath = new Map();
    for (const entry of bundle.files) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)
            || Object.keys(entry).some((key) => !['path', 'content_base64'].includes(key))) {
            throw new Error('Artifact file envelope has unknown fields.');
        }
        const path = safeRelativePath(entry.path);
        if (byPath.has(path) || typeof entry.content_base64 !== 'string'
            || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.content_base64)) {
            throw new Error('Artifact file encoding is invalid.');
        }
        const bytes = Buffer.from(entry.content_base64, 'base64');
        if (bytes.toString('base64') !== entry.content_base64) throw new Error('Artifact file encoding is invalid.');
        byPath.set(path, bytes);
    }
    const decoded = [];
    for (const item of envelope.manifest) {
        const bytes = byPath.get(item.path);
        if (!bytes || bytes.length !== item.size || sha256(bytes) !== item.sha256) throw new Error('Artifact checksum verification failed.');
        decoded.push({ ...item, bytes, text: scanBytes(bytes) });
    }
    validateSkillFrontMatter(decoded.find((file) => file.path === 'SKILL.md')?.text, envelope.name);
    return { envelope, decoded };
}

function manifestDiff(home, name, incoming) {
    assertPersonalSkillsRoot(home);
    const target = join(personalSkillsRoot(home), name);
    let current = [];
    if (existsSync(target)) current = walkSkill(target, name).map((file) => ({ path: file.path, sha256: sha256(file.bytes) }));
    const before = new Map(current.map((file) => [file.path, file.sha256]));
    const after = new Map(incoming.map((file) => [file.path, file.sha256]));
    const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
    return paths.flatMap((path) => {
        if (!before.has(path)) return [{ path, change: 'add' }];
        if (!after.has(path)) return [{ path, change: 'remove' }];
        if (before.get(path) !== after.get(path)) return [{ path, change: 'modify' }];
        return [];
    });
}

const MAX_ARTIFACT_REVIEW_CHARS = 8_000;

function safelyQuotedReviewText(bytes) {
    return JSON.stringify(bytes.toString('utf8')).replace(
        /[^\x20-\x7e]/g,
        (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
}

function artifactReviewSnapshot({ home, id }) {
    const state = loadArtifactState(home);
    const adoption = state.adoptions.find((record) => record.id === id);
    if (!adoption || adoption.status !== 'quarantined') throw new Error('Quarantined artifact was not found.');
    const quarantine = join(commonsRoot(home), 'quarantine', adoption.id, adoption.name);
    const incoming = walkSkill(quarantine, adoption.name);
    const incomingManifest = incoming.map((file) => ({
        path: file.path, size: file.bytes.length, sha256: sha256(file.bytes),
    }));
    if (JSON.stringify(incomingManifest) !== JSON.stringify(adoption.manifest)) {
        throw new Error('Quarantined artifact changed after verification.');
    }
    const currentDiff = manifestDiff(home, adoption.name, adoption.manifest);
    if (JSON.stringify(currentDiff) !== JSON.stringify(adoption.diff)) {
        throw new Error('Local skill changed after review; quarantine and review a fresh diff.');
    }
    const target = join(personalSkillsRoot(home), adoption.name);
    const current = existsSync(target) ? walkSkill(target, adoption.name) : [];
    const before = new Map(current.map((file) => [file.path, file.bytes]));
    const after = new Map(incoming.map((file) => [file.path, file.bytes]));
    const sections = adoption.diff.map(({ path, change }) => {
        const beforeBytes = before.get(path);
        const afterBytes = after.get(path);
        return [
            `${change} ${path}`,
            `before_sha256 ${beforeBytes ? sha256(beforeBytes) : '(absent)'}`,
            `after_sha256 ${afterBytes ? sha256(afterBytes) : '(absent)'}`,
            `before_json ${beforeBytes ? safelyQuotedReviewText(beforeBytes) : '(absent)'}`,
            `after_json ${afterBytes ? safelyQuotedReviewText(afterBytes) : '(absent)'}`,
        ].join('\n');
    });
    const text = sections.length ? sections.join('\n\n') : '(no file changes)';
    if (text.length > MAX_ARTIFACT_REVIEW_CHARS) {
        throw new Error('Artifact diff is too large for complete terminal review and cannot be installed.');
    }
    const reviewDigest = sha256(Buffer.from(JSON.stringify({
        artifactDigest: adoption.digest,
        files: adoption.diff.map(({ path, change }) => ({
            path, change,
            before: before.has(path) ? sha256(before.get(path)) : null,
            after: after.has(path) ? sha256(after.get(path)) : null,
        })),
    })));
    return { state, adoption, text, reviewDigest };
}

export function reviewQuarantinedArtifact({ home = process.env.HOME, id, now = Date.now() }) {
    const snapshot = artifactReviewSnapshot({ home, id });
    snapshot.adoption.reviewDigest = snapshot.reviewDigest;
    snapshot.adoption.reviewedAt = now;
    saveArtifactState(home, snapshot.state);
    return { adoption: structuredClone(snapshot.adoption), text: snapshot.text };
}

function trustedPublisherFor({ envelope, bundle, resolveTrustedPublisher, trustedScanVersion, now }) {
    if (typeof resolveTrustedPublisher !== 'function') throw new Error('Artifact verification requires a trusted publisher resolver.');
    const record = resolveTrustedPublisher(envelope.network_id, envelope.publisher_key_id);
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Trusted publisher record was not found.');
    const allowed = ['network_id', 'publisher_key_id', 'public_key', 'status', 'revoked_at', 'scan'];
    if (Object.keys(record).some((key) => !allowed.includes(key))
        || record.network_id !== envelope.network_id || record.publisher_key_id !== envelope.publisher_key_id
        || typeof record.public_key !== 'string' || record.status !== 'active' || record.revoked_at !== null) {
        throw new Error('Trusted publisher record is inactive, revoked, or incorrectly bound.');
    }
    const scan = record.scan;
    if (!scan || typeof scan !== 'object' || Array.isArray(scan)
        || Object.keys(scan).some((key) => !['status', 'scanner_version', 'artifact_digest', 'artifact_version', 'scanned_at'].includes(key))
        || scan.status !== 'passed' || scan.scanner_version !== trustedScanVersion
        || scan.artifact_digest !== bundle.digest || scan.artifact_version !== envelope.version
        || !Number.isSafeInteger(scan.scanned_at) || scan.scanned_at > now
        || now - scan.scanned_at > MAX_TRUSTED_SCAN_AGE_MS) {
        throw new Error('Trusted publisher scan state is missing, stale, or not bound to this artifact.');
    }
    return record;
}

export function quarantineSkillBundle({
    home = process.env.HOME, bundle, resolveTrustedPublisher, trustedScanVersion = TRUSTED_SCAN_VERSION,
    now = Date.now(), bundledRoot = REPO_ROOT,
}) {
    if (!Number.isSafeInteger(now) || typeof trustedScanVersion !== 'string'
        || !trustedScanVersion || trustedScanVersion.length > 128 || /[\r\n]/.test(trustedScanVersion)) {
        throw new Error('Artifact quarantine trust configuration is invalid.');
    }
    const { envelope, decoded } = decodeBundle(bundle);
    if (typeof bundle.signature !== 'string') throw new Error('Artifact signature is required.');
    const publisher = trustedPublisherFor({
        envelope, bundle, resolveTrustedPublisher, trustedScanVersion, now,
    });
    let valid = false;
    try {
        valid = verify(
            null,
            Buffer.from(artifactSignaturePayload(bundle.digest)),
            createPublicKey(publisher.public_key),
            Buffer.from(bundle.signature, 'base64'),
        );
    } catch {}
    if (!valid) throw new Error('Artifact signature verification failed.');
    const signatureStatus = 'verified';
    const diff = manifestDiff(home, envelope.name, envelope.manifest);
    const id = randomUUID();
    const quarantineRoot = join(commonsRoot(home), 'quarantine');
    const quarantineParent = join(quarantineRoot, id);
    const quarantineSkill = join(quarantineParent, envelope.name);
    mkdirSync(quarantineSkill, { recursive: true, mode: 0o700 });
    chmodSync(quarantineRoot, 0o700);
    chmodSync(quarantineParent, 0o700);
    chmodSync(quarantineSkill, 0o700);
    try {
        for (const file of decoded) {
            const path = join(quarantineSkill, ...file.path.split('/'));
            mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
            chmodSync(join(path, '..'), 0o700);
            writeFileSync(path, file.bytes, { mode: 0o600, flag: 'wx' });
        }
        const rescanned = walkSkill(quarantineSkill, envelope.name);
        const rescannedManifest = rescanned.map((file) => ({ path: file.path, size: file.bytes.length, sha256: sha256(file.bytes) }));
        if (JSON.stringify(rescannedManifest) !== JSON.stringify(envelope.manifest)) throw new Error('Artifact quarantine verification failed.');
    } catch (error) {
        rmSync(quarantineParent, { recursive: true, force: true });
        throw error;
    }
    const verification = { checksum: 'verified', digest: 'verified', signature: signatureStatus, scan: 'passed' };
    const adoption = {
        id, status: 'quarantined', createdAt: now, name: envelope.name, version: envelope.version,
        compatibility: envelope.compatibility, manifest: envelope.manifest, digest: bundle.digest,
        networkId: envelope.network_id, publisherKeyId: envelope.publisher_key_id,
        verification, diff,
    };
    // Bundled collisions are deliberately recorded only at install time: a
    // quarantined object may still be inspected, but can never shadow bundled.
    void bundledRoot;
    const state = loadArtifactState(home);
    state.adoptions = [...state.adoptions.slice(-98), adoption];
    saveArtifactState(home, state);
    return structuredClone(adoption);
}

function writeReceipt(home, receipt) {
    const directory = join(commonsRoot(home), 'receipts');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const path = join(directory, `${receipt.id}.json`);
    writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return path;
}

function parseCompatibilityVersion(value) {
    const match = String(value).trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-[0-9A-Za-z.-]+)?$/);
    if (!match) return null;
    return match.slice(1).map((part) => Number(part ?? 0));
}

function compareVersions(left, right) {
    for (let index = 0; index < 3; index += 1) {
        if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
    }
    return 0;
}

function satisfiesCompatibility(current, range) {
    const currentVersion = parseCompatibilityVersion(current);
    if (!currentVersion || /\|\||\s+-\s+/.test(range)) return false;
    const clauses = range.trim().split(/\s+/);
    if (!clauses.length) return false;
    return clauses.every((clause) => {
        const match = clause.match(/^(>=|<=|>|<|=)?(v?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?)$/);
        if (!match) return false;
        const wanted = parseCompatibilityVersion(match[2]);
        const comparison = compareVersions(currentVersion, wanted);
        return {
            '>': comparison > 0, '>=': comparison >= 0, '<': comparison < 0,
            '<=': comparison <= 0, '=': comparison === 0, undefined: comparison === 0,
        }[match[1]];
    });
}

function assertCompatible(compatibility) {
    const shellPackage = JSON.parse(readFileSync(join(REPO_ROOT, 'shell', 'package.json'), 'utf8'));
    if ((compatibility.node && !satisfiesCompatibility(process.versions.node, compatibility.node))
        || (compatibility.sherman && !satisfiesCompatibility(shellPackage.version, compatibility.sherman))) {
        throw new Error('Artifact compatibility requirements are not satisfied by this Node/Sherman version.');
    }
}

export function installQuarantinedArtifact({
    home = process.env.HOME, id, bundledRoot = REPO_ROOT, confirmation, now = Date.now(),
    persistence = {},
}) {
    const state = loadArtifactState(home);
    const adoption = state.adoptions.find((record) => record.id === id);
    if (!adoption || adoption.status !== 'quarantined') throw new Error('Quarantined artifact was not found.');
    const currentReview = artifactReviewSnapshot({ home, id });
    if (!adoption.reviewDigest || currentReview.reviewDigest !== adoption.reviewDigest) {
        throw new Error('Artifact content changed after review; review the exact content again.');
    }
    if (confirmation !== artifactInstallConfirmation(adoption.id, adoption.digest, adoption.reviewDigest)) {
        throw new Error(`Explicit local owner confirmation is required: ${artifactInstallConfirmation(adoption.id, adoption.digest, adoption.reviewDigest)}`);
    }
    if (adoption.verification.signature !== 'verified') throw new Error('A verified publisher signature is required before install.');
    assertCompatible(adoption.compatibility);
    if (existsSync(join(bundledRoot, 'skills', adoption.name))) throw new Error('A bundled skill with this name wins and cannot be replaced.');
    const quarantine = join(commonsRoot(home), 'quarantine', adoption.id, adoption.name);
    const files = walkSkill(quarantine, adoption.name);
    const expectedManifest = JSON.stringify(adoption.manifest);
    const toManifest = (values) => values.map((file) => ({
        path: file.path, size: file.bytes.length, sha256: sha256(file.bytes),
    }));
    if (JSON.stringify(toManifest(files)) !== expectedManifest) throw new Error('Quarantined artifact changed after verification.');
    const currentDiff = manifestDiff(home, adoption.name, adoption.manifest);
    if (JSON.stringify(currentDiff) !== JSON.stringify(adoption.diff)) throw new Error('Local skill changed after review; quarantine and review a fresh diff.');

    const root = personalSkillsRoot(home);
    assertPersonalSkillsRoot(home);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
    const stage = join(root, `.commons-stage-${randomUUID()}`);
    const target = join(root, adoption.name);
    const backup = join(root, `.commons-backup-${randomUUID()}`);
    const receipt = {
        id: randomUUID(), type: 'commons-skill-install', name: adoption.name,
        version: adoption.version, digest: adoption.digest, publisherKeyId: adoption.publisherKeyId,
        reviewDigest: adoption.reviewDigest,
        installedAt: now, verification: adoption.verification, diff: adoption.diff,
    };
    const expectedReceiptPath = join(commonsRoot(home), 'receipts', `${receipt.id}.json`);
    const persistReceipt = persistence.writeReceipt ?? writeReceipt;
    const persistState = persistence.saveArtifactState ?? saveArtifactState;
    let movedExisting = false;
    let swapped = false;
    let receiptPath;
    mkdirSync(stage, { mode: 0o700 });
    try {
        for (const file of files) {
            const destination = join(stage, ...file.path.split('/'));
            mkdirSync(join(destination, '..'), { recursive: true, mode: 0o700 });
            chmodSync(join(destination, '..'), 0o700);
            writeFileSync(destination, file.bytes, { mode: 0o600, flag: 'wx' });
        }
        if (JSON.stringify(toManifest(walkSkill(stage, adoption.name))) !== expectedManifest) {
            throw new Error('Staged artifact verification failed.');
        }
        // Revalidate the immutable bytes and path identities immediately before
        // the same-filesystem rename. The stage was written from descriptor-read
        // bytes, never by reopening/copying a mutable source path.
        if (JSON.stringify(toManifest(walkSkill(quarantine, adoption.name))) !== expectedManifest) {
            throw new Error('Quarantined artifact changed immediately before install.');
        }
        if (artifactReviewSnapshot({ home, id }).reviewDigest !== adoption.reviewDigest) {
            throw new Error('Local skill changed immediately before install; review the exact content again.');
        }
        if (existsSync(target)) {
            renameSync(target, backup);
            movedExisting = true;
        }
        renameSync(stage, target);
        swapped = true;

        receiptPath = persistReceipt(home, receipt);
        adoption.status = 'installed';
        adoption.installedAt = now;
        adoption.receiptId = receipt.id;
        persistState(home, state);
        if (movedExisting) rmSync(backup, { recursive: true, force: true });
        return { ...receipt, receiptPath };
    } catch (error) {
        if (swapped && existsSync(target)) rmSync(target, { recursive: true, force: true });
        if (movedExisting && existsSync(backup)) renameSync(backup, target);
        rmSync(receiptPath ?? expectedReceiptPath, { force: true });
        throw error;
    } finally {
        if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
    }
}
