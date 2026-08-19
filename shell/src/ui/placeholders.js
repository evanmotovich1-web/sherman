// The composer's teaching placeholders.
//
// An empty composer used to show one static line forever. The reference
// rotates capability through that slot — `Try "explain this codebase"` — and
// it is the cheapest capability surface a shell has: the operator is already
// looking there, and the hint costs no rows.
//
// The house translation keeps one hard rule: every hint names something this
// install can actually do. The first-party command hints are backed by
// commands.js (smoke check 17 verifies the capability registry against that
// same table), and the skill hints are built from the LOADED skill list — an
// unreadable skill registry contributes nothing, exactly as the launch panel
// prints no count it could not verify. No hint is speculative.
//
// The default line leads the rotation, so frame zero — and every off-TTY or
// reduced-motion render — is byte-identical to the composer before rotation
// existed. Same move WHIMSY makes with 'starting'.

/** How often the idle hint turns over. Slow on purpose: the placeholder is a
 *  reading surface, not an animation, and a hint needs time to be read. */
export const HINT_INTERVAL_MS = 5000;

/** The resting line, unchanged since the composer existed. */
export const DEFAULT_HINT = 'Ask about company operations…';

// First-party teachings, in the order they earn their keep: the working verbs
// first, the memory pair, then session craft. Each names a command from
// commands.js verbatim and says what it does in the plain register.
const COMMAND_HINTS = Object.freeze([
    'try /plan <task> — a read-only planning pass',
    'try /goal <focus> — pin what this session is for',
    'try @<agent> <task> — route a specialist',
    'try /subagent <task> — an isolated worker turn',
    'try /models — engines and named keys already on this machine',
    '/learn <name> | <fact> teaches the vault',
    '/wiki captures this session for the company wiki',
    '/win shows what the last eval thought',
    '/compact shrinks a long session without losing the thread',
    '/pic pastes a clipboard image into the turn',
]);

/** How many loaded skills the rotation samples. More would starve the
 *  first-party hints of their share of a slow rotation. */
const SKILL_HINT_LIMIT = 4;

/**
 * The rotation, built from what is actually loaded.
 *
 * @param {{skills?: Array<{name?:string, summary?:string}>}} input
 * @returns {string[]} at least [DEFAULT_HINT]
 */
export function capabilityHints({ skills = [] } = {}) {
    const hints = [DEFAULT_HINT, ...COMMAND_HINTS];
    for (const skill of (Array.isArray(skills) ? skills : []).slice(0, SKILL_HINT_LIMIT)) {
        if (typeof skill?.name !== 'string' || skill.name === '') continue;
        const summary = typeof skill.summary === 'string' && skill.summary.trim() !== ''
            ? ` — ${skill.summary.trim()}`
            : '';
        hints.push(`try /${skill.name}${summary}`);
    }
    return hints;
}

/** The hint for a tick. Pure, so cadence and order pin without a mount. */
export function hintFor(hints, tick) {
    if (!Array.isArray(hints) || hints.length === 0) return DEFAULT_HINT;
    return hints[Math.max(0, tick) % hints.length];
}
