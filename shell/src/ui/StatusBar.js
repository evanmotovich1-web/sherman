// engine · model · user · vault · tokens
//
// Every value comes from what 04-01 already exposes: session.info and
// session.usage. The status bar invents nothing.
//
// It must never wrap. A wrapped status bar does not look like a smaller status
// bar, it looks like the app is broken — so on a narrow terminal segments are
// dropped in a deliberate order rather than allowed to spill.

import React from 'react';
import { Text, Box, useWindowSize } from 'ink';

import { color } from './theme.js';

const SEP = ' · ';

// Left-to-right layout, from the brief: engine · model · user · vault · tokens.
const DISPLAY_ORDER = ['model', 'user', 'vault'];

// What gets sacrificed first when the terminal is narrow. Deliberately NOT the
// same list as the display order: the vault path is the longest and least
// surprising to lose, the user knows their own name, and the model matters more
// than either. `engine` and `tokens` are never dropped — engine is which product
// you are talking to, tokens is the one value that actually changes.
const DROP_ORDER = ['vault', 'model', 'user'];

/** 60258 -> "60.3k". A status bar wants a number you can glance at. */
function formatTokens(total) {
    if (!total) return '0';
    if (total < 1000) return String(total);
    return `${(total / 1000).toFixed(1)}k`;
}

/**
 * Keep the tail of a path — `…/sherman/vault` tells you where you are,
 * `/Users/moto/code/sh…` does not.
 */
function truncateLeft(value, max) {
    if (typeof value !== 'string' || value.length <= max) return value ?? '';
    if (max <= 1) return '…';
    return `…${value.slice(-(max - 1))}`;
}

/**
 * @param {{info: object, usage: object}} props
 */
export function StatusBar({ info, usage }) {
    const { columns } = useWindowSize();
    const available = Math.max(20, columns - 1);

    const tokens = `${formatTokens(usage?.total ?? 0)} tok`;
    const values = {
        model: info.model,
        user: info.user,
        vault: truncateLeft(info.vaultPath, 28),
    };

    const dropped = new Set();
    let line = '';
    for (;;) {
        const middle = DISPLAY_ORDER.filter((k) => !dropped.has(k)).map((k) => values[k]);
        line = [info.engine, ...middle, tokens].join(SEP);
        if (line.length <= available) break;

        const next = DROP_ORDER.find((k) => !dropped.has(k));
        if (!next) break; // Nothing left to give; truncate below handles it.
        dropped.add(next);
    }

    return React.createElement(
        Box,
        null,
        // `truncate` is the last line of defence: even with everything dropped,
        // a 20-column terminal must not wrap.
        React.createElement(Text, { color: color.muted, wrap: 'truncate' }, line)
    );
}
