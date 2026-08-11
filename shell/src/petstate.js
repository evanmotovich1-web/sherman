// The desktop pet's one input: ~/.sherman/pet/state.json.
//
// The floating companion (`sherman pet`, pet/sherman-pet.swift) is a viewer
// with no connection to the engine; everything it shows comes from this file,
// so everything written here must be a fact the shell actually observed. The
// shell reports status transitions and the label of the last completed tool —
// never message content, never vault content — and the pet renders exactly
// that.
//
// Writes are gated on the pet directory existing, which `sherman pet` creates
// on first launch: a machine that never adopted the pet gets zero writes, and
// tests running under a sandboxed HOME stay silent by construction. Every
// write is best-effort — a pet that misses a beat is a pet, not a defect, and
// no turn may fail because a status file could not be written.

import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DETAIL_MAX = 120;

function petDir(home) {
    return join(home ?? homedir(), '.sherman', 'pet');
}

/** Whether this machine has adopted the desktop pet. */
export function petAdopted({ home } = {}) {
    return existsSync(petDir(home));
}

/**
 * Report one status to the pet. Statuses the pet knows: idle, working, done,
 * failed, waiting, offline. Returns whether a write happened, for tests.
 */
export function writePetState(status, detail = '', { home, session = '' } = {}) {
    try {
        const dir = petDir(home);
        if (!existsSync(dir)) return false;
        const payload = JSON.stringify({
            status,
            detail: String(detail ?? '').replace(/\s+/g, ' ').trim().slice(0, DETAIL_MAX),
            terminal: process.env.TERM_PROGRAM ?? '',
            session: session || (process.env.SHERMAN_SESSION_ID ?? ''),
            updatedAt: Date.now(),
        });
        // Write-then-rename so the pet's poll never reads a half-written file.
        const tmp = join(dir, '.state.tmp');
        writeFileSync(tmp, payload);
        renameSync(tmp, join(dir, 'state.json'));
        return true;
    } catch {
        return false;
    }
}
