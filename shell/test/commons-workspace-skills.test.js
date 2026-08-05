import test from 'node:test';
import assert from 'node:assert/strict';
import {
    chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { assembleSkills, main } from '../bin/sherman-commons.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function skill(root, name, metadataName = name, extra = '') {
    const directory = join(root, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'SKILL.md'), [
        '---', `name: ${metadataName}`, 'category: test', 'description: fixture skill', '---', '', `# ${name}`, extra,
    ].join('\n'));
    return directory;
}

test('workspace skill assembly keeps bundled first and deterministically admits only valid personal skills', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'sherman-workspace-skills-'));
    const bundled = join(fixture, 'bundled');
    const personal = join(fixture, 'personal');
    const target = join(fixture, 'workspace-skills');
    mkdirSync(bundled);
    mkdirSync(personal);
    try {
        skill(bundled, 'collision', 'collision', 'bundled copy');
        skill(bundled, 'bundled-only');
        skill(personal, 'personal-valid');
        skill(personal, 'collision', 'collision', 'personal must not win');
        skill(personal, 'name-mismatch', 'other-name');
        mkdirSync(join(personal, 'malformed'));
        writeFileSync(join(personal, 'malformed', 'SKILL.md'), '# no frontmatter\n');
        const linked = skill(fixture, 'linked-source');
        symlinkSync(linked, join(personal, 'linked-skill'));
        const nestedLink = skill(personal, 'nested-link');
        symlinkSync(join(fixture, 'outside.txt'), join(nestedLink, 'escape.txt'));
        writeFileSync(join(fixture, 'outside.txt'), 'outside');

        const first = assembleSkills({ bundledRoot: bundled, personalRoot: personal, targetRoot: target });
        assert.deepEqual(readdirSync(target).sort(), ['bundled-only', 'collision', 'personal-valid']);
        assert.match(readFileSync(join(target, 'collision', 'SKILL.md'), 'utf8'), /bundled copy/);
        assert.equal(first.personalCopied, 1);
        assert.deepEqual(first.rejected.map((item) => item.name), [
            'collision', 'linked-skill', 'malformed', 'name-mismatch', 'nested-link',
        ]);
        assert.equal(existsSync(join(target, 'linked-skill')), false);

        writeFileSync(join(target, 'stale.txt'), 'must disappear');
        assert.throws(
            () => assembleSkills({ bundledRoot: bundled, personalRoot: personal, targetRoot: target }),
            /target already exists/i,
        );
        assert.equal(readFileSync(join(target, 'stale.txt'), 'utf8'), 'must disappear');
        const secondTarget = join(fixture, 'workspace-skills-second');
        const second = assembleSkills({ bundledRoot: bundled, personalRoot: personal, targetRoot: secondTarget });
        assert.deepEqual(second, first);
        assert.deepEqual(readdirSync(secondTarget).sort(), ['bundled-only', 'collision', 'personal-valid']);
    } finally {
        rmSync(fixture, { recursive: true, force: true });
    }
});

test('the internal assembly CLI refuses arbitrary direct invocation before touching a target', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'sherman-assembly-guard-'));
    const target = join(fixture, 'target');
    mkdirSync(target);
    writeFileSync(join(target, 'keep.txt'), 'keep');
    const errors = [];
    try {
        const status = await main(
            ['--assemble-skills', join(fixture, 'bundled'), join(fixture, 'personal'), target],
            { log() {}, error: (text) => errors.push(text) },
        );
        assert.equal(status, 1);
        assert.equal(readFileSync(join(target, 'keep.txt'), 'utf8'), 'keep');
        assert.match(errors.join('\n'), /could not be completed safely/i);

        const token = 'a'.repeat(64);
        process.env.SHERMAN_SKILL_ASSEMBLY_TOKEN = token;
        const forgedStatus = await main(
            ['--assemble-skills', token, join(fixture, 'bundled'), join(fixture, 'personal'), target],
            { log() {}, error: (text) => errors.push(text) },
        );
        assert.equal(forgedStatus, 1);
        assert.equal(readFileSync(join(target, 'keep.txt'), 'utf8'), 'keep');
    } finally {
        rmSync(fixture, { recursive: true, force: true });
    }
});

test('the launcher assembles approved personal skills into both generated engine layouts', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-launch-personal-skills-'));
    const fakeBin = join(home, 'bin');
    mkdirSync(fakeBin);
    mkdirSync(join(home, '.sherman'), { recursive: true });
    const personal = join(home, '.sherman', 'skills');
    mkdirSync(personal);
    skill(personal, 'personal-launch');
    writeFileSync(join(home, '.sherman', 'config.json'), JSON.stringify({
        version: 2, engine: 'codex', user: 'fixture', vault_path: join(home, 'vault'),
    }));
    const codex = join(fakeBin, 'codex');
    writeFileSync(codex, '#!/bin/sh\nexit 0\n');
    chmodSync(codex, 0o700);
    try {
        const result = spawnSync(join(repoRoot, 'bin', 'sherman'), ['--raw'], {
            encoding: 'utf8',
            env: {
                ...process.env,
                HOME: home,
                PATH: `${fakeBin}:${process.env.PATH}`,
                SHERMAN_NO_FETCH: '1',
            },
            timeout: 15_000,
        });
        assert.equal(result.status, 0, result.stderr || result.stdout);
        const workspace = join(home, '.sherman', 'workspace');
        for (const engineRoot of ['.agents', '.claude']) {
            assert.equal(existsSync(join(workspace, engineRoot, 'skills', 'personal-launch', 'SKILL.md')), true);
            assert.equal(existsSync(join(workspace, engineRoot, 'skills', 'commons', 'SKILL.md')), true);
        }
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});
