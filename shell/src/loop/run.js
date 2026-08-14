// The self-direction loop core.
//
// One iteration is two sends on one engine session, both in the NORMAL
// posture — the loop is a scheduler over existing machinery and adds zero new
// privilege. The PICK turn reads the direction layer and answers with a JSON
// pick; the shell logs that pick to the audit trail BEFORE the EXECUTE turn
// runs, so the choice is on record even if execution goes sideways. The
// EXECUTE turn does the work in-sandbox and may end with direction operations,
// which apply only through the validated direction layer.
//
// Halting is deliberate and layered: a STOP file (~/.sherman/loop/STOP) is
// checked between the pick and the execute and again between iterations; two
// consecutive failed iterations halt the loop rather than let it thrash; and
// the iteration count is clamped to 1..10 per invocation. The gates the rest
// of Sherman lives behind — merge, money, external sends, sandbox — are not
// re-implemented here because nothing here touches them: the engine posture
// args, the money engine, and the vault writer are all reached through the
// same code paths an interactive session uses.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { selectBackend } from '../engine/index.js';
import { readDirection, applyDirectionOperations, appendLoopLog } from './direction.js';

const DEFAULT_ITERATIONS = 3;
const MAX_ITERATIONS = 10;
const TURN_TIMEOUT_MS = 20 * 60 * 1000;

export function stopPath(home = homedir()) {
    return join(home, '.sherman', 'loop', 'STOP');
}

/** The last {...} block in the model's final message, or null. */
function trailingJson(text) {
    if (typeof text !== 'string') return null;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * Drive one send to completion and return the final message text.
 * A turn that exceeds the wall-clock cap is interrupted (when the backend
 * supports it) and reported as a failure, not left to wedge the loop.
 */
async function completeTurn(session, request, timeoutMs) {
    let timer;
    const timeout = new Promise((_, rejectPromise) => {
        timer = setTimeout(() => {
            session.interrupt?.();
            rejectPromise(new Error('turn exceeded the wall-clock cap'));
        }, timeoutMs);
        timer.unref?.();
    });
    const run = (async () => {
        let message = null;
        let error = null;
        for await (const event of session.send(request)) {
            if (event.kind === 'message') message = event.text;
            if (event.kind === 'error') error = event.message;
        }
        if (error && message === null) throw new Error(error);
        return message;
    })();
    try {
        return await Promise.race([run, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

function pickPrompt(direction) {
    const bootstrap = !direction.goals;
    const layer = [
        `goals.md:\n${direction.goals ?? '(missing)'}`,
        ...direction.threads.map((t) => `${t.name}:\n${t.content}`),
        `log.md (audit, read-only):\n${direction.log ?? '(empty)'}`,
    ].join('\n---\n');
    return [
        'SELF-DIRECTION PICK TURN. Read your direction layer below and choose the single highest-value next task.',
        bootstrap
            ? 'The direction layer has no goals yet, so the pick IS the bootstrap: draft goals.md — 3 to 7 ranked standing goals grounded in the vault, the session logs, and the repository state. Never remove or reword lines marked [operator].'
            : 'Choose from the goals and open threads. Prefer unblocking an open thread over starting a new one.',
        'Reply with ONLY a JSON object: {"pick": "<one task, one sentence>", "why": "<one sentence>"} — no prose around it.',
        '',
        '=== DIRECTION LAYER ===',
        layer,
    ].join('\n');
}

function execPrompt(pick) {
    return [
        `SELF-DIRECTION EXECUTE TURN. Execute exactly this pick, nothing else: ${pick}`,
        'Standing contract, unchanged: reversible work only. Code changes go to a branch and a pull request after a green ./smoke.sh — never a merge, never a push to main. No spends outside the money engine, no external sends, no PHI, no sandbox bypass.',
        'End your final message with ONLY a JSON object: {"outcome": "<one sentence on what happened>", "direction": {"operations": [{"path": "goals.md|thread-<slug>.md", "content": "..."}]}} — operations may be an empty array; log.md is shell-owned and will be rejected.',
    ].join('\n');
}

/**
 * @param {object} opts
 * @param {{vaultPath: string}} opts.config full Sherman config (fake-able in tests)
 * @param {number} [opts.iterations]
 * @param {(config: object) => object} [opts.makeSession]
 * @param {string} [opts.home]
 * @param {number} [opts.turnTimeoutMs]
 * @param {(line: string) => void} [opts.onProgress]
 * @returns {Promise<{completed: number, halted: null|'stop'|'failures', results: Array<{pick: string|null, ok: boolean, detail: string}>}>}
 */
export async function runLoop({
    config,
    iterations = DEFAULT_ITERATIONS,
    makeSession = selectBackend,
    home = homedir(),
    turnTimeoutMs = TURN_TIMEOUT_MS,
    onProgress = () => {},
} = {}) {
    const count = Math.max(1, Math.min(MAX_ITERATIONS, Number.isInteger(iterations) ? iterations : DEFAULT_ITERATIONS));
    const vaultPath = config.vaultPath;
    const session = makeSession(config);
    const results = [];
    let completed = 0;
    let consecutiveFailures = 0;

    const fail = (pick, detail) => {
        results.push({ pick, ok: false, detail });
        appendLoopLog({ vaultPath, line: `failed: ${detail}` });
        onProgress(`failed: ${detail}`);
        consecutiveFailures += 1;
    };

    for (let iteration = 1; iteration <= count; iteration++) {
        if (existsSync(stopPath(home))) return { completed, halted: 'stop', results };

        let pick = null;
        try {
            const pickText = await completeTurn(
                session,
                { text: pickPrompt(readDirection(vaultPath)), mode: 'normal', source: 'loop-pick' },
                turnTimeoutMs
            );
            const parsed = trailingJson(pickText);
            if (!parsed || typeof parsed.pick !== 'string' || !parsed.pick.trim()) {
                fail(null, `iteration ${iteration} returned no parsable pick`);
                if (consecutiveFailures >= 2) return { completed, halted: 'failures', results };
                continue;
            }
            pick = parsed.pick.trim();
            appendLoopLog({
                vaultPath,
                line: `iteration ${iteration} pick: ${pick} — ${typeof parsed.why === 'string' ? parsed.why : ''}`,
            });
            onProgress(`pick: ${pick}`);
        } catch (error) {
            fail(null, `iteration ${iteration} pick turn: ${error?.message ?? error}`);
            if (consecutiveFailures >= 2) return { completed, halted: 'failures', results };
            continue;
        }

        if (existsSync(stopPath(home))) return { completed, halted: 'stop', results };

        try {
            const execText = await completeTurn(
                session,
                { text: execPrompt(pick), mode: 'normal', source: 'loop-exec' },
                turnTimeoutMs
            );
            const parsed = trailingJson(execText);
            if (!parsed || typeof parsed.outcome !== 'string') {
                fail(pick, `iteration ${iteration} returned no parsable outcome`);
                if (consecutiveFailures >= 2) return { completed, halted: 'failures', results };
                continue;
            }
            const { applied, rejected } = applyDirectionOperations({
                vaultPath,
                operations: parsed.direction?.operations,
            });
            const detail = [
                parsed.outcome.trim(),
                applied.length ? `direction: ${applied.join(', ')}` : '',
                rejected.length ? `rejected: ${rejected.map((r) => `${r.path} (${r.reason})`).join('; ')}` : '',
            ].filter(Boolean).join(' · ');
            appendLoopLog({ vaultPath, line: `iteration ${iteration} outcome: ${detail}` });
            onProgress(`outcome: ${detail}`);
            results.push({ pick, ok: true, detail });
            completed += 1;
            consecutiveFailures = 0;
        } catch (error) {
            fail(pick, `iteration ${iteration} execute turn: ${error?.message ?? error}`);
            if (consecutiveFailures >= 2) return { completed, halted: 'failures', results };
        }
    }
    return { completed, halted: null, results };
}
