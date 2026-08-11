import {
    closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync, mkdirSync,
    openSync, realpathSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkCommonsContent } from './commons/content-gate.js';

// One explicit command writes one fact file. Besides matching the vault's
// one-fact-per-file contract, this makes the host commit a single atomic rename:
// there is no multi-file state whose rollback can itself fail halfway through.
const MAX_OPERATIONS = 1;
const MAX_CONTENT_BYTES = 4000;
const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,79}\.md$/;
const WRITER = fileURLToPath(new URL('./retention-writer.js', import.meta.url));
const EXTRA_SENSITIVE = [
    /\b(?:date of birth|dob|social security number|ssn)\s*(?::|#|-)?\s*\S+/i,
    /\b(?:patient name|patient email|patient phone|patient address)\s*[:#]\s*\S+/i,
    /\b\d{3}-\d{2}-\d{4}\b/,
    /\b(?:mrn|medical record number|patient id)\s*[:#]\s*[A-Za-z0-9-]+/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?:^|\D)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?:\D|$)/,
    /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct)\b/i,
    /\b(?:patient|diagnosis|specimen|treatment|symptom|clinical)\b.{0,100}\b(?:[A-Z][a-z]+|[A-Z]{2,})(?:\s+(?:[A-Z][a-z]+|[A-Z]{2,}))+\b/s,
    /\bpatient(?:\s+(?:named|name))?\s+[\p{L}\p{M}'’.-]{2,}(?:\s+[\p{L}\p{M}'’.-]{2,}){1,3}\b/iu,
    /\b(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b/,
];
const SECRET_OR_CREDENTIAL = [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\b(?:aws[_-]?secret[_-]?access[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd)\s*[:=]\s*\S+/i,
    /\b(?:aws[\s_-]*secret[\s_-]*access[\s_-]*key|api[\s_-]*key|access[\s_-]*token|refresh[\s_-]*token|client[\s_-]*secret|password|passwd)\s*(?::|=|\bis\b|\bwas\b)\s*["']?\S{8,}/i,
    /\b(?:aws[\s_-]*secret[\s_-]*access[\s_-]*key|api[\s_-]*key|access[\s_-]*token|refresh[\s_-]*token|client[\s_-]*secret|password|passwd)\s+(?:is|was)\b/i,
    /\bauthorization\s*:\s*(?:bearer|basic)\s+\S+/i,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
    /\b(?:https?|ssh):\/\/[^\s/@:]+:[^\s/@]+@/i,
    /\b(?:bearer|basic)\s+(?:credential|token)(?:\s+value)?\s*(?:is|[:=])\s*\S+/i,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    /\bsk-[A-Za-z0-9_-]{32,}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
    /\bAIza[A-Za-z0-9_-]{30,}\b/,
    /\b[A-Za-z0-9+/]{48,}={0,2}\b/,
];
const INJECTED_DIRECTIVE = [
    /\b(?:ignore|disregard|forget|override|bypass|evade)\b.{0,80}\b(?:instruction|direction|rule|policy|prompt|system|developer|message)s?\b/is,
    /\b(?:new|updated|replacement)\s+(?:system|developer)\s+(?:prompt|message|instruction)s?\b/i,
    /(?:^|\n)\s*(?:system|developer|assistant)\s*:\s*/i,
    /<\/?(?:system|developer|assistant)(?:\s|>)/i,
    /\[(?:system|developer|assistant)(?:\s+message)?\]/i,
    /\byou are now\b/i,
    /\b(?:treat|consider|regard)\b.{0,60}\b(?:earlier|previous|prior|existing)\b.{0,60}\b(?:guidance|instruction|direction|rule|policy|prompt)s?\b.{0,40}\b(?:irrelevant|obsolete|superseded|invalid|inapplicable)\b/is,
    /\b(?:earlier|previous|prior|existing)\b.{0,60}\b(?:guidance|instruction|direction|rule|policy|prompt)s?\b.{0,40}\b(?:no longer|does not|do not)\b.{0,20}\b(?:apply|matter|control)\b/is,
    /\b(?:instruction|directive|policy|rule|guidance)\b.{0,40}\b(?:is|are|becomes?)\s+(?:void|invalid|obsolete|irrelevant|superseded)\b/is,
    /\b(?:follow|obey|execute|apply)\b.{0,40}\b(?:this\s+)?(?:instruction|directive|policy|rule|guidance)\b/is,
    /\b(?:this|the)\s+(?:text|content|file|statement)\b.{0,40}\b(?:authority|priority|precedence|control)\b/is,
    /\bsystem\b.{0,40}\b(?:follow|obey|execute|reveal|disclose|command)\b/is,
    /\b(?:policy|rule|instruction|guidance)\b.{0,40}\b(?:zero|no)\s+(?:force|effect|authority|weight)\b/is,
    /\bcarry\s+out\b.{0,40}\b(?:command|instruction|directive|request)\b/is,
    /\b(?:prior|earlier|previous|existing)\s+(?:safety\s+)?(?:safeguard|guardrail|restriction|constraint|rule|policy|instruction)s?\b.{0,50}\b(?:retired|obsolete|superseded|invalid|void|inactive|revoked)\b/is,
    /\b(?:this|the)\s+(?:document|page|record|note)\b.{0,50}\b(?:takes?\s+precedence|controls?|overrides?|is\s+authoritative)\b/is,
    /\bjavascript\s*:/i,
    /\[[^\]]*\]\(\s*(?:data|javascript)\s*:/i,
    /\[[^\]]*\]\([^)]*&#(?:x[0-9a-f]+|\d+);[^)]*:/i,
    /\[[^\]]*\]\([^)]*&(?:#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/i,
    /<[^>]{0,200}\bon\s*[a-z]+\s*=/i,
];
const CLINICAL_CONTEXT = /\b(?:patient|diagnos(?:is|ed)|specimen|treatment|symptom|clinical|medical|medication|prescription|disease|condition|test result|lab result|positive|negative|born|diabetes|insulin|hiv)\b/i;
const PERSON_WORD = String.raw`\p{Lu}[\p{L}\p{M}'’.-]{1,}`;
const PERSON_LIKE_NAME = new RegExp(
    String.raw`(?:^|[^\p{L}])${PERSON_WORD}(?:\s+${PERSON_WORD})(?=$|[^\p{L}])`,
    'u'
);
const COMPOUND_PERSON_LIKE = /(?:^|[^\p{L}])\p{Lu}[\p{L}\p{M}]{1,}[-'’]\p{Lu}[\p{L}\p{M}]{1,}(?:['’]s)?(?=$|[^\p{L}])/u;
const LOWER_COMPOUND_PERSON_LIKE = /(?:^|[^\p{L}])\p{Ll}[\p{L}\p{M}]{1,}[-'’]\p{Ll}[\p{L}\p{M}]{1,}(?:['’]s)?(?=$|[^\p{L}])/u;
const LOWER_PERSON_WORD = String.raw`\p{Ll}[\p{L}\p{M}'’.-]{1,}`;
const LOWER_PERSON_CLINICAL = new RegExp(
    String.raw`\b${LOWER_PERSON_WORD}\s+${LOWER_PERSON_WORD}(?:\s+${LOWER_PERSON_WORD})?\s+(?:has|had|was\s+born|received|takes?|uses?|tested|is\s+diagnosed|was\s+diagnosed)\b`,
    'u'
);
const LOWER_PERSON_AFTER_RELATION = new RegExp(
    String.raw`(?:\b(?:in|to|for|of|affects|belongs\s+to)|:)\s+${LOWER_PERSON_WORD}\s+${LOWER_PERSON_WORD}(?:\s+${LOWER_PERSON_WORD})?(?=$|[^\p{L}])`,
    'u'
);

function laneFor(vaultPath, source) {
    if (source === 'learn') return join(vaultPath, 'memory', 'shared');
    if (source === 'wiki') return join(vaultPath, 'wiki');
    return null;
}

function parseJsonObject(text) {
    if (typeof text !== 'string') return null;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
}

function validateContent(content) {
    if (typeof content !== 'string' || !content.trim()) {
        throw new Error('Retention candidate content is empty.');
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES || content.includes('\uFFFD')) {
        throw new Error('Retention candidate content is not safe bounded UTF-8 text.');
    }
    if (/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u.test(content)) {
        throw new Error('Retention candidate content contains hidden control text.');
    }
    const gate = checkCommonsContent(content);
    if (!gate.allowed) throw new Error(`Retention safety scan rejected content (${gate.reason_code}).`);
    if (EXTRA_SENSITIVE.some((pattern) => pattern.test(content))) {
        throw new Error('Retention safety scan rejected content (possible_phi).');
    }
    // Order-independent: "Name ... diagnosis" is as unsafe as
    // "patient Name ...". Explicit shared retention fails closed on
    // person-linked clinical prose even without an explicit patient label.
    if (CLINICAL_CONTEXT.test(content)
        && (PERSON_LIKE_NAME.test(content) || COMPOUND_PERSON_LIKE.test(content)
            || LOWER_COMPOUND_PERSON_LIKE.test(content) || LOWER_PERSON_CLINICAL.test(content)
            || LOWER_PERSON_AFTER_RELATION.test(content))) {
        throw new Error('Retention safety scan rejected content (possible_phi).');
    }
    if (SECRET_OR_CREDENTIAL.some((pattern) => pattern.test(content))) {
        throw new Error('Retention safety scan rejected content (possible_secret).');
    }
    if (INJECTED_DIRECTIVE.some((pattern) => pattern.test(content))) {
        throw new Error('Retention safety scan rejected content (prompt_injection).');
    }
    return content.endsWith('\n') ? content : `${content}\n`;
}

export function parseRetentionResult(text) {
    const parsed = parseJsonObject(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Retention turn did not return a JSON object.');
    }
    if (Object.keys(parsed).some((key) => key !== 'operations')) {
        throw new Error('Retention result contains unknown fields.');
    }
    if (!Array.isArray(parsed.operations) || parsed.operations.length > MAX_OPERATIONS) {
        throw new Error('Retention operations are invalid or exceed the limit.');
    }
    const seen = new Set();
    return parsed.operations.map((operation) => {
        if (!operation || typeof operation !== 'object' || Array.isArray(operation)
            || Object.keys(operation).some((key) => !['path', 'content'].includes(key))) {
            throw new Error('Retention operation is invalid.');
        }
        if (typeof operation.path !== 'string' || !SAFE_NAME.test(operation.path)
            || basename(operation.path) !== operation.path || operation.path.toLowerCase() === 'readme.md') {
            throw new Error('Retention path is outside the approved fact-file shape.');
        }
        if (seen.has(operation.path)) throw new Error('Retention result contains duplicate paths.');
        seen.add(operation.path);
        return { path: operation.path, content: validateContent(operation.content) };
    });
}

function assertLaneIdentity(lane) {
    const current = lstatSync(lane.path);
    if (current.isSymbolicLink() || !current.isDirectory()
        || current.dev !== lane.stat.dev || current.ino !== lane.stat.ino) {
        throw new Error('Retention vault lane changed during capture.');
    }
}

function secureLane(vaultPath, source) {
    const lane = laneFor(vaultPath, source);
    if (!lane || !vaultPath || !existsSync(vaultPath)) throw new Error('Retention vault lane is unavailable.');
    const segments = relative(resolve(vaultPath), resolve(lane)).split(sep).filter(Boolean);
    let cursor = resolve(vaultPath);
    const rootStat = lstatSync(cursor);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
        throw new Error('Retention vault lane is symlinked or escaped.');
    }
    const rootPath = realpathSync(cursor);
    cursor = rootPath;
    const assertRootIdentity = () => {
        const current = lstatSync(rootPath);
        if (current.isSymbolicLink() || !current.isDirectory()
            || current.dev !== rootStat.dev || current.ino !== rootStat.ino
            || realpathSync(rootPath) !== rootPath) {
            throw new Error('Retention vault root changed during capture.');
        }
    };
    for (const segment of segments) {
        assertRootIdentity();
        cursor = join(cursor, segment);
        if (!existsSync(cursor)) mkdirSync(cursor, { mode: 0o700 });
        const stat = lstatSync(cursor);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw new Error('Retention vault lane is symlinked or escaped.');
        }
    }
    assertRootIdentity();
    const realVault = realpathSync(vaultPath);
    const realLane = realpathSync(lane);
    const within = relative(realVault, realLane);
    if (!within || within.startsWith('..') || within.startsWith(sep)) {
        throw new Error('Retention vault lane is symlinked or escaped.');
    }
    const fd = openSync(
        realLane,
        fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0)
    );
    const stat = fstatSync(fd);
    if (!stat.isDirectory()) {
        closeSync(fd);
        throw new Error('Retention vault lane is not a directory.');
    }
    const handle = { path: realLane, fd, stat };
    assertRootIdentity();
    assertLaneIdentity(handle);
    return handle;
}

export function applyRetentionResult({ vaultPath, source, text }) {
    const operations = parseRetentionResult(text);
    if (operations.length === 0) return [];
    const lane = secureLane(vaultPath, source);
    try {
        const operation = operations[0];
        const target = join(lane.path, operation.path);
        assertLaneIdentity(lane);
        // Descriptor 3 and cwd must resolve to the same already-verified lane;
        // the helper also checks the approved pathname around every mutation.
        const result = spawnSync(process.execPath, [WRITER, lane.path], {
            cwd: lane.path,
            input: JSON.stringify({
                dev: lane.stat.dev,
                ino: lane.stat.ino,
                canonical: lane.path,
                path: operation.path,
                content: operation.content,
            }),
            encoding: 'utf8',
            timeout: 5000,
            maxBuffer: 8192,
            env: {},
            stdio: ['pipe', 'pipe', 'pipe', lane.fd],
        });
        if (result.status !== 0 || result.error) {
            if (result.stderr?.trim() === 'unsafe_target') {
                throw new Error('Retention target is not a regular single-link file.');
            }
            throw new Error('Retention writer rejected the atomic replacement.');
        }
        assertLaneIdentity(lane);
        return [target];
    } finally {
        closeSync(lane.fd);
    }
}
