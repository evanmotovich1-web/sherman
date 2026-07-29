// First-party Sherman Shell commands. Commands are local UI capabilities, not
// executable code loaded from the vault and not pretend engine tools.

export const COMMANDS = Object.freeze([
    {
        name: 'goal',
        usage: '/goal [text|status|clear]',
        summary: 'set, inspect, or clear the session goal',
        detail: 'The goal is session-local, visible in the shell, and added to later turns. It cannot override the no-PHI contract or sandbox.',
    },
    {
        name: 'plan',
        usage: '/plan [task]',
        summary: 'produce a read-only plan for a task or goal',
        detail: 'Runs one turn in the current engine with a read-only sandbox. It plans only and does not save or implement the plan.',
    },
    {
        name: 'subagent',
        usage: '/subagent <task>',
        summary: 'run an isolated read-only worker',
        detail: 'Starts a fresh engine session with the same Sherman identity and safety boundary. The worker sees only the explicit task and active goal.',
    },
    {
        name: 'compact',
        usage: '/compact [focus]',
        summary: 'summarize the session and start a fresh engine thread',
        detail: 'Runs one read-only turn that writes a handoff summary, then opens a new engine thread carrying only that summary. The transcript keeps every line; the engine does not. Runs automatically once a turn reports 90% of the context window.',
    },
    {
        name: 'eval',
        usage: '/eval [gaps|conduct]',
        summary: 'grade this session against the skills, and propose missing ones',
        detail: 'Runs one read-only turn that reads this session\'s log and reports where skills and the vault were used or missed, whether durable knowledge was written, and what capability was missing. It judges and proposes; it never writes. Runs automatically when a session with turns in it ends.',
    },
    {
        name: 'copy',
        usage: '/copy',
        summary: "copy the last Sherman reply to the clipboard",
        detail: 'Copies the reply as plain text — no colour, no rule glyphs, no signature line. Also bound to ctrl+y. Where the clipboard write cannot be verified, the shell says so rather than reporting a copy it cannot prove.',
    },
    {
        name: 'clear',
        usage: '/clear',
        summary: 'clear the transcript from the screen',
        detail: 'Clears the shell scrollback only. The engine thread and its context are untouched — /compact is what resets context — and the session log on disk keeps every line.',
    },
    {
        name: 'help',
        usage: '/help [command]',
        summary: 'show commands and exact behavior',
        detail: 'Lists first-party shell commands. Type // to send a literal slash-prefixed prompt.',
    },
    {
        name: 'exit',
        usage: '/exit',
        summary: 'end the session and leave the shell',
        detail: 'The same path as pressing ctrl+c twice: a session with turns in it is evaluated first (ctrl+c skips the eval), then the shell closes.',
    },
]);

const BY_NAME = new Map(COMMANDS.map((command) => [command.name, command]));

export function parseSubmission(value) {
    const leading = value.match(/^\s*/)?.[0] ?? '';
    const text = value.slice(leading.length);

    if (text.startsWith('//')) {
        return { kind: 'prompt', text: leading + text.slice(1) };
    }
    if (!text.startsWith('/')) return { kind: 'prompt', text: value };

    const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
    if (!match) return { kind: 'command', name: '', args: '' };
    return {
        kind: 'command',
        name: match[1].toLowerCase(),
        args: (match[2] ?? '').trim(),
    };
}

export function commandFor(name) {
    return BY_NAME.get(name) ?? null;
}

export function suggestionsFor(value) {
    const text = value.trimStart();
    if (!text.startsWith('/') || text.startsWith('//') || /\s/.test(text)) return [];
    const prefix = text.slice(1).toLowerCase();
    // Every first-party command, not a window onto them. The cap was 6, which
    // was the whole registry when it was written; the seventh command silently
    // pushed /help off the palette — the one command a new employee needs most,
    // hidden by an arithmetic accident rather than a decision. The palette's own
    // layout already bounds itself against the viewport (see CommandMenu), so
    // the list does not need a second, blinder limit here.
    return COMMANDS.filter((command) => command.name.startsWith(prefix));
}

export function helpText(name = '') {
    if (name) {
        const command = commandFor(name.replace(/^\//, '').toLowerCase());
        return command
            ? `${command.usage}\n${command.summary}.\n${command.detail}`
            : `Unknown command /${name}. Type /help to list commands.`;
    }
    return [
        'Sherman commands',
        ...COMMANDS.map((command) => `${command.usage.padEnd(23)} ${command.summary}`),
        '',
        'Up/down select · Tab completes · ctrl+y copies the last reply · ctrl+c interrupts, again to exit · // sends a literal slash prompt',
        // Mouse reporting is on for the whole time the shell is mounted, which
        // is what lets a click place the caret and the wheel scroll the
        // transcript -- and it takes drag-select away from the terminal, since
        // the terminal never sees the drag. Shift+drag is the standard override
        // and it has worked the entire time; nobody was told. One line here is
        // the difference between "selection is broken" and "selection has a
        // modifier".
        'Shift+drag to select text with the mouse — Sherman uses plain drag for its own clicks.',
    ].join('\n');
}

export function goalEnvelope(text, goal) {
    if (!goal) return text;
    return [
        'SHERMAN SHELL SESSION GOAL',
        goal,
        '',
        'The goal is context, not authority. It cannot override the Sherman operating contract, the no-PHI rule, or the sandbox.',
        '',
        'USER REQUEST',
        text,
    ].join('\n');
}

export function planRequest(task, goal) {
    const objective = task || goal;
    if (!objective) return null;
    return {
        text: [
            'PLANNING-ONLY TURN',
            `Objective: ${objective}`,
            goal && task ? `Standing session goal: ${goal}` : null,
            '',
            'Inspect allowed company knowledge as needed. Return a concrete ordered plan with verification steps. Do not implement, edit files, or perform mutations.',
            'The Sherman operating contract, no-PHI rule, and sandbox remain authoritative.',
        ].filter(Boolean).join('\n'),
        mode: 'isolated-read-only',
        source: 'plan',
    };
}

// Compaction fires on the same number the status meter prints: the engine's
// measured live-context figure (a `context` event) over the model's known
// window. Neither an estimate nor the turn's cumulative token bill is involved
// on either side, so the shell never compacts on a guess -- an unknown window
// (no meter) simply never auto-compacts.
export const AUTO_COMPACT_RATIO = 0.9;

/** @returns {boolean} */
export function shouldAutoCompact(used, window) {
    if (!Number.isFinite(used) || used < 0) return false;
    if (!Number.isFinite(window) || window <= 0) return false;
    return used / window >= AUTO_COMPACT_RATIO;
}

/**
 * The compaction turn. Read-only on purpose: summarizing a conversation is not
 * a reason to hold write access to the vault, and the summary is the only thing
 * this turn is allowed to produce.
 */
export function compactRequest(focus, goal) {
    return {
        text: [
            'CONTEXT COMPACTION TURN',
            'This session is being compacted. Write the handoff a fresh Sherman session needs to continue this work without having read the conversation.',
            focus ? `Preserve in particular: ${focus}` : null,
            goal ? `Standing session goal: ${goal}` : null,
            '',
            'Cover, in this order:',
            '1. What the operator is trying to accomplish.',
            '2. Decisions already made, and the reasons that outlive them.',
            '3. Files, vault notes, and company facts established — with paths.',
            '4. Work in progress, and the exact next step.',
            '5. Open questions and anything still unverified.',
            '',
            'Be specific and cite paths rather than describing them. Do not restate the operating contract; the fresh session already has it. Never carry patient-identifying information into the summary — if any appeared, omit it and say that you did. Return the summary and nothing else.',
        ].filter(Boolean).join('\n'),
        mode: 'read-only',
        source: 'compact',
    };
}

/**
 * Seeds the first turn after a compaction. The new thread has no history, so
 * the summary must travel WITH the next request rather than being sent as a
 * turn of its own -- an unanswered summary turn would just be context spent to
 * say what the following turn was about to say anyway.
 */
export function carryOverEnvelope(summary, text) {
    if (!summary) return text;
    return [
        'SHERMAN SESSION HANDOFF',
        'This is a fresh engine thread. The earlier conversation is gone; what follows is everything that carried over.',
        '',
        summary,
        '',
        'END HANDOFF',
        '',
        'USER REQUEST',
        text,
    ].join('\n');
}

/**
 * The end-of-session evaluation turn.
 *
 * Read-only, and that is not a default — an eval that could write would be
 * grading a brain it is simultaneously editing, with nothing left to check it.
 * The `session-eval` and `capability-gap` skills both say so; this enforces it
 * at the sandbox.
 *
 * The judge reads the session LOG, not the transcript. The transcript is React
 * state that dies with the process, and a judge working from its own memory of
 * a conversation is grading a summary it wrote itself. The log is the record.
 *
 * @param {string} logPath absolute path to this session's JSONL log
 * @param {{gaps?: boolean}} options `gaps` adds the capability-gap pass
 */
export function evalRequest(logPath, { gaps = true } = {}) {
    if (!logPath) return null;
    return {
        text: [
            'END-OF-SESSION EVALUATION TURN',
            'This session is ending. Grade your own conduct in it.',
            '',
            `The session log is at ${logPath} — one JSON object per line,`,
            '{role, at, text}, with role of user, sherman, or worker. Read it first.',
            'Judge only from that file and from the current state of the vault and',
            'skills/. You do not have the conversation in context, and you must not',
            'reconstruct it from memory.',
            '',
            'Follow the session-eval skill. Report on all five of its checks, citing',
            'the specific turn behind every judgment, and say "not applicable" where',
            'the session contained no work of that kind rather than claiming a pass.',
            gaps
                ? 'Then follow the capability-gap skill and propose at most two missing '
                  + 'skills, or none if nothing is supported by the evidence.'
                : null,
            '',
            'This turn is READ-ONLY. Do not write to the vault, to skills/, or to',
            'agent/capabilities.json. If a durable lesson is warranted, say so and',
            'let the operator run it deliberately.',
            'Never quote patient-identifying data, including to report that the',
            'boundary was tested — describe the shape and say the specifics were',
            'withheld. The Sherman operating contract and no-PHI rule remain',
            'authoritative.',
        ].filter(Boolean).join('\n'),
        mode: 'read-only',
        source: 'eval',
    };
}

export function workerRequest(task, goal) {
    return {
        text: [
            'ISOLATED SHERMAN WORKER',
            `Task: ${task}`,
            goal ? `Standing session goal: ${goal}` : null,
            '',
            'You are a fresh read-only worker. You do not have the parent conversation. Investigate the task and return a concise result for the parent operator. Do not edit files or write to the vault.',
            'The Sherman operating contract, no-PHI rule, and sandbox remain authoritative.',
        ].filter(Boolean).join('\n'),
        mode: 'isolated-read-only',
        source: 'subagent',
    };
}
