import { test } from 'node:test';
import assert from 'node:assert/strict';
import stringWidth from 'string-width';

import {
    FACES,
    FACE_WIDTH,
    GENERIC,
    activityLine,
    activityWords,
    assertFaceWidths,
} from '../src/ui/ActivityLine.js';

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
                const line = activityLine({ face, words: w, width });
                assert.ok(
                    stringWidth(line) <= width,
                    `width ${width}, face ${face}: line measured ${stringWidth(line)}`
                );
            }
        }
    }
});

test('the line never exceeds the width at any narrow size either', () => {
    for (let width = 1; width <= 40; width += 1) {
        const line = activityLine({ face: FACES[0], words: 'patch scanner.js', width });
        assert.ok(stringWidth(line) <= width, `width ${width}: measured ${stringWidth(line)}`);
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
