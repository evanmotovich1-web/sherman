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
import { fitCategory, loadRegistry } from '../registry.js';
import {
    RETRO_MIN_COLUMNS,
    RETRO_ROWS,
    SMALL_ROWS,
    STACK_MIN_COLUMNS,
    STACK_ROWS,
    Wordmark,
} from './Wordmark.js';
import { Mark, MarkStrip, markSize } from './Mark.js';
import { safeTerminalText } from './sanitize.js';

// Resolved from THIS file, never process.cwd() — at runtime the cwd is the
// engine's workspace, not the repo. Same reasoning as Header.js.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');


// The company Sherman works for. The one string on the launch frame that is
// copy rather than a measured value, and it is the company's actual name.
const COMPANY = 'Sherman Abrams Labs';

// The left column carries the mark AND the identity block beneath it now —
// model · company, the vault path, the session — centered, the reference's
// arrangement. Its width is what the identity lines need: the model·company
// line runs ~33 cells with a typical model name, so 37 gives it two cells of
// air. The mark (12 or 24 wide) centers inside the same column either way,
// which is why the doubled mark no longer needs a wider column of its own.
const LEFT_COLUMN = 37;
const LEFT_COLUMN_LARGE = Math.max(markSize(2).columns + 4, LEFT_COLUMN);
// Mark, one blank row, then the three identity lines.
const IDENTITY_ROWS = 3;
const LEFT_ROWS = markSize(1).rows + 1 + IDENTITY_ROWS;
const PANEL_PAD_X = 2;
const LABEL = 9;

// ------------------------------------------------------------- tall budget --
// On a tall terminal the content-hugging panel left most of the screen empty
// above the composer, which read as an unfinished frame rather than as space.
// Above the threshold the panel claims a share of the height and its sections
// spread into it; below it, nothing changes — the compact card stays canonical
// for short terminals, which is the size most launches actually happen at.
//
// The threshold sits above the compact cutoffs (29/44) so the two never fight:
// a terminal is either short enough for the compact card or tall enough to
// stretch, never switching modes on the same row.
//
// Lowering this to 30 was tried, to close the same slack on mid-height
// terminals, and reverted: it breaks the documented hug at 40 rows and starves
// the mark at another size. Below this threshold the panel still hugs and the
// slack still falls under it — a known, bounded gap at sizes between the
// compact cutoff and here, not an oversight.
const TALL_MIN_ROWS = 44;

// What the frame leaves between itself and the status rule.
//
// This used to be a share of the terminal (0.75), and a share is not a spacing
// decision — it is a number that produces a different gap at every height. At
// 120x44 it left FIVE blank rows under the welcome line while the reference
// leaves one, and the panel read as though it had drifted up the screen away
// from the chrome rather than sitting above it.
//
// So the budget is stated as the gap it is actually trying to produce. The
// frame claims the transcript's height minus the chrome it must not collide
// with. The separating blank row is NOT added here: the launch frame already
// carries marginBottom:1 under its welcome sentence, so an extra tail row would
// spend two rows on one gap. One blank row between the welcome line and the
// status rule is the target, and the frame already owns it.
//
// Rows below the transcript at launch: the status rule, and the composer's
// three (top border, prompt, bottom border). The activity line is not counted —
// it only exists during a turn, by which point the launch frame has scrolled.
const CHROME_ROWS = 4;
const LAUNCH_TAIL_ROWS = 0;
// Rows the frame spends outside the panel body at every size: the marginTop
// above the panel, the panel's own top and bottom border rows, the marginTop
// above the welcome line, the welcome line, and the trailing marginBottom.
const LAUNCH_FIXED_ROWS = 6;
// The mark's 22-row pixel grid is drawn two pixel rows per text row.
const MARK_ROWS = markSize(1).rows;
// The doubled rendition used in the tall panel, in text rows.
const MARK_ROWS_LARGE = markSize(2).rows;

/**
 * Rows the right column occupies when it hugs its content: the registry
 * sections, the Vault section, and the closing tally, with one blank row
 * between sections. Identity is not here any more — it lives under the mark.
 * An unreadable vault renders one line where a readable one renders two, and
 * the budget has to follow that or a blocked vault would stretch by one row
 * more than it earned.
 */
function knowledgeRows(stats, registry, caps = null) {
    const vaultLines = stats.ok ? 2 : 1;
    // A registry section is its title plus one row per category, or its title
    // plus the one row that says why it is unavailable.
    const registryRows = (result, cap) => {
        if (!result.ok) return 1 + 1;
        const shown = cap === undefined || cap === null ? result.categories.length
            : Math.min(result.categories.length, cap);
        return 1 + shown;
    };

    // Base: the Vault section and the closing tally, with a blank row between
    // them. This is what the column costs when the lists are gone.
    const base = (1 + vaultLines) + 1 + 1;
    if (caps && caps.tools === 0 && caps.skills === 0) return base;

    return (
        registryRows(registry.tools, caps?.tools)
        + 1 + registryRows(registry.skills, caps?.skills)
        + 1 + base
    );
}

/**
 * How many category rows each registry section may print.
 *
 * Derived from the frame that will actually be drawn rather than from a
 * threshold constant: the launch frame must leave the status rule and the
 * composer their two rows, and the lists are the only part of the panel that
 * can give rows back. Below the point where a section could show a title and
 * even one group, BOTH lists are dropped and the closing tally carries the
 * counts alone — `15 tools · 5 skills` is still the whole truth, and a section
 * header over nothing is not.
 *
 * Returns `{tools, skills}` row caps, or nulls meaning "no limit".
 */
export function listBudget({ height, wordmark, stack, stats, registry }) {
    const full = { tools: null, skills: null };

    // Two rows for the status strip and the composer beneath the frame.
    const allowedInner = height - 2 - wordmark - LAUNCH_FIXED_ROWS - (stack ? LEFT_ROWS + 1 : 0);
    const natural = knowledgeRows(stats, registry, null);
    if (allowedInner >= natural) return full;

    const base = knowledgeRows(stats, registry, { tools: 0, skills: 0 });
    // Each section costs a blank row and a title before its first group.
    const listRoom = allowedInner - base - 4;
    if (listRoom < 2) return { tools: 0, skills: 0 };

    // Split what is left, giving the odd row to tools: it is the longer list,
    // so it is the one that loses most from a cap.
    const skills = Math.floor(listRoom / 2);
    return { tools: listRoom - skills, skills };
}

/**
 * The registry, read once per process.
 *
 * The panel's values are frozen at launch by design (see the file header), and
 * the registry is a property of the installation rather than of the frame, so
 * re-reading it on every render would be disk IO inside a render pass to
 * produce an identical answer. App passes the loaded registry down with the
 * transcript item; this cache serves direct renders — fixtures and tests —
 * without making `registry` a required prop at every call site.
 */
let registryCache = null;
function cachedRegistry() {
    if (registryCache === null) registryCache = loadRegistry();
    return registryCache;
}

/**
 * Inner rows the panel body should stretch to, or `null` to hug its content.
 *
 * Returns null below the threshold so the existing behaviour is bit-for-bit
 * unchanged there, and clamps to the natural height so the budget can only ever
 * grow the panel — a terminal tall enough to trigger this but narrow enough to
 * stack must never end up with a panel SHORTER than its own content.
 */
function tallPanelRows(wmRows, height, naturalInnerRows) {
    if (height < TALL_MIN_ROWS) return null;
    // The height the whole frame may occupy so exactly LAUNCH_TAIL_ROWS blank
    // rows remain between it and the status rule.
    const frame = height - CHROME_ROWS - LAUNCH_TAIL_ROWS;
    const body = frame - wmRows - LAUNCH_FIXED_ROWS;
    return body > naturalInnerRows ? body : null;
}

/**
 * Integer scale for the mark: 2 in a tall panel with room for it, else 1.
 *
 * The doubled mark is only ever *added* room the panel already claimed, so it
 * can never push the body past the budget `tallPanelRows` computed: it needs
 * both the rows (the stretched body is already at least 22 inner rows) and the
 * columns (the wider left column must still leave the knowledge column its 20).
 * Every other case — compact card, hugging panel, stacked narrow layout — falls
 * through to 1, which is the compact rendition, byte-identical to before.
 *
 * Exported so the scale rule is testable without rendering a whole screen.
 */
export function markScaleFor({ bodyRows, stack, inner }) {
    if (!bodyRows || stack) return 1;
    // The doubled mark shares its column with the identity block now, so the
    // rows it must fit are the art PLUS the gap and the three identity lines —
    // gating on the art alone would double the mark into a body one row too
    // short and push the identity past the budget the panel promised.
    if (bodyRows < MARK_ROWS_LARGE + 1 + IDENTITY_ROWS) return 1;
    if (inner < LEFT_COLUMN_LARGE + 20) return 1;
    return 2;
}

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
    let behind = 0;

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

    // Commits upstream carries that HEAD does not — counted against the
    // remote-tracking ref already on disk, so this is a local read, never a
    // network call in a render path. The launcher freshens those refs with a
    // background fetch at launch; offline they simply hold the last fetched
    // truth. No upstream (a tarball install, a detached head) throws, and the
    // notice is then omitted rather than guessed.
    try {
        behind = Number(
            execFileSync('git', ['-C', REPO_ROOT, 'rev-list', '--count', 'HEAD..@{upstream}'], {
                stdio: ['ignore', 'pipe', 'ignore'],
            })
                .toString()
                .trim()
        );
        if (!Number.isFinite(behind) || behind < 0) behind = 0;
    } catch {
        behind = 0;
    }

    cachedBuild = { version, sha, dirty, behind };
    return cachedBuild;
}

/**
 * The update-notice source, with a test seam: SHERMAN_UPDATE_BEHIND overrides
 * the measured count (read fresh on every call, unlike the cached git reads)
 * so layout tests can exercise both states of a notice whose real value
 * depends on the state of the checkout running them.
 */
function updateBehind() {
    if (process.env.SHERMAN_UPDATE_BEHIND != null) {
        const forced = Number(process.env.SHERMAN_UPDATE_BEHIND);
        return Number.isFinite(forced) && forced > 0 ? forced : 0;
    }
    return readBuildInfo().behind;
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
    const behind = updateBehind();

    let label = 'Sherman Abrams';
    if (version) label += ` v${version}`;
    if (sha) label += ` · ${sha}`;
    if (sha && dirty > 0) label += ` · +${dirty}`;

    const text = ` ${label} `;
    // The update notice rides in the border the way the reference stamps its
    // upstream/local divergence there: zero rows in every layout tier, and
    // the one row that exists at every size. Present only when the local
    // refs actually carry newer commits — a measurement, never a guess — and
    // it names the command that clears it.
    const notice = behind > 0 ? `⚠ update available · sherman update ` : '';
    // Centered in the border, the reference's placement. The fill splits
    // around the label; the halves differ by at most one dash on odd widths,
    // and the corners always survive because the fills are clamped, not the
    // corners. Bold accent rather than muted for the same reason the reference
    // sets its title line in its one bright colour: this row is the panel's
    // name, not a footnote on it.
    const fill = Math.max(0, width - 2 - [...text].length - [...notice].length - (notice ? 2 : 0));
    const leftFill = Math.floor(fill / 2);
    const rightFill = fill - leftFill;

    return React.createElement(
        Text,
        { wrap: 'truncate' },
        React.createElement(Text, { color: color.frame }, '╭' + '─'.repeat(leftFill)),
        React.createElement(Text, { color: color.accent, bold: true }, text),
        notice
            ? React.createElement(Text, { color: color.frame }, '─ ')
            : null,
        notice
            ? React.createElement(Text, { color: color.tertiary, bold: true }, notice)
            : null,
        React.createElement(Text, { color: color.frame }, '─'.repeat(rightFill) + '╮')
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

/**
 * A registry section: a lit title over one dim-labelled line per category.
 *
 *     Available Tools
 *     session: goal, plan, subagent, compact
 *     file: read_file, search_files, +2 more
 *
 * The three weights are the structure Hermes uses — lit title, receding
 * category label, readable items — rendered in this house's inks rather than
 * its. theme.js already records that translation: Sherman's accent 205 exists
 * "matching Hermes's use of one bright yellow", so a second bright hue here
 * would be a fifth palette in a file whose first rule is one vivid anchor.
 *
 * `result` is the loader's discriminated return. An unavailable registry prints
 * why in the muted weight and prints NO count, because a section that rendered
 * an empty list would say "Sherman has no skills" when the truth is "this
 * install could not be read" — different problems that must not look the same.
 */
function Registry({ title, result, width, maxRows = Infinity }) {
    if (!result.ok) {
        return React.createElement(
            Box,
            { flexDirection: 'column' },
            React.createElement(Text, { color: color.accent, bold: true, wrap: 'truncate' }, title),
            React.createElement(Text, { color: color.muted, wrap: 'truncate' }, `  ${result.reason}`)
        );
    }

    // A short terminal cannot show every category. Dropping the tail silently
    // would understate the toolset, so the last row spends itself saying how
    // many categories it could not show — the same contract fitCategory keeps
    // horizontally, applied vertically.
    const overflowed = result.categories.length > maxRows;
    const visible = overflowed
        ? result.categories.slice(0, Math.max(0, maxRows - 1))
        : result.categories;
    const hiddenCategories = result.categories.length - visible.length;

    const lines = visible.map((category, index) => {
        const { label, shown, more } = fitCategory(category.name, category.items, Math.max(1, width));
        return React.createElement(
            Text,
            { key: index, wrap: 'truncate' },
            // Label recedes, names carry the light. Inverting these two is what
            // made the panel read flat — see color.value in theme.js.
            React.createElement(Text, { color: color.secondary, dimColor: true }, label),
            React.createElement(Text, { color: color.value }, shown.join(', ')),
            more > 0
                ? React.createElement(
                      Text,
                      { color: color.secondary },
                      `${shown.length > 0 ? ', ' : ''}+${more} more`
                  )
                : null
        );
    });

    if (hiddenCategories > 0) {
        lines.push(
            React.createElement(
                Text,
                { key: 'overflow', color: color.secondary, wrap: 'truncate' },
                `+${hiddenCategories} more ${hiddenCategories === 1 ? 'group' : 'groups'}`
            )
        );
    }

    return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(Text, { color: color.accent, bold: true, wrap: 'truncate' }, title),
        ...lines
    );
}

/**
 * The closing tally: `15 tools · 5 skills · /help for commands`.
 *
 * A registry that failed to load contributes NO number — its segment is
 * omitted, exactly as VersionBorder omits a missing sha rather than printing a
 * placeholder. The `/help` hint is unconditional because it is true regardless.
 */
function Totals({ tools, skills }) {
    const segments = [];
    if (tools.ok) segments.push(plural(tools.count, 'tool'));
    if (skills.ok) segments.push(plural(skills.count, 'skill'));
    segments.push('/help for commands');

    return React.createElement(
        Text,
        { color: color.muted, wrap: 'truncate' },
        segments.join(' · ')
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

/**
 * The identity block, centered under the mark — the reference's arrangement,
 * with the company where the reference credits its lab:
 *
 *       gpt-5-codex · Sherman Abrams Labs
 *          /Users/moto/code/sherman/vault
 *       Session: 20260728_220719_8bf52c
 *
 * Three lines, same values as ever (session.info and the launcher), just
 * placed. The engine and user do not vanish from the shell — the status strip
 * carries engine·model persistently, and the compact card still prints the
 * user — but this block is the portrait, and a portrait is not a form.
 */
function MarkIdentity({ info, sessionId, width }) {
    const budget = Math.max(1, width);
    return React.createElement(
        Box,
        { flexDirection: 'column', alignItems: 'center', width },
        React.createElement(
            Text,
            { wrap: 'truncate' },
            React.createElement(Text, { color: color.valueModel, bold: true }, safeTerminalText(info.model)),
            React.createElement(Text, { color: color.muted }, ` · ${COMPANY}`)
        ),
        React.createElement(
            Text,
            { color: color.muted, wrap: 'truncate' },
            truncatePath(info.vaultPath, budget)
        ),
        React.createElement(
            Text,
            { color: color.muted, wrap: 'truncate' },
            `Session: ${sessionId ?? '—'}`
        )
    );
}

/**
 * Right column: what Sherman can reach and how to drive it.
 *
 * Identity and controls hug their content at every height the shell actually
 * launches at. `stretch` is set only above the tall threshold, where the
 * sections spread across the panel's extra rows instead of clumping at its top
 * and leaving the rest of the box empty.
 */
function Knowledge({ stats, registry, caps, info, sessionId, width, stretch = false }) {
    // Built as a list so the uniform inter-section gap is applied in one place.
    // Identity is not a section here any more — it sits under the mark, in the
    // left column, which leaves this column entirely to what Sherman can do
    // and what it currently knows.
    const sections = [];

    // What Sherman can do, ahead of what it currently knows: the lists are the
    // reason the operator can predict what a request will get them, and the
    // vault counts are a fact about this install rather than a capability.
    // Dropped entirely when the frame cannot afford a title plus one group.
    // The tally below still reports both totals, so nothing is concealed.
    if (!(caps.tools === 0 && caps.skills === 0)) {
        sections.push(
            React.createElement(Registry, {
                key: 'tools',
                title: 'Available Tools',
                result: registry.tools,
                width,
                maxRows: caps.tools ?? Infinity,
            }),
            React.createElement(Registry, {
                key: 'skills',
                title: 'Available Skills',
                result: registry.skills,
                width,
                maxRows: caps.skills ?? Infinity,
            })
        );
    }

    // The vault line survives the Keys section's removal because it is the one
    // thing here that can be BROKEN. An unreadable vault is the difference
    // between Sherman answering from company knowledge and Sherman guessing,
    // and the launch frame is where that has to be visible.
    sections.push(
        React.createElement(Section, {
            key: 'vault',
            title: 'Vault',
            lines: stats.ok
                ? [
                      `${plural(stats.wiki, 'wiki page')} · ${plural(stats.shared, 'shared fact')}`,
                      `${plural(stats.private, 'private fact')} · ${plural(stats.inbox, 'inbox item')}`,
                  ]
                : // Unreachable is a different problem from empty, and the panel
                  // should not let them look the same.
                  ['unreadable — check vault_path in ~/.sherman/config.json'],
        }),
        React.createElement(Totals, {
            key: 'totals',
            tools: registry.tools,
            skills: registry.skills,
        })
    );

    return React.createElement(
        Box,
        {
            flexGrow: 1,
            flexDirection: 'column',
            justifyContent: stretch ? 'space-between' : 'flex-start',
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

// The shortest terminal the mid panel fits: its body is eight inner rows
// (the mark strip, a gap, and three identity lines on the left; two dense
// registry sections, the vault line, and the tally on the right), and the
// frame around the body — compact wordmark, margins, borders, welcome — plus
// the two rows owed to the chrome puts the whole frame at exactly 22.
export const MID_MIN_ROWS = 22;

/**
 * The mid-height frame: the full panel's design, abridged to eight body rows.
 *
 * This exists because the first real Windows machine launches in a ~26-row
 * terminal, which the full panel cannot fit (its left column alone — the
 * stacked mark plus identity — is fifteen rows), and the compact card,
 * however honest, does not look like Sherman on the Mac. Same two-column
 * arrangement, same bordered panel with the build in its top border, same
 * mark — laid horizontally (dot, inner ring, outer ring) at four rows
 * instead of eleven — same identity block, and the registry sections
 * compressed to one dense line each: every category name, then the honest
 * total. A registry that failed to load prints its reason, exactly like the
 * full panel's sections; the vault line keeps all four counts.
 */
function MidPanel({ panel, inner, info, stats, sessionId, registry }) {
    const leftWidth = Math.min(LEFT_COLUMN, inner);

    const section = (key, title, result) =>
        React.createElement(
            Box,
            { key, flexDirection: 'column' },
            React.createElement(Text, { color: color.accent, bold: true, wrap: 'truncate' }, title),
            result.ok
                ? React.createElement(
                      Text,
                      { wrap: 'truncate' },
                      React.createElement(
                          Text,
                          { color: color.value },
                          `  ${result.categories.map((c) => c.name).join(', ')}`
                      ),
                      React.createElement(Text, { color: color.muted }, ` · ${result.count} total`)
                  )
                : React.createElement(Text, { color: color.muted, wrap: 'truncate' }, `  ${result.reason}`)
        );

    const vaultLine = stats.ok
        ? `${plural(stats.wiki, 'wiki page')} · ${plural(stats.shared, 'shared fact')} · `
          + `${plural(stats.private, 'private fact')} · ${plural(stats.inbox, 'inbox item')}`
        : 'unreadable — check vault_path in ~/.sherman/config.json';

    return React.createElement(
        Box,
        { width: panel, flexDirection: 'column' },
        React.createElement(VersionBorder, { width: panel }),
        React.createElement(
            Box,
            {
                width: panel,
                borderStyle: 'round',
                borderTop: false,
                borderColor: color.frame,
                paddingX: PANEL_PAD_X,
                flexDirection: 'row',
            },
            React.createElement(
                Box,
                {
                    flexShrink: 0,
                    width: leftWidth,
                    flexDirection: 'column',
                    alignItems: 'center',
                },
                React.createElement(MarkStrip),
                React.createElement(
                    Box,
                    { marginTop: 1 },
                    React.createElement(MarkIdentity, { info, sessionId, width: leftWidth })
                )
            ),
            React.createElement(
                Box,
                // The gutter: a 37-cell identity line otherwise butts against
                // the right column's titles ("…Labs Vault" reads as one line).
                { flexGrow: 1, flexDirection: 'column', marginLeft: 1 },
                section('tools', 'Available Tools', registry.tools),
                section('skills', 'Available Skills', registry.skills),
                React.createElement(
                    Box,
                    { marginTop: 1, flexDirection: 'column' },
                    React.createElement(Text, { color: color.accent, bold: true, wrap: 'truncate' }, 'Vault'),
                    React.createElement(Text, { color: color.muted, wrap: 'truncate' }, `  ${vaultLine}`)
                ),
                React.createElement(Totals, { tools: registry.tools, skills: registry.skills })
            )
        )
    );
}

// Rows the compact frame spends around the card's four base lines: the
// wordmark is counted by the caller (its height varies with the terminal);
// this is everything else — the panel's marginTop, its two border rows, the
// four content rows, the welcome line with its margins, and the chrome below
// (status rule plus the three composer rows). The spare-row budget the card
// receives is the terminal height minus wordmark minus this, and the card may
// grow by AT MOST that many rows: one row over and Ink duplicates frames on
// repaint (the small-viewport waterfall, issue #18), which is a worse screen
// than a shorter card.
export const COMPACT_BASE_ROWS = 14;

/** Short-terminal readiness card: operational facts win over decorative art. */
function CompactSummary({ width, info, stats, sessionId, registry, spare = 0 }) {
    if (width < 4) return React.createElement(Text, { wrap: 'truncate' }, 'sherman');

    const facts = stats.wiki + stats.shared + stats.private;
    const vault = stats.ok
        ? `${plural(facts, 'fact')} · ${plural(stats.inbox, 'inbox item')}`
        : 'unavailable · check vault_path';
    const session = sessionId ? `…${sessionId.slice(-6)}` : '—';

    // What Sherman can do, in the card's own label/value grammar: one line per
    // registry, category names carrying the light and the honest total after
    // them. This is the mid-size answer to "the PC screen shows less than the
    // Mac" — the full panel's lists need rows a short terminal does not have,
    // but two lines fit almost everywhere, so the card stops hiding the
    // capability set. Rendered only when the height budget covers both lines,
    // and a registry that failed to load contributes NO line: the full panel
    // prints its reason, but this card never promised it, and a fabricated
    // row is worse than a missing one.
    const capabilities = [];
    if (spare >= 2 && registry) {
        for (const [label, result] of [['tools', registry.tools], ['skills', registry.skills]]) {
            if (!result?.ok) continue;
            const names = result.categories.map((c) => c.name).join(', ');
            capabilities.push(
                React.createElement(
                    Text,
                    { key: label, wrap: 'truncate' },
                    React.createElement(Text, { color: color.muted }, label.padEnd(10)),
                    React.createElement(Text, { color: color.value }, names),
                    React.createElement(Text, { color: color.muted }, ` · ${result.count} total`)
                )
            );
        }
    }

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
            ...capabilities,
            React.createElement(
                Text,
                { wrap: 'truncate' },
                React.createElement(Text, { color: color.secondary }, '⋯ summary'),
                React.createElement(Text, { color: color.muted }, ' · '),
                React.createElement(Text, { color: color.tertiary }, '› activity'),
                // Small-window view must say so: on the first real Windows run
                // this card read as "an old Sherman" next to a maximized Mac.
                React.createElement(Text, { color: color.muted }, ' · /help · larger window shows the full screen')
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
export function LaunchScreen({ info, stats, sessionId, columns, rows, registry }) {
    const reg = registry ?? cachedRegistry();
    const measured = useWindowSize();
    const width = typeof columns === 'number' ? columns : measured.columns;
    const height = typeof rows === 'number' ? rows : measured.rows;

    // Full bleed: the panel spans the terminal, like Hermes. Never a fixed
    // constant — the border is composed to the measured width, so a narrow
    // terminal gets a narrow panel, not a spilled one.
    const panel = Math.max(1, width);
    // Border + horizontal padding consume six columns. Below the normal
    // two-column layout, stack identity above knowledge and let both shrink.
    const inner = Math.max(1, panel - 2 - PANEL_PAD_X * 2);
    const stack = inner < LEFT_COLUMN + 20;
    const retroWide = width >= RETRO_MIN_COLUMNS;
    // The welcome sentence and its margin cost two rows after either panel.
    // The stacked cutoff moved 41 -> 44 when the identity block joined the
    // left column: a stacked frame is the wordmark, the mark, the identity AND
    // the knowledge floor stacked vertically, and at 41-43 rows that pile
    // overflows the two rows the chrome is owed. Below 44 the compact card —
    // which already carries model, user, vault and session in four rows — is
    // the honest fit.
    //
    // On a terminal wide enough for the retro headline the full panel starts
    // at 31, not 29: its left column (the stacked mark plus identity) is a
    // fixed fifteen rows, and 29-30 can hold it only next to the small
    // wordmark — which would make the headline VANISH between 28 and 31 and
    // reappear, reading as a glitch. The mid panel carries the lockup through
    // that band instead; once the headline appears it never surrenders.
    const fullMin = retroWide ? 31 : 29;
    const compactPanel = height < (stack ? 44 : fullMin);
    // Between the compact card and the full panel, and only where two columns
    // fit: the abridged Mac frame. A stacked (narrow) terminal skips it — the
    // mid design IS its two columns, and stacking them re-creates the very
    // pile the compact card exists to avoid.
    const midPanel = compactPanel && !stack && height >= MID_MIN_ROWS;

    // The tallest wordmark this frame can carry, height and width together.
    // The short frames (card and mid) spend wmRows + 14 rows around the
    // body; the full panel's floor is its fifteen-row left column plus the
    // fixed rows. A narrow (stacked) terminal keeps the small form — the
    // taller forms do not fit its width anyway.
    let wordmarkForm = 'small';
    if (!stack) {
        if (compactPanel) {
            if (retroWide && height - 16 >= RETRO_ROWS) wordmarkForm = 'retro';
        } else {
            const maxWm = height - 2 - LAUNCH_FIXED_ROWS - LEFT_ROWS;
            if (retroWide && maxWm >= RETRO_ROWS) wordmarkForm = 'retro';
            else if (width >= STACK_MIN_COLUMNS && maxWm >= STACK_ROWS) wordmarkForm = 'stack';
        }
    }
    const wmRows =
        wordmarkForm === 'retro' ? RETRO_ROWS
        : wordmarkForm === 'stack' ? STACK_ROWS
        : SMALL_ROWS;

    // Stacked, the mark sits above the knowledge column and the two heights
    // add; side by side, the taller of the two sets the natural height.
    const caps = listBudget({
        height,
        wordmark: wmRows,
        stack,
        stats,
        registry: reg,
    });
    const known = knowledgeRows(stats, reg, caps);
    const naturalInner = stack ? LEFT_ROWS + 1 + known : Math.max(LEFT_ROWS, known);
    const bodyRows = compactPanel ? null : tallPanelRows(wmRows, height, naturalInner);

    // The budget is settled before the mark is sized, so the larger rendition
    // can only ever fill room the panel had already claimed.
    const markScale = markScaleFor({ bodyRows, stack, inner });
    const leftColumn = markScale > 1 ? LEFT_COLUMN_LARGE : LEFT_COLUMN;
    const leftWidth = Math.min(leftColumn, inner);
    const rightWidth = Math.max(1, inner - leftWidth);

    return React.createElement(
        Box,
        { flexDirection: 'column', marginBottom: 1 },
        React.createElement(Wordmark, { columns: width, form: wordmarkForm }),
        midPanel
            ? React.createElement(
                  Box,
                  { marginTop: 1, width: panel, flexDirection: 'column' },
                  React.createElement(MidPanel, {
                      panel,
                      inner,
                      info,
                      stats,
                      sessionId,
                      registry: reg,
                  })
              )
            : compactPanel
            ? React.createElement(
                  Box,
                  { marginTop: 1, width: panel, flexDirection: 'column' },
                  React.createElement(CompactSummary, {
                      width: panel,
                      info,
                      stats,
                      sessionId,
                      registry: reg,
                      // Counted against the wordmark actually drawn, which
                      // the form selection above has already sized to fit.
                      spare: height - wmRows - COMPACT_BASE_ROWS,
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
                        // minHeight, not height: the budget may only ever grow
                        // the body past its content, never clip it.
                        ...(bodyRows ? { minHeight: bodyRows } : {}),
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
                        React.createElement(Mark, { scale: markScale }),
                        React.createElement(
                            Box,
                            { marginTop: 1 },
                            React.createElement(MarkIdentity, {
                                info,
                                sessionId,
                                width: leftWidth,
                            })
                        )
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
                            registry: reg,
                            caps,
                            info,
                            sessionId,
                            width: stack ? inner : rightWidth,
                            stretch: Boolean(bodyRows),
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
