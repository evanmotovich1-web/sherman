// The first frame.
//
// Wordmark, one bordered panel, one welcome line. It answers "what is this and
// what does it know" before the user types anything.
//
// The governing rule is that every value on it is true. Nothing here is
// hardcoded copy standing in for a real number: the counts come from a readdir,
// the identity comes from session.info, and the Skills section is absent rather
// than empty because there are no skills yet. When the panel says zero it is
// because the answer is zero.
//
// Like the banner it replaces, this commits once through <Static> and scrolls
// away (D12/D13). It is a bigger opener, not a pinned one.

import React from 'react';
import { Text, Box, useWindowSize } from 'ink';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { color } from './theme.js';
import { Wordmark } from './Wordmark.js';
import { Mark } from './Mark.js';

// Resolved from THIS file, never process.cwd() — at runtime the cwd is the
// engine's workspace, not the repo. Same reasoning as Header.js.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SKILLS_DIR = join(REPO_ROOT, 'skills');

// Wide enough to read, narrow enough that a 200-column terminal does not get a
// panel stretched across the whole screen.
const MAX_PANEL = 76;

// Holds the mark (10 wide) plus a label/value pair without crushing either.
const LEFT_COLUMN = 26;
const LABEL = 9;

/**
 * Keep the tail of a path, cutting only at separators.
 *
 * StatusBar truncates to an exact character budget, which on this column yields
 * `…de/sherman/vault` — a fragment of a directory name that reads as corruption
 * rather than as a path. Dropping whole segments gives `…/sherman/vault`, which
 * is the point of showing the tail at all.
 *
 * Local rather than shared: StatusBar is verified and out of scope for this
 * plan, and its character-exact behaviour is right for a status line that must
 * hit a total width.
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

/** Left column: the mark, then who and where. */
function Identity({ info }) {
    return React.createElement(
        Box,
        { width: LEFT_COLUMN, flexShrink: 0, flexDirection: 'column' },
        React.createElement(Mark),
        React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
            React.createElement(Field, { label: 'user', value: info.user }),
            React.createElement(Field, {
                label: 'vault',
                value: truncatePath(info.vaultPath, LEFT_COLUMN - LABEL),
            }),
            // threadId is null until the engine reports one, so at launch this is
            // always 'new'. That is the honest value, not a placeholder.
            React.createElement(Field, { label: 'session', value: info.threadId ?? 'new' })
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
 * @param {{info: object, stats: import('../vault.js').VaultStats, columns?: number}} props
 *
 * `columns` overrides the measured width. Nothing passes it live; it exists
 * because `useWindowSize()` reports a fixed 80x24 under `renderToString`, so
 * without it neither the narrow fallback nor the wide case could be tested off
 * a TTY. Resolved once here and passed down, so the wordmark and the panel can
 * never disagree about how wide the terminal is.
 */
export function LaunchScreen({ info, stats, columns }) {
    const measured = useWindowSize().columns;
    const width = typeof columns === 'number' ? columns : measured;

    // Never a constant. A fixed width overflows the moment the terminal is
    // narrower than it, and a spilled border is the exact "wrapped garbage" this
    // screen must not produce.
    const panel = Math.min(width - 2, MAX_PANEL);

    return React.createElement(
        Box,
        { flexDirection: 'column', marginBottom: 1 },
        React.createElement(Wordmark, { columns: width }),
        React.createElement(
            Box,
            {
                marginTop: 1,
                width: panel,
                borderStyle: 'round',
                borderColor: color.accent,
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
                    `${info.engine} · ${info.model} · ctrl+c to exit`
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
