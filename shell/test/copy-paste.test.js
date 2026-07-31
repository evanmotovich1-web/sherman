// Copy and paste, on machines that are not a Mac.
//
// Copy: pbcopy is macOS-only, and the PC runs Sherman under WSL where the
// evidence-producing writer is clip.exe (wl-copy/xclip/xsel on Linux). The
// contract stays the clipboard module's: a command's exit code is evidence,
// OSC 52 is the unverifiable last resort, and no wording ever claims more
// than its mechanism earned.
//
// Paste: without bracketed paste, a multi-line paste is a stream of keys —
// and a chunk boundary landing exactly on a carriage return SUBMITS the half
// of the paste that arrived first. With it, the terminal wraps the paste in
// ESC[200~ / ESC[201~, and the composer must treat everything between the
// markers as text: newlines insert, markers never render, nothing submits.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import React from 'react';
import { render } from 'ink';
import chalk from 'chalk';

import { copyText } from '../src/clipboard.js';
import { MOUSE_ON, MOUSE_OFF } from '../src/ui/mouse.js';
import { PASTE_BEGIN, PASTE_END, foldPasteChunk } from '../src/ui/paste.js';
import { Composer } from '../src/ui/Composer.js';

chalk.level = 0;
const ansi = /\x1b\[[0-9;?]*[A-Za-z]/g;
const plain = (value) => value.replace(ansi, '');
const pause = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------------- copy --

const failing = (reason) => ({ error: Object.assign(new Error(reason), { code: 'ENOENT' }) });

test('clip.exe exiting 0 confirms the copy when pbcopy is missing', () => {
    const calls = [];
    const run = (command, args, options) => {
        calls.push({ command, args, input: options.input });
        return command === 'clip.exe' ? { status: 0 } : failing('ENOENT');
    };
    const result = copyText('the reply', { run, stdout: { isTTY: true, write: () => true } });
    assert.deepEqual(result, { ok: true, method: 'clip.exe', confirmed: true, reason: null });
    assert.equal(calls.at(-1).input, 'the reply');
});

test('the writers are tried in order and each gets its own arguments', () => {
    const calls = [];
    const run = (command, args) => { calls.push({ command, args }); return failing('ENOENT'); };
    copyText('the reply', { run, stdout: { isTTY: false, write: () => true } });
    assert.deepEqual(calls.map((call) => call.command), ['pbcopy', 'clip.exe', 'wl-copy', 'xclip', 'xsel']);
    assert.deepEqual(calls.find((call) => call.command === 'xclip').args, ['-selection', 'clipboard']);
    assert.deepEqual(calls.find((call) => call.command === 'xsel').args, ['--clipboard', '--input']);
});

test('a later writer succeeding stops the search', () => {
    const calls = [];
    const run = (command) => {
        calls.push(command);
        return command === 'wl-copy' ? { status: 0 } : failing('ENOENT');
    };
    const result = copyText('the reply', { run, stdout: { isTTY: true, write: () => true } });
    assert.equal(result.method, 'wl-copy');
    assert.equal(result.confirmed, true);
    assert.ok(!calls.includes('xclip'), 'kept probing after a confirmed write');
});

// -------------------------------------------------------- bracketed paste --

test('mouse arming also arms bracketed paste, and disarms it first', () => {
    assert.equal(MOUSE_ON, '\x1b[?1000h\x1b[?1006h\x1b[?2004h');
    assert.equal(MOUSE_OFF, '\x1b[?2004l\x1b[?1006l\x1b[?1000l');
});

test('foldPasteChunk strips markers and tracks the open paste across chunks', () => {
    // Both markers in one chunk: the text between them, no longer pasting.
    assert.deepEqual(
        foldPasteChunk(`${PASTE_BEGIN}alpha\rbeta${PASTE_END}`, false),
        { text: 'alpha\rbeta', pasting: false }
    );
    // Begin only: the paste stays open for the chunks that follow.
    assert.deepEqual(foldPasteChunk(`${PASTE_BEGIN}one`, false), { text: 'one', pasting: true });
    // A bare carriage return inside an open paste is text, not a submit.
    assert.deepEqual(foldPasteChunk('\r', true), { text: '\r', pasting: true });
    // The closing chunk ends it.
    assert.deepEqual(foldPasteChunk(`two${PASTE_END}`, true), { text: 'two', pasting: false });
    // Ordinary input outside a paste is untouched.
    assert.deepEqual(foldPasteChunk('plain', false), { text: 'plain', pasting: false });
});

async function composerSession() {
    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    stdin.ref = () => {};
    stdin.unref = () => {};
    const stdout = new PassThrough();
    stdout.columns = 60;
    stdout.rows = 20;
    const writes = [];
    stdout.on('data', (chunk) => { writes.push(chunk.toString()); });
    const submitted = [];
    const instance = render(
        React.createElement(Composer, {
            onSubmit: (text) => submitted.push(text), busy: false, columns: 60,
        }),
        { stdin, stdout, exitOnCtrlC: false, patchConsole: false, debug: true }
    );
    await pause();
    return { stdin, writes, submitted, unmount: () => instance.unmount() };
}

test('a bracketed paste with a newline inserts, renders clean, and does not submit', async () => {
    const { stdin, writes, submitted, unmount } = await composerSession();
    try {
        stdin.write(`${PASTE_BEGIN}alpha\rbeta${PASTE_END}`);
        await pause();
        assert.deepEqual(submitted, [], 'a pasted newline submitted the half-typed prompt');
        const frame = plain(writes.at(-1) ?? '');
        assert.match(frame, /alpha/);
        assert.match(frame, /beta/);
        assert.doesNotMatch(frame, /200~|201~/, 'paste markers leaked into the buffer');

        stdin.write('\r');
        await pause();
        assert.deepEqual(submitted, ['alpha\nbeta']);
    } finally {
        unmount();
    }
});

test('a chunk boundary on the pasted newline still does not submit', async () => {
    const { stdin, submitted, unmount } = await composerSession();
    try {
        stdin.write(`${PASTE_BEGIN}one`);
        await pause(20);
        stdin.write('\r');
        await pause(20);
        stdin.write(`two${PASTE_END}`);
        await pause();
        assert.deepEqual(submitted, [], 'the mid-paste carriage return submitted');

        stdin.write('\r');
        await pause();
        assert.deepEqual(submitted, ['one\ntwo']);
    } finally {
        unmount();
    }
});
