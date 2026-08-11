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

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DETAIL_MAX = 120;

// The exact option sets the pet binary knows (pet/sherman-pet.swift SIZES and
// COLORS). /customize validates against these so a typo is refused here, in
// the shell, instead of silently ignored by the pet.
export const PET_SIZES = Object.freeze(['small', 'medium', 'large', 'huge']);
export const PET_COLORS = Object.freeze(['pink', 'blue', 'green', 'purple', 'gray']);

function petDir(home) {
    return join(home ?? homedir(), '.sherman', 'pet');
}

/**
 * The terminal program hosting this shell, as robustly as the environment
 * allows. TERM_PROGRAM is the convention, but it does not survive every
 * multiplexer or launcher, so the terminal-specific env vars back it up —
 * a click on the pet is only as good as this answer.
 */
export function detectTerminal(env = process.env) {
    if (env.TERM_PROGRAM) return env.TERM_PROGRAM;
    if (env.GHOSTTY_RESOURCES_DIR || /ghostty/i.test(env.TERM ?? '')) return 'ghostty';
    if (env.WEZTERM_EXECUTABLE) return 'WezTerm';
    if (env.KITTY_PID) return 'kitty';
    if (env.ALACRITTY_WINDOW_ID) return 'Alacritty';
    if (env.ITERM_SESSION_ID) return 'iTerm.app';
    return '';
}

/** Whether this machine has adopted the desktop pet. */
export function petAdopted({ home } = {}) {
    return existsSync(petDir(home));
}

/**
 * /customize: read, change, and verify the pet's prefs.json.
 *
 * Accepts `size <value>`, `color <value>`, or a bare value whose key is
 * inferred from which option set it belongs to. Empty args reports the
 * current settings. Every change is claimed only after reading it back —
 * the same contract the launcher holds config writes to. Position (x/y) is
 * deliberately untouched: that belongs to dragging the pet itself.
 *
 * @returns {{ok: boolean, text: string}}
 */
export function customizePet(args = '', { home } = {}) {
    const dir = petDir(home);
    if (!existsSync(dir)) {
        return { ok: false, text: 'The desktop pet is not set up on this machine — run: sherman pet' };
    }
    const prefsPath = join(dir, 'prefs.json');
    let prefs = {};
    try {
        prefs = JSON.parse(readFileSync(prefsPath, 'utf8'));
        if (typeof prefs !== 'object' || prefs === null) prefs = {};
    } catch { prefs = {}; }
    const current = () =>
        `pet: ${prefs.size ?? 'medium'} · ${prefs.color ?? 'pink'}`;
    const usage =
        `/customize size <${PET_SIZES.join('|')}> · /customize color <${PET_COLORS.join('|')}>`;

    const words = String(args ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return { ok: true, text: `${current()}\n${usage}` };

    let key = null;
    let value = null;
    if (words.length === 1) {
        value = words[0];
        key = PET_SIZES.includes(value) ? 'size' : PET_COLORS.includes(value) ? 'color' : null;
    } else if (words.length === 2 && (words[0] === 'size' || words[0] === 'color')) {
        [key, value] = words;
    }
    if (key === 'size' && !PET_SIZES.includes(value)) key = null;
    if (key === 'color' && !PET_COLORS.includes(value)) key = null;
    if (!key) return { ok: false, text: `Unknown customization "${args.trim()}".\n${usage}` };

    prefs[key] = value;
    try {
        writeFileSync(prefsPath, JSON.stringify(prefs));
        const readBack = JSON.parse(readFileSync(prefsPath, 'utf8'));
        if (readBack?.[key] !== value) throw new Error('read-back mismatch');
    } catch {
        return { ok: false, text: `Could not write ${prefsPath} — nothing was changed.` };
    }
    return {
        ok: true,
        text: `pet ${key} ${value} (verified: read back from prefs.json) — a running pet applies it within a second`,
    };
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
            terminal: detectTerminal(),
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
