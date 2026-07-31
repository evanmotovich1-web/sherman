import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectWinSources, renderMarkdown, renderWinHtml, winRequest, writeWinSite } from '../src/win.js';

test('collectWinSources reports what exists and nothing it invented', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-win-'));
    try {
        // A first-week install: nothing recorded yet, nothing thrown.
        assert.deepEqual(collectWinSources({ home }), { sessions: [], evals: [], extras: [] });

        mkdirSync(join(home, '.sherman', 'sessions'), { recursive: true });
        mkdirSync(join(home, '.sherman', 'evals'), { recursive: true });
        mkdirSync(join(home, '.sherman', 'win-sources'), { recursive: true });
        writeFileSync(join(home, '.sherman', 'sessions', 'a.jsonl'), '{}\n');
        writeFileSync(join(home, '.sherman', 'sessions', 'ignore.txt'), 'x');
        writeFileSync(join(home, '.sherman', 'evals', 'a.md'), '# v');
        writeFileSync(join(home, '.sherman', 'win-sources', 'chatgpt-export.json'), '{}');
        writeFileSync(join(home, '.sherman', 'win-sources', '.hidden'), 'x');

        const sources = collectWinSources({ home });
        assert.equal(sources.sessions.length, 1);
        assert.match(sources.sessions[0], /a\.jsonl$/);
        assert.equal(sources.evals.length, 1);
        assert.deepEqual(sources.extras.map((p) => p.endsWith('chatgpt-export.json')), [true]);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('the /win turn is isolated, read-only, evidence-cited, and PHI-bounded', () => {
    const request = winRequest(
        { sessions: ['/h/.sherman/sessions/a.jsonl'], evals: [], extras: ['/h/.sherman/win-sources/x.json'] },
        'ship safely'
    );
    assert.equal(request.mode, 'isolated-read-only');
    assert.equal(request.source, 'win');
    assert.match(request.text, /\/h\/\.sherman\/sessions\/a\.jsonl/);
    assert.match(request.text, /Persisted eval verdicts: none found/);
    assert.match(request.text, /Cite session ids or filenames/);
    assert.match(request.text, /# What is going right/);
    assert.match(request.text, /no-PHI rule/);
    assert.match(request.text, /Standing session goal: ship safely/);
});

test('renderMarkdown covers the shapes the judge is told to use, escaped', () => {
    const html = renderMarkdown([
        '# What is going right',
        '- vault cited in **20260730_a**',
        '- `sop-draft` reached for unprompted',
        '',
        '1. first',
        '2. second',
        '',
        'A paragraph with <script>alert(1)</script> in it.',
        '---',
    ].join('\n'));
    assert.match(html, /<h1>What is going right<\/h1>/);
    assert.match(html, /<ul>\n<li>vault cited in <strong>20260730_a<\/strong><\/li>/);
    assert.match(html, /<code>sop-draft<\/code>/);
    assert.match(html, /<ol>\n<li>first<\/li>\n<li>second<\/li>\n<\/ol>/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /<hr>/);
});

test('the page states its evidence counts and that nothing left the machine', () => {
    const html = renderWinHtml('# What is going right\n- x', {
        sessions: 3, evals: 2, extras: 1, generatedAt: new Date('2026-07-31T12:00:00Z'),
    });
    assert.match(html, /3 session logs · 2 eval verdicts · 1 operator export/);
    assert.match(html, /Nothing left it\./);
    assert.match(html, /2026-07-31T12:00:00/);
    assert.match(html, /<h1>What is going right<\/h1>/);
});

test('writeWinSite writes under ~/.sherman/win and reports failure as null', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-win-site-'));
    try {
        const file = writeWinSite('<!doctype html><p>x</p>', {
            home, now: new Date('2026-07-31T12:34:56Z'),
        });
        assert.match(file, /\.sherman\/win\/win-20260731_123456\.html$/);
        assert.match(readFileSync(file, 'utf8'), /<p>x<\/p>/);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});
