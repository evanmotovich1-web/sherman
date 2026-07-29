// The session turn log: one JSONL line per turn side.
//
// Operational data, so it lives under ~/.sherman/sessions/ beside config and
// workspace — NEVER in the vault. The vault is company knowledge; what somebody
// typed on a Tuesday is not.
//
// The contract with the shell is one-way: the log may quietly stop existing
// (unwritable disk, missing home, permissions), but it may never crash a turn,
// block the UI, or print a single line of noise. One failure disables it for
// the rest of the session — a log that failed once and then spammed a retry
// error per turn would be worse than no log at all.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * @param {string} sessionId
 * @returns {{ append(role: string, text: string): void }}
 */
export function createSessionLog(sessionId) {
    const dir = join(homedir(), '.sherman', 'sessions');
    const file = join(dir, `${sessionId}.jsonl`);

    let dead = false;
    let prepared = false;

    return {
        /**
         * Where this session's turns are being written.
         *
         * Exposed because the evals read the log rather than the transcript:
         * the transcript is React state that dies with the process, and a judge
         * that graded a conversation from memory would be grading a summary of
         * itself. The path is returned even when logging has died, and the
         * reader is expected to fail honestly if the file is not there.
         */
        path: file,

        /** True once a write has failed; the log is off for the rest of the session. */
        get failed() { return dead; },

        append(role, text) {
            if (dead) return;
            try {
                if (!prepared) {
                    mkdirSync(dir, { recursive: true });
                    prepared = true;
                }
                appendFileSync(
                    file,
                    JSON.stringify({ role, at: new Date().toISOString(), text }) + '\n'
                );
            } catch {
                dead = true;
            }
        },
    };
}
