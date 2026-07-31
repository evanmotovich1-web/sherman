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

import { appendFileSync, mkdirSync } from 'node:fs';
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
