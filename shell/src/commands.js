// First-party Sherman Shell commands. Commands are local UI capabilities, not
// executable code loaded from the vault and not pretend engine tools.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

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
        detail: 'Runs one read-only turn that reads this session\'s log and reports where skills, workers, and the vault were used or missed, whether durable knowledge was written, and what capability was missing. It judges and proposes; it never writes to the vault. The shell saves each verdict to ~/.sherman/evals/ so trends survive the session. Runs automatically when a session with turns in it ends, and as a background checkpoint every 10 minutes while a session with new turns is live.',
    },
    {
        name: 'email',
        usage: '/email <who to write and what to say>',
        summary: 'learn your email voice, draft, and open it in Chrome ready to send',
        detail: 'Uses read-only browser/computer tools to inspect your Sent mail for writing patterns, then inspects all available correspondence with the recipient. If there is no prior thread, Sherman asks one tone question in a multiple-choice box. It opens Gmail in Google Chrome with recipient, subject, and body filled in. Sherman never sends mail — you review and press Send. The no-PHI rule applies to drafts and mailbox reading.',
    },
    {
        name: 'win',
        usage: '/win',
        summary: 'judge every recorded session and open a report page about how you work',
        detail: 'Reads every session log in ~/.sherman/sessions/, every saved eval verdict in ~/.sherman/evals/, and anything you drop in ~/.sherman/win-sources/ (exports from other tools — a ChatGPT data export, notes). One isolated read-only worker judges what is going right and wrong — vault use, skills reached for unprompted, delegation, honest limits — then the shell writes a local HTML report under ~/.sherman/win/ and opens it in your browser. The page is a local file; nothing leaves the machine.',
    },
    {
        name: 'wiki',
        usage: '/wiki',
        summary: "capture this session's durable learnings into your LLM Wiki",
        detail: 'Runs one turn that reads this session\'s log and folds what is worth keeping — research findings, decisions and their reasons, techniques — into your personal LLM Wiki through its MCP server (installed at ~/.sherman/llmwiki, workspace at ~/.sherman/research). Company facts still belong in the vault; the wiki is your research memory. Runs automatically when a session with turns ends, after the eval. If the wiki is not installed the command says so and does nothing.',
    },
    {
        name: 'connectors',
        usage: '/connectors',
        summary: 'show what Sherman is connected to, and what is one key away',
        detail: 'A local read of the committed catalog (agent/connectors.json) and this machine\'s enablement file (~/.sherman/connectors.json). Prints secret NAMES and never values. Three headings — Connected, Needs a key, Available — and an empty one is omitted rather than printed. Changes take effect on the next launch, because the launcher is what renders engine config. Ask /0-1 to add a connector for you.',
    },
    {
        name: 'copy',
        usage: '/copy',
        summary: "copy the last Sherman reply to the clipboard",
        detail: 'Copies the reply as plain text — no colour, no rule glyphs, no signature line. Also bound to ctrl+y. Where the clipboard write cannot be verified, the shell says so rather than reporting a copy it cannot prove. To copy anything else, use Shift+drag or type /select to enter terminal selection mode.',
    },
    {
        name: 'select',
        usage: '/select',
        summary: 'toggle terminal text selection mode',
        detail: 'Selection mode temporarily releases Sherman mouse capture so ordinary drag and your terminal copy shortcut work. Wheel scrolling pauses while selection mode is active. Type /select again to restore Sherman wheel scrolling.',
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

/** Route clear imperative prose into the first-party email workflow. */
export function naturalEmailInstruction(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    const match = text.match(/^(?:please\s+)?(?:write|draft|compose)\s+(.+)$/i);
    if (!match) return null;
    const target = match[1];
    const artifact = /\b(?:parser|template|component|validation|regex|function|script|code|client|sender|service|class|method|test|schema)\b/i;
    const direct = target.match(/^(?:an?|the)\s+e-?mail(?:\s+([\s\S]+))?$/i);
    if (direct) return artifact.test(direct[1] ?? '') ? null : text;

    const personFirst = target.match(/^(.+)\s+(?:an?|the)\s+e-?mail(?:$|\s+(?:to|for|saying|about|asking|requesting|that|thanking|confirming|reminding|letting|telling|following|congratulating|inviting|notifying)\b)/i);
    return personFirst && !artifact.test(personFirst[1]) ? text : null;
}

export function commandFor(name) {
    return BY_NAME.get(name) ?? null;
}

export function suggestionsFor(value, skills = []) {
    const text = value.trimStart();
    if (!text.startsWith('/') || text.startsWith('//') || /\s/.test(text)) return [];
    const prefix = text.slice(1).toLowerCase();
    // Every first-party command, not a window onto them. The cap was 6, which
    // was the whole registry when it was written; the seventh command silently
    // pushed /help off the palette — the one command a new employee needs most,
    // hidden by an arithmetic accident rather than a decision. The palette's own
    // layout already bounds itself against the viewport (see CommandMenu), so
    // the list does not need a second, blinder limit here.
    //
    // Skills ride the same palette AFTER the commands — the first-party
    // registry is small and fixed, the skill list grows with the product — and
    // each carries `kind: 'skill'` so the menu can ink them as the different
    // contract they are. The caller passes the skill rows in (from the launch
    // registry) rather than this module reading the repo itself, which keeps
    // this file pure and the existing single-argument behavior untouched.
    return [
        ...COMMANDS.filter((command) => command.name.startsWith(prefix)),
        ...skills
            .filter((skill) => skill.name.startsWith(prefix))
            .map((skill) => ({
                name: skill.name,
                usage: `/${skill.name}`,
                summary: skill.summary,
                kind: 'skill',
            })),
    ];
}

/**
 * The skill the composer's current value names, or null.
 *
 * A value names a skill when it is a slash invocation (`/name` or
 * `/name args…`, not the `//` literal escape) whose first token matches a
 * loaded skill exactly. Prefixes do not count — half a name is a search, not
 * an invocation — and first-party commands are not checked here because they
 * are not skills. This is what the composer keys the purple ink on.
 */
export function typedSkillName(value, skills) {
    const text = String(value ?? '').trimStart();
    if (!text.startsWith('/') || text.startsWith('//')) return null;
    const name = text.slice(1).split(/\s/, 1)[0].toLowerCase();
    if (!name) return null;
    return skills.some((skill) => skill.name === name) ? name : null;
}

/**
 * The engine turn for a slash-invoked skill. A plain prompt string on
 * purpose: skills are allowed to do what their SKILL.md says (including
 * writing where it directs), so the turn rides the normal path with the
 * normal sandbox, and the goal envelope wraps it exactly like typed prose.
 */
export function skillTurn(name, args) {
    return [
        'SKILL TURN',
        `The operator invoked your company skill "${name}" directly. Read skills/${name}/SKILL.md from your workspace skill set and follow it, including anything it says about where output belongs.`,
        args ? `Request: ${args}` : 'No arguments were given — use the available context and the skill\'s default entry behavior. Ask one focused question only if no actionable outcome can be inferred.',
        'Run autonomously by default: inspect the available evidence, resolve routine choices with reasonable defaults, and complete the skill end to end. Treat questions, menus, review gates, and approval checkpoints in the skill as internal decision material unless the operator explicitly asked for an interactive flow.',
        'The Sherman operating contract and no-PHI rule remain authoritative.',
    ].filter(Boolean).join('\n');
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
        'Up/down select · Tab completes · wheel scrolls history · ctrl+y copies the last reply · Shift+drag selects text · ctrl+c interrupts, again to exit · // sends a literal slash prompt',
        'If Shift+drag does not select in your terminal, type /select, drag and copy normally, then type /select again to restore wheel scrolling. SHERMAN_MOUSE=0 disables capture from launch.',
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
 * @param {string} logPath absolute path to the session's JSONL log
 * @param {{gaps?: boolean, closed?: boolean}} options `gaps` adds the
 *   capability-gap pass; `closed` frames the judgment as a catch-up over a
 *   PAST session whose shell died without an exit eval — the judge is not
 *   inside that session and must not speak as though it were. Everything else
 *   (the evidence, the skills, the read-only contract) is identical, because
 *   the log file is the whole truth either way.
 */
export function evalRequest(logPath, { gaps = true, closed = false } = {}) {
    if (!logPath) return null;
    return {
        text: [
            closed ? 'POST-SESSION EVALUATION TURN' : 'END-OF-SESSION EVALUATION TURN',
            closed
                ? 'A previous session ended without being graded — its shell closed without an exit. Its log is the complete record; grade the conduct Sherman showed in it.'
                : 'This session is ending. Grade your own conduct in it.',
            '',
            `The session log is at ${logPath} — one JSON object per line,`,
            '{role, at, text}, with role of user, sherman, or worker. Read it first.',
            'Judge only from that file and from the current state of the vault and',
            'skills/. You do not have the conversation in context, and you must not',
            'reconstruct it from memory.',
            '',
            'Follow the session-eval skill. Report on all six of its checks, citing',
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

/**
 * The meta-eval turn: the judge gets judged.
 *
 * An eval whose quality nobody measures decays into confident noise — the
 * Karpathy loop for graders: every eval verdict is itself graded, by a
 * separate turn, against the contract the eval was supposed to follow. The
 * meta-judge reads the VERDICT (inlined below, so a judge cannot be graded on
 * a report it can quietly rewrite) and spot-checks its citations against the
 * same session log.
 *
 * Read-only for the same reason the eval is: a grader with a pen edits the
 * thing it grades. Its verdict rides the same eval store, and the pair —
 * recommendation plus the grade of the recommender — is what the shell files
 * into the vault inbox for review.
 *
 * @param {string} evalText the eval verdict under review, verbatim
 * @param {string|null} logPath the session log that eval graded, for citation spot-checks
 */
export function metaEvalRequest(evalText, logPath = null) {
    if (typeof evalText !== 'string' || !evalText.trim()) return null;
    return {
        text: [
            'META-EVALUATION TURN — grade the eval, not the session.',
            'A session eval just ran. Its full verdict is inlined below. Judge that',
            'VERDICT against the meta-eval skill: read the skill, report on each of',
            'its checks, and cite the specific line of the verdict behind every',
            'judgment.',
            '',
            logPath
                ? `The session log the eval graded is at ${logPath} — consult it only to spot-check the verdict's citations, never to re-grade the session yourself.`
                : null,
            '',
            'THE VERDICT UNDER REVIEW:',
            '--- verdict begins ---',
            evalText.trim(),
            '--- verdict ends ---',
            '',
            'End your report with exactly two lines:',
            'GRADE: one of A, B, C, D, F',
            'NEXT: the single change that would most improve the next eval, or "none"',
            '',
            'This turn is READ-ONLY. Do not write to the vault, to skills/, or to',
            'agent/capabilities.json — filing the result is the shell\'s job, not',
            'yours. Never quote patient-identifying data, even if the verdict under',
            'review did; describe the shape and say the specifics were withheld.',
            'The Sherman operating contract and no-PHI rule remain authoritative.',
        ].filter(Boolean).join('\n'),
        mode: 'read-only',
        source: 'meta-eval',
    };
}

/**
 * Whether the LLM Wiki is installed on this machine.
 *
 * The probe is the CLI entry point install.sh provisions plus the venv
 * interpreter the MCP entry runs under — presence of both is what "installed"
 * means, and either alone is a broken install the shell must not build a
 * capture turn on. Checked once at mount (see app.js): an install appearing
 * mid-session is picked up at the next launch, the same contract as skills.
 */
export function wikiAvailable({ home = homedir() } = {}) {
    const dir = join(home, '.sherman', 'llmwiki');
    return (
        existsSync(join(dir, 'llmwiki'))
        && (existsSync(join(dir, '.venv', 'bin', 'python'))
            || existsSync(join(dir, '.venv', 'Scripts', 'python.exe')))
    );
}

/**
 * Why a wiki capture would fail, found BEFORE the turn is spent finding it.
 *
 * The mute version of this failure shipped first: /wiki ran a full engine
 * turn whose entire result was the model saying the MCP tools were not
 * reachable — one line, no cause, nothing the operator could act on. Every
 * cause is checkable from the shell in milliseconds, so this checks them in
 * order and names the first broken thing with its fix in the same sentence:
 *
 *   1. the install (CLI entry + venv interpreter — wikiAvailable's probe),
 *   2. the runtime (the interpreter actually runs the CLI; a venv whose
 *      python exists but whose packages are broken dies here, which is
 *      invisible to an existence check),
 *   3. the registration, for the engine that needs one: codex reads
 *      [mcp_servers.llmwiki] from its own config.toml, and a launch that
 *      failed to append it leaves every codex turn wiki-blind. Claude Code
 *      reads .mcp.json, which the launcher rewrites in the workspace every
 *      launch, so there is nothing stale to check for it.
 *
 * @returns {{ok: boolean, reason: string|null}} reason names the fix.
 */
export function wikiPreflight({
    home = homedir(),
    engine = null,
    run = spawnSync,
    env = process.env,
} = {}) {
    const dir = join(home, '.sherman', 'llmwiki');
    const cli = join(dir, 'llmwiki');
    const python = [
        join(dir, '.venv', 'bin', 'python'),
        join(dir, '.venv', 'Scripts', 'python.exe'),
    ].find((candidate) => existsSync(candidate));
    if (!existsSync(cli) || !python) {
        return {
            ok: false,
            reason: 'the LLM Wiki is not installed on this machine — re-run install.sh to provision it',
        };
    }

    try {
        const probe = run(python, [cli, '--help'], { timeout: 10000, encoding: 'utf8' });
        if (!probe || probe.error || probe.status !== 0) {
            const evidence = probe?.error
                ? `${probe.error.code ?? 'failed to start'}`
                : `exited ${probe?.status ?? 'abnormally'}`;
            const stderrLine = String(probe?.stderr ?? '').split('\n', 1)[0].trim();
            return {
                ok: false,
                reason: `the wiki's own runtime is broken (python ${evidence}`
                    + `${stderrLine ? `: ${stderrLine}` : ''}) — re-run install.sh to repair it`,
            };
        }
    } catch (error) {
        return {
            ok: false,
            reason: `the wiki's own runtime is broken (python ${error?.code ?? 'failed to start'}) — re-run install.sh to repair it`,
        };
    }

    if (engine === 'codex') {
        const configPath = join(env.CODEX_HOME || join(home, '.codex'), 'config.toml');
        let config = '';
        try {
            config = readFileSync(configPath, 'utf8');
        } catch {
            // Unreadable and absent report the same way: not registered.
        }
        if (!/^\s*\[mcp_servers\.llmwiki\]/m.test(config)) {
            return {
                ok: false,
                reason: `the LLM Wiki MCP is not registered in ${configPath} — relaunch sherman to register it`,
            };
        }
    }

    return { ok: true, reason: null };
}

/**
 * The wiki-capture turn: the session's durable learnings, folded into the
 * personal LLM Wiki over MCP.
 *
 * Deliberately a SEPARATE turn from the eval, not a clause in it. The eval is
 * read-only because a judge that writes is grading a brain it is editing —
 * that contract stays intact, and the capture runs after it in the exit
 * sequence. This turn is the mirror image: it records and does not judge,
 * and its one write surface is the wiki's own MCP tools.
 */
export function wikiCaptureRequest(logPath, goal) {
    if (!logPath) return null;
    return {
        text: [
            'WIKI CAPTURE TURN',
            'This session is ending. Preserve what it learned.',
            '',
            `The session log is at ${logPath} — one JSON object per line,`,
            '{role, at, text}, with role of user, sherman, or worker. Read it,',
            'then fold the session\'s durable learnings into the personal LLM',
            'Wiki using the llmwiki MCP tools (search first, then write):',
            'research findings, decisions and the reasons behind them,',
            'techniques that worked, dead ends worth not repeating. Follow the',
            'research-wiki skill.',
            '',
            'What does NOT belong in the wiki: company procedures and facts',
            '(those go to the vault via vault-write, deliberately, in their own',
            'turn), credentials or secrets, and patient-identifying data —',
            'never, in any form; describe shapes, withhold specifics.',
            '',
            'If the llmwiki MCP tools are not reachable in this session, say so',
            'in one line and stop — do not simulate a capture. If the session',
            'established nothing durable, say that in one line instead of',
            'inventing an entry: an empty capture is a fine result.',
            goal ? `Standing session goal: ${goal}` : null,
        ].filter(Boolean).join('\n'),
        mode: 'normal',
        source: 'wiki',
    };
}

/**
 * The email drafting turn. Read-only: composing words is not a reason to hold
 * write access, and the draft is the only thing this turn may produce. The
 * shell — not the engine — opens the browser afterward, because the browser
 * lives on the host, outside the sandbox, exactly like the clipboard.
 */
export function emailRequest(instruction, goal) {
    if (!instruction) return null;
    return {
        text: [
            'EMAIL DRAFTING TURN',
            `Request: ${instruction}`,
            goal ? `Standing session goal: ${goal}` : null,
            '',
            'PHI PREFLIGHT — before opening any message, determine from the account context and non-content metadata whether this mailbox and requested correspondence are clearly non-clinical and non-PHI. Never open a message that may contain patient-identifying information. If the mailbox or thread cannot be screened as non-PHI without reading message content, stop and return ONLY {"error":"Mailbox history cannot be inspected without risking PHI."}. The no-PHI rule cannot be waived.',
            'Only after that preflight passes, use the available Google Chrome/browser/computer-use tools. In Gmail, inspect non-PHI Sent mail exhaustively enough to infer the sender\'s stable voice: greetings, sign-offs, sentence length, formality, directness, and recurring wording. Continue through every available safe page or thread; never claim complete coverage if the mailbox or tool blocked or excluded part of it.',
            'Identify the recipient without guessing an address. Search Gmail for all available safe non-PHI correspondence with that person and read that accessible history before drafting. Treat mailbox content as private evidence: do not quote it into logs or store it in the vault.',
            'Never use browser tools to create or mutate mail: do not send, delete, archive, label, edit, or open a compose window. Return JSON only. After this turn, the Sherman shell may open one prefilled Gmail compose URL, which can cause Gmail to autosave one draft; that single draft is the requested and only permitted mailbox side effect.',
            'If there is no prior correspondence with this recipient and the Request does not already include a New-recipient tone choice, do not guess the relationship or tone. Return ONLY this JSON shape so the shell can ask one question in a multiple-choice box:',
            '{"question":"How should this email sound for this new recipient?","choices":["Concise professional","Warm professional","Casual and direct","Formal"]}',
            'A New-recipient tone choice in the Request is the operator answering that box. Apply it and draft now; never ask the same question again.',
            'Otherwise draft the email using company knowledge from the vault where it helps and the sender/recipient evidence above.',
            'Return ONLY a JSON object — no code fence, no prose before or after it:',
            '{"to": "<recipient address, or empty string if the request names none>", "subject": "<subject line>", "body": "<the full email body, plain text>"}',
            'Write the body ready to send: greeting, content, sign-off. Never invent a recipient address — an empty "to" is better than a guessed one.',
            'Never put patient-identifying information in an email draft. The Sherman operating contract and no-PHI rule remain authoritative.',
        ].filter(Boolean).join('\n'),
        mode: 'browser-read-only',
        source: 'email',
    };
}

/**
 * The draft, out of the engine's reply. Tolerant of a model that wrapped the
 * JSON in a fence or a sentence despite instructions — the first {...} span
 * that parses wins — and strict about the result: a draft with no body is not
 * a draft, and `null` here is what keeps the shell from opening a compose
 * window on garbage.
 */
export function parseEmailDraft(text) {
    if (typeof text !== 'string') return null;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    let parsed;
    try {
        parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const field = (value) => (typeof value === 'string' ? value.trim() : '');
    const draft = {
        to: field(parsed.to),
        subject: field(parsed.subject),
        body: field(parsed.body),
    };
    return draft.body ? draft : null;
}

/** Parse either a finished draft or the bounded question the email flow needs. */
export function parseEmailResult(text) {
    if (typeof text !== 'string') return null;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    let parsed;
    try {
        parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
    const error = typeof parsed?.error === 'string' ? parsed.error.trim().slice(0, 240) : '';
    if (error) return { kind: 'error', error };
    const question = typeof parsed?.question === 'string' ? parsed.question.trim() : '';
    const choices = Array.isArray(parsed?.choices)
        ? parsed.choices
            .filter((choice) => typeof choice === 'string')
            .map((choice) => choice.trim())
            .filter(Boolean)
            .slice(0, 4)
        : [];
    if (question && choices.length >= 2) return { kind: 'question', question, choices };
    const draft = parseEmailDraft(text);
    return draft ? { kind: 'draft', draft } : null;
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
