import { z } from 'zod';

export const EnrollmentRequest = z.object({
  enrollment_token: z.string().min(16).max(256),
  public_key: z.string().min(80).max(2048).regex(/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+-----END PUBLIC KEY-----\n?$/),
  proof_signature: z.string().min(80).max(256).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  label: z.string().min(1).max(80).regex(/^[A-Za-z0-9 ._-]+$/),
}).strict();

export type EnrollmentInput = z.infer<typeof EnrollmentRequest>;

export type EnrollmentResult = {
  networkId: string;
  deviceId: string;
  agentId: string;
  ownerDisplayName: string;
};

export type EnrollmentConsumeInput = {
  tokenHash: string;
  networkId: string;
  publicKey: string;
  label: string;
  deviceId: string;
  now: number;
};

export interface EnrollmentRepository {
  consume(input: EnrollmentConsumeInput): Promise<EnrollmentResult | null>;
}

export class EnrollmentError extends Error {
  constructor(public readonly code: 'invalid_enrollment' | 'enrollment_unavailable') {
    super(code);
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

export async function hashEnrollmentToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    toArrayBuffer(new TextEncoder().encode(token)),
  ));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function importEd25519PublicKey(pem: string): Promise<CryptoKey | null> {
  try {
    const encoded = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    return await crypto.subtle.importKey('spki', toArrayBuffer(bytes), { name: 'Ed25519' }, false, ['verify']);
  } catch {
    return null;
  }
}

export async function enrollmentProofPayload(tokenHash: string, publicKey: string, label: string): Promise<string> {
  const publicKeyHash = await hashEnrollmentToken(publicKey);
  return ['SHERMAN-COMMONS-ENROLL-V1', tokenHash, publicKeyHash, label].join('\n');
}

async function validEnrollmentProof(input: EnrollmentInput, tokenHash: string): Promise<boolean> {
  try {
    const publicKey = await importEd25519PublicKey(input.public_key);
    if (!publicKey) return false;
    const signature = Uint8Array.from(atob(input.proof_signature), (character) => character.charCodeAt(0));
    return crypto.subtle.verify(
      'Ed25519', publicKey, toArrayBuffer(signature),
      toArrayBuffer(new TextEncoder().encode(await enrollmentProofPayload(tokenHash, input.public_key, input.label))),
    );
  } catch {
    return false;
  }
}

export class EnrollmentService {
  constructor(
    private readonly repository: EnrollmentRepository,
    private readonly networkId: string,
    private readonly clock: () => number = () => Math.floor(Date.now() / 1000),
    private readonly deviceIdFactory: () => string = () => crypto.randomUUID(),
  ) {}

  async enroll(value: unknown): Promise<{
    network_id: string;
    device_id: string;
    agent_id: string;
    owner_display_name: string;
    protocol: 'SHERMAN-COMMONS-V2';
  }> {
    const parsed = EnrollmentRequest.safeParse(value);
    if (!parsed.success) throw new EnrollmentError('invalid_enrollment');
    const tokenHash = await hashEnrollmentToken(parsed.data.enrollment_token);
    if (!await validEnrollmentProof(parsed.data, tokenHash)) {
      throw new EnrollmentError('invalid_enrollment');
    }
    const result = await this.repository.consume({
      tokenHash,
      networkId: this.networkId,
      publicKey: parsed.data.public_key,
      label: parsed.data.label,
      deviceId: this.deviceIdFactory(),
      now: this.clock(),
    });
    if (!result) throw new EnrollmentError('enrollment_unavailable');
    return {
      network_id: result.networkId,
      device_id: result.deviceId,
      agent_id: result.agentId,
      owner_display_name: result.ownerDisplayName,
      protocol: 'SHERMAN-COMMONS-V2',
    };
  }
}
