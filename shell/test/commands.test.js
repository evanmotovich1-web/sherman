import test from 'node:test';
import assert from 'node:assert/strict';

import {
    commandFor,
    goalEnvelope,
    helpText,
    parseSubmission,
    planRequest,
    suggestionsFor,
    workerRequest,
} from '../src/commands.js';

test('parses commands, multiline args, and literal slash escape', () => {
    assert.deepEqual(parseSubmission(' /goal ship it'), {
        kind: 'command', name: 'goal', args: 'ship it',
    });
    assert.deepEqual(parseSubmission('/plan first\nsecond'), {
        kind: 'command', name: 'plan', args: 'first\nsecond',
    });
    assert.deepEqual(parseSubmission('//goal literal'), {
        kind: 'prompt', text: '/goal literal',
    });
    assert.deepEqual(parseSubmission('normal prompt'), {
        kind: 'prompt', text: 'normal prompt',
    });
});

test('registry drives suggestions and help', () => {
    assert.equal(commandFor('subagent')?.usage, '/subagent <task>');
    assert.deepEqual(suggestionsFor('/p').map((c) => c.name), ['plan']);
    assert.deepEqual(suggestionsFor('/').map((c) => c.name), ['goal', 'plan', 'subagent', 'compact', 'help']);
    assert.equal(suggestionsFor('//plan').length, 0);
    assert.match(helpText(), /\/goal/);
    assert.match(helpText('plan'), /read-only sandbox/);
    assert.match(helpText('missing'), /Unknown command/);
});

test('goal, plan, and worker envelopes preserve policy boundaries', () => {
    assert.match(goalEnvelope('do the task', 'ship safely'), /no-PHI rule/);
    assert.equal(goalEnvelope('plain', ''), 'plain');

    const plan = planRequest('', 'ship safely');
    assert.equal(plan.mode, 'isolated-read-only');
    assert.equal(plan.source, 'plan');
    assert.match(plan.text, /Do not implement/);
    assert.equal(planRequest('', ''), null);

    const worker = workerRequest('research options', 'ship safely');
    assert.equal(worker.mode, 'isolated-read-only');
    assert.equal(worker.source, 'subagent');
    assert.match(worker.text, /fresh read-only worker/);
    assert.doesNotMatch(worker.text, /parent conversation history/i);
});
