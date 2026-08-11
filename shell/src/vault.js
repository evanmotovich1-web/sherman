// Counts what the vault actually holds, for the launch screen.
//
// This module exists to keep one promise: every number on the launch panel is
// real. It reads the filesystem and reports what is there — it never estimates,
// caches a previous answer, or rounds a zero up to something friendlier.
//
// It lives in src/ rather than src/ui/ because it is data, not presentation.
// That is also what lets smoke exercise it without loading React.
//
// The shell is a READER of everything outside itself (see src/config.js). This
// module opens directories and nothing else.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * @typedef {Object} VaultStats
 * @property {number} wiki      shared wiki pages
 * @property {number} shared    shared memory facts
 * @property {number} private   this user's private memory facts
 * @property {number} inbox     items waiting in the inbox
 * @property {boolean} ok       false if the vault root itself could not be read
 */

/**
 * Markdown files directly inside `dir`, excluding scaffolding READMEs.
 *
 * Non-recursive on purpose. A launch-time walk of an arbitrarily deep tree is a
 * stall the user sees before the first frame, and the vault's knowledge lives
 * one level down by design (PROJECT.md's memory model).
 *
 * A missing or unreadable directory counts 0 rather than throwing. A vault with
 * no inbox yet is a normal state, not an error worth failing a launch over.
 */
function countMarkdown(dir) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return 0;
    }

    return entries.filter((entry) => {
        if (!entry.isFile()) return false;

        const name = entry.name.toLowerCase();
        if (!name.endsWith('.md')) return false;

        // READMEs are scaffolding, not knowledge. Counting them would print
        // "1 wiki page" over an empty vault, on a panel whose entire value is
        // that its numbers can be trusted.
        return name !== 'readme.md';
    }).length;
}

/** True if the path is a directory we can list. */
function readable(dir) {
    try {
        readdirSync(dir);
        return true;
    } catch {
        return false;
    }
}

/**
 * Read live counts from the vault.
 *
 * @param {{vaultPath: string, user: string}} params
 * @returns {VaultStats}
 */
export function readVaultStats({ vaultPath, user }) {
    // Distinguished from "everything is zero" so the panel can say the vault is
    // unreachable instead of quietly implying it is merely empty. Those are very
    // different problems and only one of them is expected.
    if (!vaultPath || !readable(vaultPath)) {
        return { wiki: 0, shared: 0, private: 0, inbox: 0, ok: false };
    }

    return {
        wiki: countMarkdown(join(vaultPath, 'wiki')),
        shared: countMarkdown(join(vaultPath, 'memory', 'shared')),
        // No user means no private scope to read — not an error, just nothing
        // to count. Joining an undefined segment would throw.
        private: user ? countMarkdown(join(vaultPath, 'memory', 'private', user)) : 0,
        inbox: countMarkdown(join(vaultPath, 'inbox')),
        // Shared-lane changes on THIS machine that `sherman sync` has not
        // published. Two machines disagreeing about the wiki count is this
        // number, and drift with no number gets discovered as confusion.
        unpublished: countUnpublished(vaultPath),
        ok: true,
    };
}

/**
 * Files changed in the shared vault lanes but not yet committed — what a
 * `sherman sync` on this machine would publish. Measured with git against the
 * lanes only; a vault outside any checkout, or a machine without git, reports
 * 0 rather than failing the panel.
 */
function countUnpublished(vaultPath) {
    try {
        const result = spawnSync(
            'git',
            ['-C', vaultPath, 'status', '--porcelain', '--', 'wiki', 'memory/shared', 'inbox'],
            { encoding: 'utf8', timeout: 3000 }
        );
        if (result.status !== 0 || typeof result.stdout !== 'string') return 0;
        return result.stdout.split('\n').filter(Boolean).length;
    } catch {
        return 0;
    }
}
