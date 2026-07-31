// Where eval verdicts survive the session.
//
// The transcript is React state that dies with the process, and the session
// log buries verdicts among every other turn. A verdict that cannot be found
// later cannot show a trend — and the whole point of grading every session is
// the trend. So each verdict is ALSO appended here, one Markdown file per
// session under ~/.sherman/evals/, beside sessions/ and config. Operational
// data, never the vault: how a Tuesday's session was graded is not company
// knowledge.
//
// Same contract as sessionlog.js: persistence may quietly fail (unwritable
// disk, missing home), but it may never crash a turn or print noise — the
// verdict still reached the transcript and the session log, which are the
// primary record.

import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function evalsDir(home = homedir()) {
    return join(home, '.sherman', 'evals');
}

/**
 * Append one verdict to the session's eval file.
 *
 * @param {string} sessionId
 * @param {string} kind 'exit eval' | 'checkpoint eval' | 'requested eval'
 * @param {string} text the verdict as the judge wrote it
 * @returns {boolean} whether the write landed — callers may not claim more
 */
export function appendEvalReport(sessionId, kind, text, { home = homedir() } = {}) {
    if (!sessionId || typeof text !== 'string' || !text.trim()) return false;
    try {
        const dir = evalsDir(home);
        mkdirSync(dir, { recursive: true });
        appendFileSync(
            join(dir, `${sessionId}.md`),
            `\n## ${kind} · ${new Date().toISOString()}\n\n${text.trim()}\n`
        );
        return true;
    } catch {
        return false;
    }
}

/**
 * Sessions that ended without a verdict, newest first.
 *
 * This is the catch-up eval's worklist: the loop's promise is a verdict for
 * EVERY session, and the sessions that break it are the ones that never got
 * to say goodbye — a closed window, a kill, a crash. Their logs survive under
 * ~/.sherman/sessions/; what marks them ungraded is the absence of the eval
 * file appendEvalReport would have written.
 *
 * Three exclusions keep this honest rather than eager:
 * - `exclude` (the calling session) — it is live and will be graded on exit;
 * - logs still being written (`staleMs` of quiet required) — a parallel shell
 *   MUST not have its session graded out from under it mid-conversation;
 * - logs with no `sherman` turn — a launch-and-quit has no conduct to judge,
 *   and the exit eval already refuses those (same contract, applied late).
 *
 * The role probe is a substring match against the exact line shape
 * sessionlog.js writes (`JSON.stringify({role, at, text})`, role first); it
 * reads that file's contract, not a guess about JSON in general.
 *
 * Same quiet-failure contract as everything else here: an unreadable
 * directory or file contributes nothing and never throws.
 */
export function ungradedSessions({ home = homedir(), exclude = null, staleMs = 30 * 60_000, now = Date.now() } = {}) {
    let graded;
    try {
        graded = new Set(
            readdirSync(evalsDir(home))
                .filter((name) => name.endsWith('.md'))
                .map((name) => name.slice(0, -'.md'.length))
        );
    } catch {
        graded = new Set();
    }

    const dir = join(home, '.sherman', 'sessions');
    let names;
    try {
        names = readdirSync(dir).filter((name) => name.endsWith('.jsonl'));
    } catch {
        return [];
    }

    const out = [];
    // Session ids lead with their timestamp, so the lexicographic sort IS the
    // chronological one; reversed, the newest unfinished business comes first.
    for (const name of names.sort().reverse()) {
        const id = name.slice(0, -'.jsonl'.length);
        if (id === exclude || graded.has(id)) continue;
        const path = join(dir, name);
        try {
            if (now - statSync(path).mtimeMs < staleMs) continue;
            if (!readFileSync(path, 'utf8').includes('"role":"sherman"')) continue;
        } catch {
            continue;
        }
        out.push({ id, path });
    }
    return out;
}
