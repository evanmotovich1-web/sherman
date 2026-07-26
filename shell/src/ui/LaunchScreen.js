// The first frame.
//
// Wordmark deck, identity block, one bordered panel with the build stamped into
// its top border, one welcome line — spaced to fill the viewport on entry. It
// answers "what is this, whose is it, and what does it know" before the user
// types anything.
//
// The governing rule is that every value on it is true. Nothing here is
// hardcoded copy standing in for a real number: the counts come from a readdir,
// the identity comes from session.info, the session id from the launcher, the
// version from package.json, the sha from git — and when a source is absent
// (no git on a future employee install), its segment is OMITTED, never faked.
//
// Like the banner it replaces, this commits once through <Static> and scrolls
// away (D12/D13). "Fills the viewport" means vertical spacing on the primary
// screen — never the alternate screen, which would destroy scrollback.

import React from 'react';
import { Text, Box, useWindowSize } from 'ink';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { color } from './theme.js';
import { Wordmark, wordmarkRows } from './Wordmark.js';
import { Mark, MARK_ROWS } from './Mark.js';

// Resolved from THIS file, never process.cwd() — at runtime the cwd is the
// engine's workspace, not the repo. Same reasoning as Header.js.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SKILLS_DIR = join(REPO_ROOT, 'skills');

// Wide enough to read, narrow enough that a 200-column terminal does not get a
// panel stretched across the whole screen.
const MAX_PANEL = 76;

// Holds the mark (12 wide) plus a label/value pair without crushing either.
const LEFT_COLUMN = 26;
const LABEL = 9;

// Rows the pinned region below the transcript occupies when idle: composer,
// its top margin, compact header, status bar. Part of the height budget so
// "fills the viewport" includes the chrome the user actually sees.
const CHROME_ROWS = 4;

/**
 * Keep the tail of a path, cutting only at separators.
 *
 * StatusBar truncates to an exact character budget, which on this column yields
 * `…de/sherman/vault` — a fragment of a directory name that reads as corruption
 * rather than as a path. Dropping whole segments gives `…/sherman/vault`, which
 * is the point of showing the tail at all.
 */
function truncatePath(value, max) {
    if (typeof value !== 'string') return '';
    if (value.length <= max) return value;
    if (max <= 1) return '…';

    const parts = value.split('/').filter(Boolean);
    let tail = '';
    for (let i = parts.length - 1; i >= 0; i--) {
        const next = `/${parts[i]}${tail}`;
        // +1 leaves room for the leading ellipsis.
        if (next.length + 1 > max) break;
        tail = next;
    }

    // A single segment longer than the budget has no separator to cut at, so
    // fall back to a character-exact tail rather than returning nothing.
    return tail ? `…${tail}` : `…${value.slice(-(max - 1))}`;
}

/** "1 wiki page" / "2 wiki pages" — a panel that says "1 pages" is not careful. */
function plural(n, singular, pluralForm) {
    return `${n} ${n === 1 ? singular : pluralForm ?? `${singular}s`}`;
}

// ------------------------------------------------------------- build stamp --
// Read once per process: the values cannot change mid-session, and <Static>
// children may render more than once while committing.
let cachedBuild;

function readBuildInfo() {
    if (cachedBuild) return cachedBuild;

    let version = null;
    let sha = null;
    let dirty = 0;

    try {
        version =
            JSON.parse(readFileSync(join(REPO_ROOT, 'shell', 'package.json'), 'utf8'))
                .version ?? null;
    } catch {
        version = null;
    }

    // Guarded: on a machine without git, or an install that is not a checkout,
    // these throw and the segments are simply omitted (never blank separators).
    try {
        sha = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', '--short', 'HEAD'], {
            stdio: ['ignore', 'pipe', 'ignore'],
        })
            .toString()
            .trim();
        if (sha) {
            dirty = execFileSync('git', ['-C', REPO_ROOT, 'status', '--porcelain'], {
                stdio: ['ignore', 'pipe', 'ignore'],
            })
                .toString()
                .split('\n')
                .filter(Boolean).length;
        }
    } catch {
        sha = null;
        dirty = 0;
    }

    cachedBuild = { version, sha, dirty };
    return cachedBuild;
}

/**
 * The panel's top border with the build stamped into it:
 * ╭─ Sherman Abrams v0.2.0 · abc1234 · +2 ────╮
 *
 * Composed to exactly `width` visual columns and paired with borderTop:false
 * on the box below, so the two read as one border (probed at plan time).
 */
function VersionBorder({ width }) {
    const { version, sha, dirty } = readBuildInfo();

    let label = 'Sherman Abrams';
    if (version) label += ` v${version}`;
    if (sha) label += ` · ${sha}`;
    if (sha && dirty > 0) label += ` · +${dirty}`;

    const text = ` ${label} `;
    const fill = Math.max(0, width - 3 - [...text].length);

    return React.createElement(
        Text,
        { wrap: 'truncate' },
        React.createElement(Text, { color: color.frame }, '╭─'),
        React.createElement(Text, { color: color.muted }, text),
        React.createElement(Text, { color: color.frame }, '─'.repeat(fill) + '╮')
    );
}

/** `label   value`, dimmed, on one truncated line. */
function Field({ label, value }) {
    return React.createElement(
        Box,
        { flexDirection: 'row' },
        React.createElement(
            Box,
            { width: LABEL, flexShrink: 0 },
            React.createElement(Text, { color: color.muted }, label)
        ),
        React.createElement(Text, { color: color.muted, wrap: 'truncate' }, value)
    );
}

/**
 * Under the wordmark, before the panel: what is running and where. Model and
 * company neutral-white on purpose — the wordmark above carries the colour.
 */
function IdentityBlock({ info, sessionId, width }) {
    return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(
            Text,
            { wrap: 'truncate' },
            React.createElement(Text, { color: color.user }, info.model),
            React.createElement(Text, { color: color.muted }, ' · '),
            React.createElement(Text, { color: color.user }, 'Sherman Abrams Labs')
        ),
        React.createElement(Field, {
            label: 'folder',
            value: truncatePath(info.vaultPath, Math.max(1, width - LABEL)),
        }),
        React.createElement(Field, { label: 'session', value: sessionId ?? '—' })
    );
}

function Section({ title, lines }) {
    return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(Text, { color: color.accent, bold: true }, title),
        ...lines.map((line, i) =>
            React.createElement(
                Text,
                { key: i, color: color.muted, wrap: 'truncate' },
                `  ${line}`
            )
        )
    );
}

/** Left column: the mark, then who is signed in. Where and which session moved
 *  up to the identity block. */
function Identity({ info }) {
    return React.createElement(
        Box,
        { width: LEFT_COLUMN, flexShrink: 0, flexDirection: 'column' },
        React.createElement(Mark),
        React.createElement(
            Box,
            { marginTop: 1, flexDirection: 'column' },
            React.createElement(Field, { label: 'user', value: info.user })
        )
    );
}

/** Right column: what Sherman can reach, and how to drive it. */
function Knowledge({ stats }) {
    const vaultLines = stats.ok
        ? [
              `${plural(stats.wiki, 'wiki page')} · ${plural(stats.shared, 'shared fact')}`,
              `${plural(stats.private, 'private fact')} · ${plural(stats.inbox, 'inbox item')}`,
          ]
        : // Unreachable is a different problem from empty, and the panel should
          // not let them look the same.
          ['unreadable — check vault_path in ~/.sherman/config.json'];

    return React.createElement(
        Box,
        { flexGrow: 1, flexDirection: 'column' },
        React.createElement(Section, { title: 'Vault', lines: vaultLines }),
        React.createElement(
            Box,
            { marginTop: 1 },
            React.createElement(Section, {
                title: 'Keys',
                // What actually exists. There are no slash commands in the shell
                // today, so this lists the real affordances rather than inventing
                // a Commands section to fill the space.
                lines: ['enter    send', 'ctrl+c   interrupt, again to exit'],
            })
        ),
        // Skills is absent, not empty. A "coming soon" placeholder would be the
        // one invented thing on an otherwise entirely true panel.
        existsSync(SKILLS_DIR)
            ? React.createElement(
                  Box,
                  { marginTop: 1 },
                  React.createElement(Section, { title: 'Skills', lines: ['see skills/'] })
              )
            : null
    );
}

/** One plain sentence. No exclamation marks — that is not Sherman's voice. */
function welcome(stats) {
    if (!stats.ok) {
        return 'I cannot reach the vault, so I know nothing about the business yet.';
    }
    if (stats.wiki + stats.shared + stats.private === 0) {
        return 'The vault is empty so far, so I will tell you when I do not know something.';
    }
    return 'Ask me about the company, and I will say when something is outside what I know.';
}

/**
 * Rows this screen occupies, derived from the same constants the components
 * render with — never re-measured, never guessed. Drift here costs a line of
 * filler, not a wrapped panel, so derived arithmetic is the right tool.
 */
function estimateRows(width, hasSkills) {
    const identity = 3;
    const left = MARK_ROWS + 1 + 1; // mark, margin, user
    const right = 3 + 1 + 3 + (hasSkills ? 3 : 0); // vault, gap, keys, skills
    const inner = Math.max(left, right) + 1 + 1; // + footer margin + footer
    const panel = 1 + inner + 1; // version border + body + bottom border
    // wordmark, gap, identity, gap, panel, gap, welcome
    return wordmarkRows(width) + 1 + identity + 1 + panel + 1 + 1;
}

/**
 * @param {{info: object, stats: import('../vault.js').VaultStats, sessionId?: string, columns?: number, rows?: number}} props
 *
 * `columns` and `rows` override the measured size. Live, nothing passes them;
 * they exist because `useWindowSize()` reports a fixed 80x24 under
 * `renderToString` (D17), so neither the narrow fallback nor the height math
 * could be tested off a TTY without injection. Resolved once here and passed
 * down, so no two parts of the screen can disagree about the terminal.
 */
export function LaunchScreen({ info, stats, sessionId, columns, rows }) {
    const measured = useWindowSize();
    const width = typeof columns === 'number' ? columns : measured.columns;
    const height = typeof rows === 'number' ? rows : measured.rows;

    // Never a constant. A fixed width overflows the moment the terminal is
    // narrower than it, and a spilled border is the exact "wrapped garbage" this
    // screen must not produce.
    const panel = Math.min(width - 2, MAX_PANEL);

    // The opener owns the first viewport: whatever the content does not use,
    // the filler hands to the margin so the composer region sits at the bottom
    // of the screen on entry. On small terminals this clamps to the old
    // one-line gap and the screen simply scrolls, exactly as before.
    const filler = Math.max(
        1,
        height - estimateRows(width, existsSync(SKILLS_DIR)) - CHROME_ROWS
    );

    return React.createElement(
        Box,
        { flexDirection: 'column', marginBottom: filler },
        React.createElement(Wordmark, { columns: width }),
        React.createElement(
            Box,
            { marginTop: 1 },
            React.createElement(IdentityBlock, { info, sessionId, width: panel })
        ),
        React.createElement(
            Box,
            { marginTop: 1, width: panel, flexDirection: 'column' },
            React.createElement(VersionBorder, { width: panel }),
            React.createElement(
                Box,
                {
                    width: panel,
                    borderStyle: 'round',
                    borderTop: false,
                    // Deep red, not the accent: the wordmark and mark carry the
                    // colour on this screen, and the frame must not compete.
                    borderColor: color.frame,
                    paddingX: 1,
                    flexDirection: 'column',
                },
                React.createElement(
                    Box,
                    { flexDirection: 'row' },
                    React.createElement(Identity, { info }),
                    React.createElement(Knowledge, { stats })
                ),
                React.createElement(
                    Box,
                    { marginTop: 1 },
                    React.createElement(
                        Text,
                        { color: color.faint, dimColor: true, wrap: 'truncate' },
                        'ctrl+c to exit'
                    )
                )
            )
        ),
        React.createElement(
            Box,
            { marginTop: 1 },
            React.createElement(Text, { color: color.muted, wrap: 'truncate' }, welcome(stats))
        )
    );
}
