import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { encoding: 'utf8', ...options });
    assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    return result;
}

function writeFixtureRepo(source) {
    mkdirSync(join(source, 'bin'), { recursive: true });
    mkdirSync(join(source, 'shell', 'bin'), { recursive: true });
    cpSync(join(repoRoot, 'bin', 'sherman'), join(source, 'bin', 'sherman'));
    writeFileSync(join(source, 'shell', 'package.json'), '{"version":"0.0.1"}\n');
    writeFileSync(join(source, 'shell', 'bin', 'sherman-commons.js'), 'old launcher\n');
    writeFileSync(join(source, 'smoke.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
}

function snapshotTree(root) {
    const entries = [];
    function walk(path, relative = '') {
        const metadata = lstatSync(path);
        const mode = metadata.mode & 0o777;
        if (metadata.isSymbolicLink()) {
            entries.push([relative, 'link', mode, readlinkSync(path)]);
            return;
        }
        if (metadata.isDirectory()) {
            entries.push([relative, 'directory', mode]);
            for (const name of readdirSync(path).sort()) walk(join(path, name), relative ? join(relative, name) : name);
            return;
        }
        entries.push([relative, 'file', mode, readFileSync(path).toString('base64')]);
    }
    walk(root);
    return entries;
}

test('a stale-clone sherman update preserves Commons state and approved personal skills byte-for-byte', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'sherman-update-preservation-'));
    const remote = join(fixture, 'remote.git');
    const source = join(fixture, 'source');
    const stale = join(fixture, 'stale');
    const home = join(fixture, 'home');
    try {
        run('git', ['init', '--bare', remote]);
        run('git', ['init', source]);
        writeFixtureRepo(source);
        run('git', ['-C', source, 'config', 'user.email', 'fixture@example.test']);
        run('git', ['-C', source, 'config', 'user.name', 'Fixture']);
        run('git', ['-C', source, 'add', '.']);
        run('git', ['-C', source, 'commit', '-m', 'old']);
        run('git', ['-C', source, 'branch', '-M', 'main']);
        run('git', ['-C', source, 'remote', 'add', 'origin', remote]);
        run('git', ['-C', source, 'push', '-u', 'origin', 'main']);
        run('git', ['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
        run('git', ['clone', remote, stale]);

        const preserved = new Map([
            ['.sherman/commons/identity.json', '{"identity":"keep"}\n'],
            ['.sherman/commons/settings.json', '{"settings":"keep"}\n'],
            ['.sherman/commons/state.json', '{"pending_intent":"keep"}\n'],
            ['.sherman/commons/inventory-state.json', '{"inventory_cursor":"keep"}\n'],
            ['.sherman/commons/artifacts.json', '{"artifact_state":"keep"}\n'],
            ['.sherman/commons/receipts/receipt.json', '{"receipt":"keep"}\n'],
            ['.sherman/commons/quarantine/item/SKILL.md', 'quarantined bytes\n'],
            ['.sherman/skills/personal/SKILL.md', 'approved personal bytes\n'],
        ]);
        for (const [relative, content] of preserved) {
            const path = join(home, relative);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, content);
        }
        mkdirSync(join(home, '.sherman', 'commons', 'empty-state-directory'), { mode: 0o700 });
        symlinkSync('identity.json', join(home, '.sherman', 'commons', 'identity-link'));
        const before = snapshotTree(join(home, '.sherman'));

        writeFileSync(join(source, 'shell', 'package.json'), '{"version":"0.0.2"}\n');
        cpSync(join(repoRoot, 'shell', 'bin', 'sherman-commons.js'), join(source, 'shell', 'bin', 'sherman-commons.js'));
        run('git', ['-C', source, 'add', '.']);
        run('git', ['-C', source, 'commit', '-m', 'new commons client']);
        run('git', ['-C', source, 'push']);

        // SHERMAN_NO_FETCH: update also provisions network-installed
        // capabilities (mnemosyne) into ~/.sherman, which this test's
        // byte-for-byte snapshot must not see — and a fixture has no
        // business reaching PyPI. Same opt-out the vault sync honors.
        const nestedUpdateEnv = { ...process.env, HOME: home, SHERMAN_NO_BROWSER: '1', SHERMAN_NO_FETCH: '1' };
        delete nestedUpdateEnv.SHERMAN_UPDATE_REEXEC;
        delete nestedUpdateEnv.SHERMAN_UPDATE_OLD_VERSION;
        const updated = run(join(stale, 'bin', 'sherman'), ['update'], {
            env: nestedUpdateEnv,
            timeout: 30_000,
        });
        assert.match(updated.stdout, /Updated: v0\.0\.1 -> v0\.0\.2/);
        assert.match(readFileSync(join(stale, 'shell', 'bin', 'sherman-commons.js'), 'utf8'), /assembleSkills/);
        for (const [relative, content] of preserved) {
            assert.equal(readFileSync(join(home, relative), 'utf8'), content, relative);
        }
        assert.deepEqual(snapshotTree(join(home, '.sherman')), before);
    } finally {
        rmSync(fixture, { recursive: true, force: true });
    }
});
