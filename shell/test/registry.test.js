// The registry, tested for the failure that matters: a launch screen that
// states something untrue about what Sherman can do.
//
// Two distinct lies are possible here and both are covered. A registry that
// could not be READ must not render as a registry that is EMPTY — "0 skills"
// and "unreadable" are different facts about an installation. And a category
// list too wide for the panel must state what it dropped, never just stop.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fitCategory, loadSkills, loadTools, parseFrontMatter } from '../src/registry.js';

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'sherman-registry-'));
    return {
        root,
        skill(name, body) {
            mkdirSync(join(root, 'skills', name), { recursive: true });
            writeFileSync(join(root, 'skills', name, 'SKILL.md'), body);
        },
        capabilities(value) {
            mkdirSync(join(root, 'agent'), { recursive: true });
            writeFileSync(join(root, 'agent', 'capabilities.json'), value);
        },
        cleanup() { rmSync(root, { recursive: true, force: true }); },
    };
}

const skillBody = (name, category) =>
    `---\nname: ${name}\ncategory: ${category}\nsummary: does a thing\n---\n\n# Body\n`;

// ---------------------------------------------------------- front matter --

test('front matter parses a flat key: value block', () => {
    assert.deepEqual(
        parseFrontMatter('---\nname: a\ncategory: b\n---\nbody'),
        { name: 'a', category: 'b' }
    );
});

test('absent, unterminated, or non-flat front matter is rejected, not guessed at', () => {
    assert.equal(parseFrontMatter('# no front matter'), null);
    assert.equal(parseFrontMatter('---\nname: a\nbody without close'), null);
    assert.equal(parseFrontMatter('---\n  - a list item\n---\n'), null);
});

// ---------------------------------------------------------------- skills --

test('skills are grouped by category and counted from the directory', () => {
    const fx = fixture();
    try {
        fx.skill('vault-search', skillBody('vault-search', 'vault'));
        fx.skill('vault-write', skillBody('vault-write', 'vault'));
        fx.skill('phi-boundary', skillBody('phi-boundary', 'compliance'));

        const result = loadSkills(fx.root);
        assert.equal(result.ok, true);
        assert.equal(result.count, 3);
        assert.deepEqual(result.categories, [
            { name: 'compliance', items: ['phi-boundary'] },
            { name: 'vault', items: ['vault-search', 'vault-write'] },
        ]);
        assert.deepEqual(result.malformed, []);
    } finally { fx.cleanup(); }
});

// The load-bearing distinction. A missing skills/ directory rendering as an
// empty list would tell the operator Sherman has no skills, when the truth is
// that this installation is broken.
test('a missing skills directory is unavailable, never an empty registry', () => {
    const fx = fixture();
    try {
        const result = loadSkills(fx.root);
        assert.equal(result.ok, false);
        assert.match(result.reason, /no skills directory/);
        assert.equal(result.count, undefined, 'an unreadable registry must not report a count');
    } finally { fx.cleanup(); }
});

// A skill whose front matter is broken will not work. Dropping it silently
// would make a broken install look like a smaller one.
test('malformed skills are reported separately, not silently dropped', () => {
    const fx = fixture();
    try {
        fx.skill('good', skillBody('good', 'vault'));
        fx.skill('no-front-matter', '# just a heading\n');
        fx.skill('missing-category', '---\nname: missing-category\n---\n');
        mkdirSync(join(fx.root, 'skills', 'no-skill-file'), { recursive: true });

        const result = loadSkills(fx.root);
        assert.equal(result.count, 1);
        assert.deepEqual(result.malformed, ['missing-category', 'no-front-matter', 'no-skill-file']);
    } finally { fx.cleanup(); }
});

// The directory is what the operator navigates; the front matter is what the
// screen prints. When they disagree there is no way to tell which is the lie,
// so neither is trusted.
test('a name that disagrees with its directory is malformed', () => {
    const fx = fixture();
    try {
        fx.skill('actual-dir', skillBody('a-different-name', 'vault'));
        const result = loadSkills(fx.root);
        assert.equal(result.count, 0);
        assert.deepEqual(result.malformed, ['actual-dir']);
    } finally { fx.cleanup(); }
});

// ----------------------------------------------------------------- tools --

test('toolsets load in declaration order with a true total', () => {
    const fx = fixture();
    try {
        fx.capabilities(JSON.stringify({
            toolsets: [
                { name: 'session', tools: [{ name: 'goal' }, { name: 'plan' }] },
                { name: 'web', tools: [{ name: 'web_search' }] },
            ],
        }));
        const result = loadTools(fx.root);
        assert.equal(result.ok, true);
        assert.equal(result.count, 3);
        assert.deepEqual(result.categories, [
            { name: 'session', items: ['goal', 'plan'] },
            { name: 'web', items: ['web_search'] },
        ]);
    } finally { fx.cleanup(); }
});

test('an absent or malformed capability registry is unavailable, not empty', () => {
    const fx = fixture();
    try {
        assert.deepEqual(loadTools(fx.root), { ok: false, reason: 'no capability registry' });

        fx.capabilities('{ not json');
        assert.equal(loadTools(fx.root).ok, false);

        fx.capabilities(JSON.stringify({ toolsets: [{ name: 'x' }] }));
        assert.deepEqual(loadTools(fx.root), { ok: false, reason: 'malformed registry' });

        fx.capabilities(JSON.stringify({ toolsets: [{ name: 'x', tools: [{ nope: 1 }] }] }));
        assert.deepEqual(loadTools(fx.root), { ok: false, reason: 'malformed registry' });
    } finally { fx.cleanup(); }
});

// ------------------------------------------------------------------- fit --

test('a category that fits shows every item and reports nothing dropped', () => {
    assert.deepEqual(
        fitCategory('web', ['web_search'], 40),
        { label: 'web: ', shown: ['web_search'], more: 0 }
    );
});

// Truncation is stated, never silent — the rule Diff.js already follows. A
// line that just stopped would read as a smaller toolset than the real one.
test('an overflowing category states how many it dropped', () => {
    const items = ['read_file', 'search_files', 'write_file', 'patch'];
    const fit = fitCategory('file', items, 34);
    assert.ok(fit.shown.length < items.length, 'nothing was dropped, so this proves nothing');
    assert.equal(fit.shown.length + fit.more, items.length, 'the tally lost an item');

    const rendered = `${fit.label}${fit.shown.join(', ')}, +${fit.more} more`;
    assert.ok(rendered.length <= 34, `line overflowed: ${rendered.length} cells`);
});

test('a width too narrow for even one item still reports the whole count', () => {
    const fit = fitCategory('transcript', ['copy', 'help'], 12);
    assert.deepEqual(fit.shown, []);
    assert.equal(fit.more, 2);
});

// Every real width the panel renders at, against the real registry shape.
test('no fitted line ever exceeds its budget', () => {
    const items = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
    for (let width = 4; width <= 80; width += 1) {
        const fit = fitCategory('category', items, width);
        const tail = fit.more > 0 ? `${fit.shown.length > 0 ? ', ' : ''}+${fit.more} more` : '';
        const rendered = `${fit.label}${fit.shown.join(', ')}${tail}`;
        assert.equal(fit.shown.length + fit.more, items.length, `width ${width} lost an item`);
        if (fit.shown.length > 0) {
            assert.ok(rendered.length <= width, `width ${width} overflowed: ${JSON.stringify(rendered)}`);
        }
    }
});
