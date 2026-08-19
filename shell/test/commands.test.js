import test from 'node:test';
import assert from 'node:assert/strict';

import {
    commandFor,
    parseEngineFlag,
    emailRequest,
    goalEnvelope,
    helpText,
    naturalEmailInstruction,
    parseEmailDraft,
    parseEmailResult,
    parseSubmission,
    planRequest,
    submissionRecordText,
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

test('explicit retention payloads are redacted before transcript or session logging', () => {
    assert.equal(
        submissionRecordText('/wiki approved-format | Internal fact text'),
        '/wiki «fact text redacted»'
    );
    assert.equal(
        submissionRecordText('/learn verify-first | Verify before claiming completion'),
        '/learn «fact text redacted»'
    );
});

test('registry drives suggestions and help', () => {
    assert.equal(commandFor('subagent')?.usage, '/subagent [--engine codex|claude|zai] <task>');
    assert.deepEqual(suggestionsFor('/p').map((c) => c.name), ['plan', 'pic']);
    assert.deepEqual(
        suggestionsFor('/').map((c) => c.name),
        ['goal', 'plan', 'pic', 'subagent', 'agents', 'compact', 'eval', 'email', 'win', 'learn', 'wiki',
            'connectors', 'key', 'models', 'commons', 'money', 'copy', 'select', 'customize', 'update', 'clear', 'help', 'exit']
    );
    // /compact, /connectors, /copy, and /clear share a prefix, so none may
    // swallow another — and /co now has four claimants, which is exactly the
    // case a naive prefix match gets wrong.
    assert.deepEqual(suggestionsFor('/c').map((c) => c.name), ['compact', 'connectors', 'commons', 'copy', 'customize', 'clear']);
    assert.deepEqual(suggestionsFor('/co').map((c) => c.name), ['compact', 'connectors', 'commons', 'copy']);
    assert.deepEqual(suggestionsFor('/m').map((c) => c.name), ['models', 'money']);
    assert.deepEqual(suggestionsFor('/mo').map((c) => c.name), ['models', 'money']);
    assert.deepEqual(suggestionsFor('/mod').map((c) => c.name), ['models']);
    assert.deepEqual(suggestionsFor('/mon').map((c) => c.name), ['money']);
    assert.deepEqual(suggestionsFor('/con').map((c) => c.name), ['connectors']);
    assert.deepEqual(suggestionsFor('/com').map((c) => c.name), ['compact', 'commons']);
    assert.deepEqual(suggestionsFor('/cl').map((c) => c.name), ['clear']);
    assert.deepEqual(suggestionsFor('/e').map((c) => c.name), ['eval', 'email', 'exit']);
    assert.deepEqual(suggestionsFor('/cop').map((c) => c.name), ['copy']);
    assert.equal(suggestionsFor('//plan').length, 0);
    assert.match(helpText(), /\/goal/);
    assert.match(helpText('plan'), /read-only sandbox/);
    assert.match(helpText('learn'), /shared memory/);
    assert.match(helpText('wiki'), /vault\/wiki/);
    assert.match(helpText('missing'), /Unknown command/);
});

// Native terminal selection wins by default. Wheel capture remains an explicit
// toggle for fullscreen history and an environment opt-in at launch.
test('help states default selection, copy, wheel toggle, and mouse opt-in', () => {
    const help = helpText();
    assert.match(help, /ctrl\+y/, '/help does not mention the copy binding');
    assert.match(help, /drag selects text/i, '/help does not state default terminal selection');
    assert.match(help, /\/select to toggle wheel capture/i, '/help does not state how to enable wheel capture');
    assert.match(help, /SHERMAN_MOUSE=1/, '/help does not state how to opt into mouse capture');

    const copy = helpText('copy');
    assert.match(copy, /ctrl\+y/);
    // The command's own detail has to carry the honesty caveat: an operator
    // reading /help copy is the one deciding whether to trust the notice.
    assert.match(copy, /cannot be verified|cannot prove/i);
    const select = helpText('select');
    assert.match(select, /ordinary terminal text selection/i);
    assert.match(select, /drag/i);
    assert.match(select, /wheel/i);
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
    assert.equal(naturalEmailInstruction('write Alex an email saying the report is ready'), 'write Alex an email saying the report is ready');
    assert.equal(naturalEmailInstruction('Please draft an e-mail to the vendor'), 'Please draft an e-mail to the vendor');
    assert.equal(naturalEmailInstruction('How do I write a good email?'), null);
    assert.equal(naturalEmailInstruction('write a parser for email headers'), null);
    assert.equal(naturalEmailInstruction('write an email parser'), null);
    assert.equal(naturalEmailInstruction('draft an email template component'), null);
    assert.equal(naturalEmailInstruction('compose an email validation regex'), null);
    assert.equal(naturalEmailInstruction('write a function to send an email'), null);
    assert.equal(naturalEmailInstruction('write an email thanking Alex for the report'), 'write an email thanking Alex for the report');
    assert.equal(naturalEmailInstruction('draft Bob an email that confirms receipt'), 'draft Bob an email that confirms receipt');
    assert.equal(naturalEmailInstruction('compose an email reminding the team about Friday'), 'compose an email reminding the team about Friday');
    assert.equal(emailRequest('', 'goal'), null);

    const request = emailRequest('tell the lab the analyzers are back up', 'ship safely');
    assert.equal(request.mode, 'browser-read-only');
    assert.equal(request.source, 'email');
    assert.match(request.text, /no-PHI rule/);
    assert.match(request.text, /Never invent a recipient/);
    assert.match(request.text, /Sent mail/i);
    assert.match(request.text, /correspondence/i);
    assert.match(request.text, /browser|Chrome/i);
    assert.match(request.text, /question/i);
    assert.match(request.text, /Never use browser tools to create or mutate mail/);
    assert.match(request.text, /autosave one draft/);
    assert.match(request.text, /New-recipient tone choice/);
    assert.match(request.text, /never ask the same question again/i);
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

    const question = parseEmailResult(JSON.stringify({
        question: 'How should this sound?',
        choices: ['Concise professional', 'Warm professional', 'Casual and direct'],
    }));
    assert.deepEqual(question, {
        kind: 'question',
        question: 'How should this sound?',
        choices: ['Concise professional', 'Warm professional', 'Casual and direct'],
    });
    assert.deepEqual(
        parseEmailResult('{"to":"a@b.c","subject":"S","body":"B"}'),
        { kind: 'draft', draft: { to: 'a@b.c', subject: 'S', body: 'B' } }
    );
    assert.equal(parseEmailResult('{"question":"Q","choices":[]}'), null);
    assert.deepEqual(
        parseEmailResult('{"error":"Mailbox history cannot be inspected without risking PHI."}'),
        { kind: 'error', error: 'Mailbox history cannot be inspected without risking PHI.' }
    );
});

test('parseEngineFlag routes one worker to a named model', () => {
    assert.deepEqual(
        parseEngineFlag('--engine claude summarize the SOP'),
        { engine: 'claude', task: 'summarize the SOP', error: null }
    );
    // Operators say the model name; aliases land on the backend that runs it.
    assert.equal(parseEngineFlag('--engine glm check the format').engine, 'zai');
    assert.equal(parseEngineFlag('--engine OPENCODE t').engine, 'zai');
    // No flag: task untouched, no engine, no error.
    assert.deepEqual(
        parseEngineFlag('plain task text'),
        { engine: null, task: 'plain task text', error: null }
    );
    // Unknown engines error with the roster instead of silently falling through.
    assert.ok(parseEngineFlag('--engine grok do a thing').error.includes('Valid: codex, claude, zai'));
    // A bare flag with no task is not a routing.
    assert.equal(parseEngineFlag('--engine claude').engine, null);
});
