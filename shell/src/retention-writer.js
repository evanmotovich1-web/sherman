import {
    closeSync, constants as fsConstants, existsSync, fstatSync, fsyncSync, lstatSync,
    openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';

const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,79}\.md$/;
let temporary = null;

function reject(code) {
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
}

try {
    const lanePath = process.argv[2];
    const raw = readFileSync(0, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > 6000) throw new Error('invalid_payload');
    const request = JSON.parse(raw);
    if (!request || typeof request !== 'object' || Array.isArray(request)
        || Object.keys(request).some((key) => !['dev', 'ino', 'canonical', 'path', 'content'].includes(key))
        || typeof lanePath !== 'string' || !lanePath
        || typeof request.dev !== 'number' || typeof request.ino !== 'number'
        || typeof request.canonical !== 'string' || !request.canonical
        || typeof request.path !== 'string' || !SAFE_NAME.test(request.path)
        || request.path.includes('/') || request.path.includes('\\')
        || typeof request.content !== 'string') {
        throw new Error('invalid_payload');
    }

    // Descriptor 3 is the verified lane opened by the parent. The child cwd
    // must be that same inode, while lanePath must still name it directly (not
    // through a symlink). Recheck the namespace around each mutation and remove
    // a just-created target if the lane moved during the final rename window.
    const lane = fstatSync(3);
    const cwdLane = lstatSync('.');
    if (!lane.isDirectory() || cwdLane.isSymbolicLink() || !cwdLane.isDirectory()
        || cwdLane.dev !== lane.dev || cwdLane.ino !== lane.ino
        || lane.dev !== request.dev || lane.ino !== request.ino) {
        throw new Error('lane_identity_mismatch');
    }
    const assertLanePath = () => {
        const current = lstatSync(lanePath);
        if (current.isSymbolicLink() || !current.isDirectory()
            || current.dev !== request.dev || current.ino !== request.ino
            || lanePath !== request.canonical
            || realpathSync(lanePath) !== request.canonical) {
            throw new Error('lane_identity_mismatch');
        }
    };
    assertLanePath();
    const targetPath = request.path;

    if (existsSync(targetPath)) {
        const target = lstatSync(targetPath);
        if (target.isSymbolicLink() || !target.isFile() || target.nlink !== 1) {
            throw new Error('unsafe_target');
        }
    }

    temporary = `.${request.path}.${randomUUID()}.tmp`;
    let fd;
    try {
        fd = openSync(
            temporary,
            fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL
                | (fsConstants.O_NOFOLLOW ?? 0),
            0o600,
        );
        writeFileSync(fd, request.content, 'utf8');
        fsyncSync(fd);
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.nlink !== 1) throw new Error('unsafe_temporary');
    } finally {
        if (fd !== undefined) closeSync(fd);
    }

    assertLanePath();
    renameSync(temporary, targetPath);
    temporary = null;
    try {
        assertLanePath();
    } catch (error) {
        rmSync(targetPath, { force: true });
        throw error;
    }
    fsyncSync(3);
    process.stdout.write('{"ok":true}\n');
} catch (error) {
    if (temporary) {
        try { rmSync(temporary, { force: true }); } catch { /* descriptor-bound best effort */ }
    }
    const code = [
        'invalid_payload', 'lane_identity_mismatch', 'unsafe_target', 'unsafe_temporary',
    ].includes(error?.message) ? error.message : 'writer_rejected';
    reject(code);
}
