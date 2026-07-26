// The house palette, in one place.
//
// No component hardcodes a colour number. Ink accepts a 256-colour index as a
// string, so these values pass straight to `color=` / `backgroundColor=`.
//
// Dark background is assumed — the design brief says so, and every choice here
// is picked for legibility on dark.

export const color = {
    // Red 196 is the accent. Used sparingly on purpose: it marks Sherman's own
    // voice and the live indicator, and loses all its force if it decorates
    // everything.
    accent: '196',

    // The mark's gradient, top to bottom: pink -> purple -> blue.
    markTop: '205',
    markMid: '135',
    markBottom: '39',

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
    lit: '203',
    bright: '196',
    mid: '160',
    deep: '124',
    shadow: '88',
};

/** Spinner glyphs for the activity indicator. Braille reads as motion at small
 *  size without stealing attention the way ASCII spinners do. */
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Speaker labels, padded to a common width so message bodies line up. */
export const label = {
    user: 'you',
    sherman: 'sherman',
};
