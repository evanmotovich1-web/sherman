// What Sherman can reach outside itself, resolved from two files.
//
//   catalog     agent/connectors.json — committed. What exists, how it
//               launches, what it needs, where a human gets the credential.
//   enablement  ~/.sherman/connectors.json — per machine, chmod 600, never
//               committed. Which catalogued connectors are on, and their keys.
//
// The split is the point. A connector's SHAPE is company knowledge and belongs
// in the repo; a connector's KEY is a machine's secret and must never be able
// to reach a commit, a sync, or the vault. Keeping them in one file would make
// that a matter of remembering, and secrets do not survive a policy of
// remembering.
//
// This module follows registry.js's convention exactly: every loader returns a
// discriminated `{ok: true, ...}` or `{ok: false, reason}` and never a
// plausible-looking empty list. "No connectors are enabled" and "the enablement
// file is corrupt" are different problems, and a launcher that renders an empty
// config for both would turn the second one into a silent capability outage.
//
// THE SECRET BOUNDARY. `resolve()` returns three sets. Only `wired` carries
// substituted values, because only the renderer needs them. `blocked` and
// `known` carry secret NAMES and never values, and they are the only shapes
// anything user-facing is allowed to format. `redact()` exists for the error
// paths, where a thrown message would otherwise carry a recipe out of the
// module with the key already substituted into it.

import { spawnSync } from 'node:child_process';
import {
    accessSync, constants, mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync,
} from 'node:fs';
import { delimiter as pathDelimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';

// Resolved from THIS file, never process.cwd() — at runtime the cwd is the
// engine's workspace, not the repo. Same reasoning as registry.js.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PROBE_TIMEOUT_MS = 10_000;

/* ------------------------------------------------------------------ load -- */

/**
 * The committed catalog.
 *
 * @returns {{ok: true, connectors: object[]} | {ok: false, reason: string}}
 */
export function loadCatalog(root = REPO_ROOT) {
    let text;
    try {
        text = readFileSync(join(root, 'agent', 'connectors.json'), 'utf8');
    } catch (error) {
        return { ok: false, reason: error?.code === 'ENOENT' ? 'no connector catalog' : 'unreadable' };
    }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, reason: 'catalog is not valid JSON' };
    }

    if (!Array.isArray(parsed?.connectors)) return { ok: false, reason: 'catalog has no connectors array' };

    // A malformed entry is dropped rather than half-rendered, and named, for
    // registry.js's reason: a connector that will not work is not a connector
    // that does not exist, and only the operator can tell the difference.
    const connectors = [];
    const malformed = [];
    for (const entry of parsed.connectors) {
        if (!entry?.name || typeof entry.name !== 'string') { malformed.push('(unnamed)'); continue; }
        if (entry.transport !== 'stdio' && entry.transport !== 'http') { malformed.push(entry.name); continue; }
        connectors.push(entry);
    }
    return { ok: true, connectors, malformed };
}

/**
 * The machine's enablement and secrets.
 *
 * An absent file is not an error — it is the ordinary state of a fresh
 * install, where the only live connectors are the autoEnable ones.
 *
 * @returns {{ok: true, enabled: object, disabled: string[]} | {ok: false, reason: string}}
 */
export function loadEnablement(home = join(homedir(), '.sherman')) {
    let text;
    try {
        text = readFileSync(join(home, 'connectors.json'), 'utf8');
    } catch (error) {
        if (error?.code === 'ENOENT') return { ok: true, enabled: {}, disabled: [] };
        return { ok: false, reason: 'enablement file is unreadable' };
    }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        // Deliberately does not quote the file. A parse error message from a
        // file full of API keys is one of the easiest ways to print a secret.
        return { ok: false, reason: 'enablement file is not valid JSON' };
    }

    return {
        ok: true,
        enabled: parsed?.enabled && typeof parsed.enabled === 'object' ? parsed.enabled : {},
        disabled: Array.isArray(parsed?.disabled) ? parsed.disabled : [],
    };
}

/* -------------------------------------------------------------- resolve -- */

const defaultIo = {
    exists: (path) => { try { accessSync(path, constants.F_OK); return true; } catch { return false; } },
    executable: (path) => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } },
};

/** Expand ${NAME} from a flat map. Returns null when any placeholder is unknown. */
function expand(value, vars) {
    if (typeof value !== 'string') return null;
    let unresolved = false;
    const out = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
        const replacement = vars[name];
        if (replacement === undefined || replacement === null || replacement === '') {
            unresolved = true;
            return '';
        }
        return String(replacement);
    });
    // A literal ${...} rendered into engine config is a path that does not
    // exist, discovered at engine startup. Blocking here is the cheaper failure.
    return unresolved ? null : out;
}

/**
 * `${HOME}/.local/bin:${PATH}` is the honest way for a committed catalog to
 * say "the operator's PATH, plus this one place" — and on most machines that
 * place is already in it, so the naive expansion repeats entries. Harmless to
 * the loader, but this lands in a person's codex config and in a file they
 * read when a server misbehaves, and a PATH with the same directory four times
 * is noise that makes the real entries harder to see. First occurrence wins,
 * so the prepended entry still takes precedence.
 */
function dedupePath(value) {
    const seen = new Set();
    const kept = [];
    for (const part of String(value).split(pathDelimiter)) {
        if (!part || seen.has(part)) continue;
        seen.add(part);
        kept.push(part);
    }
    return kept.join(pathDelimiter);
}

/** Expand every value of a string map. Returns null when any placeholder is unknown. */
function expandMap(values, vars) {
    if (!values || typeof values !== 'object') return {};
    const out = {};
    for (const [key, value] of Object.entries(values)) {
        const expanded = expand(value, vars);
        if (expanded === null) return null;
        out[key] = key === 'PATH' ? dedupePath(expanded) : expanded;
    }
    return out;
}

function expandAll(values, vars) {
    if (!Array.isArray(values)) return [];
    const out = [];
    for (const value of values) {
        const expanded = expand(value, vars);
        if (expanded === null) return null;
        out.push(expanded);
    }
    return out;
}

/**
 * Catalog + enablement → what is wired, what is blocked, what is merely known.
 *
 * Pure apart from the injected `io`, which exists so tests can describe a
 * machine rather than being one.
 *
 * @returns {{
 *   wired: Array<{name, summary, transport, command?, args?, env, url?, headers?, mkdir: string[]}>,
 *   blocked: Array<{name, summary, missing: string[], reason?: string, signup?: object, repair?: string}>,
 *   known: Array<{name, summary, signup?: object}>,
 *   secrets: string[]
 * }}
 */
export function resolve(catalog, enablement, options = {}) {
    const io = { ...defaultIo, ...(options.io ?? {}) };
    const shermanHome = options.shermanHome ?? join(homedir(), '.sherman');
    // PATH is a var rather than something a catalog entry may hardcode. A
    // server that shells out to its own helper binaries needs the operator's
    // PATH, and the operator's PATH is not knowable from a committed file —
    // `${HOME}/.local/bin:${PATH}` is the only honest way to write "mine, plus
    // this one place". Empty when the launcher has none, which `expand` then
    // treats as unresolved and blocks on, rather than rendering a truncated
    // PATH the server would fail against far from here.
    const baseVars = {
        SHERMAN_HOME: shermanHome,
        HOME: options.home ?? homedir(),
        PATH: options.path ?? process.env.PATH ?? '',
    };

    const wired = [];
    const blocked = [];
    const known = [];
    const secrets = [];

    for (const entry of catalog.connectors) {
        const summary = entry.summary ?? '';
        const machine = enablement.enabled?.[entry.name];
        const off = enablement.disabled?.includes(entry.name);

        // Not enabled and not self-enabling: catalogued, nothing more.
        if (off || (!machine && !entry.autoEnable)) {
            if (!off) known.push({ name: entry.name, summary, signup: entry.signup ?? null });
            continue;
        }

        // Secrets. Names only from here on unless the entry reaches `wired`.
        const required = Array.isArray(entry.requires) ? entry.requires : [];
        const provided = machine?.secrets && typeof machine.secrets === 'object' ? machine.secrets : {};
        const missing = required.filter((name) => !provided[name] || String(provided[name]).trim() === '');
        if (missing.length > 0) {
            blocked.push({
                name: entry.name, summary, missing,
                signup: entry.signup ?? null,
            });
            continue;
        }
        for (const name of required) secrets.push(String(provided[name]));

        const vars = { ...baseVars, ...provided };

        // Installed? requiresFile is existence; probe (run later, by the
        // renderer) is whether it answers. Both, because files existing is not
        // an install.
        const needed = expandAll(entry.requiresFile ?? [], vars);
        if (needed === null) {
            blocked.push({ name: entry.name, summary, missing: [], reason: 'a path in its recipe did not resolve' });
            continue;
        }
        const absent = needed.filter((path) => !io.exists(path));
        if (absent.length > 0) {
            blocked.push({
                name: entry.name, summary, missing: [],
                reason: 'not installed', repair: entry.repair ?? null,
            });
            continue;
        }

        if (entry.transport === 'stdio') {
            const candidates = expandAll(entry.commandCandidates ?? [], vars);
            const args = expandAll(entry.args ?? [], vars);
            if (candidates === null || args === null) {
                blocked.push({ name: entry.name, summary, missing: [], reason: 'a path in its recipe did not resolve' });
                continue;
            }
            const command = candidates.find((path) => io.executable(path));
            if (!command) {
                blocked.push({
                    name: entry.name, summary, missing: [],
                    reason: 'not installed', repair: entry.repair ?? null,
                });
                continue;
            }
            // The server's environment, when it needs one. Same all-or-nothing
            // rule as every other recipe field: a variable that does not
            // resolve blocks the connector here, because the alternative is an
            // engine handed a subprocess with a half-built PATH that fails
            // somewhere the operator cannot connect to this file.
            const env = expandMap(entry.env, vars);
            if (env === null) {
                blocked.push({ name: entry.name, summary, missing: [], reason: 'a value in its environment did not resolve' });
                continue;
            }
            const probe = expandAll(entry.probe ?? [], vars);
            wired.push({
                name: entry.name, summary, transport: 'stdio', command, args, env,
                probe: probe === null ? [] : probe,
                mkdir: expandAll(entry.mkdir ?? [], vars) ?? [],
                repair: entry.repair ?? null,
            });
            continue;
        }

        // http
        const url = expand(entry.url ?? '', vars);
        if (url === null || !url) {
            blocked.push({ name: entry.name, summary, missing: [], reason: 'its url did not resolve' });
            continue;
        }
        const headers = {};
        let headerFailed = false;
        for (const [key, value] of Object.entries(entry.headers ?? {})) {
            const expanded = expand(value, vars);
            if (expanded === null) { headerFailed = true; break; }
            headers[key] = expanded;
        }
        if (headerFailed) {
            blocked.push({ name: entry.name, summary, missing: [], reason: 'a header did not resolve' });
            continue;
        }
        wired.push({
            name: entry.name, summary, transport: 'http', url, headers, env: {},
            probe: [], mkdir: [], repair: entry.repair ?? null,
        });
    }

    return { wired, blocked, known, secrets };
}

/**
 * Replace every secret value with its placeholder.
 *
 * Used on any path that formats something derived from a wired recipe. It is a
 * backstop, not the boundary — the boundary is that `blocked` and `known` never
 * hold values in the first place.
 */
export function redact(text, secrets = []) {
    let out = String(text ?? '');
    for (const secret of secrets) {
        if (!secret || String(secret).length < 4) continue;
        out = out.split(String(secret)).join('«redacted»');
    }
    return out;
}

/* --------------------------------------------------------------- render -- */

/** Claude Code reads .mcp.json from its working directory. */
export function renderMcpJson(wired) {
    const mcpServers = {};
    for (const connector of wired) {
        if (connector.transport === 'stdio') {
            const server = { command: connector.command, args: connector.args };
            // Omitted when empty rather than written as {}. The rendered file is
            // something an operator reads when a server misbehaves, and an empty
            // env block invites the reading that the server was given one.
            if (connector.env && Object.keys(connector.env).length > 0) server.env = connector.env;
            mcpServers[connector.name] = server;
        } else {
            mcpServers[connector.name] = { type: 'http', url: connector.url, headers: connector.headers };
        }
    }
    return { mcpServers };
}

/** TOML basic string. Paths and keys, so backslash and quote are what matter. */
function tomlString(value) {
    return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * One [mcp_servers.name] block for codex's config.toml.
 *
 * Returns null for http connectors: codex's config surface for url-based MCP
 * has not been verified against a real codex on this project, and writing an
 * unverified key into a person's config.toml is exactly the confident-and-wrong
 * this repo refuses elsewhere. They render for Claude Code and say so for codex.
 */
export function renderCodexToml(connector) {
    if (connector.transport !== 'stdio') return null;
    const args = connector.args.map(tomlString).join(', ');
    const lines = [
        '',
        `[mcp_servers.${connector.name}]`,
        `command = ${tomlString(connector.command)}`,
        `args = [${args}]`,
    ];
    // A sub-table, so it must follow the parent's keys — which is why it is
    // appended here rather than being a field the caller can reorder.
    const env = Object.entries(connector.env ?? {});
    if (env.length > 0) {
        lines.push('', `[mcp_servers.${connector.name}.env]`);
        for (const [key, value] of env) lines.push(`${key} = ${tomlString(value)}`);
    }
    lines.push('');
    return lines.join('\n');
}

/* ------------------------------------------------------------------ cli -- */

/**
 * Probe a wired connector: does it actually answer?
 *
 * The llmwiki case this generalizes: a venv whose packages never installed
 * passes every existence check, then hands the engine a server that dies on
 * startup — which the operator meets as one causeless "not available" line
 * mid-session, nowhere near its cause. One interpreter start per launch buys
 * the error message a place to happen.
 */
function probes(connector) {
    if (!connector.probe || connector.probe.length === 0) return { ok: true };
    // Under the connector's own environment, or the probe answers a question
    // nobody asked: whether the server works HERE, rather than whether it works
    // in the environment the engine will actually hand it.
    const result = spawnSync(connector.command, connector.probe, {
        stdio: 'ignore',
        timeout: PROBE_TIMEOUT_MS,
        env: Object.keys(connector.env ?? {}).length > 0
            ? { ...process.env, ...connector.env }
            : process.env,
    });
    return result.status === 0 ? { ok: true } : { ok: false };
}

/**
 * Render engine config for a workspace.
 *
 * Writes <workspace>/.mcp.json and <workspace>/.codex-mcp/<name>.toml, prints
 * each wired name to stdout, and every NOTE to stderr. The launcher appends the
 * TOML blocks it does not already have, so this never touches the operator's
 * codex config itself — that write carries a backup-and-read-back contract that
 * belongs with the rest of the launcher's config writes.
 */
export function render(workspace, options = {}) {
    const notes = [];
    const catalog = loadCatalog(options.root ?? REPO_ROOT);
    if (!catalog.ok) return { ok: false, reason: catalog.reason, notes, wired: [] };

    const shermanHome = options.shermanHome ?? join(homedir(), '.sherman');
    const enablement = loadEnablement(shermanHome);
    if (!enablement.ok) {
        // Refuse to render rather than render a partial set. A connector
        // silently missing because a file failed to parse is a capability
        // outage with no error attached to it.
        return { ok: false, reason: enablement.reason, notes, wired: [] };
    }

    for (const name of catalog.malformed ?? []) {
        notes.push(`connector "${name}" is malformed in agent/connectors.json and was not wired`);
    }

    const { wired, blocked, secrets } = resolve(catalog, enablement, { shermanHome });

    const live = [];
    for (const connector of wired) {
        if (!probes(connector).ok) {
            notes.push(connector.repair
                ? `${connector.name} is present but does not answer; it was not wired. Run: ${connector.repair}`
                : `${connector.name} is present but does not answer; it was not wired`);
            continue;
        }
        for (const path of connector.mkdir) {
            try { mkdirSync(path, { recursive: true }); } catch { /* non-fatal */ }
        }
        live.push(connector);
    }

    for (const entry of blocked) {
        if (entry.missing.length > 0) {
            const where = entry.signup?.url ? ` — sign up at ${entry.signup.url}` : '';
            notes.push(`${entry.name} is enabled but missing ${entry.missing.join(', ')}${where}`);
        } else if (entry.reason === 'not installed') {
            if (entry.repair) notes.push(`${entry.name} is not installed; it was not wired. Run: ${entry.repair}`);
        } else if (entry.reason) {
            notes.push(`${entry.name} was not wired: ${entry.reason}`);
        }
    }

    const httpForCodex = live.filter((c) => c.transport !== 'stdio').map((c) => c.name);
    if (httpForCodex.length > 0) {
        notes.push(`${httpForCodex.join(', ')} uses http transport and was wired for Claude Code only`);
    }

    // Written whole or not at all. A half-written .mcp.json fails at engine
    // startup, which is the worst place for this to go wrong.
    const mcpPath = join(workspace, '.mcp.json');
    const codexDir = join(workspace, '.codex-mcp');
    try {
        rmSync(mcpPath, { force: true });
        rmSync(codexDir, { recursive: true, force: true });
        if (live.length > 0) {
            const staged = mkdtempSync(join(tmpdir(), 'sherman-mcp-'));
            writeFileSync(join(staged, '.mcp.json'), `${JSON.stringify(renderMcpJson(live), null, 2)}\n`, { mode: 0o600 });
            mkdirSync(codexDir, { recursive: true });
            for (const connector of live) {
                const toml = renderCodexToml(connector);
                if (toml) writeFileSync(join(codexDir, `${connector.name}.toml`), toml, { mode: 0o600 });
            }
            writeFileSync(mcpPath, readFileSync(join(staged, '.mcp.json')), { mode: 0o600 });
            rmSync(staged, { recursive: true, force: true });
        }
    } catch (error) {
        return { ok: false, reason: redact(error?.message ?? 'render failed', secrets), notes, wired: [] };
    }

    return { ok: true, notes, wired: live.map((c) => c.name), secrets };
}

/* ------------------------------------------------------------- describe -- */

/**
 * What `/connectors` prints.
 *
 * "Connected" is read from the workspace's rendered `.mcp.json` rather than
 * recomputed, because that file IS what the launcher wired — recomputing would
 * report what a fresh render WOULD do, which is a different and quietly
 * misleading claim after a connector was installed mid-session. The other two
 * headings come from `resolve`, whose `blocked` and `known` shapes carry secret
 * names and never values.
 *
 * An empty heading is omitted rather than printed empty, the same rule the
 * launch screen's panel follows.
 */
export function describe(options = {}) {
    const root = options.root ?? REPO_ROOT;
    const shermanHome = options.shermanHome ?? join(homedir(), '.sherman');
    const workspace = options.workspace ?? join(shermanHome, 'workspace');

    const catalog = loadCatalog(root);
    if (!catalog.ok) return `Connectors unavailable: ${catalog.reason}.`;

    const enablement = loadEnablement(shermanHome);
    if (!enablement.ok) return `Connectors unavailable: ${enablement.reason}.`;

    const { blocked, known } = resolve(catalog, enablement, { shermanHome });

    let connected = [];
    try {
        const rendered = JSON.parse(readFileSync(join(workspace, '.mcp.json'), 'utf8'));
        connected = Object.keys(rendered?.mcpServers ?? {});
    } catch { connected = []; }

    const summaryOf = (name) => catalog.connectors.find((c) => c.name === name)?.summary ?? '';
    const lines = [];

    if (connected.length > 0) {
        lines.push('Connected');
        for (const name of connected.sort()) lines.push(`  ${name.padEnd(16)} ${summaryOf(name)}`);
    }

    // Blocked on a key is the actionable heading, so it names both the secret
    // and where to get it. Never the value — `blocked` cannot carry one.
    const needsKey = blocked.filter((entry) => entry.missing.length > 0);
    if (needsKey.length > 0) {
        if (lines.length) lines.push('');
        lines.push('Needs a key');
        for (const entry of needsKey) {
            const where = entry.signup?.url ? ` · ${entry.signup.url}` : '';
            lines.push(`  ${entry.name.padEnd(16)} missing ${entry.missing.join(', ')}${where}`);
        }
    }

    const notInstalled = blocked.filter((entry) => entry.reason === 'not installed');
    if (notInstalled.length > 0) {
        if (lines.length) lines.push('');
        lines.push('Not installed');
        for (const entry of notInstalled) {
            lines.push(`  ${entry.name.padEnd(16)}${entry.repair ? ` run: ${entry.repair}` : ' not installed'}`);
        }
    }

    const available = known.filter((entry) => !connected.includes(entry.name));
    if (available.length > 0) {
        if (lines.length) lines.push('');
        lines.push('Available');
        for (const entry of available) lines.push(`  ${entry.name.padEnd(16)} ${entry.summary}`);
    }

    if (lines.length === 0) return 'No connectors are catalogued yet. Ask /0-1 for a capability and it will add one.';

    lines.push('');
    lines.push('Secret names only — never values. Changes take effect on the next launch.');
    return lines.join('\n');
}

// `node src/connectors.js --render <workspace>` — the launcher's one entry.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const flag = process.argv[2];
    const workspace = process.argv[3];
    if (flag !== '--render' || !workspace) {
        process.stderr.write('usage: connectors.js --render <workspace>\n');
        process.exit(2);
    }
    const result = render(workspace, {
        root: process.env.SHERMAN_REPO_ROOT || REPO_ROOT,
        shermanHome: process.env.SHERMAN_HOME || join(homedir(), '.sherman'),
    });
    for (const note of result.notes) process.stderr.write(`  NOTE: ${note}\n`);
    if (!result.ok) {
        process.stderr.write(`  NOTE: no MCP config was written (${result.reason})\n`);
        process.exit(1);
    }
    for (const name of result.wired) process.stdout.write(`${name}\n`);
}
