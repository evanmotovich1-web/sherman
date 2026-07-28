import { test } from 'node:test';
import assert from 'node:assert/strict';
import stringWidth from 'string-width';

import {
    FACES,
    FACE_WIDTH,
    GENERIC,
    activityDescriptor,
    activityLine,
    activityWords,
    assertFaceWidths,
} from '../src/ui/ActivityLine.js';
import { ACTIVITY_GLYPH, GLYPH_WIDTH } from '../src/ui/theme.js';

test('every face measures exactly one cell per column it claims', () => {
    // The gotcha this pins: kaomoji built from fullwidth glyphs measure 2 per
    // glyph, so a face that LOOKS 5 characters wide can occupy 7 columns and
    // push the row past the terminal edge.
    assert.equal(assertFaceWidths(), true);
    for (const face of FACES) {
        assert.equal(stringWidth(face), FACE_WIDTH, `face ${face} is not ${FACE_WIDTH} columns`);
    }
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

test('with nothing reported it falls back to one honest generic', () => {
    assert.equal(activityWords([], null), GENERIC);
    assert.equal(activityWords(undefined, undefined), GENERIC);
    // Never a rotating set of invented verbs: the same empty state is always
    // described the same way.
    assert.equal(activityWords([], ''), activityWords([], null));
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
