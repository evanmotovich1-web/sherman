// The codex app-server transport: one persistent `codex app-server` child
// speaking newline-delimited JSON-RPC over stdio.
//
// Codex-owned, like filediff.js: this file exists so codex.js can stream
// token deltas without also owning line framing and request plumbing. Nothing
// above the engine seam imports it.
//
// Probed live against codex-cli 0.146.0 (2026-08-15) before a line of this
// was written; every method and shape used here was observed working, not
// read from docs:
//
//   initialize {clientInfo}                → {userAgent}
//   thread/start {cwd, config}             → {thread:{id}}, and dotted config
//       keys (`mcp_servers.X.enabled`, `sandbox_workspace_write.
//       writable_roots`) apply exactly like `codex exec -c` overrides.
//       Quoting a dotted key breaks it; bare hyphenated names work.
//   thread/resume {threadId}               → reloads a thread from disk
//   turn/start {threadId, input:[{type:'text',text}]}
//   turn/interrupt {threadId, turnId}
//
// and the notification stream during a turn:
//
//   item/started / item/completed          — items in camelCase (agentMessage,
//       commandExecution, …) where exec spells them snake_case
//   item/agentMessage/delta {itemId,delta} — the token stream this whole
//       transport exists for
//   thread/tokenUsage/updated              — live context (`last`) AND the
//       accumulating bill (`total`), with modelContextWindow
//   turn/completed / turn/failed, warning, thread/status/changed
//
// The protocol is marked experimental upstream. The blast radius accepted:
// this file and codex.js's app-server branch — the exec path stays whole as
// the fallback, and a protocol break degrades to an error the operator can
// route around by that path.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** How long a request may wait before it resolves as a timeout error.
 *  Generous: thread/start pays for MCP server startup on slow days. */
const REQUEST_TIMEOUT_MS = 60_000;

export class CodexAppServer {
    constructor() {
        this._child = null;
        this._lines = null;
        this._nextId = 0;
        this._pending = new Map();
        this._listeners = new Set();
        this._initialized = null;
    }

    /** True while the child process is alive and usable. */
    get alive() {
        return this._child !== null && this._child.exitCode === null;
    }

    /**
     * Subscribe to server notifications. Returns an unsubscribe function.
     * Every listener sees every notification; filtering by threadId is the
     * caller's business.
     */
    onNotification(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    /**
     * Ensure the child is running and the initialize handshake is done.
     * Safe to call every turn; it only pays once per process lifetime.
     */
    async ensureStarted() {
        if (this.alive && this._initialized) return this._initialized;

        const child = spawn('codex', ['app-server'], {
            // TRAP 1 does not apply here — app-server IS driven over stdin —
            // but stderr must still drain or the child stalls mid-turn.
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        this._child = child;
        this._stderrTail = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => {
            this._stderrTail = (this._stderrTail + chunk).slice(-4096);
        });
        child.once('close', () => {
            // Every in-flight request fails loudly rather than hanging: a
            // caller mid-turn gets an error event, not a stuck spinner.
            const reason = new Error(
                `codex app-server exited${this._stderrTail ? `:\n${this._stderrTail.trim().split('\n').slice(-4).join('\n')}` : '.'}`
            );
            for (const { reject } of this._pending.values()) reject(reason);
            this._pending.clear();
            this._child = null;
            this._initialized = null;
        });

        // readline for the same reason codex.js uses it: a JSON object can
        // straddle a chunk boundary, and hand-splitting corrupts it.
        this._lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
        this._lines.on('line', (line) => this._onLine(line));

        this._initialized = this.request('initialize', {
            clientInfo: { name: 'sherman', title: 'Sherman Abrams', version: '0.3.0' },
        });
        return this._initialized;
    }

    _onLine(line) {
        const trimmed = line.trim();
        if (trimmed === '') return;
        let msg;
        try {
            msg = JSON.parse(trimmed);
        } catch {
            return;
        }
        if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
            const pending = this._pending.get(msg.id);
            if (!pending) return;
            this._pending.delete(msg.id);
            clearTimeout(pending.timer);
            if (msg.error) {
                pending.reject(new Error(msg.error.message ?? 'app-server request failed'));
            } else {
                pending.resolve(msg.result);
            }
            return;
        }
        if (typeof msg.method === 'string') {
            // A server→client REQUEST (it has an id) must be answered or codex
            // blocks forever awaiting it. The posture runs approval_policy
            // "never", so codex should never ask — but "should never" is not
            // "cannot", and the fail-closed answer to a question the shell
            // has no UI for is a decline, mirroring what "never" itself does.
            if (msg.id !== undefined) {
                this._send({ id: msg.id, result: { decision: 'denied' } });
            }
            for (const listener of this._listeners) {
                try {
                    listener(msg.method, msg.params ?? {});
                } catch {
                    // A listener bug must not take the transport down.
                }
            }
        }
    }

    _send(payload) {
        if (!this.alive) throw new Error('codex app-server is not running');
        this._child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...payload }) + '\n');
    }

    /** One JSON-RPC request. Rejects on server error, exit, or timeout. */
    request(method, params = {}) {
        return new Promise((resolve, reject) => {
            if (!this.alive) {
                reject(new Error('codex app-server is not running'));
                return;
            }
            const id = ++this._nextId;
            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new Error(`app-server ${method} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
            }, REQUEST_TIMEOUT_MS);
            this._pending.set(id, { resolve, reject, timer });
            try {
                this._send({ id, method, params });
            } catch (err) {
                this._pending.delete(id);
                clearTimeout(timer);
                reject(err);
            }
        });
    }

    /** Kill the child. The next ensureStarted() respawns fresh. */
    dispose() {
        if (this._child && this._child.exitCode === null) {
            this._child.kill('SIGTERM');
        }
        this._child = null;
        this._initialized = null;
    }
}
