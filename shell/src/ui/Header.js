// The launch mark and the persistent header line.
//
// Two exports, because they have different lifetimes (D13):
//
//   Banner        — 18 lines. Rendered ONCE through <Static> so it commits and
//                   scrolls away, exactly as `bin/sherman` has always behaved.
//                   Pinning it would leave six rows for the conversation on a
//                   24-row terminal.
//   CompactHeader — one line, always visible, so the screen still says whose
//                   it is after the mark has scrolled off.

import React from 'react';
import { Text, Box } from 'ink';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { color } from './theme.js';

// Resolve the repo from THIS file, never from process.cwd(). At runtime the cwd
// is ~/.sherman/workspace (the engine's cwd), not the repo, so a relative read
// against cwd would look for the banner in the wrong place entirely.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BANNER_PATH = join(REPO_ROOT, 'logo', 'banner.ans');

// Trailing newline stripped: <Text> would render it as an extra blank row and
// the Box below already provides the spacing.
function readBanner() {
    try {
        return readFileSync(BANNER_PATH, 'utf8').replace(/\n+$/, '');
    } catch {
        return null;
    }
}

/**
 * The full mark, read from logo/banner.ans.
 *
 * NOT DEAD CODE, and not the shell's opener any more: since 05-01 the shell
 * renders <LaunchScreen> instead, which draws its own wordmark and mark rather
 * than reading the asset. This stays because `bin/sherman` still prints
 * banner.ans for its pre-shell moments, and Transcript still answers to the
 * 'banner' item kind. Deleting it would make those two disagree.
 *
 * Ink preserves the raw 256-colour escapes and measures the 41-column block art
 * correctly — verified with renderToString — so the file content goes through
 * untouched. Do not strip, recolour or re-wrap it.
 */
export function Banner() {
    const banner = readBanner();

    if (banner === null) {
        // Same fallback shape and voice as bin/sherman's placeholder, so a
        // machine without the logo still looks deliberate rather than broken.
        return React.createElement(
            Box,
            { flexDirection: 'column', marginBottom: 1 },
            React.createElement(Text, { color: color.accent, bold: true }, '  SHERMAN ABRAMS'),
            React.createElement(Text, { color: color.muted }, '  Sherman Abrams Labs — company agent')
        );
    }

    // banner.ans already carries "Sherman Abrams Labs" on its own line, so
    // adding a label here would print the company name twice.
    return React.createElement(
        Box,
        { flexDirection: 'column', marginBottom: 1 },
        React.createElement(Text, null, banner)
    );
}

/** One line, always on screen. */
export function CompactHeader() {
    return React.createElement(
        Text,
        null,
        React.createElement(Text, { color: color.accent, bold: true }, 'sherman'),
        React.createElement(Text, { color: color.muted }, '  Sherman Abrams Labs')
    );
}
