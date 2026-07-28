// The activity line: what Sherman is doing, right now, in one row.
//
//     ─ (•ᴗ•) ─ patch scanner.js ────────────────────────────────
//
// THE HONESTY SPLIT, which is the whole design of this file:
//
//   The WORDS are a claim about state. They come only from the normalized
//   engine stream -- the same `activities` and `lifecycle` the shell already
//   tracks in app.js, which originate in real codex events. This file never
//   invents a verb, never rotates through a list of plausible-sounding ones,
//   and never says a thing is happening that the engine did not report. When a
//   turn is genuinely busy with nothing in flight, it says "working", which is
//   the one true generic.
//
//   The FACE and the DASHES are decoration. They carry no information, so they
//   may animate on a timer freely -- a blinking face is not a claim.
//
// WIDTH: kaomoji are a layout hazard. Many of the obvious ones are built from
// width-2 CJK glyphs -- measured with string-width, `(￣▽￣)` is 7 columns and
// `(・_・)` is 7, not 5. A face wider than its cell count overflows the row and
// breaks Yoga's layout for everything below it. FACES below is therefore
// restricted to faces that measure exactly FACE_WIDTH, and assertFaceWidths()
// proves it rather than trusting the eye.

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';

import { color, ACTIVITY_GLYPH } from './theme.js';
import { safeTerminalText } from './sanitize.js';

/** Every face is exactly this wide. Enforced, not assumed. */
export const FACE_WIDTH = 5;

/**
 * The face set. Decorative only.
 *
 * Each of these measures 5 columns under string-width; faces built from
 * fullwidth glyphs were rejected on measurement, not on taste.
 */
export const FACES = Object.freeze(['(•ᴗ•)', '(•‿•)', '(ᵔᴗᵔ)', '(◕‿◕)', '(•ω•)']);

/** How often the face changes. Decoration, so the cadence is free. */
export const FACE_INTERVAL_MS = 700;

/** The one honest generic for "busy, nothing specific in flight". */
export const GENERIC = 'working';

/**
 * Throws if any face is not FACE_WIDTH columns.
 *
 * Exported so the test suite asserts the invariant against the real width
 * function rather than a hand-count. A face that fails this would silently
 * push the line past the terminal edge.
 */
export function assertFaceWidths() {
    for (const face of FACES) {
        const width = stringWidth(face);
        if (width !== FACE_WIDTH) {
            throw new Error(`face ${JSON.stringify(face)} measures ${width}, expected ${FACE_WIDTH}`);
        }
    }
    return true;
}

/**
 * The words for the line, sourced strictly from engine-derived state.
 *
 * Precedence is most-specific-first: an in-flight tool is the best available
 * description of what is happening; a lifecycle status is the next best; the
 * generic is used only when the engine has told us nothing at all.
 *
 * @param {Array<{line?:string}>} activities in-flight tool activities from app.js
 * @param {string|null} lifecycle last transport status from app.js
 * @returns {string}
 */
export function activityWords(activities = [], lifecycle = null) {
    return activityDescriptor(activities, lifecycle).words;
}

/**
 * The words AND the glyph for the line, from the same single source event.
 *
 * The glyph is keyed on the engine's own `category`, so a book means codex
 * reported a read and a computer means it reported a shell command. Two rules
 * keep it honest:
 *
 *   - A glyph is only ever taken from the in-flight activity that also supplies
 *     the words. It never describes a different event than the text does.
 *   - Lifecycle statuses and the "working" generic get NO glyph. They are not a
 *     kind of work, and picking an icon for them would be decoration pretending
 *     to be classification.
 *
 * @returns {{words:string, glyph:string}} glyph is '' when none applies
 */
export function activityDescriptor(activities = [], lifecycle = null) {
    const last = Array.isArray(activities) ? activities[activities.length - 1] : null;
    // `label` is the engine's own text; `line` is the trace's rendering of it and
    // carries a leading glyph. Prefer the label so the row does not show two
    // glyphs for one event, and fall back so either shape works.
    const text = typeof last?.label === 'string' && last.label.trim() !== ''
        ? last.label
        : last?.line;
    if (typeof text === 'string' && text.trim() !== '') {
        // The duration is the engine's measured elapsed time, present only once
        // the task has actually completed -- it is never shown for running work,
        // because a running task has no duration yet.
        const seconds = Number.isFinite(last.durationMs)
            ? `  ${(last.durationMs / 1000).toFixed(1)}s`
            : '';
        return {
            words: `${text.trim()}${seconds}`,
            glyph: ACTIVITY_GLYPH[last.category] ?? '',
            mark: typeof last.mark === 'string' ? last.mark : '',
        };
    }
    if (typeof lifecycle === 'string' && lifecycle.trim() !== '') {
        return { words: lifecycle.trim(), glyph: '', mark: '' };
    }
    return { words: GENERIC, glyph: '', mark: '' };
}

/** Truncate to a column budget using measured width, not code-unit length. */
function clampWidth(text, budget) {
    if (budget <= 0) return '';
    if (stringWidth(text) <= budget) return text;
    let out = '';
    let used = 0;
    for (const ch of text) {
        const w = stringWidth(ch);
        if (used + w > budget) break;
        out += ch;
        used += w;
    }
    return out;
}

/**
 * Compose the line. Pure, so the width invariant is testable without a render.
 *
 * The return value is guaranteed to measure at most `width` columns for any
 * width and any input -- that guarantee is what the 60/200-column tests pin.
 *
 * @param {{face:string, words:string, width:number}} input
 * @returns {string}
 */
export function activityLine({ face, words, glyph = '', mark = '', width }) {
    if (!Number.isFinite(width) || width < 1) return '';

    // The glyph is measured, never assumed to be one cell. Emoji are width 2,
    // so a hand-counted prefix here would overrun the row by one column per
    // icon -- exactly the class of bug the face set was restricted to avoid.
    const head = `─ ${face} ─ ${mark === '' ? '' : `${mark} `}${glyph === '' ? '' : `${glyph} `}`;
    // Too narrow for the decoration to mean anything: degrade to a plain rule
    // rather than emitting a broken half-face.
    if (stringWidth(head) + 2 > width) return '─'.repeat(width);

    const budget = width - stringWidth(head) - 1; // at least one trailing dash
    const body = clampWidth(safeTerminalText(words), budget);
    const line = `${head}${body} `;
    const fill = Math.max(0, width - stringWidth(line));
    return `${line}${'─'.repeat(fill)}`;
}

/**
 * @param {{active:boolean, activities?:Array<{line?:string}>, lifecycle?:string|null,
 *          columns:number, face?:string}} props
 *
 * `face` is injectable so fixtures and smoke checks render a deterministic
 * frame instead of racing the animation timer.
 */
export function ActivityLine({ active, activities = [], lifecycle = null, columns, face }) {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        // The timer exists only while the turn is live, so an idle shell is not
        // re-rendering forever. Cleared on turn end with everything else.
        if (!active || face) return undefined;
        const id = setInterval(() => setTick((n) => n + 1), FACE_INTERVAL_MS);
        return () => clearInterval(id);
    }, [active, face]);

    if (!active) return null;
    if (!Number.isFinite(columns) || columns < 1) return null;

    const shown = face ?? FACES[tick % FACES.length];
    const { words, glyph, mark } = activityDescriptor(activities, lifecycle);
    const text = activityLine({ face: shown, words, glyph, mark, width: columns });
    if (text === '') return null;

    // flexShrink:0, matching Thinking: this row is chrome inside the root's
    // fixed height, and only the transcript above it is allowed to give up rows.
    // Without it the frame overflows by one and Ink clips the scrollback
    // indicator instead of shortening the transcript.
    return React.createElement(
        Box,
        { flexShrink: 0 },
        React.createElement(Text, { color: color.tertiary, wrap: 'truncate' }, text)
    );
}
