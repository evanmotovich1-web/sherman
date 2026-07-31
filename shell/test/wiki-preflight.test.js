// The /wiki preflight: when the capture cannot work, say WHY before spending
// a turn discovering it.
//
// The failure that prompted this was real and mute: on the PC, /wiki ran a
// full engine turn whose only result was the model reporting "the LLM Wiki
// connection is not available in this session" — one line, no cause, nothing
// to act on. Everything the turn discovered the hard way was checkable from
// the shell in milliseconds: is the wiki installed, does its interpreter
// actually run, is the MCP entry registered where THIS engine reads config.
// The preflight checks those in order and names the first thing that is
// broken, with the fix in the same sentence.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { wikiPreflight } from '../src/commands.js';

function installedFixture({ codexConfig = null } = {}) {
    const home = mkdtempSync(join(tmpdir(), 'sherman-wiki-preflight-'));
    const dir = join(home, '.sherman', 'llmwiki');
    mkdirSync(join(dir, '.venv', 'bin'), { recursive: true });
    writeFileSync(join(dir, 'llmwiki'), '# cli entry');
    writeFileSync(join(dir, '.venv', 'bin', 'python'), '#!/bin/sh\n');
    if (codexConfig !== null) {
        mkdirSync(join(home, '.codex'), { recursive: true });
        writeFileSync(join(home, '.codex', 'config.toml'), codexConfig);
    }
    return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

const runOk = () => ({ status: 0 });

test('a healthy install with a registered codex entry passes preflight', () => {
    const { home, cleanup } = installedFixture({
        codexConfig: 'model = "gpt-5.6"\n\n[mcp_servers.llmwiki]\ncommand = "python"\n',
    });
    try {
        const result = wikiPreflight({ home, engine: 'codex', run: runOk, env: {} });
        assert.deepEqual(result, { ok: true, reason: null });
    } finally {
        cleanup();
    }
});

test('no install names the provisioning fix', () => {
    const home = mkdtempSync(join(tmpdir(), 'sherman-wiki-preflight-empty-'));
    try {
        const result = wikiPreflight({ home, engine: 'codex', run: runOk, env: {} });
        assert.equal(result.ok, false);
        assert.match(result.reason, /install\.sh/);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('an interpreter that cannot run the CLI is reported with its exit evidence', () => {
    const { home, cleanup } = installedFixture();
    try {
        const run = () => ({ status: 1, stderr: 'ModuleNotFoundError: No module named foo\nmore' });
        const result = wikiPreflight({ home, engine: 'claude-code', run, env: {} });
        assert.equal(result.ok, false);
        assert.match(result.reason, /exited 1/);
        assert.match(result.reason, /ModuleNotFoundError/);
        assert.doesNotMatch(result.reason, /\bmore\b/, 'more than the first stderr line leaked');
    } finally {
        cleanup();
    }
});

test('a spawn error degrades to its code rather than crashing', () => {
    const { home, cleanup } = installedFixture();
    try {
        const run = () => { throw Object.assign(new Error('no'), { code: 'EACCES' }); };
        const result = wikiPreflight({ home, engine: 'claude-code', run, env: {} });
        assert.equal(result.ok, false);
        assert.match(result.reason, /EACCES/);
    } finally {
        cleanup();
    }
});

test('codex without the MCP entry names the config file and the relaunch fix', () => {
    const { home, cleanup } = installedFixture({ codexConfig: 'model = "gpt-5.6"\n' });
    try {
        const result = wikiPreflight({ home, engine: 'codex', run: runOk, env: {} });
        assert.equal(result.ok, false);
        assert.match(result.reason, /config\.toml/);
        assert.match(result.reason, /relaunch/i);
    } finally {
        cleanup();
    }
});

test('the codex registration check honours CODEX_HOME', () => {
    const { home, cleanup } = installedFixture();
    const codexHome = mkdtempSync(join(tmpdir(), 'sherman-wiki-codexhome-'));
    try {
        writeFileSync(join(codexHome, 'config.toml'), '[mcp_servers.llmwiki]\ncommand = "x"\n');
        const result = wikiPreflight({
            home, engine: 'codex', run: runOk, env: { CODEX_HOME: codexHome },
        });
        assert.deepEqual(result, { ok: true, reason: null });
    } finally {
        cleanup();
        rmSync(codexHome, { recursive: true, force: true });
    }
});

test('non-codex engines do not require a codex config at all', () => {
    const { home, cleanup } = installedFixture();
    try {
        const result = wikiPreflight({ home, engine: 'claude-code', run: runOk, env: {} });
        assert.deepEqual(result, { ok: true, reason: null });
    } finally {
        cleanup();
    }
});
