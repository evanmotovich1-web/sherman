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

/** Spinner glyphs for the activity indicator. Braille reads as motion at small
 *  size without stealing attention the way ASCII spinners do. */
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Speaker labels, padded to a common width so message bodies line up. */
export const label = {
    user: 'you',
    sherman: 'sherman',
};
