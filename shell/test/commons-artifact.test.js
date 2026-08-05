import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import {
    chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    artifactSignaturePayload,
    artifactInstallConfirmation,
    artifactStatePath,
    buildSkillPublicationBundle,
    computeArtifactDigest,
    installQuarantinedArtifact,
    loadArtifactState,
    prepareSkillPublication,
    quarantineSkillBundle,
} from '../src/commons/artifacts.js';
import { runCommonsCommand } from '../src/commons/command.js';

const skillText = (name) => [
    '---', `name: ${name}`, 'category: operations',
    'summary: run a bounded synthetic workflow',
    'description: Use for a bounded synthetic workflow.',
    '---', '', '# Synthetic workflow', '', 'Operate on non-sensitive test data only.', '',
].join('\n');

function writeSkill(home, name = 'personal-skill') {
    const directory = join(home, '.sherman', 'skills', name);
    mkdirSync(join(directory, 'references'), { recursive: true });
    writeFileSync(join(directory, 'SKILL.md'), skillText(name));
    writeFileSync(join(directory, 'references', 'guide.md'), '# Guide\n\nBounded synthetic guidance.\n');
    return directory;
}

function signedBundle(name = 'adopted-skill') {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const files = [
        { path: 'SKILL.md', bytes: Buffer.from(skillText(name)) },
        { path: 'references/guide.md', bytes: Buffer.from('# Guide\n\nBounded synthetic guidance.\n') },
    ];
    const manifest = files.map((file) => ({
        path: file.path,
        size: file.bytes.length,
        sha256: createHash('sha256').update(file.bytes).digest('hex'),
    }));
    const envelope = {
        schema: 'SHERMAN-COMMONS-SKILL-V1',
        network_id: 'network-test',
        publisher_key_id: 'publisher-test',
        name,
        version: '1.2.3',
        compatibility: { node: '>=22' },
        manifest,
    };
    const digest = computeArtifactDigest(envelope);
    return {
        bundle: {
            ...envelope,
            digest,
            signature: sign(null, Buffer.from(artifactSignaturePayload(digest)), privateKey).toString('base64'),
            files: files.map((file) => ({ path: file.path, content_base64: file.bytes.toString('base64') })),
        },
        publisherPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    };
}

function trustedPublisher(bundle, publicKey, now = 1785900000000) {
    return {
        network_id: bundle.network_id,
        publisher_key_id: bundle.publisher_key_id,
        public_key: publicKey,
        status: 'active',
        revoked_at: null,
        scan: {
            status: 'passed', scanner_version: '1', artifact_digest: bundle.digest,
            artifact_version: bundle.version, scanned_at: now - 1000,
        },
    };
}

const resolverFor = (record) => (networkId, publisherKeyId) => (
    record.network_id === networkId && record.publisher_key_id === publisherKeyId ? record : null
);

test('skill publication manifests are deterministic, pending-only, and 0600', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-artifact-publish-'));
    try {
        writeSkill(home);
        const first = prepareSkillPublication({
            home, name: 'personal-skill', version: '1.2.3', compatibility: { node: '>=22' },
        });
        const second = prepareSkillPublication({
            home, name: 'personal-skill', version: '1.2.3', compatibility: { node: '>=22' },
        });
        assert.equal(first.digest, second.digest);
        assert.deepEqual(first.manifest, second.manifest);
        assert.equal(first.status, 'pending');
        assert.equal(Object.hasOwn(first, 'files'), false);
        assert.equal(statSync(artifactStatePath(home)).mode & 0o777, 0o600);
        assert.equal(loadArtifactState(home).publications.length, 1, 'same digest should upsert one pending publication');
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('a pending publication is re-read, attribution-bound, and signed only when published', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-artifact-bundle-'));
    try {
        writeSkill(home);
        const publication = prepareSkillPublication({
            home, name: 'personal-skill', version: '1.2.3', compatibility: { node: '>=22' },
        });
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const bundle = buildSkillPublicationBundle({
            home,
            id: publication.id,
            networkId: 'network-test',
            publisherKeyId: 'publisher-test',
            privateKey,
        });
        assert.equal(bundle.network_id, 'network-test');
        assert.equal(bundle.publisher_key_id, 'publisher-test');
        assert.equal(bundle.files.length, publication.manifest.length);
        assert.equal(computeArtifactDigest(bundle), bundle.digest);
        assert.equal(verify(
            null,
            Buffer.from(artifactSignaturePayload(bundle.digest)),
            publicKey,
            Buffer.from(bundle.signature, 'base64'),
        ), true);

        writeFileSync(join(home, '.sherman', 'skills', 'personal-skill', 'references', 'guide.md'), '# Changed\n');
        assert.throws(() => buildSkillPublicationBundle({
            home, id: publication.id, networkId: 'network-test', publisherKeyId: 'publisher-test', privateKey,
        }), /changed/i);
    } finally { rmSync(home, { recursive: true, force: true }); }
});

test('publication rejects links, hidden credentials, executables, secrets, and suspected PHI', async (t) => {
    await t.test('personal root symlink', () => {
        const home = mkdtempSync(join(tmpdir(), 'sherman-commons-artifact-root-link-'));
        const outside = mkdtempSync(join(tmpdir(), 'sherman-commons-artifact-outside-'));
        try {
            const directory = join(outside, 'personal-skill');
            mkdirSync(directory, { recursive: true });
            writeFileSync(join(directory, 'SKILL.md'), skillText('personal-skill'));
            mkdirSync(join(home, '.sherman'), { recursive: true });
            symlinkSync(outside, join(home, '.sherman', 'skills'));
            assert.throws(() => prepareSkillPublication({
                home, name: 'personal-skill', version: '1.0.0', compatibility: { node: '>=22' },
            }), /personal.*root|symbolic link/i);
        } finally {
            rmSync(home, { recursive: true, force: true });
            rmSync(outside, { recursive: true, force: true });
        }
    });

    await t.test('symlink', () => {
        const home = mkdtempSync(join(tmpdir(), 'sherman-commons-artifact-link-'));
        try {
            const directory = writeSkill(home);
            symlinkSync(join(directory, 'references', 'guide.md'), join(directory, 'linked.md'));
            assert.throws(() => prepareSkillPublication({
                home, name: 'personal-skill', version: '1.0.0', compatibility: { node: '>=22' },
            }), /link|regular file/i);
        } finally { rmSync(home, { recursive: true, force: true }); }
    });

    for (const [label, filename, content, mutate] of [
        ['credential file', '.env', 'SYNTHETIC=1', null],
        ['executable', 'run.sh', '#!/bin/sh\nexit 0\n', (path) => chmodSync(path, 0o700)],
        ['secret content', 'secret.md', 'API_KEY=synthetic-do-not-publish', null],
        ['suspected PHI', 'case.md', 'patient MRN: 12345678', null],
    ]) {
        await t.test(label, () => {
            const home = mkdtempSync(join(tmpdir(), `sherman-commons-artifact-${label.replace(' ', '-')}-`));
            try {
                const directory = writeSkill(home);
                const path = join(directory, filename);
                writeFileSync(path, content);
                mutate?.(path);
                assert.throws(() => prepareSkillPublication({
                    home, name: 'personal-skill', version: '1.0.0', compatibility: { node: '>=22' },
                }), /credential|executable|safety scan/i);
            } finally { rmSync(home, { recursive: true, force: true }); }
        });
    }
});

test('quarantine verifies paths, checksums, digest, signature, scan, and deterministic diff', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-quarantine-'));
    try {
        const { bundle, publisherPublicKey } = signedBundle();
        const resolveTrustedPublisher = resolverFor(trustedPublisher(bundle, publisherPublicKey));
        const adoption = quarantineSkillBundle({ home, bundle, resolveTrustedPublisher, now: 1785900000000 });
        assert.deepEqual(adoption.verification, {
            checksum: 'verified', digest: 'verified', signature: 'verified', scan: 'passed',
        });
        assert.deepEqual(adoption.diff, [
            { path: 'SKILL.md', change: 'add' },
            { path: 'references/guide.md', change: 'add' },
        ]);
        assert.equal(adoption.status, 'quarantined');

        const tampered = structuredClone(bundle);
        tampered.files[0].content_base64 = Buffer.from('tampered').toString('base64');
        assert.throws(() => quarantineSkillBundle({ home, bundle: tampered, resolveTrustedPublisher }), /checksum/i);

        const traversal = structuredClone(bundle);
        traversal.manifest[0].path = '../escape.md';
        traversal.files[0].path = '../escape.md';
        assert.throws(() => quarantineSkillBundle({ home, bundle: traversal, resolveTrustedPublisher }), /path/i);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('quarantine requires a current digest-bound trusted publisher record, not a caller key', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-trust-'));
    try {
        const attacker = signedBundle('trust-boundary');
        assert.throws(() => quarantineSkillBundle({
            home, bundle: attacker.bundle, publisherPublicKey: attacker.publisherPublicKey,
            now: 1785900000000,
        }), /trusted publisher/i);

        const valid = trustedPublisher(attacker.bundle, attacker.publisherPublicKey);
        for (const mutation of [
            (record) => { record.network_id = 'other-network'; },
            (record) => { record.publisher_key_id = 'other-publisher'; },
            (record) => { record.status = 'disabled'; },
            (record) => { record.revoked_at = 1785899999000; },
            (record) => { record.scan.status = 'pending'; },
            (record) => { record.scan.scanner_version = '0'; },
            (record) => { record.scan.artifact_digest = '0'.repeat(64); },
            (record) => { record.scan.artifact_version = '9.9.9'; },
            (record) => { record.scan.scanned_at = 1785800000000; },
        ]) {
            const record = structuredClone(valid);
            mutation(record);
            assert.throws(() => quarantineSkillBundle({
                home, bundle: attacker.bundle, resolveTrustedPublisher: () => record,
                now: 1785900000000,
            }), /trusted publisher|scan/i);
        }
    } finally { rmSync(home, { recursive: true, force: true }); }
});

test('install requires local owner confirmation, preserves bundled collisions, installs atomically, and records a receipt', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-install-'));
    const bundledRoot = mkdtempSync(join(tmpdir(), 'sherman-commons-bundled-'));
    try {
        const { bundle, publisherPublicKey } = signedBundle();
        const adoption = quarantineSkillBundle({
            home, bundle, resolveTrustedPublisher: resolverFor(trustedPublisher(bundle, publisherPublicKey)),
            bundledRoot, now: 1785900000000,
        });
        assert.throws(() => installQuarantinedArtifact({
            home, id: adoption.id, bundledRoot, confirmation: true,
        }), /local owner confirmation/i);
        const receipt = installQuarantinedArtifact({
            home, id: adoption.id, bundledRoot, confirmation: artifactInstallConfirmation(adoption.id, adoption.digest),
            now: 1785900001000,
        });
        assert.equal(receipt.name, 'adopted-skill');
        assert.equal(receipt.digest, bundle.digest);
        assert.match(readFileSync(join(home, '.sherman', 'skills', 'adopted-skill', 'SKILL.md'), 'utf8'), /adopted-skill/);
        assert.equal(statSync(receipt.receiptPath).mode & 0o777, 0o600);
        assert.equal(loadArtifactState(home).adoptions[0].status, 'installed');

        mkdirSync(join(bundledRoot, 'skills', 'phi-boundary'), { recursive: true });
        const collisionBundle = signedBundle('phi-boundary');
        const collision = quarantineSkillBundle({
            home, bundle: collisionBundle.bundle,
            resolveTrustedPublisher: resolverFor(trustedPublisher(collisionBundle.bundle, collisionBundle.publisherPublicKey)),
            bundledRoot, now: 1785900000000,
        });
        assert.throws(() => installQuarantinedArtifact({
            home, id: collision.id, bundledRoot, confirmation: artifactInstallConfirmation(collision.id, collision.digest),
        }), /bundled skill/i);
    } finally {
        rmSync(home, { recursive: true, force: true });
        rmSync(bundledRoot, { recursive: true, force: true });
    }
});

test('install restores the prior target and quarantined state when receipt or state persistence fails', () => {
    for (const failure of ['receipt', 'state']) {
        const home = mkdtempSync(join(tmpdir(), `sherman-commons-install-${failure}-`));
        const bundledRoot = mkdtempSync(join(tmpdir(), 'sherman-commons-bundled-'));
        try {
            writeSkill(home, 'adopted-skill');
            const oldSkill = readFileSync(join(home, '.sherman', 'skills', 'adopted-skill', 'SKILL.md'), 'utf8');
            const signed = signedBundle();
            const adoption = quarantineSkillBundle({
                home, bundle: signed.bundle,
                resolveTrustedPublisher: resolverFor(trustedPublisher(signed.bundle, signed.publisherPublicKey)),
                now: 1785900000000,
            });
            const persistence = failure === 'receipt'
                ? { writeReceipt: () => { throw new Error('injected receipt failure'); } }
                : { saveArtifactState: () => { throw new Error('injected state failure'); } };
            assert.throws(() => installQuarantinedArtifact({
                home, id: adoption.id, bundledRoot, confirmation: artifactInstallConfirmation(adoption.id, adoption.digest),
                now: 1785900001000, persistence,
            }), new RegExp(`injected ${failure} failure`));
            assert.equal(
                readFileSync(join(home, '.sherman', 'skills', 'adopted-skill', 'SKILL.md'), 'utf8'),
                oldSkill,
            );
            assert.equal(loadArtifactState(home).adoptions[0].status, 'quarantined');
            const receipts = join(home, '.sherman', 'commons', 'receipts');
            assert.equal(!existsSync(receipts) || readdirSync(receipts).length === 0, true, 'failed install left an orphan receipt');
        } finally {
            rmSync(home, { recursive: true, force: true });
            rmSync(bundledRoot, { recursive: true, force: true });
        }
    }
});

test('install rejects incompatible Node and Sherman versions without changing target or state', () => {
    for (const compatibility of [{ node: '>=999.0.0' }, { sherman: '>=999.0.0' }]) {
        const home = mkdtempSync(join(tmpdir(), 'sherman-commons-compat-'));
        const bundledRoot = mkdtempSync(join(tmpdir(), 'sherman-commons-bundled-'));
        try {
            writeSkill(home, 'adopted-skill');
            const oldSkill = readFileSync(join(home, '.sherman', 'skills', 'adopted-skill', 'SKILL.md'), 'utf8');
            const signed = signedBundle();
            signed.bundle.compatibility = compatibility;
            signed.bundle.digest = computeArtifactDigest(signed.bundle);
            const keys = generateKeyPairSync('ed25519');
            signed.bundle.signature = sign(null, Buffer.from(artifactSignaturePayload(signed.bundle.digest)), keys.privateKey).toString('base64');
            const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
            const adoption = quarantineSkillBundle({
                home, bundle: signed.bundle,
                resolveTrustedPublisher: resolverFor(trustedPublisher(signed.bundle, publicKey)),
                now: 1785900000000,
            });
            assert.throws(() => installQuarantinedArtifact({
                home, id: adoption.id, bundledRoot, confirmation: artifactInstallConfirmation(adoption.id, adoption.digest),
            }), /compatib/i);
            assert.equal(readFileSync(join(home, '.sherman', 'skills', 'adopted-skill', 'SKILL.md'), 'utf8'), oldSkill);
            assert.equal(loadArtifactState(home).adoptions[0].status, 'quarantined');
        } finally {
            rmSync(home, { recursive: true, force: true });
            rmSync(bundledRoot, { recursive: true, force: true });
        }
    }
});

test('artifact publish binds the enrolled key and download quarantines server-derived trust', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-artifact-command-'));
    try {
        writeSkill(home);
        const publication = prepareSkillPublication({
            home, name: 'personal-skill', version: '1.2.3', compatibility: { node: '>=22' },
        });
        const identityKeys = generateKeyPairSync('ed25519');
        const identity = {
            version: 1, networkId: 'network-test', deviceId: 'device-test', agentId: 'agent-test',
            ownerDisplayName: 'Test Owner',
            publicKey: identityKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
            privateKey: identityKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        };
        const commons = join(home, '.sherman', 'commons');
        mkdirSync(commons, { recursive: true, mode: 0o700 });
        writeFileSync(join(commons, 'identity.json'), `${JSON.stringify(identity)}\n`, { mode: 0o600 });

        let publishedBundle;
        let idempotencyKey;
        const publish = await runCommonsCommand(`artifact publish ${publication.id}`, {
            home,
            clientFactory: () => ({
                publisherKeys: async () => [{
                    id: 'publisher-test', network_id: identity.networkId,
                    device_id: identity.deviceId, public_key: identity.publicKey,
                }],
                publishArtifact: async (bundle, options) => {
                    publishedBundle = bundle;
                    idempotencyKey = options.idempotencyKey;
                    return { id: 'artifact-server-id', scan_status: 'pending', replayed: false };
                },
            }),
        });
        assert.equal(publish.ok, true);
        assert.equal(publishedBundle.publisher_key_id, 'publisher-test');
        assert.equal(idempotencyKey, `artifact:${publishedBundle.digest}`);
        assert.match(publish.text, /artifact-server-id/);
        assert.deepEqual(loadArtifactState(home).publications[0], {
            ...publication,
            status: 'published',
            networkId: 'network-test',
            publisherKeyId: 'publisher-test',
            publishedDigest: publishedBundle.digest,
            serverId: 'artifact-server-id',
            scanStatus: 'pending',
            publishedAt: loadArtifactState(home).publications[0].publishedAt,
        });
        assert.equal(Number.isSafeInteger(loadArtifactState(home).publications[0].publishedAt), true);
        const status = await runCommonsCommand('artifact status', { home });
        assert.match(status.text, /0 pending publication manifests · 1 published artifact/);

        const downloaded = signedBundle('downloaded-skill');
        const now = Date.now();
        const download = await runCommonsCommand('artifact download artifact-server-id', {
            home,
            clientFactory: () => ({
                downloadArtifact: async () => ({
                    artifact: downloaded.bundle,
                    trust: {
                        network_id: downloaded.bundle.network_id,
                        publisher_key_id: downloaded.bundle.publisher_key_id,
                        device_id: 'publisher-device', public_key: downloaded.publisherPublicKey,
                        publisher_status: 'active', publisher_revoked_at: null,
                        device_status: 'active', device_revoked_at: null,
                        current_scanner_version: 'scanner-v2',
                        scan: {
                            status: 'passed', scanner_version: 'scanner-v2',
                            artifact_digest: downloaded.bundle.digest,
                            artifact_version: downloaded.bundle.version,
                            scanned_at: Math.floor((now - 1000) / 1000),
                            expires_at: Math.floor((now + 3600000) / 1000),
                        },
                    },
                }),
            }),
        });
        assert.equal(download.ok, true);
        const adoption = loadArtifactState(home).adoptions.at(-1);
        assert.equal(adoption.name, 'downloaded-skill');
        assert.equal(adoption.status, 'quarantined');
        const unconfirmed = await runCommonsCommand(`artifact install ${adoption.id}`, { home });
        assert.equal(unconfirmed.ok, false);
        assert.equal(loadArtifactState(home).adoptions.at(-1).status, 'quarantined');
        const review = await runCommonsCommand(`artifact review ${adoption.id}`, { home });
        const confirmation = artifactInstallConfirmation(adoption.id, adoption.digest);
        assert.match(review.text, new RegExp(confirmation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        const installed = await runCommonsCommand(`artifact install ${adoption.id} ${confirmation}`, { home });
        assert.equal(installed.ok, true);
        assert.equal(loadArtifactState(home).adoptions.at(-1).status, 'installed');
    } finally { rmSync(home, { recursive: true, force: true }); }
});
