// The narrow sandbox widening's security core: which operator-granted roots
// are honored and — far more important — which are refused. A grant that could
// reach the vault, the home directory, or the whole disk must fail closed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { grantedWritableRoots } from '../src/engine/writable-roots.js';

// Each case builds a throwaway home with a real directory tree, writes a grant
// file, and asserts what survives validation.
function withHome(fn) {
    const home = mkdtempSync(join(tmpdir(), 'sherman-sandbox-'));
    try {
        return fn(home);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
}

function grant(home, writable_roots) {
    const grantFile = join(home, 'sandbox.json');
    writeFileSync(grantFile, JSON.stringify({ writable_roots }));
    return grantFile;
}

test('no grant file grants nothing', () => {
    withHome((home) => {
        const roots = grantedWritableRoots({ vault: join(home, 'vault'), home, grantFile: join(home, 'absent.json') });
        assert.deepEqual(roots, []);
    });
});

test('a malformed or wrong-shaped grant file fails closed', () => {
    withHome((home) => {
        const vault = join(home, 'vault');
        const bad = join(home, 'sandbox.json');
        writeFileSync(bad, 'not json {');
        assert.deepEqual(grantedWritableRoots({ vault, home, grantFile: bad }), []);
        writeFileSync(bad, JSON.stringify({ writable_roots: 'not-an-array' }));
        assert.deepEqual(grantedWritableRoots({ vault, home, grantFile: bad }), []);
        writeFileSync(bad, JSON.stringify({ other: ['x'] }));
        assert.deepEqual(grantedWritableRoots({ vault, home, grantFile: bad }), []);
    });
});

test('an existing directory is granted, with ~ expanded and duplicates collapsed', () => {
    withHome((home) => {
        const vault = join(home, 'vault');
        mkdirSync(vault, { recursive: true });
        const work = join(home, 'work');
        mkdirSync(work);
        const grantFile = grant(home, [work, work, '~/work']);
        const roots = grantedWritableRoots({ vault, home, grantFile });
        assert.deepEqual(roots, [work], 'the granted dir appears once, ~ resolved to the same path');
    });
});

test('a path that does not exist, or is a file not a directory, is refused', () => {
    withHome((home) => {
        const vault = join(home, 'vault');
        const file = join(home, 'a-file');
        writeFileSync(file, 'x');
        const grantFile = grant(home, [join(home, 'nope'), file]);
        assert.deepEqual(grantedWritableRoots({ vault, home, grantFile }), []);
    });
});

test('a relative path is refused — it cannot be reasoned about', () => {
    withHome((home) => {
        const vault = join(home, 'vault');
        const grantFile = grant(home, ['relative/dir', './also-relative']);
        assert.deepEqual(grantedWritableRoots({ vault, home, grantFile }), []);
    });
});

test('the vault, an ancestor of it, and anything inside it are all refused', () => {
    withHome((home) => {
        const vault = join(home, 'company', 'vault');
        mkdirSync(vault, { recursive: true });
        const inside = join(vault, 'memory');
        mkdirSync(inside);
        const ancestor = join(home, 'company');
        const grantFile = grant(home, [vault, ancestor, inside]);
        assert.deepEqual(
            grantedWritableRoots({ vault, home, grantFile }),
            [],
            'no vault-related path may become writable through the grant'
        );
    });
});

test('the home directory itself and the filesystem root are refused as too broad', () => {
    withHome((home) => {
        const vault = join(home, 'vault');
        const grantFile = grant(home, [home, '/']);
        assert.deepEqual(grantedWritableRoots({ vault, home, grantFile }), []);
    });
});

test('a safe project dir survives alongside refused broad and vault grants', () => {
    withHome((home) => {
        const vault = join(home, 'vault');
        mkdirSync(vault, { recursive: true });
        const project = join(home, '.sherman', 'workspace', 'local-mlx-research');
        mkdirSync(project, { recursive: true });
        const grantFile = grant(home, [home, vault, project]);
        assert.deepEqual(
            grantedWritableRoots({ vault, home, grantFile }),
            [project],
            'only the narrow, non-vault, non-home project dir is granted'
        );
    });
});
