import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffLines, summarizeChange, toLines, MAX_DIFF_LINES } from '../src/engine/filediff.js';

test('diffLines reports only the lines that actually changed', () => {
    const ops = diffLines('alpha\nbravo\ncharlie\n', 'alpha\nBRAVO\ncharlie\n');
    assert.deepEqual(ops, [
        { sign: '-', text: 'bravo' },
        { sign: '+', text: 'BRAVO' },
    ]);
});

test('an unchanged file produces no diff rows', () => {
    assert.deepEqual(diffLines('a\nb\n', 'a\nb\n'), []);
});

test('every emitted line is present in the side it is attributed to', () => {
    const before = 'one\ntwo\nthree\nfour\n';
    const after = 'one\nTWO\nthree\nfour\nfive\n';
    const beforeLines = new Set(toLines(before));
    const afterLines = new Set(toLines(after));

    for (const op of diffLines(before, after)) {
        // The honesty invariant: nothing is reconstructed. A '-' line must have
        // existed before, a '+' line must exist after.
        const source = op.sign === '-' ? beforeLines : afterLines;
        assert.ok(source.has(op.text), `fabricated ${op.sign} line: ${JSON.stringify(op.text)}`);
    }
});

test('a create is all additions and a delete is all removals', () => {
    const created = summarizeChange({
        path: 'notes.txt', changeKind: 'add', before: null, after: 'one\ntwo\n',
    });
    assert.equal(created.available, true);
    assert.equal(created.added, 2);
    assert.equal(created.removed, 0);

    const deleted = summarizeChange({
        path: 'notes.txt', changeKind: 'delete', before: 'one\ntwo\n', after: null,
    });
    assert.equal(deleted.removed, 2);
    assert.equal(deleted.added, 0);
});

test('unsourceable content reports unavailable with a reason, never a diff', () => {
    const out = summarizeChange({
        path: 'blob.bin', changeKind: 'update', before: null, after: null, reason: 'binary file',
    });
    assert.equal(out.available, false);
    assert.equal(out.reason, 'binary file');
    assert.deepEqual(out.lines, []);
    assert.equal(out.added, 0);
    assert.equal(out.removed, 0);
});

test('a long diff is capped for rendering but reports its true size', () => {
    const after = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n';
    const out = summarizeChange({ path: 'big.txt', changeKind: 'add', before: '', after });

    assert.equal(out.lines.length, MAX_DIFF_LINES);
    // The count is the whole change, not the rendered slice -- a truncated hunk
    // must not read as a smaller edit than the one that happened.
    assert.equal(out.added, 200);
    assert.equal(out.more, 200 - MAX_DIFF_LINES);
});
