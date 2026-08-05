import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { commandFor, helpText, submissionRecordText } from '../src/commands.js';
import { runCommonsCommand } from '../src/commons/command.js';
import { loadIdentity } from '../src/commons/identity.js';

test('/commons is truthful in the shell registry and status is local when unenrolled', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-command-'));
    try {
        assert.equal(commandFor('commons')?.usage, '/commons <subcommand>');
        assert.match(helpText('commons'), /enroll|feed|pending/i);
        const result = await runCommonsCommand('', { home });
        assert.equal(result.ok, true);
        assert.match(result.text, /not enrolled/i);
        assert.match(result.text, /service.*not deployed|routes.*unavailable/i);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('the shell transcript and session log redact enrollment tokens before recording', () => {
    const token = 'synthetic-one-time-token';
    assert.equal(submissionRecordText(`/commons enroll ${token}`), '/commons enroll «redacted»');
    assert.equal(
        submissionRecordText('/commons propose {"body":"API_KEY=synthetic-value"}'),
        '/commons propose «payload redacted»',
    );
    assert.equal(submissionRecordText('/commons status'), '/commons status');
    assert.doesNotMatch(submissionRecordText(`  /commons enroll ${token}`), new RegExp(token));
});

test('enroll never prints or stores the token and status uses the signed heartbeat route', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-enroll-command-'));
    const token = 'synthetic-one-time-token';
    const calls = [];
    try {
        const fetchImpl = async (url, options) => {
            calls.push({ url, options });
            if (url.endsWith('/enrollment/v1/device')) {
                return Response.json({
                    protocol: 'SHERMAN-COMMONS-V2', network_id: 'network-test',
                    device_id: 'device-test', agent_id: 'agent-test', owner_display_name: 'Test Owner',
                }, { status: 201 });
            }
            return Response.json({ ok: true, replayed: false });
        };
        const enrolled = await runCommonsCommand(`enroll ${token}`, {
            home, serviceUrl: 'https://commons.test', fetchImpl,
        });
        assert.equal(enrolled.ok, true);
        assert.doesNotMatch(enrolled.text, new RegExp(token));
        assert.doesNotMatch(JSON.stringify(loadIdentity(home)), new RegExp(token));
        assert.equal(calls[0].options.headers.Authorization, undefined);

        const status = await runCommonsCommand('status', { home, fetchImpl });
        assert.equal(status.ok, true);
        assert.match(status.text, /active.*Test Owner/i);
        assert.match(calls[1].options.headers['X-Sherman-Signature'], /./);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('open without an ID opens only the configured same-origin dashboard after the browser helper confirms', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-dashboard-command-'));
    try {
        const openedUrls = [];
        const opened = await runCommonsCommand('open', {
            home,
            dashboardUrl: 'https://commons.test/',
            serviceUrl: 'https://commons.test',
            openDashboard: (url) => {
                openedUrls.push(url);
                return { ok: true, method: 'open', reason: null };
            },
        });
        assert.equal(opened.ok, true);
        assert.deepEqual(openedUrls, ['https://commons.test/']);
        assert.match(opened.text, /dashboard.*opening/i);

        const refused = await runCommonsCommand('open', {
            home,
            dashboardUrl: 'https://other.test/',
            serviceUrl: 'https://commons.test',
            openDashboard: () => { throw new Error('must not run'); },
        });
        assert.equal(refused.ok, false);
        assert.match(refused.text, /same-origin/i);

        const failed = await runCommonsCommand('open', {
            home,
            dashboardUrl: 'https://commons.test/',
            serviceUrl: 'https://commons.test',
            openDashboard: () => ({ ok: false, method: null, reason: 'xdg-open exited 1' }),
        });
        assert.equal(failed.ok, false);
        assert.match(failed.text, /could not open/i);
        assert.doesNotMatch(failed.text, /dashboard.*opening/i);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('thread remains an explicit fetch command and open with an ID is a compatibility alias', async () => {
    const calls = [];
    const clientFactory = () => ({
        thread: async (id) => {
            calls.push(id);
            return {
                post: { id, kind: 'idea', title: 'Thread title', owner_display_name: 'Owner', authorship_mode: 'agent_observed' },
                replies: [],
            };
        },
    });
    const explicit = await runCommonsCommand('thread post-1', { clientFactory });
    const compatible = await runCommonsCommand('open post-2', { clientFactory });
    assert.equal(explicit.ok, true);
    assert.equal(compatible.ok, true);
    assert.deepEqual(calls, ['post-1', 'post-2']);
});

test('propose stays local, approve is a separate human command, and unavailable publish is honest', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-commons-intent-command-'));
    const value = JSON.stringify({
        kind: 'idea', title: 'Synthetic pending command', body: 'Create only a local intent.',
        authorship_mode: 'agent_observed', visibility: 'network',
    });
    try {
        let calls = 0;
        const proposed = await runCommonsCommand(`propose ${value}`, {
            home,
            clientFactory: () => ({ publishPost: async () => { calls += 1; } }),
        });
        assert.equal(proposed.ok, true);
        assert.match(proposed.text, /pending intent ([a-f0-9-]+)/i);
        assert.equal(calls, 0);
        const id = proposed.text.match(/pending intent ([a-f0-9-]+)/i)[1];

        const approved = await runCommonsCommand(`approve ${id}`, { home });
        assert.equal(approved.ok, true);
        assert.match(approved.text, /exact.*hash|hash.*approved/i);
        assert.match(approved.text, /Synthetic pending command/);
        assert.match(approved.text, /Create only a local intent\./);
        assert.match(approved.text, /agent-observed/);

        const unavailable = await runCommonsCommand(`publish-intent ${id}`, {
            home,
            clientFactory: () => ({ publishPost: async () => {
                throw Object.assign(new Error('raw server details'), { code: 'service_unavailable' });
            } }),
        });
        assert.equal(unavailable.ok, false);
        assert.match(unavailable.text, /service capability.*not available/i);
        assert.doesNotMatch(unavailable.text, /raw server details/);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});
