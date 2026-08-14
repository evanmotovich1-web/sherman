// Operator-granted extra writable roots — the narrow sandbox widening.
//
// Sherman's engine runs restricted: Codex enforces a kernel seatbelt that
// denies every write outside a small set of roots, and OpenCode confines its
// file tools to the workspace and vault. That is the right default, but it
// means a local project living outside the disposable workspace — an offline
// research checkout, a scratch build tree — cannot be worked on without
// handing the operator a paste-block to run in their own shell.
//
// This lets the operator name additional directories the engine may write to.
// It is opt-in and reversible: with no `~/.sherman/sandbox.json` the returned
// list is empty and the posture is byte-for-byte what it was. The grant widens
// the FILESYSTEM only — never the network, which stays off at the kernel — and
// there is no "safe command" allowlist, because neither engine can enforce one
// headlessly without reintroducing the per-run approvals the operator opted
// out of. The sandbox root list is the whole, enforceable mechanism.
//
// A grant that would reach the vault (or an ancestor or descendant of it), the
// home directory itself, or the filesystem root is not a narrow widening — it
// is a mistake — so it is dropped with no effect rather than honored. The
// validation here is the security core: it is the one place these rules live,
// shared by both engine backends so they cannot drift apart.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';

/** True when `ancestor` strictly contains `target`. */
function contains(ancestor, target) {
    const base = ancestor.endsWith(sep) ? ancestor : ancestor + sep;
    return target.startsWith(base);
}

/** True when the two paths are equal or one contains the other. */
function related(a, b) {
    return a === b || contains(a, b) || contains(b, a);
}

/**
 * The validated list of operator-granted writable roots.
 *
 * @param {object} opts
 * @param {string} [opts.vault] the configured vault path, always excluded
 * @param {string} [opts.home] home directory (injectable for tests)
 * @param {string} [opts.grantFile] the grant file (injectable for tests)
 * @returns {string[]} absolute, existing, deduped directories safe to grant
 */
export function grantedWritableRoots({ vault, home = homedir(), grantFile } = {}) {
    const path = grantFile ?? join(home, '.sherman', 'sandbox.json');
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        // No grant file, unreadable, or malformed JSON: grant nothing. A
        // broken widening file must never widen — it fails closed.
        return [];
    }
    const raw = Array.isArray(parsed?.writable_roots) ? parsed.writable_roots : [];
    const homeResolved = resolve(home);
    const rootResolved = resolve('/');
    const vaultResolved = vault ? resolve(String(vault).replace(/\/+$/, '')) : null;

    const seen = new Set();
    const roots = [];
    for (const entry of raw) {
        if (typeof entry !== 'string' || !entry.trim()) continue;
        const expanded = entry === '~' ? home
            : entry.startsWith(`~${sep}`) || entry.startsWith('~/') ? join(home, entry.slice(2))
            : entry;
        // Absolute only: a relative grant resolves against whatever the process
        // cwd happens to be, which is not a grant the operator can reason about.
        if (!isAbsolute(expanded)) continue;
        const candidate = resolve(expanded);
        // Existing directory only: a grant to a path that is not there yet
        // silently grants nothing, so drop it rather than widen to a typo.
        if (!existsSync(candidate)) continue;
        try {
            if (!statSync(candidate).isDirectory()) continue;
        } catch {
            continue;
        }
        // Never the filesystem root, the home directory itself, or any
        // ancestor of home (/, /Users): that is the whole machine, not a root.
        if (candidate === rootResolved || candidate === homeResolved || contains(candidate, homeResolved)) continue;
        // Never the vault, an ancestor of it, or anything inside it: the vault
        // is writable only through the shell-owned /learn and /wiki path.
        if (vaultResolved && related(candidate, vaultResolved)) continue;
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        roots.push(candidate);
    }
    return roots;
}
