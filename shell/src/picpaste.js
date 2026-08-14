// /pic — hand the engine an image from the clipboard.
//
// Terminals do not paste image bytes into stdin, so a screenshot on the
// clipboard simply vanishes when pasted into a TUI. This is the bridge: the
// shell captures the clipboard image to a PNG inside the engine's own
// workspace (`~/.sherman/workspace/pastes/`), where every engine's sandbox
// already reaches, and the turn's prompt points at the file. Codex opens it
// with its view_image tool, Claude Code reads it directly, and the OpenCode
// engines read what their models support — the shell promises delivery of
// the file, not what a given model can see in it.
//
// macOS-only for now, honestly: capture shells out to osascript for the
// clipboard's «class PNGf» rendering, which needs no extra install. On other
// platforms the command names its limitation instead of pretending.

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function pastesDir(home = homedir()) {
    return join(home, '.sherman', 'workspace', 'pastes');
}

/**
 * Capture the clipboard's image to a PNG under the workspace.
 *
 * @returns {{ok: true, path: string, bytes: number} | {ok: false, reason: string}}
 */
export function captureClipboardImage({
    dir = pastesDir(),
    run = spawnSync,
    platform = process.platform,
    now = Date.now,
} = {}) {
    if (platform !== 'darwin') {
        return { ok: false, reason: 'clipboard image capture is macOS-only for now — pass a file path in your prompt instead' };
    }
    try {
        mkdirSync(dir, { recursive: true });
    } catch (error) {
        return { ok: false, reason: `cannot create ${dir}: ${error?.message ?? error}` };
    }
    const path = join(dir, `paste-${now()}.png`);
    // One osascript, three statements: coerce the clipboard to PNG data (this
    // is the step that fails cleanly when no image is there), then write it.
    const script = [
        'set png to the clipboard as «class PNGf»',
        `set f to open for access POSIX file "${path}" with write permission`,
        'write png to f',
        'close access f',
    ].flatMap((line) => ['-e', line]);
    const result = run('osascript', script, { stdio: 'ignore', timeout: 10_000 });
    if (result.status !== 0) {
        return { ok: false, reason: 'no image on the clipboard — copy a screenshot or picture first' };
    }
    if (!existsSync(path)) {
        return { ok: false, reason: 'the capture reported success but wrote nothing' };
    }
    const bytes = statSync(path).size;
    if (bytes === 0) {
        return { ok: false, reason: 'the clipboard image captured as an empty file' };
    }
    return { ok: true, path, bytes };
}

/**
 * The turn request for a captured image. Normal mode — viewing a picture is
 * ordinary work, and the file sits inside the sandbox the posture already
 * grants.
 */
export function picRequest(args, path) {
    const task = String(args ?? '').trim();
    return {
        text: [
            `The operator pasted an image from their clipboard. It is saved at: ${path}`,
            'Open and look at the image first (view_image on Codex; read the file on other engines).',
            task
                ? `Then: ${task}`
                : 'Then describe what you see and ask what the operator wants done with it only if the image itself does not make that obvious.',
        ].join('\n'),
        mode: 'normal',
        source: 'pic',
    };
}
