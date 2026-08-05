import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const commonsRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = join(commonsRoot, 'scripts');

function fixture(): string {
  return mkdtempSync(join(tmpdir(), 'commons-operations-'));
}

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body, { mode: 0o700 });
  chmodSync(path, 0o700);
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const approvedAccountId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const approvedDatabaseId = '11111111-2222-4333-8444-555555555555';

function run(script: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {}) {
  return spawnSync('bash', [join(scripts, script), ...args], {
    cwd: options.cwd ?? commonsRoot,
    env: { ...process.env, ...options.env },
    input: options.input,
    encoding: 'utf8',
  });
}

function validConfig(databaseId = '11111111-2222-4333-8444-555555555555') {
  return {
    name: 'sherman-commons-pilot',
    account_id: approvedAccountId,
    workers_dev: false,
    preview_urls: false,
    routes: [{ pattern: 'commons-pilot.example.test/*', custom_domain: false }],
    vars: {
      NETWORK_ID: 'pilot',
      API_AUDIENCE: 'https://commons-pilot.example.test',
      CF_ACCESS_AUD: 'access-audience-value',
      CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
      HUMAN_ORIGIN: 'https://commons-pilot.example.test',
      SCANNER_VERSION: 'scanner-2026-08-05',
      SCAN_MAX_AGE_SECONDS: '86400',
    },
    d1_databases: [{ binding: 'DB', database_name: 'commons-pilot-db', database_id: databaseId, migrations_dir: 'migrations' }],
  };
}

function writeConfig(root: string, config = validConfig()): string {
  const path = join(root, 'wrangler.jsonc');
  writeFileSync(path, JSON.stringify(config));
  return path;
}

function writeWranglerStub(root: string): string {
  const path = join(root, 'npx');
  writeExecutable(path, `#!/bin/bash
case "$*" in
  *"whoami --json"*)
    if [ "\${STUB_AUTH:-yes}" = "yes" ]; then printf '%s\\n' '{"loggedIn":true,"accounts":[{"id":"${approvedAccountId}"}]}'; exit 0; fi
    printf '%s\\n' "authentication failed \${SECRET_CANARY:-}" >&2; exit 1 ;;
  *"secret list"*) printf '%s\\n' '[{"name":"SCANNER_CALLBACK_TOKEN"}]'; exit 0 ;;
  *"d1 migrations list"*)
    if [ -n "\${STUB_MIGRATION:-}" ]; then printf '%s\\n' "\${STUB_MIGRATION}"; else printf '%s\\n' 'No migrations to apply!'; fi
    exit 0 ;;
  *) printf '%s\\n' 'unexpected wrangler invocation' >&2; exit 90 ;;
esac
`);
  return path;
}

const approvedRoute = 'commons-pilot.example.test/*';
const verifiedAttestations = {
  COMMONS_ATTEST_ACCESS_JWT: 'verified',
  COMMONS_ATTEST_WAF: 'verified',
  COMMONS_ATTEST_LOG_RETENTION: 'verified',
  COMMONS_ATTEST_SCANNER: 'verified',
};
const preflightArgs = (configPath: string) => [
  '--config', configPath, '--database', 'commons-pilot-db', '--database-id', approvedDatabaseId,
  '--account-id', approvedAccountId, '--approved-route', approvedRoute,
];

describe('Commons operations scripts', () => {
  it('preflight fails closed on a placeholder API audience before contacting Wrangler', () => {
    const root = fixture();
    const config = validConfig();
    config.vars.API_AUDIENCE = 'https://replace-before-deploy.invalid';
    const configPath = join(root, 'wrangler.jsonc');
    writeFileSync(configPath, JSON.stringify(config));
    const npx = join(root, 'npx');
    writeExecutable(npx, '#!/bin/bash\necho "WRANGLER SHOULD NOT RUN" >&2\nexit 99\n');

    const result = run('commons-preflight.sh', preflightArgs(configPath), {
      env: { NPX_BIN: npx, COMMONS_ATTEST_WAF: 'verified', COMMONS_ATTEST_LOG_RETENTION: 'verified', COMMONS_ATTEST_SCANNER: 'verified' },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('MACHINE BLOCKER');
    expect(result.stderr).toContain('API_AUDIENCE');
    expect(result.stderr).not.toContain('WRANGLER SHOULD NOT RUN');
  });

  it('preflight fails closed when Wrangler is unauthenticated without echoing command output or secrets', () => {
    const root = fixture();
    const configPath = writeConfig(root);
    const npx = writeWranglerStub(root);
    const canary = 'super-secret-canary-value';

    const result = run('commons-preflight.sh', preflightArgs(configPath), {
      env: { NPX_BIN: npx, STUB_AUTH: 'no', SECRET_CANARY: canary, ...verifiedAttestations },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('MACHINE BLOCKER');
    expect(result.stderr).toContain('Wrangler authentication');
    expect(`${result.stdout}${result.stderr}`).not.toContain(canary);
    expect(`${result.stdout}${result.stderr}`).not.toContain('operator@example.test');
  });

  it('preflight reports unverified controls as operator-attestation blockers', () => {
    const root = fixture();
    const configPath = writeConfig(root);
    const npx = writeWranglerStub(root);

    const result = run('commons-preflight.sh', preflightArgs(configPath), {
      env: { NPX_BIN: npx, COMMONS_ATTEST_SCANNER: '', COMMONS_ATTEST_WAF: '', COMMONS_ATTEST_LOG_RETENTION: '' },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('OPERATOR BLOCKER: WAF');
    expect(result.stderr).toContain('OPERATOR BLOCKER: log retention');
    expect(result.stderr).toContain('OPERATOR BLOCKER: scanner service integration');
    expect(result.stderr).not.toContain('MACHINE BLOCKER');
  });

  it('preflight fails closed when Wrangler reports an unapplied migration', () => {
    const root = fixture();
    const configPath = writeConfig(root);
    const npx = writeWranglerStub(root);

    const result = run('commons-preflight.sh', preflightArgs(configPath), {
      env: { NPX_BIN: npx, STUB_MIGRATION: '0004_artifact_delivery.sql', ...verifiedAttestations },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('MACHINE BLOCKER: unapplied D1 migrations');
    expect(result.stderr).not.toContain('0004_artifact_delivery.sql');
  });

  it('preflight passes only with machine checks and every operator attestation verified', () => {
    const root = fixture();
    const configPath = writeConfig(root);
    const npx = writeWranglerStub(root);

    const result = run('commons-preflight.sh', preflightArgs(configPath), {
      env: { NPX_BIN: npx, ...verifiedAttestations },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PREFLIGHT PASS');
    expect(result.stderr).toBe('');
  });

  it('preflight rejects every additional or non-object public route', () => {
    const root = fixture();
    const config = validConfig();
    config.routes.push({ pattern: 'unexpected-public.example.test/*', custom_domain: false });
    const configPath = writeConfig(root, config);
    const npx = writeWranglerStub(root);

    const result = run('commons-preflight.sh', preflightArgs(configPath), {
      env: { NPX_BIN: npx, ...verifiedAttestations },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('MACHINE BLOCKER: configuration must contain only the exact approved route object');
  });

  it('backup requires explicit database and destination arguments', () => {
    const root = fixture();
    const marker = join(root, 'called');
    const npx = join(root, 'npx');
    writeExecutable(npx, `#!/bin/bash\ntouch "${marker}"\nexit 0\n`);

    const result = run('commons-backup.sh', [], { env: { NPX_BIN: npx } });

    expect(result.status).not.toBe(0);
    expect(() => statSync(marker)).toThrow();
  });

  it('backup creates a remote export with owner-only permissions', () => {
    const root = fixture();
    const destination = join(root, 'restricted-backup.sql');
    const invocation = join(root, 'invocation');
    const npx = join(root, 'npx');
    writeExecutable(npx, `#!/bin/bash
printf '%s\\n' "$*" > "${invocation}"
output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--output' ]; then output=$2; break; fi
  shift
done
[ -n "$output" ] || exit 2
printf '%s\\n' 'PRAGMA foreign_keys=OFF;' > "$output"
`);

    const result = run('commons-backup.sh', ['--database', 'commons-production', '--destination', destination], { env: { NPX_BIN: npx } });

    expect(result.status).toBe(0);
    expect(readFileSync(destination, 'utf8')).toContain('PRAGMA');
    expect(statSync(destination).mode & 0o777).toBe(0o600);
    expect(readFileSync(invocation, 'utf8')).toContain('wrangler d1 export commons-production --remote');
  });

  it('backup refuses an exporter that swaps its private output path for a symlink', () => {
    const root = fixture();
    const destination = join(root, 'restricted-backup.sql');
    const redirected = join(root, 'redirected.sql');
    const npx = join(root, 'npx');
    writeExecutable(npx, `#!/bin/bash
output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--output' ]; then output=$2; break; fi
  shift
done
rm -f "$output"
ln -s "${redirected}" "$output"
printf '%s\\n' 'PRAGMA foreign_keys=OFF;' > "$output"
`);

    const result = run('commons-backup.sh', ['--database', 'commons-production', '--destination', destination], { env: { NPX_BIN: npx } });

    expect(result.status).not.toBe(0);
    expect(() => statSync(destination)).toThrow();
    expect(result.stdout).not.toContain('BACKUP COMPLETE');
  });

  it('restore refuses production-looking targets without a second override', () => {
    const root = fixture();
    const input = join(root, 'backup.sql');
    writeFileSync(input, 'SELECT 1;\n', { mode: 0o600 });
    const marker = join(root, 'called');
    const npx = join(root, 'npx');
    writeExecutable(npx, `#!/bin/bash\ntouch "${marker}"\nexit 0\n`);

    const result = run('commons-restore.sh', [
      '--database', 'commons-production', '--input', input, '--sha256', sha256('SELECT 1;\n'),
    ], {
      env: { NPX_BIN: npx }, input: 'RESTORE commons-production\n',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--allow-production');
    expect(() => statSync(marker)).toThrow();
  });

  it('restore requires exact typed destructive confirmation before a nonproduction restore', () => {
    const root = fixture();
    const input = join(root, 'backup.sql');
    writeFileSync(input, 'SELECT 1;\n', { mode: 0o600 });
    const invocation = join(root, 'invocation');
    const npx = join(root, 'npx');
    writeExecutable(npx, `#!/bin/bash\nprintf '%s\\n' "$*" > "${invocation}"\nexit 0\n`);

    const digest = sha256('SELECT 1;\n');
    const denied = run('commons-restore.sh', [
      '--database', 'commons-restore-rehearsal', '--input', input, '--sha256', digest,
    ], {
      env: { NPX_BIN: npx }, input: 'yes\n',
    });
    expect(denied.status).not.toBe(0);
    expect(() => statSync(invocation)).toThrow();

    const allowed = run('commons-restore.sh', [
      '--database', 'commons-restore-rehearsal', '--input', input, '--sha256', digest,
    ], {
      env: { NPX_BIN: npx }, input: 'RESTORE commons-restore-rehearsal\n',
    });
    expect(allowed.status).toBe(0);
    expect(readFileSync(invocation, 'utf8')).toContain('wrangler d1 execute commons-restore-rehearsal --remote --file');
  });

  it('restore fails closed before confirmation when the reviewed backup checksum does not match', () => {
    const root = fixture();
    const input = join(root, 'backup.sql');
    writeFileSync(input, 'SELECT 1;\n', { mode: 0o600 });
    const marker = join(root, 'called');
    const npx = join(root, 'npx');
    writeExecutable(npx, `#!/bin/bash\ntouch "${marker}"\nexit 0\n`);
    const result = run('commons-restore.sh', [
      '--database', 'commons-restore-rehearsal', '--input', input, '--sha256', '0'.repeat(64),
    ], { env: { NPX_BIN: npx }, input: 'RESTORE commons-restore-rehearsal\n' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('checksum');
    expect(() => statSync(marker)).toThrow();
  });

  it('bootstrap seed accepts only reviewed closed-world metadata and renders bounded SQL', () => {
    const root = fixture();
    const input = join(root, 'seed.json');
    const seed = JSON.stringify({
      network: { id: 'pilot', name: 'Synthetic Pilot' },
      organizations: [{ id: 'org-a', name: 'Synthetic Org' }],
      users: [
        { id: 'owner-admin', organization_id: 'org-a', email: 'admin@example.test', access_subject: 'access-admin', display_name: 'Admin', role: 'network_admin' },
        { id: 'owner-member', organization_id: 'org-a', email: 'member@example.test', access_subject: 'access-member', display_name: 'Member', role: 'member' },
      ],
      agents: [
        { id: 'agent-admin', organization_id: 'org-a', owner_user_id: 'owner-admin', display_name: 'Admin agent' },
        { id: 'agent-member', organization_id: 'org-a', owner_user_id: 'owner-member', display_name: 'Member agent' },
      ],
    });
    writeFileSync(input, seed, { mode: 0o600 });
    const captured = join(root, 'captured.sql');
    const npx = join(root, 'npx');
    writeExecutable(npx, `#!/bin/bash
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--file' ]; then cp "$2" "${captured}"; exit 0; fi
  shift
done
exit 2
`);
    const result = run('commons-seed.sh', [
      '--database', 'commons-pilot-staging', '--input', input, '--sha256', sha256(seed),
    ], { env: { NPX_BIN: npx }, input: 'SEED commons-pilot-staging pilot\n' });
    expect(result.status).toBe(0);
    const sql = readFileSync(captured, 'utf8');
    expect(sql).toContain("INSERT INTO networks");
    expect(sql).toContain("'network_admin'");
    expect(sql).not.toContain('BEGIN PRIVATE KEY');
    expect(sql).not.toMatch(/\b(?:BEGIN|COMMIT)\b/);
    const database = new DatabaseSync(':memory:');
    for (const migration of ['0001_initial.sql', '0002_api_security.sql', '0003_human_mutation_quotas.sql', '0004_artifact_delivery.sql', '0005_inventory.sql']) {
      database.exec(readFileSync(join(commonsRoot, 'migrations', migration), 'utf8'));
    }
    database.exec(sql);
    expect(database.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 2 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM agents').get()).toEqual({ count: 2 });
    database.close();
  });

  it('bootstrap seed rejects unknown fields before contacting Wrangler', () => {
    const root = fixture();
    const input = join(root, 'seed.json');
    const seed = JSON.stringify({ network: { id: 'pilot', name: 'Pilot', secret: 'nope' }, organizations: [], users: [], agents: [] });
    writeFileSync(input, seed, { mode: 0o600 });
    const marker = join(root, 'called');
    const npx = join(root, 'npx');
    writeExecutable(npx, `#!/bin/bash\ntouch "${marker}"\nexit 0\n`);
    const result = run('commons-seed.sh', [
      '--database', 'commons-pilot-staging', '--input', input, '--sha256', sha256(seed),
    ], { env: { NPX_BIN: npx }, input: 'SEED commons-pilot-staging pilot\n' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Seed input is invalid');
    expect(() => statSync(marker)).toThrow();
  });

  it('bootstrap seed rejects internal uniqueness conflicts before rendering any SQL', () => {
    const root = fixture();
    const input = join(root, 'seed.json');
    const output = join(root, 'seed.sql');
    writeFileSync(input, JSON.stringify({
      network: { id: 'pilot', name: 'Pilot' },
      organizations: [{ id: 'org-a', name: 'Org' }],
      users: [
        { id: 'admin', organization_id: 'org-a', email: 'same@example.test', access_subject: 'admin-sub', display_name: 'Admin', role: 'network_admin' },
        { id: 'member', organization_id: 'org-a', email: 'SAME@example.test', access_subject: 'member-sub', display_name: 'Member', role: 'member' },
      ],
      agents: [
        { id: 'agent-admin', organization_id: 'org-a', owner_user_id: 'admin', display_name: 'Admin agent' },
        { id: 'agent-member', organization_id: 'org-a', owner_user_id: 'member', display_name: 'Member agent' },
      ],
    }), { mode: 0o600 });
    const result = spawnSync(process.execPath, [join(scripts, 'render-seed.mjs'), input, output], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(() => statSync(output)).toThrow();
  });

  it('operations runbook covers the complete private-pilot and recovery lifecycle', () => {
    const runbook = readFileSync(join(commonsRoot, '..', 'docs', 'COMMONS-OPERATIONS.md'), 'utf8');
    for (const required of [
      'Invitation-only', 'Cloudflare Access', 'CF_ACCESS_AUD', 'workers.dev', 'backup before',
      'restore rehearsal', 'separate database', 'Device revocation', 'User revocation', 'Purge',
      'scanner key rotation', 'Rollback', 'two-machine', 'Acceptance metrics', 'log retention',
    ]) expect(runbook.toLowerCase()).toContain(required.toLowerCase());
  });
});
