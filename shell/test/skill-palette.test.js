// Skills on the slash palette.
//
// The palette's first-party command list is a fixed registry, but the skills
// are the product — the operator asked to SEE them under `/` and to see at a
// glance which entries are skills. Two lies are possible and both are covered
// here: a skill that completes but silently submits as an unknown command, and
// a palette that renders a skill in command ink so the operator cannot tell
// which contract they are invoking. Skill rows are purple (brand secondary,
// ansi256 135); first-party rows keep their blue (tertiary, 39).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { renderToString } from 'ink';
import chalk from 'chalk';

import { COMMANDS, suggestionsFor, typedSkillName, skillTurn } from '../src/commands.js';
import { loadSkills } from '../src/registry.js';
import { CommandMenu } from '../src/ui/CommandMenu.js';

const SKILLS = [
    { name: 'seed', category: 'documents', summary: 'shape a raw idea into a typed, buildable project plan' },
    { name: 'vault-search', category: 'vault', summary: 'search the vault before asserting any company-specific fact' },
];

// ------------------------------------------------------------ suggestions --

test('bare slash lists every command and then every skill', () => {
    const all = suggestionsFor('/', SKILLS);
    assert.deepEqual(
        all.map((entry) => entry.name),
        [...COMMANDS.map((command) => command.name), 'seed', 'vault-search']
    );
    // Commands first is an ordering contract, not an accident: the first-party
    // registry is small and stable, the skill list grows.
    assert.equal(all.filter((entry) => entry.kind === 'skill').length, SKILLS.length);
});

test('a prefix filters skills exactly as it filters commands', () => {
    assert.deepEqual(suggestionsFor('/se', SKILLS).map((entry) => entry.name), ['select', 'seed']);
    assert.deepEqual(suggestionsFor('/v', SKILLS).map((entry) => entry.name), ['vault-search']);
    // /e matches commands only; no skill entry sneaks in.
    assert.deepEqual(
        suggestionsFor('/e', SKILLS).map((entry) => entry.kind ?? 'command'),
        ['command', 'command', 'command']
    );
});

test('skill entries carry the palette fields the menu renders', () => {
    const [entry] = suggestionsFor('/seed', SKILLS);
    assert.equal(entry.kind, 'skill');
    assert.equal(entry.usage, '/seed');
    assert.match(entry.summary, /buildable project plan/);
});

test('the skills parameter is optional and the literal-slash escape still wins', () => {
    assert.deepEqual(suggestionsFor('/'), suggestionsFor('/', []));
    assert.equal(suggestionsFor('//seed', SKILLS).length, 0);
});

// ------------------------------------------------------- typed skill name --

test('typedSkillName recognizes a typed slash-skill and nothing else', () => {
    assert.equal(typedSkillName('/seed', SKILLS), 'seed');
    assert.equal(typedSkillName('/seed my idea', SKILLS), 'seed');
    assert.equal(typedSkillName('/SEED my idea', SKILLS), 'seed');
    assert.equal(typedSkillName('/see', SKILLS), null);
    assert.equal(typedSkillName('/goal status', SKILLS), null);
    assert.equal(typedSkillName('//seed', SKILLS), null);
    assert.equal(typedSkillName('seed', SKILLS), null);
    assert.equal(typedSkillName('', SKILLS), null);
});

// -------------------------------------------------------------- the turn --

test('a skill turn names the skill and runs it autonomously by default', () => {
    const text = skillTurn('seed', 'a lab courier tracker');
    assert.match(text, /skills\/seed\/SKILL\.md/);
    assert.match(text, /a lab courier tracker/);
    assert.match(text, /autonomously by default/);
    assert.match(text, /complete the skill end to end/);
    assert.match(text, /unless the operator explicitly asked for an interactive flow/);
    assert.match(text, /no-PHI/);

    const bare = skillTurn('seed', '');
    assert.match(bare, /skills\/seed\/SKILL\.md/);
    assert.doesNotMatch(bare, /Request:/);
    assert.match(bare, /Ask one focused question only if no actionable outcome can be inferred/);
    assert.doesNotMatch(bare, /ask for what it needs/);
});

// ----------------------------------------------------------- palette ink --

test('the palette renders skill rows purple and command rows blue', () => {
    const level = chalk.level;
    chalk.level = 3;
    try {
        const entries = suggestionsFor('/', SKILLS);
        const output = renderToString(
            React.createElement(CommandMenu, {
                commands: entries, selected: 0, width: 120, maxRows: 40,
            }),
            { columns: 120 }
        );
        const rowFor = (name) => output.split('\n').find((line) => line.includes(`/${name}`));
        // Brand secondary (purple 135) on the skill row; tertiary (blue 39) on
        // an unselected command row.
        assert.match(rowFor('seed'), /38;5;135/);
        assert.match(rowFor('vault-search'), /38;5;135/);
        assert.match(rowFor('plan'), /38;5;39/);
        assert.doesNotMatch(rowFor('plan'), /38;5;135/);
    } finally {
        chalk.level = level;
    }
});

test('a selected skill row inverts in purple, not command pink', () => {
    const level = chalk.level;
    chalk.level = 3;
    try {
        const entries = suggestionsFor('/seed', SKILLS);
        const output = renderToString(
            React.createElement(CommandMenu, {
                commands: entries, selected: 0, width: 120, maxRows: 40,
            }),
            { columns: 120 }
        );
        const row = output.split('\n').find((line) => line.includes('/seed'));
        // The ink immediately styling the selected label is purple — the pink
        // that may appear elsewhere on the line belongs to the box frame.
        assert.match(row, /38;5;135m \/seed /);
        assert.doesNotMatch(row, /38;5;205m \/seed /);
    } finally {
        chalk.level = level;
    }
});

// ------------------------------------------------------------- registry --

test('loadSkills exposes a flat list with the summary the palette prints', () => {
    const root = mkdtempSync(join(tmpdir(), 'sherman-skill-palette-'));
    try {
        mkdirSync(join(root, 'skills', 'alpha'), { recursive: true });
        writeFileSync(
            join(root, 'skills', 'alpha', 'SKILL.md'),
            '---\nname: alpha\ncategory: vault\nsummary: does the alpha thing\ndescription: Does the alpha thing. Use when alpha.\n---\n\n# Alpha\n'
        );
        // No summary: the description stands in, because the palette must
        // never render a blank explanation next to a real skill.
        mkdirSync(join(root, 'skills', 'beta'), { recursive: true });
        writeFileSync(
            join(root, 'skills', 'beta', 'SKILL.md'),
            '---\nname: beta\ncategory: vault\ndescription: Does the beta thing. Use when beta.\n---\n\n# Beta\n'
        );

        const skills = loadSkills(root);
        assert.equal(skills.ok, true);
        assert.deepEqual(
            skills.list,
            [
                { name: 'alpha', category: 'vault', summary: 'does the alpha thing' },
                { name: 'beta', category: 'vault', summary: 'Does the beta thing. Use when beta.' },
            ]
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
