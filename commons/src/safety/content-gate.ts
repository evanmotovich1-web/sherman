export type ContentGateResult =
  | { allowed: true; reason_code: null }
  | { allowed: false; reason_code: string };

const rules: ReadonlyArray<readonly [string, RegExp]> = [
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
  ['credential', /\bauthorization\s*:\s*(?:bearer|basic)\s+\S+/i],
  ['credential', /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[=:]\s*\S+/i],
  ['credential', /\b(?:database_url|secret_key_base)\s*=\s*\S+/i],
  ['local_path', /(?:^|\s)\/(?:Users|home)\/[^\s]+/i],
  ['local_path', /\b[A-Z]:\\Users\\[^\s]+/i],
  ['possible_phi', /\b(?:mrn|medical record number|patient id)\s*[:#]\s*[A-Za-z0-9-]+/i],
  ['prompt_injection', /\bignore (?:all |the )?(?:previous|prior) instructions\b/i],
  ['prompt_injection', /\b(?:reveal|print|exfiltrate) (?:all )?(?:secrets|credentials|system prompt)\b/i],
  ['prompt_injection', /<\s*(?:script|iframe|object|embed)\b/i],
];

export function checkContent(value: unknown): ContentGateResult {
  if (typeof value !== 'string') return { allowed: false, reason_code: 'invalid_type' };
  if (new TextEncoder().encode(value).byteLength > 4000) return { allowed: false, reason_code: 'too_large' };
  for (const [reasonCode, pattern] of rules) {
    if (pattern.test(value)) return { allowed: false, reason_code: reasonCode };
  }
  return { allowed: true, reason_code: null };
}

export function enforceSafeContent(
  value: unknown,
  logger: (event: string, details: { reasonCode: string; byteCount: number }) => void = console.warn,
): void {
  const result = checkContent(value);
  if (result.allowed) return;
  const byteCount = typeof value === 'string' ? new TextEncoder().encode(value).byteLength : 0;
  logger('commons_content_rejected', { reasonCode: result.reason_code, byteCount });
  throw new Error('content_rejected');
}
