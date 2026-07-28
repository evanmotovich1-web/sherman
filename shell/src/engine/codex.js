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
import { contextWindowFor } from '../config.js';

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
    return readCodexSetting('model') ?? 'codex default';
}

/**
 * Read one TOP-LEVEL key out of the user's codex config.toml.
 *
 * Top-level only, deliberately: a `model` key inside [some.section] is that
 * section's setting, not the default, and treating it as one would report a
 * model the user never selected.
 *
 * @param {string} key
 * @returns {string|null} the string value, or null if absent/unreadable
 */
function readCodexSetting(key) {
    const codexHome = process.env.CODEX_HOME || join(process.env.HOME || homedir(), '.codex');
    try {
        const toml = readFileSync(join(codexHome, 'config.toml'), 'utf8');
        for (const line of toml.split('\n')) {
            if (line.trimStart().startsWith('[')) break;
            const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*(?:#.*)?$`));
            if (m) {
                const raw = m[1].trim();
                const quote = raw[0];
                if ((quote === '"' || quote === "'") && raw.endsWith(quote)) {
                    return raw.slice(1, -1);
                }
                return raw;
            }
        }
    } catch {
        // No config, unreadable, whatever. A missing value is not an error.
    }
    return null;
}

/** Extract only TOML-safe MCP table keys; never read or expose server values. */
export function mcpServerKeysFromToml(text) {
    const keys = new Set();
    const section = /^\s*\[\s*mcp_servers\.((?:"(?:\\.|[^"\\])*"|'[^']*'|[A-Za-z0-9_-]+))(?:\.|\s*\])/;
    for (const line of text.split('\n')) {
        const match = line.match(section);
        if (match) keys.add(match[1]);
    }
    return [...keys];
}

function configuredMcpServerKeys() {
    try {
        const text = readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf8');
        return mcpServerKeysFromToml(text);
    } catch {
        return [];
    }
}

// Filesystem sandboxing does not govern Codex host-side tools. Planning and
// isolated workers disable those capabilities explicitly instead of claiming
// to be read-only while inherited MCP/apps could still mutate external state.
// Ordinary chat turns keep the operator's configured tools.
const ISOLATED_TOOL_OVERRIDES = Object.freeze([
    'orchestrator.mcp.enabled=false',
    'orchestrator.skills.enabled=false',
    'web_search="disabled"',
    'features.apps=false',
    'features.auth_elicitation=false',
    'features.browser_use=false',
    'features.browser_use_external=false',
    'features.browser_use_full_cdp_access=false',
    'features.computer_use=false',
    'features.goals=false',
    'features.hooks=false',
    'features.image_generation=false',
    'features.in_app_browser=false',
    'features.multi_agent=false',
    'features.multi_agent_v2=false',
    'features.plugins=false',
    'features.remote_plugin=false',
    'features.tool_suggest=false',
]);

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
        this._configuredMcpServerKeys = configuredMcpServerKeys();
    }

    get info() {
        return {
            engine: 'codex',
            model: this._model,
            user: this._config.user,
            vaultPath: this._config.vaultPath,
            threadId: this._threadId,
            contextWindow: contextWindowFor(
                this._model,
                this._config.contextWindowTokens
            ),
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
    _postureArgs(mode = 'normal') {
        const readOnly = mode === 'read-only' || mode === 'isolated-read-only';
        const args = [
            '--json',
            // The workspace is not a git repo and does not need to be.
            '--skip-git-repo-check',
            '-c', `sandbox_mode="${readOnly ? 'read-only' : 'workspace-write'}"`,
            // Nothing escalates to a human and nothing outside the sandbox gets
            // auto-approved: a denied action simply fails and the model is told.
            '-c', 'approval_policy="never"',
        ];
        if (!readOnly) {
            // cwd is writable under workspace-write already; this adds the
            // vault, which is the only durable destination.
            args.push(
                '-c',
                `sandbox_workspace_write.writable_roots=["${this._config.vaultPath}"]`
            );
        }
        if (mode === 'isolated-read-only') {
            for (const override of ISOLATED_TOOL_OVERRIDES) {
                args.push('-c', override);
            }
            // `orchestrator.mcp.enabled=false` blocks MCP dispatch, but Codex's
            // `mcp list` still reports inherited servers as enabled. Disable
            // every configured server too, so the invocation's effective
            // configuration and its displayed state agree fail-closed.
            for (const key of this._configuredMcpServerKeys) {
                args.push('-c', `mcp_servers.${key}.enabled=false`);
            }
        }
        return args;
    }

    /**
     * Settings that shape what the STREAM contains, as opposed to what the
     * process is allowed to do. Kept apart from _postureArgs so nobody editing
     * a display concern is editing the safety boundary in the same breath.
     *
     * Probed against codex 0.145.0: with no `model_reasoning_summary` set,
     * `codex exec --json` emits ZERO `reasoning` items -- only agent_message,
     * command_execution, and the turn/thread lifecycle. Set it to "auto" and
     * the same prompt yields `item.completed` events of type `reasoning`
     * carrying a short title ("**Planning alternative awk command**"). That
     * opt-in is the entire difference between Sherman having self-talk and not.
     *
     * An explicit setting in the user's own config.toml WINS -- including
     * "none". Sherman turning a deliberate opt-out back on to make its own UI
     * livelier would be exactly the hijack detectModel refuses to do with `-m`.
     */
    _streamArgs() {
        if (readCodexSetting('model_reasoning_summary') !== null) return [];
        return ['-c', 'model_reasoning_summary="auto"'];
    }

    /** Turn 1 opens a thread; later turns resume it by id. */
    _argsFor(request) {
        const normalized = normalizeRequest(request);
        const shared = [...this._postureArgs(normalized.mode), ...this._streamArgs()];
        if (normalized.source === 'subagent') {
            // Shell workers are deliberately one-turn and should leave no
            // resumable Codex session file behind after App disposes them.
            shared.push('--ephemeral');
        }
        return this._threadId === null
            ? ['exec', ...shared, normalized.text]
            : ['exec', 'resume', this._threadId, ...shared, normalized.text];
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
            case 'thread.started': {
                // The id is captured, not surfaced: it is what makes turn 2 a
                // resume, and what lets an interrupted session continue.
                //
                // The FACT of it is surfaced, once, because "opening a thread"
                // and "picking one back up" are genuinely different waits and
                // this is the only event that distinguishes them. Which branch
                // is read from _threadId BEFORE assignment -- after it, every
                // thread looks new.
                const opening = this._threadId === null;
                if (msg.thread_id) this._threadId = msg.thread_id;
                return [ev.status(opening ? 'opening a thread…' : 'resuming the thread…')];
            }

            case 'turn.started':
                this._toolStarts.clear();
                return [ev.turnStart(), ev.status('starting…')];

            case 'item.started':
                return this._mapItem(msg.item, 'started');

            case 'item.updated':
                return this._mapItem(msg.item, 'updated');

            case 'item.completed':
                return this._mapItem(msg.item, 'completed');

            case 'turn.completed': {
                const usage = mapUsage(msg.usage);
                if (usage !== null) this._usage = addUsage(this._usage, usage);
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
     * @param {'started'|'updated'|'completed'} phase
     */
    _mapItem(item, phase) {
        if (!item || typeof item !== 'object') return [];
        const text = item.text ?? item.summary ?? '';

        switch (item.type) {
            case 'agent_message':
                return phase === 'completed' && text ? [ev.message(text)] : [];

            case 'reasoning': {
                if (phase !== 'completed') return [];
                const summary = selfTalk(text);
                return summary ? [ev.reasoning(summary)] : [];
            }

            case 'command_execution':
            case 'file_change':
                return this._mapTool(item, phase);

            case 'mcp_tool_call':
            case 'web_search':
            case 'collab_tool_call':
            case 'todo_list':
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

        const started = phase !== 'started' ? this._toolStarts.get(item.id) : null;
        const derived = toolPresentation(item, this._config);
        const derivedLabel = derived?.label ?? null;
        const label = started?.label ?? derivedLabel;
        if (!label) return [];

        if (phase === 'started') {
            this._toolStarts.set(item.id, {
                startedAt: performance.now(),
                label,
                category: derived?.category ?? 'tool',
            });
            return [ev.tool({ id: item.id, phase, label, category: derived?.category ?? 'tool' })];
        }
        if (phase === 'updated') {
            return [
                ev.tool({
                    id: item.id,
                    phase,
                    label: derivedLabel ?? label,
                    category: started?.category ?? derived?.category ?? 'tool',
                }),
            ];
        }

        this._toolStarts.delete(item.id);
        const durationMs =
            typeof started?.startedAt === 'number'
                ? Math.max(0, Math.round(performance.now() - started.startedAt))
                : null;
        return [
            ev.tool({
                id: item.id,
                phase,
                label,
                category: started?.category ?? derived?.category ?? 'tool',
                outcome: toolOutcome(item.status, phase),
                durationMs,
            }),
        ];
    }

    /**
     * Run one user turn.
     * @param {string|{text:string, mode?:'normal'|'read-only'|'isolated-read-only', source?:string}} request
     * @returns {AsyncGenerator<import('./session.js').EngineEvent>}
     */
    async *send(request) {
        this._interrupted = false;
        this._toolStarts.clear();

        const child = spawn('codex', this._argsFor(request), {
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

function normalizeRequest(request) {
    if (typeof request === 'string') return { text: request, mode: 'normal', source: 'chat' };
    if (!request || typeof request.text !== 'string' || request.text.trim() === '') {
        throw new Error('Engine request needs non-empty text.');
    }
    return {
        text: request.text,
        mode: request.mode === 'read-only' || request.mode === 'isolated-read-only'
            ? request.mode
            : 'normal',
        source: typeof request.source === 'string' ? request.source : 'chat',
    };
}

function toolOutcome(status, phase) {
    if (status === 'completed') return 'succeeded';
    if (status === 'failed') return 'failed';
    if (status === 'declined') return 'declined';
    if (status === 'in_progress' || phase !== 'completed') return 'running';
    return 'unknown';
}

function toolPresentation(item, config) {
    switch (item.type) {
        case 'command_execution':
            return { category: 'command', label: commandLabel(item.command) };
        case 'file_change':
            return { category: 'file-change', label: fileChangeLabel(item.changes, config) };
        case 'mcp_tool_call': {
            const target = [safeLabel(item.server), safeLabel(item.tool)].filter(Boolean).join('.');
            return { category: 'mcp', label: target ? `mcp ${target}` : 'mcp tool' };
        }
        case 'web_search': {
            const query = firstLine(safeLabel(item.query));
            return { category: 'web-search', label: query ? `search ${query}` : 'web search' };
        }
        case 'collab_tool_call': {
            const actions = {
                spawn_agent: 'spawn subagent',
                send_input: 'brief subagent',
                wait: 'wait for subagent',
                close_agent: 'close subagent',
            };
            return {
                category: 'subagent',
                label: actions[item.tool] ?? `subagent ${safeLabel(item.tool) || 'activity'}`,
            };
        }
        case 'todo_list': {
            const items = Array.isArray(item.items) ? item.items : [];
            const done = items.filter((entry) => entry?.completed).length;
            return {
                category: 'plan',
                label: `plan ${done}/${items.length} steps`,
            };
        }
        default:
            return null;
    }
}

/** Codex's snake_case usage payload → the normalized shape. */
function mapUsage(u) {
    // Absence must stay absence. Converting a missing payload to zeros would let
    // the UI render a confident 0% context meter from data Codex never sent.
    if (!u || !Number.isFinite(u.input_tokens)) return null;

    const input = u.input_tokens;
    const output = u.output_tokens ?? 0;
    return {
        input,
        cachedInput: u.cached_input_tokens ?? 0,
        output,
        // Reasoning tokens are a subset of output, so they are reported but not
        // added again -- double-counting would inflate the status bar.
        reasoning: u.reasoning_output_tokens ?? 0,
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

/**
 * A reasoning summary, reduced to one line of self-talk.
 *
 * Codex writes these as Markdown with a bolded title -- the real 0.145.0
 * payload is literally `**Planning alternative awk command**`, and at
 * `model_reasoning_summary="detailed"` that title is followed by prose. The
 * title alone is the line worth showing next to the tool trace, so this takes
 * the first non-empty line and undresses it.
 *
 * Emphasis markers are stripped rather than rendered because the trace area is
 * plain dim italic text, not a Markdown surface: leaving them in would print
 * literal asterisks. The text is otherwise the model's own words, unedited --
 * nothing here rewrites, summarizes, or invents a phrasing.
 */
function selfTalk(value) {
    if (typeof value !== 'string') return '';
    const line = value.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
    const bare = safeLabel(line.replace(/^#{1,6}\s*/, '').replace(/\*+|_{2,}|`/g, '')).trim();
    return bare.length > 120 ? `${bare.slice(0, 117)}...` : bare;
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

    // Only classify one simple command with no shell operators as a read.
    // Redirects, pipes, substitutions, and compound forms stay honest `exec`s.
    const unsafe = /[|;&<>`]|\$\(|\n/.test(command);
    const read = unsafe ? null : command.match(/^(?:cat|head|tail)\s+(?:--\s+)?([^\s]+)$/);
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
