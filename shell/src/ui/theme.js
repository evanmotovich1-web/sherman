// The house palette, in one place.
//
// No component hardcodes a colour number. Ink only understands four colour
// forms: a chalk name ('gray'), '#hex', 'rgb(r, g, b)', or 'ansi256(N)'.
// Anything else -- including a bare 256-colour index like '205' -- is
// SILENTLY ignored by Ink's colorize and renders in the terminal's default
// colour. That is how the v2 launch screen shipped all-white, so every
// numeric colour below goes through `c()` and smoke check 9 asserts the
// escapes actually come out.
//
// Dark background is assumed — the design brief says so, and every choice here
// is picked for legibility on dark.

/** The one valid spelling of a 256-colour index for Ink. */
const c = (n) => `ansi256(${n})`;

export const color = {
    // One vivid anchor for all persistent chrome, matching Hermes's use of one
    // bright yellow. Purple and blue are secondary accents, never competing
    // local palettes invented by individual components.
    accent: c(205),
    frame: c(205),
    secondary: c(135),
    tertiary: c(39),

    // Secondary text. `muted` is for structural labels, `faint` for things the
    // eye should skip unless it is looking for them (tool lines, timings).
    muted: 'gray',
    faint: 'gray',

    user: 'white',
    error: 'red',
};

/**
 * The wordmark's brand gradient, top to bottom.
 *
 * Pink at the lit top travels through magenta and purple into blue at the
 * bottom. The rim and shadow remain in-family, preserving the existing object
 * depth without dimming the logo into a dark single-hue ramp.
 */
export const ramp = {
    lit: c(212),
    body: [c(205), c(205), c(171), c(135), c(99), c(63), c(39)],
    compact: [c(205), c(171), c(135), c(99), c(39)],
    agent: c(39),
    shadow: c(33),
};

/**
 * The three-circle mark's palette: one small ramp per shape, top to bottom.
 *
 * `mid` is the brand colour of each shape — pink 205, purple 135, blue 39,
 * same as logo/banner.ans. `top` and `low` are one step to either side on the
 * same hue, so each shape carries a subtle vertical gradient (pink into
 * magenta, purple into violet, blue into cyan) instead of rendering flat.
 */
export const markRamp = {
    dot: { top: c(212), mid: c(205), low: c(199) },
    inner: { top: c(141), mid: c(135), low: c(129) },
    outer: { top: c(33), mid: c(39), low: c(45) },
};

/** Spinner glyphs for the activity indicator. Braille reads as motion at small
 *  size without stealing attention the way ASCII spinners do. */
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Speaker labels, padded to a common width so message bodies line up. */
export const label = {
    user: 'you',
    sherman: 'sherman',
};
