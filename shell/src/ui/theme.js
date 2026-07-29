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
    meterEmpty: c(53),
    secondary: c(135),
    tertiary: c(39),

    // Identity values. Labels stay muted; these three values carry the brand
    // hierarchy wherever identity is repeated (launch panel, status region).
    valueModel: c(205),
    valueEngine: c(135),
    valueUser: c(39),
    promptLive: c(205),
    promptHistory: 'gray',

    // Secondary structural text.
    muted: 'gray',

    // The readable neutral for dense lists — the tool and skill names on the
    // launch panel.
    //
    // Those names were 'gray', the same ink as structural chrome, and the panel
    // read flat next to the reference: there, the category labels RECEDE and the
    // names are near-white, so the eye lands on the thing you can actually use.
    // Ours had it inverted — vivid labels, dull names — which spends the
    // contrast on the taxonomy instead of the content.
    //
    // 252 is a light neutral, not a fifth hue: it competes with nothing in the
    // brand ramp and is the same move the reference makes with its off-white.
    // The vividness comes from the CONTRAST between a receded label and a bright
    // name, not from turning up the saturation on everything.
    value: c(252),

    // The status strip's chip fill. Every existing foreground in that strip is
    // either gray, pink 205, purple 135, or blue 39, so the chip has to sit
    // below all four without introducing a fifth hue. 236 is a neutral dark
    // grey two steps up from the terminal's black: dark enough that gray text
    // and the dim 53 meter track still read as foreground, light enough that
    // the one-space gap between chips is a visible seam on a dark background.
    // An in-family dark pink (53) was rejected — it is already the meter's
    // empty track, and reusing it as a background would flatten the meter.
    chipBg: c(236),

    user: 'white',
    error: 'red',

    // Diff inks — the one SEMANTIC exception to the retired red.
    //
    // The brand retired the ansi256 red ramp (196/160/124) from every launch and
    // chrome surface, and smoke check 9 keeps it retired there. These two are a
    // different thing: in a diff, green and red are not brand colours expressing
    // taste, they are the universal notation for "added" and "removed". Rendering
    // a deletion in brand pink would be a prettier lie about what the symbol
    // means. They are scoped to Diff.js and appear nowhere else.
    //
    // Spelled as chalk names, not ansi256 indices, for two reasons: they inherit
    // the operator's own terminal palette the way every other diff tool does, and
    // they are provably not the retired ramp — `error: 'red'` above already set
    // that precedent for semantic red.
    diffAdded: 'green',
    diffRemoved: 'red',
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
 * The one-line retro-3D lockup's two inks.
 *
 * `bands` paints the solid strokes in three horizontal bands of two rows each
 * — pink over purple over blue, the brand translation of the reference
 * lockup's yellow/yellow/orange. `echo` colours the thin box-drawing outline
 * that traces every stroke down-right: one dim indigo, hue-wise between brand
 * purple and brand blue but darker than both, so the echo reads as a line
 * sitting behind the letterforms rather than as a fourth band.
 */
export const retro = {
    bands: [c(205), c(205), c(135), c(135), c(39), c(39)],
    echo: c(61),
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

/**
 * One glyph per activity CATEGORY, for the activity line.
 *
 * These are keyed on the `category` the engine already puts on every tool
 * event, so the glyph is a rendering of a reported fact: a book appears because
 * codex reported a read, not because a filename looked readable. A category
 * with no entry here gets no glyph at all — see ACTIVITY_GLYPH's use in
 * ActivityLine.js. Silence is the honest default for work we cannot name.
 *
 * EVERY glyph here is a SINGLE code point that measures 2 columns. Emoji that
 * need a VS16 variation selector (⌨️, ✏️, ⚙️) are deliberately excluded: they
 * measure 2 under string-width but real terminals disagree about them, and a
 * glyph whose width the layout cannot trust corrupts every row below it. The
 * invariant is asserted in test/activity-line.test.js rather than eyeballed.
 */
export const ACTIVITY_GLYPH = Object.freeze({
    read: '📖',
    command: '💻',
    'file-change': '📝',
    'web-search': '🔍',
    mcp: '🔌',
    subagent: '🤖',
    plan: '📋',
    tool: '🔧',
});

/** Every glyph above occupies exactly this many columns. */
export const GLYPH_WIDTH = 2;

/** Speaker labels, padded to a common width so message bodies line up. */
export const label = {
    user: 'you',
    sherman: 'sherman',
};
