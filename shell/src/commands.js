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
        name: 'help',
        usage: '/help [command]',
        summary: 'show commands and exact behavior',
        detail: 'Lists first-party shell commands. Type // to send a literal slash-prefixed prompt.',
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
    return COMMANDS.filter((command) => command.name.startsWith(prefix)).slice(0, 6);
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
        'Up/down select · Tab completes · ctrl+c interrupts, again to exit · // sends a literal slash prompt',
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

// Compaction fires on the same number the status meter prints: the latest
// turn's reported input tokens over the model's known window. No estimate is
// involved on either side, so the shell never compacts on a guess -- an unknown
// window (no meter) simply never auto-compacts.
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
