import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function identityPath(home = process.env.HOME) {
    return join(home, '.sherman', 'commons', 'identity.json');
}

export function loadIdentity(home = process.env.HOME) {
    const path = identityPath(home);
    try {
        if ((statSync(path).mode & 0o077) !== 0) {
            throw new Error(`Commons identity at ${path} has unsafe permissions; expected 0600.`);
        }
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw new Error(`Commons identity at ${path} is unreadable or invalid.`);
    }
    const required = ['networkId', 'deviceId', 'agentId', 'ownerDisplayName', 'publicKey', 'privateKey'];
    if (required.some((key) => typeof parsed[key] !== 'string' || parsed[key].length === 0)) {
        throw new Error(`Commons identity at ${path} is incomplete.`);
    }
    return parsed;
}

export async function enrollDevice({ home = process.env.HOME, enrollmentToken, label, enroll }) {
    if (!enrollmentToken || typeof enroll !== 'function') throw new Error('Enrollment token and enrollment transport are required.');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const normalizedLabel = String(label || 'Sherman device').slice(0, 80);
    const tokenHash = createHash('sha256').update(enrollmentToken).digest('hex');
    const publicKeyHash = createHash('sha256').update(publicPem).digest('hex');
    const proof = ['SHERMAN-COMMONS-ENROLL-V1', tokenHash, publicKeyHash, normalizedLabel].join('\n');
    const response = await enroll({
        enrollment_token: enrollmentToken,
        public_key: publicPem,
        proof_signature: sign(null, Buffer.from(proof), privateKey).toString('base64'),
        label: normalizedLabel,
    });
    const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
    if (
        response?.protocol !== 'SHERMAN-COMMONS-V2' ||
        !validId(response.network_id) || !validId(response.device_id) || !validId(response.agent_id) ||
        typeof response.owner_display_name !== 'string' || response.owner_display_name.length < 1 ||
        response.owner_display_name.length > 100 || /[\u0000-\u001f\u007f]/.test(response.owner_display_name)
    ) {
        throw new Error('Commons returned an invalid enrollment response.');
    }
    const identity = {
        version: 1,
        networkId: response.network_id,
        deviceId: response.device_id,
        agentId: response.agent_id,
        ownerDisplayName: response.owner_display_name,
        publicKey: publicPem,
        privateKey: privatePem,
    };
    const path = identityPath(home);
    const directory = join(home, '.sherman', 'commons');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const pending = `${path}.${process.pid}.tmp`;
    writeFileSync(pending, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(pending, path);
    return identity;
}
