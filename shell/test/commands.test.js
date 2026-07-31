import test from 'node:test';
import assert from 'node:assert/strict';

import {
    commandFor,
    emailRequest,
    goalEnvelope,
    helpText,
    parseEmailDraft,
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
    assert.deepEqual(
        suggestionsFor('/').map((c) => c.name),
        ['goal', 'plan', 'subagent', 'compact', 'eval', 'email', 'win', 'copy', 'clear', 'help', 'exit']
    );
    // /compact, /copy, and /clear share a prefix, so none may swallow another.
    assert.deepEqual(suggestionsFor('/c').map((c) => c.name), ['compact', 'copy', 'clear']);
    assert.deepEqual(suggestionsFor('/co').map((c) => c.name), ['compact', 'copy']);
    assert.deepEqual(suggestionsFor('/cl').map((c) => c.name), ['clear']);
    assert.deepEqual(suggestionsFor('/e').map((c) => c.name), ['eval', 'email', 'exit']);
    assert.deepEqual(suggestionsFor('/cop').map((c) => c.name), ['copy']);
    assert.equal(suggestionsFor('//plan').length, 0);
    assert.match(helpText(), /\/goal/);
    assert.match(helpText('plan'), /read-only sandbox/);
    assert.match(helpText('missing'), /Unknown command/);
});

// Mouse reporting has been on since it shipped, and it takes drag-select away
// from the terminal for the whole time Sherman is mounted. Shift+drag has
// always been the way back and was never written down anywhere the operator
// looks. /help is where they look.
test('help states the ctrl+y binding and the shift+drag selection override', () => {
    const help = helpText();
    assert.match(help, /ctrl\+y/, '/help does not mention the copy binding');
    assert.match(help, /Shift\+drag/, '/help does not mention how to select text under mouse mode');

    const copy = helpText('copy');
    assert.match(copy, /ctrl\+y/);
    // The command's own detail has to carry the honesty caveat: an operator
    // reading /help copy is the one deciding whether to trust the notice.
    assert.match(copy, /cannot be verified|cannot prove/i);
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

// The email turn drafts; the shell opens the browser. The request must be
// read-only with the boundary stated, and the parser must be tolerant of a
// model that ignored "no fence" while staying strict about what a draft IS.
test('email drafting turn is read-only and its parser refuses non-drafts', () => {
    assert.equal(emailRequest('', 'goal'), null);

    const request = emailRequest('tell the lab the analyzers are back up', 'ship safely');
    assert.equal(request.mode, 'read-only');
    assert.equal(request.source, 'email');
    assert.match(request.text, /no-PHI rule/);
    assert.match(request.text, /Never invent a recipient/);
    assert.match(request.text, /Standing session goal: ship safely/);

    const draft = parseEmailDraft('{"to": "lab@example.com", "subject": "Analyzers", "body": "They are back up."}');
    assert.deepEqual(draft, { to: 'lab@example.com', subject: 'Analyzers', body: 'They are back up.' });

    // Fenced and wrapped in prose: the first {...} span that parses wins.
    const fenced = parseEmailDraft('Here is the draft:\n```json\n{"to": "", "subject": "S", "body": "B"}\n```\nDone.');
    assert.deepEqual(fenced, { to: '', subject: 'S', body: 'B' });

    // Not drafts: no JSON, unparseable JSON, and a draft with no body.
    assert.equal(parseEmailDraft('I could not draft that.'), null);
    assert.equal(parseEmailDraft('{"to": broken'), null);
    assert.equal(parseEmailDraft('{"to": "a@b.c", "subject": "S", "body": ""}'), null);
    assert.equal(parseEmailDraft(null), null);
});
