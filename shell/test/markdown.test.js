import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'ink';
import stringWidth from 'string-width';
import chalk from 'chalk';

import { Markdown, parseBlocks, parseInline } from '../src/ui/Markdown.js';
import { Transcript } from '../src/ui/Transcript.js';

// Same harness discipline as ui-layout.test.js: pin the terminal so a live
// console size cannot leak into pinned-width renders, and pin colour level 0
// so assertions compare content, not escapes.
Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true });
Object.defineProperty(process.stdout, 'rows', { value: 24, configurable: true });
chalk.level = 0;

const ansi = /\x1b\[[0-9;]*m/g;
const plain = (value) => value.replace(ansi, '');
const rows = (value) => plain(value).split('\n');
const maxWidth = (value) => Math.max(0, ...rows(value).map((line) => stringWidth(line)));

// ------------------------------------------------------------------ parser --

test('parseInline styles code, bold, italic, and links; plain text survives', () => {
    assert.deepEqual(parseInline('plain'), [{ text: 'plain' }]);
    assert.deepEqual(parseInline('a `b` c'), [
        { text: 'a ' }, { text: 'b', code: true }, { text: ' c' },
    ]);
    const bold = parseInline('**bold**');
    assert.equal(bold.length, 1);
    assert.equal(bold[0].text, 'bold');
    assert.equal(bold[0].bold, true);
    const link = parseInline('[docs](https://example.com)');
    assert.deepEqual(link, [{ text: 'docs', href: 'https://example.com' }]);
});

test('parseInline leaves snake_case and code-span contents alone', () => {
    assert.deepEqual(parseInline('vault_path stays flat'), [{ text: 'vault_path stays flat' }]);
    const nodes = parseInline('`**not bold**`');
    assert.deepEqual(nodes, [{ text: '**not bold**', code: true }]);
});

test('parseInline nests one level: emphasis inside bold', () => {
    const nodes = parseInline('**hot `code`**');
    assert.deepEqual(nodes, [
        { text: 'hot ', bold: true },
        { text: 'code', code: true, bold: true },
    ]);
});

test('parseBlocks recognises the block subset', () => {
    const blocks = parseBlocks([
        '# Title',
        '',
        'A paragraph.',
        '',
        '- one',
        '- two',
        '',
        '> a quote',
        '',
        '```js',
        'const x = 1;',
        '```',
        '',
        '---',
        '',
        '| a | b |',
        '| --- | --- |',
        '| 1 | 2 |',
    ].join('\n'));
    assert.deepEqual(blocks.map((b) => b.type), [
        'heading', 'paragraph', 'list', 'quote', 'code', 'rule', 'table',
    ]);
    assert.equal(blocks[0].depth, 1);
    assert.equal(blocks[2].items.length, 2);
    assert.equal(blocks[4].lang, 'js');
    assert.deepEqual(blocks[4].lines, ['const x = 1;']);
    assert.deepEqual(blocks[6].rows, [['a', 'b'], ['1', '2']]);
});

test('parseBlocks keeps an unclosed fence as code — nothing is dropped', () => {
    const blocks = parseBlocks('```\nleft open');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'code');
    assert.deepEqual(blocks[0].lines, ['left open']);
});

test('parseBlocks treats pipes without a divider as prose, not a table', () => {
    const blocks = parseBlocks('a | b\nc | d');
    assert.deepEqual(blocks.map((b) => b.type), ['paragraph']);
});

// --------------------------------------------------------------- rendering --

test('Markdown strips markers and renders the content', () => {
    const output = plain(renderToString(React.createElement(Markdown, {
        text: '## Plan\n\nUse **the vault** with `sherman sync`.',
        width: 60,
    })));
    assert.match(output, /Plan/);
    assert.doesNotMatch(output, /##/);
    assert.doesNotMatch(output, /\*\*/);
    assert.match(output, /Use the vault with sherman sync\./);
});

test('Markdown renders lists with house bullets and quotes with a bar', () => {
    const output = plain(renderToString(React.createElement(Markdown, {
        text: '- first\n2. second\n\n> wisdom',
        width: 60,
    })));
    assert.match(output, /• first/);
    assert.match(output, /2\. second/);
    assert.match(output, /▏ wisdom/);
});

test('Markdown aligns a table that fits and falls back verbatim when it cannot', () => {
    const fits = plain(renderToString(React.createElement(Markdown, {
        text: '| name | n |\n| --- | --- |\n| alpha | 1 |',
        width: 60,
    })));
    assert.match(fits, /name +│ n/);
    assert.match(fits, /alpha │ 1/);
    assert.match(fits, /─+┼─+/);

    const wide = plain(renderToString(React.createElement(Markdown, {
        text: '| aaaaaaaaaa | bbbbbbbbbb |\n| --- | --- |\n| cccccccccc | dddddddddd |',
        width: 12,
    })));
    // Fallback keeps the literal pipes so no cell content is lost.
    assert.match(wide, /aaaaaaaaaa/);
    assert.match(wide, /\|/);
});

test('Markdown code blocks drop the fence glyphs and keep every line', () => {
    const output = plain(renderToString(React.createElement(Markdown, {
        text: '```bash\necho one\n\necho two\n```',
        width: 60,
    })));
    assert.doesNotMatch(output, /```/);
    assert.match(output, /bash/);
    assert.match(output, /echo one/);
    assert.match(output, /echo two/);
});

test('a markdown reply renders inside the Sherman frame without overflow', () => {
    const output = renderToString(React.createElement(Transcript, {
        items: [
            { id: 'u1', kind: 'user', text: 'plan?' },
            { id: 'm1', kind: 'message', text: '# Plan\n\n- do **this**\n- run `that`' },
        ],
        columns: 60,
    }));
    const text = plain(output);
    assert.match(text, /╭─ Sherman ─+╮/);
    assert.match(text, /• do this/);
    assert.match(text, /╰─+╯/);
    assert.ok(maxWidth(output) <= 60);
});

test('a plain reply with no markdown renders byte-identical prose', () => {
    const output = plain(renderToString(React.createElement(Markdown, {
        text: 'One plain sentence.',
        width: 60,
    })));
    assert.equal(output.trim(), 'One plain sentence.');
});
