// Codex backend — drives `codex` headless and normalizes its event stream.
//
// This is the ONLY file in shell/ that knows Codex exists. Everything above it
// sees the EngineSession contract in session.js.
//
// TRANSPORT: `codex exec --json` for the first turn, `codex exec resume` for
// every turn after. Chosen over the app-server protocol -- see shell/README.md
// for the evidence and the cost accepted. One process per turn.
//
// Three things here were learned by probing codex 0.145.0 directly and are the
// difference between a working backend and one that hangs or silently loses its
// safety posture. Do not "simplify" them away:
//
//   1. stdin MUST be ignored. `codex exec` reads stdin when stdin is not a TTY
//      and will sit forever printing "Reading additional input from stdin...".
//   2. `codex exec resume` accepts a NARROWER flag set than `codex exec`: no
//      -s/--sandbox, no -C/--cd, no --add-dir, no -p/--profile. So every
//      setting that must survive past turn 1 travels as a `-c` override, and
//      the working directory comes from spawn's cwd option. Both turn kinds
//      build their argv from one function so they cannot drift apart.
//   3. cwd stays ~/.sherman/workspace. Codex reads AGENTS.md from its cwd, and
//      that file is Sherman's assembled system prompt. Pointing cwd at the
//      vault would seal the sandbox correctly and orphan the persona.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative } from 'node:path';

import { EngineSession, ev, emptyUsage, addUsage } from './session.js';

const NOT_INSTALLED =
    'Codex is not installed. Install it with:\n' +
    '\n' +
    '    npm install -g @openai/codex\n' +
    '\n' +
    'Then run sherman again.';

/**
 * Best-effort model name for the status bar.
 *
 * Read from Codex's own config so the status bar shows the model Evan actually
 * chose. Deliberately NOT enforced with `-m`: forcing a model here would
 * silently override the user's own setting to make a display string easier.
 * A wrong label is a cosmetic bug; a hijacked model choice is not.
 */
function detectModel() {
    const codexHome = process.env.CODEX_HOME || join(process.env.HOME || homedir(), '.codex');
    try {
        const toml = readFileSync(join(codexHome, 'config.toml'), 'utf8');
        for (const line of toml.split('\n')) {
            // Stop at the first table header -- a `model` key inside
            // [some.section] is not the top-level default.
            if (line.trimStart().startsWith('[')) break;
            const m = line.match(/^\s*model\s*=\s*"([^"]+)"/);
            if (m) return m[1];
        }
    } catch {
        // No config, unreadable, whatever. A missing label is not an error.
    }
    return 'codex default';
}

export class CodexSession extends EngineSession {
    /** @param {import('../config.js').ShermanConfig} config */
    constructor(config) {
        super();
        this._config = config;
        this._usage = emptyUsage();
        this._threadId = null;
        this._model = detectModel();
        this._child = null;
        this._interrupted = false;
        this._toolStarts = new Map();
    }

    get info() {
        return {
            engine: 'codex',
            model: this._model,
            user: this._config.user,
            vaultPath: this._config.vaultPath,
            threadId: this._threadId,
        };
    }

    get usage() {
        return this._usage;
    }

    /**
     * The permissions posture — §3c's safety boundary and §4's data boundary,
     * enforced at the engine.
     *
     * Identical on turn 1 and on every resume, because it is built here once.
     * `workspace-write` puts an OS-level seatbelt around the process: the model
     * may run shell commands, but the kernel denies every read and write outside
     * the permitted roots and blocks network egress. That is a stronger boundary
     * than an allow-list of tools, because the model cannot talk its way past
     * the kernel.
     *
     * Never add --dangerously-bypass-approvals-and-sandbox or
     * --dangerously-bypass-hook-trust. They defeat the entire posture.
     */
    _postureArgs() {
        return [
            '--json',
            // The workspace is not a git repo and does not need to be.
            '--skip-git-repo-check',
            '-c', 'sandbox_mode="workspace-write"',
            // cwd (the workspace) is writable under workspace-write already;
            // this adds the vault, which is the only durable destination.
            '-c', `sandbox_workspace_write.writable_roots=["${this._config.vaultPath}"]`,
            // Nothing escalates to a human and nothing outside the sandbox gets
            // auto-approved: a denied action simply fails and the model is told.
            '-c', 'approval_policy="never"',
        ];
    }

    /** Turn 1 opens a thread; later turns resume it by id. */
    _argsFor(text) {
        return this._threadId === null
            ? ['exec', ...this._postureArgs(), text]
            : ['exec', 'resume', this._threadId, ...this._postureArgs(), text];
    }

    /**
     * Translate one line of codex JSONL into zero or more normalized events.
     * Unknown shapes yield nothing rather than throwing: the codex event set
     * will grow, and an unrecognized `type` must never take the shell down.
     */
    _mapLine(line) {
        const trimmed = line.trim();
        if (trimmed === '') return [];

        let msg;
        try {
            msg = JSON.parse(trimmed);
        } catch {
            // Not JSON. Codex prints the odd human-readable notice on stdout;
            // dropping it is correct.
            return [];
        }

        switch (msg.type) {
            case 'thread.started':
                // Captured, not surfaced. This is what makes turn 2 a resume,
                // and what lets an interrupted session continue where it was.
                if (msg.thread_id) this._threadId = msg.thread_id;
                return [];

            case 'turn.started':
                this._toolStarts.clear();
                return [ev.turnStart()];

            case 'item.started':
                return this._mapItem(msg.item, 'started');

            case 'item.completed':
                return this._mapItem(msg.item, 'completed');

            case 'turn.completed': {
                const usage = mapUsage(msg.usage);
                this._usage = addUsage(this._usage, usage);
                this._toolStarts.clear();
                return [ev.turnEnd(usage)];
            }

            case 'turn.failed':
            case 'error':
                return [ev.error(readError(msg))];

            default:
                return [];
        }
    }

    /**
     * @param {{id?:string,type?:string,text?:string,summary?:string,command?:string,changes?:Array<{path?:string}>}} item
     * @param {'started'|'completed'} phase
     */
    _mapItem(item, phase) {
        if (!item || typeof item !== 'object') return [];
        const text = item.text ?? item.summary ?? '';

        switch (item.type) {
            case 'agent_message':
                return phase === 'completed' && text ? [ev.message(text)] : [];

            case 'reasoning':
                return phase === 'completed' && text ? [ev.reasoning(text)] : [];

            case 'command_execution':
            case 'file_change':
                return this._mapTool(item, phase);

            case 'error':
                return phase === 'completed'
                    ? [ev.error(text || 'The engine reported an error.')]
                    : [];

            default:
                // An unknown item is not evidence of what work happened. Silence
                // is more honest than turning a vendor type into a fake tool line.
                return [];
        }
    }

    _mapTool(item, phase) {
        if (!item.id) return [];

        const started = phase === 'completed' ? this._toolStarts.get(item.id) : null;
        const derivedLabel =
            item.type === 'command_execution'
                ? commandLabel(item.command)
                : fileChangeLabel(item.changes, this._config);
        const label = started?.label ?? derivedLabel;
        if (!label) return [];

        if (phase === 'started') {
            this._toolStarts.set(item.id, { startedAt: performance.now(), label });
            return [ev.tool({ id: item.id, phase, label })];
        }

        this._toolStarts.delete(item.id);
        const durationMs =
            typeof started?.startedAt === 'number'
                ? Math.max(0, Math.round(performance.now() - started.startedAt))
                : null;
        return [ev.tool({ id: item.id, phase, label, durationMs })];
    }

    /**
     * Run one user turn.
     * @param {string} text
     * @returns {AsyncGenerator<import('./session.js').EngineEvent>}
     */
    async *send(text) {
        this._interrupted = false;
        this._toolStarts.clear();

        const child = spawn('codex', this._argsFor(text), {
            cwd: this._config.workspacePath,
            // TRAP 1. Anything but 'ignore' on stdin risks a hung turn.
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        this._child = child;

        // Drain stderr as it arrives. Leaving it unread can fill the pipe buffer
        // and stall the child mid-turn.
        let stderr = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });

        const finished = new Promise((resolve) => {
            child.once('error', (err) => resolve({ spawnError: err }));
            child.once('close', (code, signal) => resolve({ code, signal }));
        });

        // readline, not a split() on raw chunks: a JSON object can straddle a
        // chunk boundary, and hand-splitting corrupts it under load.
        const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });

        try {
            for await (const line of lines) {
                for (const event of this._mapLine(line)) yield event;
            }
        } finally {
            lines.close();
        }

        const result = await finished;
        this._child = null;

        if (result.spawnError) {
            yield ev.error(
                result.spawnError.code === 'ENOENT' ? NOT_INSTALLED : result.spawnError.message
            );
            return;
        }

        if (this._interrupted) {
            // Our own SIGTERM. Not a failure, and threadId is intentionally
            // retained so the next send() picks the conversation back up.
            this._interrupted = false;
            yield ev.interrupted();
            return;
        }

        if (result.code !== 0) {
            const detail = stderr.trim().split('\n').slice(-6).join('\n');
            yield ev.error(
                `codex exited with code ${result.code}` + (detail ? `:\n${detail}` : '.')
            );
        }
    }

    /** Abort the in-flight turn. The session stays usable. */
    interrupt() {
        if (this._child && this._child.exitCode === null) {
            this._interrupted = true;
            this._child.kill('SIGTERM');
        }
    }

    dispose() {
        if (this._child && this._child.exitCode === null) {
            this._child.kill('SIGTERM');
        }
        this._child = null;
    }
}

/** Codex's snake_case usage payload → the normalized shape. */
function mapUsage(u) {
    const usage = u ?? {};
    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    return {
        input,
        cachedInput: usage.cached_input_tokens ?? 0,
        output,
        // Reasoning tokens are a subset of output, so they are reported but not
        // added again -- double-counting would inflate the status bar.
        reasoning: usage.reasoning_output_tokens ?? 0,
        total: input + output,
    };
}

function readError(msg) {
    return (
        msg?.error?.message ??
        msg?.message ??
        (typeof msg?.error === 'string' ? msg.error : null) ??
        'The engine reported an error.'
    );
}

function firstLine(value) {
    if (typeof value !== 'string') return '';
    const line = value.split('\n')[0].trim();
    return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

/** Tool labels are terminal output. Remove control protocols before rendering. */
function safeLabel(value) {
    if (typeof value !== 'string') return '';
    return value
        .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Remove Codex's shell wrapper so the trace names the command that ran. */
function shellCommand(value) {
    if (typeof value !== 'string') return '';
    const line = value.split('\n')[0].trim();
    const wrapped = line.match(/^\/bin\/(?:zsh|bash|sh)\s+-lc\s+(.+)$/);
    let command = wrapped ? wrapped[1] : line;
    const quote = command[0];
    if ((quote === "'" || quote === '"') && command.endsWith(quote)) {
        command = command.slice(1, -1);
    }
    return safeLabel(command.replace(/'\\''/g, "'"));
}

/** `cat file` is the read shape observed in the real 0.145.0 stream. */
function commandLabel(value) {
    const command = shellCommand(value);
    if (command === '') return null;

    const read = command.match(/^(?:cat|head|tail)\s+(?:--\s+)?(.+)$/);
    if (read) return `read ${firstLine(read[1])}`;

    return `exec ${firstLine(command)}`;
}

function displayPath(value, config) {
    if (typeof value !== 'string' || value === '') return null;
    for (const root of [config.workspacePath, config.vaultPath]) {
        if (typeof root !== 'string' || root === '') continue;
        const within = relative(root, value);
        if (within && !within.startsWith('..') && !within.startsWith('/')) {
            return safeLabel(within);
        }
    }
    return safeLabel(basename(value));
}

function fileChangeLabel(changes, config) {
    if (!Array.isArray(changes) || changes.length === 0) return null;
    const paths = changes.map((change) => displayPath(change?.path, config)).filter(Boolean);
    if (paths.length === 0) return null;
    if (paths.length === 1) return `patch ${paths[0]}`;
    return `patch ${paths.slice(0, 2).join(', ')}${paths.length > 2 ? ` +${paths.length - 2}` : ''}`;
}
