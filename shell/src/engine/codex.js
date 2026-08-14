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
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative } from 'node:path';

import { EngineSession, ev, emptyUsage, addUsage } from './session.js';
import { contextWindowFor } from '../config.js';
import { summarizeChange, MAX_SNAPSHOT_BYTES } from './filediff.js';
import { grantedWritableRoots } from './writable-roots.js';

const NOT_INSTALLED =
    'Codex is not installed. Install it with:\n' +
    '\n' +
    '    npm install -g @openai/codex\n' +
    '\n' +
    'Then run sherman again.';

// Error-typed items that are housekeeping notes, not failures. Probed against
// codex 0.146.0: the skills-budget note arrives as `{type:"error", message:
// "Skill descriptions were shortened to fit the 2% skills context budget..."}`
// at the top of a turn that completes normally. Each entry here must have been
// observed alongside a successful turn.completed before it is added.
const ADVISORY_PATTERN = /skills context budget/i;

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
function codexHome() {
    return process.env.CODEX_HOME || join(process.env.HOME || homedir(), '.codex');
}

function readCodexSetting(key) {
    try {
        const toml = readFileSync(join(codexHome(), 'config.toml'), 'utf8');
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
        const text = readFileSync(join(codexHome(), 'config.toml'), 'utf8');
        return mcpServerKeysFromToml(text);
    } catch {
        return [];
    }
}

// ---------------------------------------------------------------------------
// Live-context measurement.
//
// `codex exec --json` reports token usage only on turn.completed, and that
// figure is the turn's BILL: input_tokens summed across every sub-request the
// turn made. Probed against codex 0.145.0 -- a resumed thread of ~22k live
// tokens reported input_tokens of 109k for one three-command turn. Feeding
// that number to a context meter reads 400%+ on a healthy thread, and feeding
// it to auto-compaction discards real conversation over arithmetic on the
// wrong number.
//
// The figure that IS the live context -- what the next request will carry --
// exists, but only in the rollout file codex writes per thread under
// $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl: `token_count`
// events whose `last_token_usage` is the final request of the turn, alongside
// the model's real `model_context_window`. So the session tails that file and
// surfaces the measurement as normalized `context` events. Absence -- no file,
// no token_count line yet, unreadable tail -- yields no event, never a guess.
// ---------------------------------------------------------------------------

/**
 * Locate the rollout file for a thread, scanning date directories newest-first
 * so an active thread is found in the first day or two touched.
 *
 * @param {string} threadId
 * @param {string} [root]
 * @returns {string|null}
 */
export function findRolloutPath(threadId, root = join(codexHome(), 'sessions')) {
    const suffix = `-${threadId}.jsonl`;
    const list = (dir) => {
        try {
            return readdirSync(dir).sort().reverse();
        } catch {
            return [];
        }
    };
    for (const year of list(root)) {
        for (const month of list(join(root, year))) {
            for (const day of list(join(root, year, month))) {
                for (const file of list(join(root, year, month, day))) {
                    if (file.endsWith(suffix)) return join(root, year, month, day, file);
                }
            }
        }
    }
    return null;
}

// 64KB of tail is dozens of rollout lines; token_count arrives at least once
// per sub-request, so the latest one is always well inside it.
const ROLLOUT_TAIL_BYTES = 64 * 1024;

/**
 * The latest measured live-context figure in a rollout file.
 *
 * Reads only the tail, scans backwards for the newest `token_count` line, and
 * returns its `last_token_usage` total with the reported window. The first
 * line of the tail may be cut mid-record; a line that fails to parse is
 * skipped, not fatal.
 *
 * @param {string} path
 * @returns {{used:number, window:number|null}|null}
 */
export function latestTokenCount(path) {
    let text;
    try {
        const size = statSync(path).size;
        const start = Math.max(0, size - ROLLOUT_TAIL_BYTES);
        const buffer = Buffer.alloc(size - start);
        const fd = openSync(path, 'r');
        try {
            readSync(fd, buffer, 0, buffer.length, start);
        } finally {
            closeSync(fd);
        }
        text = buffer.toString('utf8');
    } catch {
        return null;
    }

    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (!lines[i].includes('"token_count"')) continue;
        try {
            const record = JSON.parse(lines[i]);
            const info = record?.payload?.type === 'token_count' ? record.payload.info : null;
            const last = info?.last_token_usage;
            if (!Number.isFinite(last?.input_tokens)) continue;
            const used = Number.isFinite(last.total_tokens)
                ? last.total_tokens
                : last.input_tokens + (last.output_tokens ?? 0);
            const window = Number.isFinite(info.model_context_window)
                ? info.model_context_window
                : null;
            return { used, window };
        } catch {
            // The cut first line, or a future shape. Keep scanning.
        }
    }
    return null;
}

// Filesystem sandboxing does not govern Codex host-side tools. Planning and
// every turn disables those capabilities explicitly instead of claiming a
// Vault boundary while inherited MCP/apps could still mutate external state.
// The one reviewed exception is the explicitly invoked personal research wiki.
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

const DISABLED_HOST_TOOL_OVERRIDES = Object.freeze([
    'features.browser_use=false',
    'features.browser_use_external=false',
    'features.computer_use=false',
]);

// The two Sherman-owned memory connectors a NORMAL turn keeps. Everything
// else configured in the operator's codex config stays disabled per turn —
// admission is a named allowlist, never "whatever the host config carries".
const MEMORY_MCP_KEYS = Object.freeze(new Set(['mnemosyne', 'llmwiki']));

// Tool-level pre-approval for the admitted servers. Codex gates every MCP
// tool call behind an approval, and approval_policy="never" turns that gate
// into an auto-decline — proven live 2026-08-12: an admitted, healthy
// mnemosyne answered every call with "user cancelled MCP tool call". Only
// the per-tool key unlocks a call headlessly (the server-level and wildcard
// forms were both probed and do nothing), so the rosters are spelled out.
// Both servers are Sherman-provisioned at pinned versions, so the rosters
// are knowable; a tool absent here degrades to the old cancellation, never
// to an escalation. mnemosyne's sync_* tools are deliberately absent: the
// catalog promises a local-only store, and an outbound sync is not a call
// to approve silently.
const MEMORY_MCP_TOOLS = Object.freeze({
    mnemosyne: Object.freeze([
        'mnemosyne_remember', 'mnemosyne_recall', 'mnemosyne_shared_remember',
        'mnemosyne_shared_recall', 'mnemosyne_shared_forget', 'mnemosyne_shared_stats',
        'mnemosyne_sleep', 'mnemosyne_stats', 'mnemosyne_invalidate',
        'mnemosyne_validate', 'mnemosyne_get', 'mnemosyne_triple_add',
        'mnemosyne_triple_query', 'mnemosyne_triple_end', 'mnemosyne_remember_canonical',
        'mnemosyne_recall_canonical', 'mnemosyne_scratchpad_write', 'mnemosyne_scratchpad_read',
        'mnemosyne_scratchpad_clear', 'mnemosyne_export', 'mnemosyne_update',
        'mnemosyne_forget', 'mnemosyne_batch', 'mnemosyne_import',
        'mnemosyne_diagnose', 'mnemosyne_graph_query', 'mnemosyne_graph_link',
        'mnemosyne_persona_promote', 'mnemosyne_persona_demote', 'mnemosyne_persona_list',
        'mnemosyne_persona_reinforce', 'mnemosyne_hygiene_audit', 'mnemosyne_hygiene_clean',
    ]),
    llmwiki: Object.freeze([
        'add_source_from_url', 'append', 'create', 'create_knowledge_base',
        'delete', 'edit', 'guide', 'lint', 'list_comments',
        'list_knowledge_bases', 'ping', 'read', 'reply_to_comment',
        'search', 'update_knowledge_base',
    ]),
});

// Their local stores, granted as writable roots on the SAME normal turns.
// Codex sandboxes MCP server processes with the turn: proven live 2026-08-12,
// a wired mnemosyne answered tools/list and then failed every call with
// "unable to open database file" — SQLite needs write on its own directory
// (WAL sidecars) even to read. Without this grant the memory pair is admitted
// in name and dead in practice. The vault is deliberately NOT here: memory
// stores are the models' to write, the vault writes only through the
// shell-owned /learn and /wiki path.
function memoryDataRoots() {
    return [
        join(homedir(), '.sherman', 'mnemosyne', 'data'),
        join(homedir(), '.sherman', 'research'),
    ];
}

export class CodexSession extends EngineSession {
    /** @param {import('../config.js').ShermanConfig} config */
    constructor(config) {
        super();
        this._config = config;
        this._usage = emptyUsage();
        this._threadId = null;
        // Where this thread's rollout file lives, found once per thread.
        this._rolloutPath = null;
        // The window codex itself reported via token_count. Truer than the
        // model table's guess, but never truer than an operator override.
        this._measuredWindow = null;
        this._model = detectModel();
        this._child = null;
        this._interrupted = false;
        this._toolStarts = new Map();
        // path -> pre-write bytes, captured at item.started. See _snapshotChanges.
        this._fileSnapshots = new Map();
        this._configuredMcpServerKeys = configuredMcpServerKeys();
    }

    get info() {
        return {
            engine: 'codex',
            model: this._model,
            user: this._config.user,
            vaultPath: this._config.vaultPath,
            threadId: this._threadId,
            // Operator override first, then the window codex itself reported,
            // then the model table's guess. `contextWindowFor` with a blank
            // model resolves to the override alone.
            contextWindow:
                contextWindowFor('', this._config.contextWindowTokens) ??
                this._measuredWindow ??
                contextWindowFor(this._model, null),
        };
    }

    get usage() {
        return this._usage;
    }

    /**
     * Forget the thread id. `_argsFor` reads that field to decide between
     * `exec` and `exec resume`, so clearing it is the whole of starting over:
     * the next turn opens a new codex thread with an empty context.
     *
     * The old thread's session file is left on disk untouched. It is the record
     * of what was said, and compaction is a context decision, not a reason to
     * destroy history the operator may want to resume by hand.
     */
    startNewThread() {
        this._threadId = null;
        this._rolloutPath = null;
        return true;
    }

    /**
     * The live-context measurement for this thread, as zero or one `context`
     * events. Called at each completed item and at turn end: every completed
     * item marks a sub-request codex just paid for, so the rollout file has a
     * fresh token_count by then and the meter can move DURING a long agentic
     * turn instead of lying until it ends.
     */
    _contextEvents() {
        if (this._threadId === null) return [];
        if (this._rolloutPath === null) {
            this._rolloutPath = findRolloutPath(this._threadId);
        }
        if (this._rolloutPath === null) return [];
        const count = latestTokenCount(this._rolloutPath);
        if (count === null) return [];
        if (count.window !== null) this._measuredWindow = count.window;
        return [ev.context(count.used, this.info.contextWindow)];
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
    _postureArgs(mode = 'normal', source = 'chat') {
        const readOnly = mode === 'read-only'
            || mode === 'isolated-read-only'
            || mode === 'browser-read-only';
        const args = [
            '--json',
            // The workspace is not a git repo and does not need to be.
            '--skip-git-repo-check',
            '-c', `sandbox_mode="${readOnly ? 'read-only' : 'workspace-write'}"`,
            // Nothing escalates to a human and nothing outside the sandbox gets
            // auto-approved: a denied action simply fails and the model is told.
            '-c', 'approval_policy="never"',
        ];
        // Normal turns may edit the disposable workspace, but the vault is not
        // a writable root. Authoritative memory/wiki writes belong exclusively
        // to the shell-owned /learn and /wiki validator/writer path.
        if (mode === 'normal' || mode === 'browser-read-only') {
            for (const override of DISABLED_HOST_TOOL_OVERRIDES) {
                args.push('-c', override);
            }
        } else if (mode === 'isolated-read-only') {
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
        } else {
            for (const override of DISABLED_HOST_TOOL_OVERRIDES) {
                args.push('-c', override);
            }
        }
        for (const key of this._configuredMcpServerKeys) {
            // Long-term memory rides every engine the same way (operator's
            // instruction, 2026-08-12): NORMAL turns keep mnemosyne and the
            // personal wiki — recall the contract teaches has to actually be
            // wired, on Codex exactly as on OpenCode. Read-only and isolated
            // turns still deny every MCP: a judge must not write memories
            // about its own grading. The research skill's llmwiki carve-out
            // stays for its own turns.
            const admitted = (mode === 'normal' && MEMORY_MCP_KEYS.has(key))
                || (source === 'skill:research-wiki' && key === 'llmwiki');
            if (!admitted) {
                args.push('-c', `mcp_servers.${key}.enabled=false`);
                continue;
            }
            for (const tool of MEMORY_MCP_TOOLS[key] ?? []) {
                args.push('-c', `mcp_servers.${key}.tools.${tool}.approval_mode="approve"`);
            }
        }
        if (mode === 'normal') {
            // See memoryDataRoots: without these the admitted memory servers
            // start and then fail every call against their own stores. Any
            // operator-granted roots (opt-in, vault-excluded, network still
            // off) merge into the SAME single override so the kernel seatbelt
            // still travels as exactly one writable_roots key.
            const granted = grantedWritableRoots({ vault: this._config.vaultPath });
            const roots = [...memoryDataRoots(), ...granted];
            args.push('-c', `sandbox_workspace_write.writable_roots=${JSON.stringify(roots)}`);
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
        const shared = [
            ...this._postureArgs(normalized.mode, normalized.source),
            ...this._streamArgs(),
        ];
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
                return [...this._mapItem(msg.item, 'completed'), ...this._contextEvents()];

            case 'turn.completed': {
                // `msg.usage` is the turn's bill -- input summed across every
                // sub-request -- and feeds accounting only. The live-context
                // figure travels separately as a `context` event; see the
                // rollout helpers above for why the two must never be mixed.
                const usage = mapUsage(msg.usage);
                if (usage !== null) this._usage = addUsage(this._usage, usage);
                this._toolStarts.clear();
                return [...this._contextEvents(), ev.turnEnd(usage)];
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
                return this._mapTool(item, phase);

            // A file_change is the one item whose interesting content is NOT in
            // the stream. The tool line is mapped as usual; the line detail is
            // sourced by bracketing the write with two reads.
            case 'file_change': {
                if (phase === 'started') this._snapshotChanges(item.changes);
                const tool = this._mapTool(item, phase);
                if (phase !== 'completed') return tool;
                return [...tool, ...this._diffChanges(item.changes)];
            }

            case 'mcp_tool_call':
            case 'web_search':
            case 'collab_tool_call':
            case 'todo_list':
                return this._mapTool(item, phase);

            case 'error': {
                if (phase !== 'completed') return [];
                // Probed against codex 0.146.0: error items carry their text
                // in `message`, not `text` — reading only item.text loses the
                // real complaint and falls through to the stderr tail, which
                // on 0.146.0 is the harmless "Reading additional input from
                // stdin..." notice. That mislabel is exactly what a night of
                // "checkpoint eval failed" reports pointed at.
                let message = item.message ?? text;
                // Same probe: 0.146.0 emits housekeeping notes AS error items
                // on turns that then complete normally. Known advisories are
                // reclassified so no consumer mistakes them for a failed turn;
                // the pattern is deliberately narrow — an unrecognized error
                // stays an error, because downgrading real failures is worse
                // than a false alarm.
                if (ADVISORY_PATTERN.test(message)) return [ev.advisory(message)];
                if (!message) {
                    const tail = (this._stderrTail ?? '').trim().split('\n').slice(-4).join('\n');
                    message = tail
                        ? `The engine reported an error:\n${tail}`
                        : 'The engine reported an error with no detail — usually a transient engine/API failure; retrying normally clears it.';
                }
                return [ev.error(message)];
            }

            default:
                // An unknown item is not evidence of what work happened. Silence
                // is more honest than turning a vendor type into a fake tool line.
                return [];
        }
    }

    /**
     * Capture the pre-write bytes of every path in a starting file_change.
     *
     * Probed against codex 0.145.0: `item.started` for a file_change is emitted
     * BEFORE the write lands — reading the path here returns the old content,
     * and reading it again at `item.completed` returns the new content. That
     * ordering is the entire basis for showing a real diff, so if a future
     * codex reverses it this snapshot becomes wrong rather than merely absent.
     * The check that protects it lives in shell/test/filediff.test.js.
     */
    _snapshotChanges(changes) {
        if (!Array.isArray(changes)) return;
        for (const change of changes) {
            const path = change?.path;
            if (typeof path !== 'string' || path === '') continue;
            this._fileSnapshots.set(path, readTextFile(path));
        }
    }

    /**
     * Turn each completed change into a diff event, then drop its snapshot.
     *
     * `kind:'add'` legitimately has no before-image and `kind:'delete'` has no
     * after-image; both are passed through as an explicit null rather than an
     * empty string so summarizeChange can tell "no such side" from "empty file".
     */
    _diffChanges(changes) {
        if (!Array.isArray(changes)) return [];
        const events = [];
        for (const change of changes) {
            const path = change?.path;
            if (typeof path !== 'string' || path === '') continue;

            const changeKind = typeof change.kind === 'string' ? change.kind : 'update';
            const before = this._fileSnapshots.get(path) ?? { text: null, reason: 'no pre-write snapshot' };
            this._fileSnapshots.delete(path);
            const after = changeKind === 'delete' ? { text: null, reason: null } : readTextFile(path);

            events.push(
                ev.diff(
                    summarizeChange({
                        path: displayPath(path, this._config) ?? safeLabel(path),
                        changeKind,
                        before: before.text,
                        after: after.text,
                        reason: before.reason ?? after.reason,
                    })
                )
            );
        }
        return events;
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
        this._stderrTail = '';
        child.stderr.on('data', (chunk) => {
            // Tail only, at the accumulator itself. Every downstream read of
            // this already takes a tail or a last-lines slice, but the string
            // grew without bound — one of the leaks that let a long
            // machine-learning session abort the whole shell with a V8 heap
            // OOM. The pipe still drains; the memory no longer follows.
            stderr = (stderr + chunk).slice(-4096);
            // Mirrored onto the instance so _mapItem's empty-error case can
            // name what codex actually printed.
            this._stderrTail = stderr;
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
    const source = typeof request.source === 'string' ? request.source : 'chat';
    let mode = request.mode === 'read-only'
        || request.mode === 'isolated-read-only'
        || request.mode === 'browser-read-only'
        ? request.mode
        : 'normal';
    if (mode === 'browser-read-only' && source !== 'email') mode = 'read-only';
    return { text: request.text, mode, source };
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
            return commandPresentation(item.command);
        case 'file_change': {
            // Every change a `kind:'add'` is a creation, not a patch — the
            // same evidence the differ already uses (an add legitimately has
            // no before-image), carried out to the category so the trace can
            // mark making a file differently from editing one. A mixed batch
            // stays a patch: one edited file makes the whole change an edit.
            const changes = Array.isArray(item.changes) ? item.changes : [];
            const creates = changes.length > 0 && changes.every((change) => change?.kind === 'add');
            return {
                category: creates ? 'file-create' : 'file-change',
                label: fileChangeLabel(item.changes, config, creates ? 'create' : 'patch'),
            };
        }
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

/**
 * `cat file` is the read shape observed in the real 0.145.0 stream.
 *
 * The read/exec split was already made here to choose the LABEL; it is now also
 * reported as the category, so the UI can mark a read differently from a shell
 * command. That is the same classification on the same evidence, carried one
 * level further out — not a new inference about what the command did.
 */
function commandPresentation(value) {
    const command = shellCommand(value);
    if (command === '') return null;

    // Only classify one simple command with no shell operators as a read.
    // Redirects, pipes, substitutions, and compound forms stay honest `exec`s.
    const unsafe = /[|;&<>`]|\$\(|\n/.test(command);
    const read = unsafe ? null : command.match(/^(?:cat|head|tail)\s+(?:--\s+)?([^\s]+)$/);
    if (read) return { category: 'read', label: `read ${firstLine(read[1])}` };

    // The locating commands get the same treatment on the same terms: one
    // simple command, no shell operators, whose whole job is finding files or
    // lines. The label keeps the command verbatim — grep, rg, fd, find and ls
    // are different searches, so unlike cat/head/tail the binary name is
    // information, not noise.
    if (!unsafe && /^(?:grep|rg|fd|find|ls)\b/.test(command)) {
        return { category: 'file-search', label: firstLine(command) };
    }

    return { category: 'command', label: `exec ${firstLine(command)}` };
}

/**
 * Read a file for diffing, refusing the cases where line detail would be a lie.
 *
 * Returns `{text, reason}`. A null `text` with a null `reason` means the side
 * genuinely does not exist (the before-image of a create, the after-image of a
 * delete) — that is not a failure and must not be reported as one. A null
 * `text` WITH a reason means the content exists but could not be sourced, and
 * that reason is shown to the operator instead of a fabricated diff.
 *
 * Binary files are refused outright: rendering NUL-bearing bytes as "lines"
 * would produce plausible-looking garbage in the transcript.
 */
function readTextFile(path) {
    try {
        const size = statSync(path).size;
        if (size > MAX_SNAPSHOT_BYTES) {
            return { text: null, reason: 'file too large to diff' };
        }
        const text = readFileSync(path, 'utf8');
        if (text.includes('\u0000')) return { text: null, reason: 'binary file' };
        return { text, reason: null };
    } catch (err) {
        // ENOENT is the expected shape for the missing side of a create.
        if (err?.code === 'ENOENT') return { text: null, reason: null };
        return { text: null, reason: 'file could not be read' };
    }
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

function fileChangeLabel(changes, config, verb = 'patch') {
    if (!Array.isArray(changes) || changes.length === 0) return null;
    const paths = changes.map((change) => displayPath(change?.path, config)).filter(Boolean);
    if (paths.length === 0) return null;
    if (paths.length === 1) return `${verb} ${paths[0]}`;
    return `${verb} ${paths.slice(0, 2).join(', ')}${paths.length > 2 ? ` +${paths.length - 2}` : ''}`;
}
