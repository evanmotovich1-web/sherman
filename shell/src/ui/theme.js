// The house palette, in one place.
//
// No component hardcodes a colour number. Ink only understands four colour
// forms: a chalk name ('gray'), '#hex', 'rgb(r, g, b)', or 'ansi256(N)'.
// Anything else -- including a bare 256-colour index like '196' -- is
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
    // Red 196 is the accent. Used sparingly on purpose: it marks Sherman's own
    // voice and the live indicator, and loses all its force if it decorates
    // everything.
    accent: c(196),

    // The launch panel's border. Deliberately the deep red rather than the
    // accent: the wordmark and the mark carry the colour on that screen, and a
    // bright 196 frame around the whole panel would shout over both.
    frame: c(124),

    // Secondary text. `muted` is for structural labels, `faint` for things the
    // eye should skip unless it is looking for them (tool lines, timings).
    muted: 'gray',
    faint: 'gray',

    user: 'white',
    error: 'red',
};

/**
 * The red depth ramp, brightest to darkest.
 *
 * Only the launch wordmark uses it. A pixel wordmark drawn in one flat colour
 * reads as a stencil; the same shape drawn with a lit top edge, a body that
 * darkens downward and a shadow beneath reads as an object with mass. That is
 * the whole difference between the v1 mark and this one, and it costs nothing
 * but picking five numbers off the same hue.
 *
 * `accent` (196) is deliberately the second entry rather than the first: the
 * wordmark's body still sits at the house red, and `lit`/`shadow` only extend
 * past it at the two edges.
 */
export const ramp = {
    lit: c(203),
    bright: c(196),
    mid: c(160),
    deep: c(124),
    shadow: c(88),
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
