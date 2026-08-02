import { test } from 'node:test';
import assert from 'node:assert/strict';
import stringWidth from 'string-width';

import {
    FACES,
    FACE_WIDTH,
    FLASH_FACE,
    GENERIC,
    WHIMSY,
    WHIMSY_TICKS,
    activityDescriptor,
    activityLine,
    activityWords,
    assertFaceWidths,
    idleWords,
} from '../src/ui/ActivityLine.js';
import { ACTIVITY_GLYPH, GLYPH_WIDTH, facePalette } from '../src/ui/theme.js';

test('every face measures exactly one cell per column it claims', () => {
    // The gotcha this pins: kaomoji built from fullwidth glyphs measure 2 per
    // glyph, so a face that LOOKS 5 characters wide can occupy 7 columns and
    // push the row past the terminal edge.
    assert.equal(assertFaceWidths(), true);
    for (const face of [...FACES, FLASH_FACE]) {
        assert.equal(stringWidth(face), FACE_WIDTH, `face ${face} is not ${FACE_WIDTH} columns`);
    }
});

test('the face set is a real cast, not a trio', () => {
    // The owner's brief asked for "more than three faces"; a dozen-plus keeps
    // the rotation from reading as a loop within one short turn.
    assert.ok(FACES.length >= 12, `only ${FACES.length} faces`);
    assert.equal(new Set(FACES).size, FACES.length, 'duplicate face in the set');
});

test('the line never exceeds the terminal width at 60 and 200 columns', () => {
    const words = [
        'patch scanner.js',
        GENERIC,
        // Far longer than either viewport, to force the truncation path.
        'exec ' + 'a-very-long-command-fragment '.repeat(20),
        '',
    ];
    for (const width of [60, 200]) {
        for (const face of FACES) {
            for (const w of words) {
                // '' covers the no-glyph path; every real glyph is width 2, and
                // an unmeasured prefix would overrun by one column per icon.
                for (const glyph of ['', ...Object.values(ACTIVITY_GLYPH)]) {
                    const line = activityLine({ face, words: w, glyph, width });
                    assert.ok(
                        stringWidth(line) <= width,
                        `width ${width}, face ${face}, glyph ${glyph}: ${stringWidth(line)}`
                    );
                }
            }
        }
    }
});

test('the line never exceeds the width at any narrow size either', () => {
    for (let width = 1; width <= 40; width += 1) {
        for (const glyph of ['', ACTIVITY_GLYPH.read, ACTIVITY_GLYPH.command]) {
            const line = activityLine({ face: FACES[0], words: 'patch scanner.js', glyph, width });
            assert.ok(
                stringWidth(line) <= width,
                `width ${width}, glyph ${glyph}: measured ${stringWidth(line)}`
            );
        }
    }
});

test('the words come from the engine stream, most specific first', () => {
    assert.equal(
        activityWords([{ line: 'read scanner.js' }, { line: 'patch scanner.js' }], 'starting…'),
        'patch scanner.js'
    );
    // No activity in flight, but the transport reported something true.
    assert.equal(activityWords([], 'opening a thread…'), 'opening a thread…');
});

test('with nothing reported the pure descriptor still yields one generic', () => {
    assert.equal(activityWords([], null), GENERIC);
    assert.equal(activityWords(undefined, undefined), GENERIC);
    // The PURE layer stays deterministic: the same empty state always describes
    // itself the same way. The whimsy rotation lives strictly in the component,
    // keyed off `source`, so log lines and tests never see invented verbs.
    assert.equal(activityWords([], ''), activityWords([], null));
});

test('the descriptor names which tier supplied the words', () => {
    assert.equal(activityDescriptor([{ line: 'read scanner.js' }], null).source, 'activity');
    assert.equal(activityDescriptor([], 'starting…').source, 'lifecycle');
    assert.equal(activityDescriptor([], null).source, 'generic');
});

test('the idle rotation starts at starting and turns over on cadence', () => {
    // The first frame of a turn says exactly what the old static line said...
    assert.equal(idleWords(0), 'starting');
    // ...and holds it for the full word interval before moving on.
    assert.equal(idleWords(WHIMSY_TICKS - 1), 'starting');
    assert.equal(idleWords(WHIMSY_TICKS), WHIMSY[1]);
    // The rotation wraps rather than running off the end.
    assert.equal(idleWords(WHIMSY.length * WHIMSY_TICKS), 'starting');
});

test('every whimsy word is a vague verb, never a claim about a tool', () => {
    assert.ok(WHIMSY.length >= 10, `only ${WHIMSY.length} idle words`);
    assert.equal(new Set(WHIMSY).size, WHIMSY.length, 'duplicate idle word');
    for (const word of WHIMSY) {
        // Single lowercase words only: anything with a space or a path-ish
        // character could read as a report of concrete work, which the honesty
        // split forbids the idle slot from making.
        assert.match(word, /^[a-z]+$/, `whimsy word ${JSON.stringify(word)} is not one plain word`);
    }
    // The brief's named words are all present.
    for (const wanted of ['starting', 'thinking', 'composing', 'dreaming']) {
        assert.ok(WHIMSY.includes(wanted), `missing ${wanted}`);
    }
});

test('the face palettes are valid ink colours and avoid the retired red ramp', () => {
    const retired = new Set(['ansi256(196)', 'ansi256(160)', 'ansi256(124)']);
    for (const ramp of [facePalette.work, facePalette.rainbow]) {
        assert.ok(ramp.length >= 5, 'ramp too short to read as motion');
        for (const ink of ramp) {
            // Ink silently drops colour strings it does not recognise, so a
            // malformed entry here would render default-coloured with no error.
            assert.match(ink, /^ansi256\(\d{1,3}\)$/, `bad colour ${ink}`);
            assert.ok(!retired.has(ink), `retired red ${ink} in face palette`);
        }
    }
});

test('the rendered line carries the real words', () => {
    const line = activityLine({ face: '(•ᴗ•)', words: 'patch scanner.js', width: 60 });
    assert.ok(line.includes('patch scanner.js'));
    assert.ok(line.startsWith('─ (•ᴗ•) ─ '));
});

test('every activity glyph is a single code point of the declared width', () => {
    for (const [category, glyph] of Object.entries(ACTIVITY_GLYPH)) {
        assert.equal(
            stringWidth(glyph), GLYPH_WIDTH,
            `glyph for ${category} measures ${stringWidth(glyph)}`
        );
        // Single code point, so no VS16 variation selector. Those measure 2 here
        // but render inconsistently in real terminals, which would corrupt the
        // row width the layout depends on.
        assert.equal(
            [...glyph].length, 1,
            `glyph for ${category} is not a single code point`
        );
    }
});

test('the glyph describes the same event as the words', () => {
    // A read reports a book, a shell command reports a computer -- both keyed on
    // the category the engine itself put on the event.
    const read = activityDescriptor([{ line: 'read scanner.js', category: 'read' }], null);
    assert.equal(read.words, 'read scanner.js');
    assert.equal(read.glyph, ACTIVITY_GLYPH.read);

    const exec = activityDescriptor([{ line: 'exec npm test', category: 'command' }], null);
    assert.equal(exec.glyph, ACTIVITY_GLYPH.command);

    const patch = activityDescriptor([{ line: 'patch scanner.js', category: 'file-change' }], null);
    assert.equal(patch.glyph, ACTIVITY_GLYPH['file-change']);
});

test('unclassified and non-work states get no glyph at all', () => {
    // An unknown category is not an excuse to pick an icon that looks plausible.
    assert.equal(activityDescriptor([{ line: 'something', category: 'nope' }], null).glyph, '');
    assert.equal(activityDescriptor([{ line: 'something' }], null).glyph, '');
    // Lifecycle and the generic are not a kind of work.
    assert.equal(activityDescriptor([], 'opening a thread…').glyph, '');
    assert.equal(activityDescriptor([], null).glyph, '');
    assert.equal(activityDescriptor([], null).words, GENERIC);
});
