// The load-in: the wordmark shimmering through the brand ramp while the shell
// actually starts.
//
// This runs BEFORE Ink exists. Loading React and Ink is itself one of the steps
// it covers, so it cannot be a component — it paints with raw escapes straight
// to stdout, then erases itself and hands the terminal to Ink.
//
// The technique is Hermes', ported from `hermes-agent/ui-tui/src/components/
// loaders.tsx`: a highlight BAND travels across a run of cells, its position
// driven by a monotonically increasing `phase`, with a per-row phase offset so
// the band crosses the art on a diagonal rather than as a flat wipe. One
// interval drives every row, so all rows advance in the same timer callback and
// the frame is written once per tick. Hermes freezes its skeleton after a time
// budget instead of repainting forever; this does the same, settling into the
// full vivid lockup.
//
// Two rules govern the text underneath it, and neither is negotiable:
//
//   1. Every label describes work that is ACTUALLY HAPPENING. `step()` is
//      called immediately before the await it names, so "reading config…" is on
//      screen exactly while the config is being read. There is no scripted
//      sequence of invented stages — no "initializing agents" over a process
//      that has no agents to initialize. A caller that stops calling `step()`
//      leaves the last true label up rather than advancing to a fiction.
//
//   2. It never delays readiness. The animation is decoration OVER real work,
//      never in front of it: `done()` returns synchronously, and if startup
//      finishes in 40ms the load-in is erased 40ms in, mid-sweep. There is no
//      minimum duration, because a minimum duration would mean the animation
//      was costing the user time it did not have to.
//
// Off a TTY every function here is a no-op that writes nothing. That keeps the
// smoke `renderToString` fixtures byte-identical and means a piped run
// (smoke, CI, `echo x | sherman`) never emits a cursor escape.

import { ramp } from './theme.js';
import { smallWordmarkRows } from './Wordmark.js';

/** Cells the highlight band spans. Wide enough to read as a sweep, narrow
 *  enough that the un-swept art stays visible on a 41-column mark. */
const BAND = 8;

/** Frame interval. Hermes uses 90ms; the same tick reads as motion here
 *  without spending a repaint of the whole block more often than a terminal
 *  can usefully show one. */
const TICK_MS = 80;

/**
 * How long the sweep may run. After this the wordmark settles to full vivid
 * and stays there — the load-in is a load-in, not a background animation, and
 * a slow engine start must not turn it into one.
 */
export const LOADIN_BUDGET_MS = 1000;

/**
 * Hermes' `shimmerSegments`, ported cell-for-cell.
 *
 * Splits a `width`-cell run into [before, band, after] for a band whose left
 * edge sits at `phase` within a `width + band` cycle, starting off the left
 * edge so the band slides in rather than appearing mid-run. The three parts
 * always sum to exactly `width`, at every phase including negative ones — that
 * total is what keeps the painted row the same width as the art it colours.
 */
export function shimmerSegments(width, phase, band = BAND) {
    const cycle = width + band;
    const start = (((phase % cycle) + cycle) % cycle) - band;
    const from = Math.max(0, start);
    const to = Math.min(width, start + band);
    return to <= from ? [width, 0, 0] : [from, to - from, width - to];
}

// Brand ramp down the five rows of the small lockup: pink through purple into
// blue. Taken from theme.ramp.compact so the flicker and the launch frame draw
// from one palette — and note what is absent: no red. The retired red ramp is
// asserted against by smoke check 9, and the load-in must not reintroduce it.
const ROW_INK = ramp.compact;

const ESC = '\x1b[';
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;

/** `ramp.compact` entries are chalk functions; the raw 256-colour index is
 *  what a pre-Ink writer needs, so the escape is built directly. */
const INK_INDEX = [205, 171, 135, 99, 39];

const dim = (index, text) => `${ESC}2m${ESC}38;5;${index}m${text}${ESC}0m`;
const vivid = (index, text) => `${ESC}1m${ESC}38;5;${index}m${text}${ESC}0m`;

/**
 * One painted row: dim brand ink, with the band's cells lit vivid.
 *
 * `settled` paints the whole row vivid — the state the sweep resolves into,
 * and the state a non-animating terminal would show.
 */
export function paintRow(text, index, phase, settled = false) {
    if (settled) return vivid(index, text);

    const width = [...text].length;
    const [before, band, after] = shimmerSegments(width, phase);
    const cells = [...text];
    let out = '';
    if (before > 0) out += dim(index, cells.slice(0, before).join(''));
    if (band > 0) out += vivid(index, cells.slice(before, before + band).join(''));
    if (after > 0) out += dim(index, cells.slice(before + band).join(''));
    return out;
}

/**
 * Compose the whole block: the wordmark rows, a blank row, and the status line.
 *
 * Exported so a test can assert the frame's shape and colours without a
 * terminal, a clock, or a timer.
 */
export function frame(rows, phase, label, settled = false) {
    const art = rows.map((text, i) =>
        // The per-row phase offset is what makes the band cross diagonally
        // rather than sweeping every row in lockstep.
        paintRow(text, INK_INDEX[i % INK_INDEX.length], phase - i * 2, settled)
    );
    return [...art, '', label ? dim(INK_INDEX[4], label) : ''].join('\n');
}

/** A load-in that does nothing, for every non-TTY caller. */
const INERT = { step() {}, done() {} };

/**
 * Start the load-in.
 *
 * Returns `{step, done}`. Call `step(label)` immediately before the real work
 * that label describes; call `done()` the moment the shell is ready. Both are
 * synchronous and both are safe to call after `done()`.
 *
 * The stdout, clock and timer functions are injectable so the whole thing is
 * testable without a terminal — the same reason the width-branching components
 * take an injectable `columns` (D17).
 */
export function startLoadIn({
    stdout = process.stdout,
    budgetMs = LOADIN_BUDGET_MS,
    now = Date.now,
    setTimer = setInterval,
    clearTimer = clearInterval,
} = {}) {
    // The one gate that keeps piped output byte-identical.
    if (!stdout || !stdout.isTTY) return INERT;

    const rows = smallWordmarkRows();
    // The art plus its blank row and status line. Anything narrower than the
    // mark would wrap, and a wrapped frame cannot be erased by row count.
    const height = rows.length + 2;
    if (typeof stdout.columns === 'number' && stdout.columns < rows[0].length) {
        return INERT;
    }

    const startedAt = now();
    let phase = 0;
    let label = '';
    let painted = false;
    let settled = false;
    let finished = false;
    let timer = null;

    const write = (text) => {
        try {
            stdout.write(text);
        } catch {
            // A closed or broken stdout must never take down a launch that was
            // otherwise fine. The load-in is decoration; failing it is free.
            finished = true;
        }
    };

    const paint = () => {
        if (finished) return;
        // Repaint in place: back to the top of the block, then erase down, so a
        // shorter status line cannot leave the tail of a longer one behind.
        const home = painted ? `${ESC}${height}A${ESC}0J` : HIDE_CURSOR;
        painted = true;
        write(`${home}${frame(rows, phase, label, settled)}\n`);
    };

    const tick = () => {
        if (now() - startedAt >= budgetMs) {
            // Budget spent: settle to the full vivid lockup and stop sweeping.
            // The block stays on screen under its true label until the real
            // work that label names actually finishes.
            settled = true;
            if (timer) clearTimer(timer);
            timer = null;
            paint();
            return;
        }
        phase += 1;
        paint();
    };

    paint();
    timer = setTimer(tick, TICK_MS);
    // A load-in must never hold the process open by itself.
    if (timer && typeof timer.unref === 'function') timer.unref();

    return {
        step(next) {
            if (finished) return;
            label = typeof next === 'string' ? next : '';
            paint();
        },
        done() {
            if (finished) return;
            if (timer) clearTimer(timer);
            timer = null;
            // Erase the block entirely and give the cursor back. Ink paints the
            // real launch frame from a clean line — and on the alternate screen
            // it would be cleared anyway, so this matters most on the path
            // where Ink never starts.
            if (painted) write(`${ESC}${height}A${ESC}0J`);
            write(SHOW_CURSOR);
            finished = true;
        },
    };
}
