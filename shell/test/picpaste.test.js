// /pic capture: honest on every path — wrong platform, empty clipboard,
// phantom writes — and the request it builds points the engine at the file.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { captureClipboardImage, picRequest } from '../src/picpaste.js';

function tempDir() {
    return mkdtempSync(join(tmpdir(), 'sherman-pic-'));
}

test('capture refuses off macOS with a named limitation', () => {
    const result = captureClipboardImage({ dir: tempDir(), platform: 'linux' });
    assert.equal(result.ok, false);
    assert.match(result.reason, /macOS-only/);
});

test('a clipboard without an image fails cleanly', () => {
    const dir = tempDir();
    try {
        const result = captureClipboardImage({
            dir, platform: 'darwin', run: () => ({ status: 1 }),
        });
        assert.equal(result.ok, false);
        assert.match(result.reason, /no image on the clipboard/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a run that exits 0 but writes nothing is not called a success', () => {
    const dir = tempDir();
    try {
        const result = captureClipboardImage({
            dir, platform: 'darwin', run: () => ({ status: 0 }),
        });
        assert.equal(result.ok, false);
        assert.match(result.reason, /wrote nothing/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a real capture returns the workspace path and size', () => {
    const dir = tempDir();
    try {
        const result = captureClipboardImage({
            dir,
            platform: 'darwin',
            now: () => 1234,
            // The fake osascript writes the file the way the real one does.
            run: (cmd, argv) => {
                assert.equal(cmd, 'osascript');
                assert.equal(argv.filter((a) => a === '-e').length, 4);
                writeFileSync(join(dir, 'paste-1234.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
                return { status: 0 };
            },
        });
        assert.equal(result.ok, true);
        assert.equal(result.path, join(dir, 'paste-1234.png'));
        assert.equal(result.bytes, 4);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('picRequest points the engine at the file, normal mode, with or without a task', () => {
    const bare = picRequest('', '/x/paste-1.png');
    assert.equal(bare.mode, 'normal');
    assert.equal(bare.source, 'pic');
    assert.match(bare.text, /\/x\/paste-1\.png/);
    assert.match(bare.text, /describe what you see/);

    const tasked = picRequest('fix the layout bug in this screenshot', '/x/paste-2.png');
    assert.match(tasked.text, /Then: fix the layout bug/);
});
