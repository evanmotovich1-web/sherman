// What Sherman can do, read from the repository at launch.
//
// Two sources, deliberately different in kind:
//
//   tools   agent/capabilities.json — hand-maintained, engine-agnostic, a
//           statement of what Sherman offers.
//   skills  a readdir of skills/*/SKILL.md — the skills ARE the directory, so
//           the count cannot drift from the thing it counts.
//
// The governing rule is LaunchScreen's: every value on the frame is true, and
// an absent source is omitted rather than faked. So both loaders return a
// discriminated result — `{ ok: true, ... }` or `{ ok: false, reason }` — and
// never a plausible-looking empty list. A launch screen reading "0 skills"
// because a readdir failed would be a confident lie about an installation that
// is merely unreadable, and those are different problems that must not look the
// same on screen.
//
// Malformed skills are counted separately from valid ones rather than being
// silently dropped. A skill with broken front matter is not a skill that does
// not exist; it is a skill that will not work, and the operator is the only one
// who can fix it.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

// Resolved from THIS file, never process.cwd() — at runtime the cwd is the
// engine's workspace, not the repo. Same reasoning as LaunchScreen.js.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Parse the leading `---` front matter block.
 *
 * Deliberately not a YAML parser: the contract in skills/README.md is a flat
 * `key: value` block, and accepting more than that would let a skill declare
 * structure the launch screen cannot render. Returns null when the block is
 * absent or unterminated, which the caller reports as malformed.
 */
export function parseFrontMatter(text) {
    if (typeof text !== 'string') return null;
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) return null;

    const fields = {};
    for (const line of match[1].split(/\r?\n/)) {
        if (!line.trim()) continue;
        const pair = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
        if (!pair) return null;
        fields[pair[1]] = pair[2].trim();
    }
    return fields;
}

/**
 * Every skill in skills/, grouped by category.
 *
 * A skill is valid only when its front matter parses, its `name` matches its
 * directory, and it carries a `description`. The name check is not pedantry:
 * the directory is what the operator navigates and the front matter is what
 * the screen prints, and when they disagree there is no way to know which one
 * is the lie. The description requirement is the Agent Skills standard's other
 * mandatory field — it is what an engine reads to decide when a skill applies,
 * so a skill without one is a skill the engine will never reach for.
 *
 * Besides the launch screen's category view, this returns `list` — the flat
 * {name, category, summary} rows the slash palette renders. The summary falls
 * back to the description because a real skill must never sit next to a blank
 * explanation, and description is the field the loader already requires.
 *
 * @returns {{ok: true, categories: Array<{name: string, items: string[]}>, count: number,
 *            malformed: string[], list: Array<{name: string, category: string, summary: string}>}
 *          | {ok: false, reason: string}}
 */
export function loadSkills(root = REPO_ROOT) {
    const skillsDir = join(root, 'skills');

    let entries;
    try {
        entries = readdirSync(skillsDir, { withFileTypes: true });
    } catch (error) {
        return { ok: false, reason: error?.code === 'ENOENT' ? 'no skills directory' : 'unreadable' };
    }

    const byCategory = new Map();
    const malformed = [];
    const list = [];
    let count = 0;

    for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
        let text;
        try {
            text = readFileSync(join(skillsDir, entry.name, 'SKILL.md'), 'utf8');
        } catch {
            malformed.push(entry.name);
            continue;
        }

        const fields = parseFrontMatter(text);
        if (!fields || !fields.name || !fields.category || !fields.description || fields.name !== entry.name) {
            malformed.push(entry.name);
            continue;
        }

        if (!byCategory.has(fields.category)) byCategory.set(fields.category, []);
        byCategory.get(fields.category).push(fields.name);
        list.push({
            name: fields.name,
            category: fields.category,
            summary: fields.summary || fields.description,
        });
        count += 1;
    }

    const categories = [...byCategory.entries()]
        .map(([name, items]) => ({ name, items }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return { ok: true, categories, count, malformed: malformed.sort(), list };
}

/**
 * The declared toolsets from agent/capabilities.json.
 *
 * @returns {{ok: true, categories: Array<{name: string, items: string[]}>, count: number}
 *          | {ok: false, reason: string}}
 */
export function loadTools(root = REPO_ROOT) {
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(join(root, 'agent', 'capabilities.json'), 'utf8'));
    } catch (error) {
        return { ok: false, reason: error?.code === 'ENOENT' ? 'no capability registry' : 'unreadable' };
    }

    if (!Array.isArray(parsed?.toolsets)) return { ok: false, reason: 'malformed registry' };

    const categories = [];
    let count = 0;
    for (const set of parsed.toolsets) {
        if (!set?.name || !Array.isArray(set.tools)) return { ok: false, reason: 'malformed registry' };
        const items = set.tools.map((tool) => tool?.name).filter((name) => typeof name === 'string');
        if (items.length !== set.tools.length) return { ok: false, reason: 'malformed registry' };
        categories.push({ name: set.name, items });
        count += items.length;
    }

    return { ok: true, categories, count };
}

/**
 * A valid agent entry, or null. One place, because the bundled registry and
 * the personal directory must be held to the same bar: a name that is not a
 * slug, or a missing specialty or harness, is an agent the @-routing cannot
 * honestly launch, and it must never be counted as one it can.
 */
function validAgent(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const { name, category, specialty, harness } = entry;
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(name)) return null;
    if (typeof specialty !== 'string' || !specialty.trim()) return null;
    if (typeof harness !== 'string' || !harness.trim()) return null;
    return {
        name,
        category: typeof category === 'string' && category.trim() ? category.trim() : 'agent',
        specialty: specialty.trim(),
        harness: harness.trim(),
    };
}

/**
 * The named agents the shell can @-route to: the committed roster in
 * agent/agents.json plus any personal agents Sherman has forged into
 * ~/.sherman/agents/ (one JSON file per agent, same fields). A bundled name
 * wins a collision — the same rule workspace skill assembly follows — and a
 * malformed personal file is named in `malformed` rather than half-loaded.
 *
 * @returns {{ok: true, categories: Array<{name: string, items: string[]}>, count: number,
 *            list: Array<{name: string, category: string, specialty: string, harness: string, personal: boolean}>,
 *            malformed: string[]}
 *          | {ok: false, reason: string}}
 */
export function loadAgents(root = REPO_ROOT, home = join(homedir(), '.sherman')) {
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(join(root, 'agent', 'agents.json'), 'utf8'));
    } catch (error) {
        return { ok: false, reason: error?.code === 'ENOENT' ? 'no agent registry' : 'unreadable' };
    }
    if (!Array.isArray(parsed?.agents)) return { ok: false, reason: 'malformed registry' };

    const list = [];
    const malformed = [];
    for (const entry of parsed.agents) {
        const agent = validAgent(entry);
        if (!agent) return { ok: false, reason: 'malformed registry' };
        list.push({ ...agent, personal: false });
    }

    // Personal agents are additive and never authoritative: an unreadable
    // directory means "no personal agents", not a broken registry, and a
    // personal file may not shadow a bundled name.
    let personalFiles = [];
    try {
        personalFiles = readdirSync(join(home, 'agents'), { withFileTypes: true })
            .filter((e) => e.isFile() && e.name.endsWith('.json'))
            .map((e) => e.name)
            .sort();
    } catch { personalFiles = []; }
    const taken = new Set(list.map((agent) => agent.name));
    for (const file of personalFiles) {
        let agent = null;
        try {
            agent = validAgent(JSON.parse(readFileSync(join(home, 'agents', file), 'utf8')));
        } catch { agent = null; }
        if (!agent || agent.name !== file.replace(/\.json$/, '') || taken.has(agent.name)) {
            malformed.push(file);
            continue;
        }
        taken.add(agent.name);
        list.push({ ...agent, personal: true });
    }

    const byCategory = new Map();
    for (const agent of list) {
        if (!byCategory.has(agent.category)) byCategory.set(agent.category, []);
        byCategory.get(agent.category).push(`@${agent.name}`);
    }
    const categories = [...byCategory.entries()]
        .map(([name, items]) => ({ name, items }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return { ok: true, categories, count: list.length, list, malformed: malformed.sort() };
}

/**
 * The MCP servers Sherman can reach, for the launch screen: the connector
 * catalog split into what THIS launch actually wired (the workspace's rendered
 * .mcp.json — the file the engine reads, not a recomputation of it) and what
 * is catalogued but not wired. No probes and no secrets: this is a launch
 * render, and connectors.js `describe()` remains the detailed, named view.
 *
 * @returns {{ok: true, categories: Array<{name: string, items: string[]}>, count: number}
 *          | {ok: false, reason: string}}
 */
export function loadConnectors(root = REPO_ROOT, home = join(homedir(), '.sherman')) {
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(join(root, 'agent', 'connectors.json'), 'utf8'));
    } catch (error) {
        return { ok: false, reason: error?.code === 'ENOENT' ? 'no connector catalog' : 'unreadable' };
    }
    if (!Array.isArray(parsed?.connectors)) return { ok: false, reason: 'malformed catalog' };
    const catalogued = parsed.connectors
        .map((entry) => entry?.name)
        .filter((name) => typeof name === 'string' && name);

    let wired = [];
    try {
        const rendered = JSON.parse(readFileSync(join(home, 'workspace', '.mcp.json'), 'utf8'));
        wired = Object.keys(rendered?.mcpServers ?? {}).sort();
    } catch { wired = []; }

    const available = catalogued.filter((name) => !wired.includes(name)).sort();
    const categories = [];
    if (wired.length > 0) categories.push({ name: 'wired', items: wired });
    if (available.length > 0) categories.push({ name: 'available', items: available });

    return { ok: true, categories, count: wired.length + available.length };
}

/** Every registry, as the launch screen consumes them. */
export function loadRegistry(root = REPO_ROOT, home = join(homedir(), '.sherman')) {
    return {
        tools: loadTools(root),
        skills: loadSkills(root),
        mcp: loadConnectors(root, home),
        agents: loadAgents(root, home),
    };
}

/**
 * One category line, fitted to `width`: `label: a, b, c, +N more`.
 *
 * Truncation is STATED, never silent — the same rule Diff.js follows. A line
 * that simply stopped would read as a shorter toolset than the one that
 * exists, and the whole point of this panel is that its numbers are true.
 *
 * Returns `{label, shown, more}` rather than a formatted string so the renderer
 * can colour the label and the items differently without re-parsing its own
 * output.
 */
export function fitCategory(name, items, width) {
    const label = `${name}: `;
    // Below this there is no room to show even one item plus the label.
    const budget = width - label.length;
    if (budget < 3) return { label, shown: [], more: items.length };

    const shown = [];
    let used = 0;
    for (const [index, item] of items.entries()) {
        const remaining = items.length - index;
        const separator = shown.length > 0 ? 2 : 0;
        // Reserve room for the `, +N more` tail whenever items would be left
        // over, so the count can always be told the truth.
        const tail = remaining > 1 ? `, +${remaining - 1} more`.length : 0;
        if (used + separator + item.length + tail > budget) break;
        used += separator + item.length;
        shown.push(item);
    }

    return { label, shown, more: items.length - shown.length };
}
