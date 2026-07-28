// The first frame.
//
// v5.1, the presence pass: the wordmark, the panel, and everything after it
// span the full terminal width, Hermes-style. One bordered panel with the
// build stamped into its top border; a narrow left column carrying the full
// mark; a dense right column carrying vault, keys, and identity. Nothing floats
// above the box, and nothing pushes the prompt to the bottom of the screen —
// the welcome line, status bar, and composer stack directly under the panel.
//
// The governing rule is that every value on it is true. Nothing here is
// hardcoded copy standing in for a real number: the counts come from a readdir,
// the identity comes from session.info, the session id from the launcher, the
// version from package.json, the sha from git — and when a source is absent
// (no git on a future employee install), its segment is OMITTED, never faked.
//
// Like the banner it replaces, this is the transcript's first item and scrolls
// out of the viewport as the session grows (D12/D13). Its VALUES are frozen at
// launch — info and vault counts travel on the item itself (see app.js), so the
// panel keeps showing what was true when it appeared — while its geometry is
// live like every other component's, since the viewport transcript re-renders
// items on every frame.

import React from 'react';
import { Text, Box, useWindowSize } from 'ink';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { color } from './theme.js';
import { Wordmark } from './Wordmark.js';
import { Mark } from './Mark.js';
import { safeTerminalText } from './sanitize.js';

// Resolved from THIS file, never process.cwd() — at runtime the cwd is the
// engine's workspace, not the repo. Same reasoning as Header.js.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');


// The mark is 12 columns; four columns of breathing room separate it from the
// information column without making narrow terminals pay for oversized art.
const LEFT_COLUMN = 16;
const PANEL_PAD_X = 2;
const LABEL = 9;

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
// Read once per process: the values cannot change mid-session, and the viewport
// transcript renders this panel on every frame — an uncached readFileSync and
// git exec per frame would be absurd.
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

/** `label   value` on one truncated line. Labels recede; identity values may light. */
function Field({ label, value, valueColor = color.muted, bold = false }) {
    return React.createElement(
        Box,
        { flexDirection: 'row' },
        React.createElement(
            Box,
            { width: LABEL, flexShrink: 0 },
            React.createElement(Text, { color: color.muted }, label)
        ),
        React.createElement(Text, { color: valueColor, bold, wrap: 'truncate' }, safeTerminalText(value))
    );
}

function Section({ title, lines }) {
    return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(Text, { color: color.accent, bold: true, wrap: 'truncate' }, title),
        ...lines.map((line, i) =>
            React.createElement(
                Text,
                { key: i, color: color.muted, wrap: 'truncate' },
                `  ${line}`
            )
        )
    );
}

/** Identity values lead the right column so operational context is visible first. */
function IdentityFields({ info, sessionId, width }) {
    const valueBudget = Math.max(1, width - LABEL);
    return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(Field, {
            label: 'model',
            value: info.model,
            valueColor: color.valueModel,
            bold: true,
        }),
        React.createElement(Field, {
            label: 'engine',
            value: info.engine,
            valueColor: color.valueEngine,
        }),
        React.createElement(Field, {
            label: 'user',
            value: info.user,
            valueColor: color.valueUser,
        }),
        React.createElement(Field, {
            label: 'vault',
            value: truncatePath(info.vaultPath, valueBudget),
        }),
        React.createElement(Field, { label: 'session', value: sessionId ?? '—' })
    );
}

/**
 * Right column: what Sherman can reach and how to drive it.
 *
 * Identity and controls stay content-hugging at every height, matching Hermes:
 * extra terminal rows belong to the transcript viewport, not stretched cards.
 */
function Knowledge({ stats, info, sessionId, width }) {
    const vaultLines = stats.ok
        ? [
              `${plural(stats.wiki, 'wiki page')} · ${plural(stats.shared, 'shared fact')}`,
              `${plural(stats.private, 'private fact')} · ${plural(stats.inbox, 'inbox item')}`,
          ]
        : // Unreachable is a different problem from empty, and the panel should
          // not let them look the same.
          ['unreadable — check vault_path in ~/.sherman/config.json'];

    // Built as a list so the uniform inter-section gap is applied in one place.
    const sections = [];

    sections.push(
        React.createElement(IdentityFields, { key: 'identity', info, sessionId, width })
    );

    sections.push(
        React.createElement(Section, { key: 'vault', title: 'Vault', lines: vaultLines }),
        React.createElement(Section, {
            key: 'keys',
            title: 'Keys',
            lines: [
                'enter    send',
                '/        commands · tab completes',
                'ctrl+c   interrupt, again to exit',
            ],
        })
    );

    return React.createElement(
        Box,
        {
            flexGrow: 1,
            flexDirection: 'column',
            justifyContent: 'flex-start',
        },
        ...sections.map((section, i) =>
            React.createElement(
                Box,
                {
                    key: section.key,
                    flexDirection: 'column',
                    flexShrink: 0,
                    marginTop: i > 0 ? 1 : 0,
                },
                section
            )
        )
    );
}

/** Short-terminal readiness card: operational facts win over decorative art. */
function CompactSummary({ width, info, stats, sessionId }) {
    if (width < 4) return React.createElement(Text, { wrap: 'truncate' }, 'sherman');

    const facts = stats.wiki + stats.shared + stats.private;
    const vault = stats.ok
        ? `${plural(facts, 'fact')} · ${plural(stats.inbox, 'inbox item')}`
        : 'unavailable · check vault_path';
    const session = sessionId ? `…${sessionId.slice(-6)}` : '—';

    return React.createElement(
        Box,
        { width, flexDirection: 'column' },
        React.createElement(VersionBorder, { width }),
        React.createElement(
            Box,
            {
                width,
                borderStyle: 'round',
                borderTop: false,
                borderColor: color.frame,
                paddingX: PANEL_PAD_X,
                flexDirection: 'column',
            },
            React.createElement(
                Text,
                { wrap: 'truncate' },
                React.createElement(Text, { color: stats.ok ? color.tertiary : color.error }, stats.ok ? '● ready  ' : '× blocked  '),
                React.createElement(Text, { color: color.valueEngine }, safeTerminalText(info.engine)),
                React.createElement(Text, { color: color.muted }, ' · '),
                React.createElement(Text, { color: color.valueModel, bold: true }, safeTerminalText(info.model))
            ),
            React.createElement(Text, { color: color.muted, wrap: 'truncate' }, `vault     ${vault}`),
            React.createElement(
                Text,
                { color: color.muted, wrap: 'truncate' },
                `user      ${safeTerminalText(info.user)} · session ${session}`
            ),
            React.createElement(
                Text,
                { wrap: 'truncate' },
                React.createElement(Text, { color: color.secondary }, '⋯ summary'),
                React.createElement(Text, { color: color.muted }, ' · '),
                React.createElement(Text, { color: color.tertiary }, '› activity'),
                React.createElement(Text, { color: color.muted }, ' · /help commands')
            )
        )
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
 * @param {{info: object, stats: import('../vault.js').VaultStats, sessionId?: string, columns?: number, rows?: number}} props
 *
 * `columns` overrides the measured size. Live, nothing passes it; it exists
 * because `useWindowSize()` reports a fixed 80x24 under `renderToString`
 * (D17), so the narrow fallback and the full-bleed border could not be tested
 * off a TTY without injection. Resolved once here and passed down, so no two
 * parts of the screen can disagree about the terminal.
 *
 * `rows` is injectable for the same reason and selects only the short-terminal
 * summary; full launch cards always hug their content.
 */
export function LaunchScreen({ info, stats, sessionId, columns, rows }) {
    const measured = useWindowSize();
    const width = typeof columns === 'number' ? columns : measured.columns;
    const height = typeof rows === 'number' ? rows : measured.rows;
    const compactWordmark = height < 40;

    // Full bleed: the panel spans the terminal, like Hermes. Never a fixed
    // constant — the border is composed to the measured width, so a narrow
    // terminal gets a narrow panel, not a spilled one.
    const panel = Math.max(1, width);
    // Border + horizontal padding consume six columns. Below the normal
    // two-column layout, stack identity above knowledge and let both shrink.
    const inner = Math.max(1, panel - 2 - PANEL_PAD_X * 2);
    const stack = inner < LEFT_COLUMN + 20;
    // The welcome sentence and its margin cost two rows after either panel.
    const compactPanel = height < (stack ? 41 : 29);

    const leftWidth = Math.min(LEFT_COLUMN, inner);
    const rightWidth = Math.max(1, inner - leftWidth);

    return React.createElement(
        Box,
        { flexDirection: 'column', marginBottom: 1 },
        React.createElement(Wordmark, { columns: width, compact: compactWordmark }),
        compactPanel
            ? React.createElement(
                  Box,
                  { marginTop: 1, width: panel, flexDirection: 'column' },
                  React.createElement(CompactSummary, {
                      width: panel,
                      info,
                      stats,
                      sessionId,
                  })
              )
            : React.createElement(
                  Box,
                  { marginTop: 1, width: panel, flexDirection: 'column' },
                  React.createElement(VersionBorder, { width: panel }),
            React.createElement(
                Box,
                {
                    width: panel,
                    borderStyle: 'round',
                    borderTop: false,
                    // The same anchor used by the rest of the shell chrome.
                    borderColor: color.frame,
                    paddingX: PANEL_PAD_X,
                    paddingY: 0,
                    flexDirection: 'column',
                },
                React.createElement(
                    Box,
                    {
                        flexDirection: stack ? 'column' : 'row',
                    },
                    React.createElement(
                        Box,
                        {
                            flexShrink: 0,
                            width: leftWidth,
                            flexDirection: 'column',
                            justifyContent: 'flex-start',
                            alignItems: 'center',
                        },
                        React.createElement(Mark)
                    ),
                    React.createElement(
                        Box,
                        {
                            marginTop: stack ? 1 : 0,
                            flexGrow: 1,
                            flexDirection: 'column',
                        },
                        React.createElement(Knowledge, {
                            stats,
                            info,
                            sessionId,
                            width: stack ? inner : rightWidth,
                        })
                    )
                )
                  )
              ),
        React.createElement(
            Box,
            { marginTop: 1 },
            React.createElement(
                Text,
                { color: color.muted, wrap: 'truncate' },
                welcome(stats)
            )
        )
    );
}
