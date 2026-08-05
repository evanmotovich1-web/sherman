const MAX_CONTENT_LENGTH = 4000;

const RULES = [
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

export function checkCommonsContent(value) {
    if (typeof value !== 'string') return { allowed: false, reason_code: 'invalid_type' };
    if (Buffer.byteLength(value, 'utf8') > MAX_CONTENT_LENGTH) return { allowed: false, reason_code: 'too_large' };
    for (const [reasonCode, pattern] of RULES) {
        if (pattern.test(value)) return { allowed: false, reason_code: reasonCode };
    }
    return { allowed: true, reason_code: null };
}
