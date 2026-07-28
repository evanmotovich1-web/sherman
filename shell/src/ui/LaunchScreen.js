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
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { color } from './theme.js';
import { Wordmark } from './Wordmark.js';
import { Mark } from './Mark.js';

// Resolved from THIS file, never process.cwd() — at runtime the cwd is the
// engine's workspace, not the repo. Same reasoning as Header.js.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SKILLS_DIR = join(REPO_ROOT, 'skills');

// The mark is 12 columns; four columns of breathing room keep it from feeling
// pinned to the divider while giving the information column the useful width.
const LEFT_COLUMN = 16;
const LABEL = 9;

// ------------------------------------------------------------- tall layout --
// v6.1: on a tall terminal the panel stops hugging its content and takes real
// vertical presence, Hermes-style -- the two columns spread their sections down
// a taller box instead of stacking at the top over a void.
//
// Three numbers govern it, and the layout collapses to the v5.1 compact one the
// moment any of them is not met. That collapse is the point: the compact layout
// is not a degraded mode, it is the correct layout for a short terminal, and a
// panel that ate a 24-row screen would push the composer off the bottom.

/** Share of the terminal the panel may claim. The remaining 40% is what keeps
 *  the welcome line, status bar, and composer on screen. */
const TALL_SHARE = 0.6;

/**
 * Below this many rows the panel simply hugs its content.
 *
 * The compact panel's natural body is ~13-15 rows, so a threshold of 22 means
 * tall mode only ever engages when there is genuinely slack to distribute --
 * never to stretch a box by two rows and call it presence. In practice this is
 * the difference between a 24-row terminal (compact) and a 40-row one (tall).
 */
const TALL_MIN_ROWS = 22;

/** In tall mode the left column also carries identity, so it must fit a label
 *  plus a readable value rather than just the 12-column mark. */
const LEFT_COLUMN_TALL = 34;

/** Border top, border bottom, and one row of padding at each end. */
const PANEL_CHROME_ROWS = 4;

/**
 * Rows the launch frame owes to everything that is not the panel.
 *
 * The wordmark above it (~15), the welcome line and its margins (~3), and the
 * shell chrome below the transcript -- compact header, status bar, and the
 * four-row composer (~9). The panel may only spread into what is left after
 * those, because the transcript clips from the edge: a panel that claimed 60%
 * of a 40-row terminal would not push the composer down, it would silently
 * shear the wordmark off the top. Growing into a void is the goal; growing
 * over the rest of the screen is the bug this constant prevents.
 */
const LAUNCH_FIXED_ROWS = 27;

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
        React.createElement(Text, { color: valueColor, bold, wrap: 'truncate' }, value)
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

/** Identity values live under Keys so the right column ends with information. */
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
 * `spread` distributes the sections down the column instead of stacking them
 * under one another. The one-row gaps between sections become the spacing
 * mechanism's job, so they are dropped when spreading -- keeping both would
 * double the air above every section but the first.
 *
 * In compact mode identity rides here, at the bottom, so the column ends with
 * information. In tall mode it moves to the left column under the mark, which
 * is why it arrives as a prop rather than being built unconditionally.
 */
function Knowledge({ stats, info, sessionId, width, spread = false, includeIdentity = true }) {
    const vaultLines = stats.ok
        ? [
              `${plural(stats.wiki, 'wiki page')} · ${plural(stats.shared, 'shared fact')}`,
              `${plural(stats.private, 'private fact')} · ${plural(stats.inbox, 'inbox item')}`,
          ]
        : // Unreachable is a different problem from empty, and the panel should
          // not let them look the same.
          ['unreadable — check vault_path in ~/.sherman/config.json'];

    // Built as a list so `spread` can decide the spacing mechanism once, rather
    // than every branch below repeating a marginTop it might not want.
    const sections = [
        React.createElement(Section, { key: 'vault', title: 'Vault', lines: vaultLines }),
        React.createElement(Section, {
            key: 'keys',
            title: 'Keys',
            lines: [
                'enter    send',
                '/        commands · tab completes',
                'ctrl+c   interrupt, again to exit',
            ],
        }),
    ];

    if (includeIdentity) {
        sections.push(
            React.createElement(IdentityFields, { key: 'identity', info, sessionId, width })
        );
    }

    // Skills is absent, not empty. A "coming soon" placeholder would be the
    // one invented thing on an otherwise entirely true panel.
    if (existsSync(SKILLS_DIR)) {
        sections.push(
            React.createElement(Section, {
                key: 'skills',
                title: 'Skills',
                lines: ['see skills/'],
            })
        );
    }

    return React.createElement(
        Box,
        {
            flexGrow: 1,
            flexDirection: 'column',
            // space-evenly, not space-between: with only two real sections
            // today (Skills does not exist yet) space-between pins Vault to the
            // ceiling and Keys to the floor with a dozen dead rows between
            // them, which trades one void for a worse one. Even spacing keeps
            // the sections reading as a set however many there are.
            justifyContent: spread ? 'space-evenly' : 'flex-start',
        },
        ...sections.map((section, i) =>
            React.createElement(
                Box,
                {
                    key: section.key,
                    flexDirection: 'column',
                    flexShrink: 0,
                    marginTop: !spread && i > 0 ? 1 : 0,
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
                paddingX: 1,
                flexDirection: 'column',
            },
            React.createElement(
                Text,
                { wrap: 'truncate' },
                React.createElement(Text, { color: stats.ok ? color.tertiary : color.error }, stats.ok ? '● ready  ' : '× blocked  '),
                React.createElement(Text, { color: color.valueEngine }, info.engine),
                React.createElement(Text, { color: color.muted }, ' · '),
                React.createElement(Text, { color: color.valueModel, bold: true }, info.model)
            ),
            React.createElement(Text, { color: color.muted, wrap: 'truncate' }, `vault     ${vault}`),
            React.createElement(
                Text,
                { color: color.muted, wrap: 'truncate' },
                `user      ${info.user} · session ${session}`
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
 * `rows` is injectable for the same reason and, since v6.1, is load-bearing:
 * it is what decides whether the panel spreads (tall) or hugs (compact).
 */
export function LaunchScreen({ info, stats, sessionId, columns, rows }) {
    const measured = useWindowSize();
    const width = typeof columns === 'number' ? columns : measured.columns;
    const height = typeof rows === 'number' ? rows : measured.rows;
    const compactPanel = height <= 26;
    const compactWordmark = height < 40;

    // Full bleed: the panel spans the terminal, like Hermes. Never a fixed
    // constant — the border is composed to the measured width, so a narrow
    // terminal gets a narrow panel, not a spilled one.
    const panel = Math.max(1, width);
    // Border + horizontal padding consume four columns. Below the normal
    // two-column layout, stack identity above knowledge and let both shrink.
    const inner = Math.max(1, panel - 4);
    const stack = inner < LEFT_COLUMN + 20;

    // Tall mode needs BOTH a terminal with rows to spare and a panel wide
    // enough for a left column that carries identity as well as the mark.
    // Stacked (very narrow) never goes tall: with one column there is nothing
    // to distribute against, and spreading would just scatter the sections.
    // Two ceilings, and the panel respects the lower: the 60% share, and
    // whatever the frame has left after the wordmark, welcome, and chrome.
    const budget = Math.min(
        Math.floor(height * TALL_SHARE),
        height - LAUNCH_FIXED_ROWS
    );
    const tall = !stack && budget >= TALL_MIN_ROWS && inner >= LEFT_COLUMN_TALL + 22;

    const leftWidth = Math.min(tall ? LEFT_COLUMN_TALL : LEFT_COLUMN, inner);
    const rightWidth = Math.max(1, inner - leftWidth);
    // minHeight, never height: it lets the panel GROW into the budget while
    // guaranteeing content that happens to be taller (a wrapped vault error,
    // a long path) is never clipped by the number we picked.
    const bodyRows = Math.max(0, budget - PANEL_CHROME_ROWS);

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
                    paddingX: 1,
                    paddingY: 1,
                    flexDirection: 'column',
                },
                React.createElement(
                    Box,
                    {
                        flexDirection: stack ? 'column' : 'row',
                        // The one line that gives the panel its height. In
                        // compact mode bodyRows is below the natural content
                        // height, so this is inert and the layout is v5.1's
                        // exactly -- no separate compact branch to drift.
                        minHeight: tall ? bodyRows : 0,
                    },
                    React.createElement(
                        Box,
                        {
                            flexShrink: 0,
                            width: leftWidth,
                            flexDirection: 'column',
                            // Mark at the top, identity at the foot, the gap
                            // between them carrying the panel's new height.
                            justifyContent: tall ? 'space-between' : 'flex-start',
                        },
                        React.createElement(Mark),
                        tall
                            ? React.createElement(
                                  Box,
                                  { flexDirection: 'column', flexShrink: 0, marginTop: 1 },
                                  React.createElement(IdentityFields, {
                                      info,
                                      sessionId,
                                      width: leftWidth,
                                  })
                              )
                            : null
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
                            spread: tall,
                            includeIdentity: !tall,
                            width: stack ? inner : rightWidth,
                        })
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
