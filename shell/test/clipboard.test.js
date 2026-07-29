// The clipboard path, tested for the thing that can actually go wrong: the
// shell announcing a copy it has no evidence for.
//
// The mechanics (does pbcopy exist, does Ghostty honour OSC 52) are properties
// of the machine, not of this code, and were probed by hand before the module
// was written. What IS this code's job, and what these tests pin, is that an
// unverifiable write never produces a verified-sounding sentence.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    OSC52_MAX_BASE64,
    copyNotice,
    copyText,
    lastReplyText,
    osc52Sequence,
} from '../src/clipboard.js';

const tty = () => {
    const writes = [];
    return { isTTY: true, write: (value) => { writes.push(value); return true; }, writes };
};
const pipe = () => ({ isTTY: false, write: () => true });

const pbcopyOk = () => ({ status: 0 });
const pbcopyMissing = () => ({ error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) });
const pbcopyBroken = () => ({ status: 1 });

test('pbcopy exiting 0 is evidence, and only then is the copy confirmed', () => {
    const result = copyText('the reply', { run: pbcopyOk, stdout: tty() });
    assert.deepEqual(result, { ok: true, method: 'pbcopy', confirmed: true, reason: null });
});

test('pbcopy receives the exact text, unmodified', () => {
    let captured;
    const run = (_command, _args, options) => { captured = options.input; return { status: 0 }; };
    const body = 'line one\nline two\n  indented\ttab';
    copyText(body, { run, stdout: tty() });
    assert.equal(captured, body);
});

// The load-bearing case. Without pbcopy the shell falls back to a sequence the
// terminal never answers, and the ONLY defence against reporting that as a
// success is that `confirmed` stays false all the way through to the wording.
test('the OSC 52 fallback is never marked confirmed', () => {
    const stdout = tty();
    const result = copyText('the reply', { run: pbcopyMissing, stdout });
    assert.equal(result.ok, true);
    assert.equal(result.method, 'osc52');
    assert.equal(result.confirmed, false, 'an unacknowledged terminal write was treated as evidence');
    assert.match(stdout.writes[0], /^\x1b\]52;c;[A-Za-z0-9+/=]+\x07$/);
    assert.equal(
        Buffer.from(stdout.writes[0].slice(7, -1), 'base64').toString('utf8'),
        'the reply'
    );
});

test('a pbcopy that runs but fails also falls through to the unconfirmed path', () => {
    const result = copyText('the reply', { run: pbcopyBroken, stdout: tty() });
    assert.equal(result.method, 'osc52');
    assert.equal(result.confirmed, false);
});

// Off a TTY the sequence would land in a pipe or a log, which is not a
// clipboard. Reporting that as an attempted copy would be the same lie in a
// quieter voice.
test('with no pbcopy and no terminal, copy is unavailable rather than attempted', () => {
    const result = copyText('the reply', { run: pbcopyMissing, stdout: pipe() });
    assert.equal(result.ok, false);
    assert.equal(result.method, null);
    assert.match(result.reason, /not a terminal/);
});

test('a throwing spawn is caught and degrades, rather than crashing the shell', () => {
    const run = () => { throw Object.assign(new Error('no'), { code: 'EPERM' }); };
    const result = copyText('the reply', { run, stdout: tty() });
    assert.equal(result.method, 'osc52');
});

test('a failing terminal write is reported as unavailable, not as sent', () => {
    const stdout = { isTTY: true, write: () => { throw Object.assign(new Error('x'), { code: 'EPIPE' }); } };
    const result = copyText('the reply', { run: pbcopyMissing, stdout });
    assert.equal(result.ok, false);
    assert.match(result.reason, /EPIPE/);
});

// A payload over the terminal's ceiling is dropped or partially applied, and
// neither outcome is visible from here. Refusing is the only branch that cannot
// put half a reply on the clipboard and call it done.
test('an oversized reply refuses the OSC 52 path instead of truncating it', () => {
    const huge = 'x'.repeat(OSC52_MAX_BASE64);
    assert.equal(osc52Sequence(huge), null, 'sequence builder accepted an over-limit payload');
    const result = copyText(huge, { run: pbcopyMissing, stdout: tty() });
    assert.equal(result.ok, false);
    assert.match(result.reason, /too large/);
});

test('empty text is nothing to copy, not a successful copy of nothing', () => {
    const result = copyText('', { run: pbcopyOk, stdout: tty() });
    assert.equal(result.ok, false);
    assert.match(result.reason, /nothing to copy/);
});

// ------------------------------------------------------------------ wording --

test('only a confirmed result may say "copied"', () => {
    const confirmed = copyNotice({ ok: true, method: 'pbcopy', confirmed: true }, 3);
    assert.match(confirmed, /^Copied the last reply to the clipboard \(3 lines\)\.$/);
});

test('the unconfirmed notice does not assert that the clipboard was written', () => {
    const notice = copyNotice({ ok: true, method: 'osc52', confirmed: false }, 1);
    assert.doesNotMatch(
        notice,
        /\bcopied\b/i,
        'an unverifiable write used the word a skimming reader takes as success'
    );
    assert.match(notice, /cannot confirm/i);
    assert.match(notice, /1 line\b/, 'line count should not be pluralized at one');
});

test('an unavailable copy says so plainly and gives the reason', () => {
    const notice = copyNotice({ ok: false, method: null, confirmed: false, reason: 'pbcopy exited 1' }, 0);
    assert.match(notice, /^Copy unavailable: pbcopy exited 1\.$/);
});

// ------------------------------------------------------------- source text --

// The copy is taken from the item's source string. Sourcing it from the
// rendered rows would carry the signature, the rule glyph on every line, ANSI
// colour, and hard wraps at the current terminal width -- and the wraps cannot
// be undone once applied.
test('the last reply is the newest message, by source text', () => {
    const items = [
        { id: '1', kind: 'launch' },
        { id: '2', kind: 'user', text: 'a question' },
        { id: '3', kind: 'message', text: 'first reply' },
        { id: '4', kind: 'user', text: 'another' },
        { id: '5', kind: 'message', text: 'second reply' },
    ];
    assert.equal(lastReplyText(items), 'second reply');
});

test('a worker reply counts as a reply', () => {
    assert.equal(
        lastReplyText([{ id: '1', kind: 'worker-message', text: 'worker said this' }]),
        'worker said this'
    );
});

// Notices, errors, tool rows and diffs pile up after a reply constantly. If any
// of them counted, ctrl+y would copy the shell's own chatter back to the user.
test('trailing notices, errors, tools and diffs never shadow the real reply', () => {
    const items = [
        { id: '1', kind: 'message', text: 'the actual reply' },
        { id: '2', kind: 'tool', text: 'read a file' },
        { id: '3', kind: 'diff', diff: { path: 'x' } },
        { id: '4', kind: 'notice', text: 'compacted' },
        { id: '5', kind: 'error', text: 'something failed' },
    ];
    assert.equal(lastReplyText(items), 'the actual reply');
});

test('no reply yet returns null rather than an empty string', () => {
    assert.equal(lastReplyText([{ id: '1', kind: 'launch' }]), null);
    assert.equal(lastReplyText([]), null);
    assert.equal(lastReplyText(null), null);
});

test('a reply whose text is empty is not offered as copyable', () => {
    assert.equal(lastReplyText([{ id: '1', kind: 'message', text: '' }]), null);
});
