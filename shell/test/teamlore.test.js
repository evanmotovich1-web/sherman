import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RECALL = join(ROOT, '.claude', 'skills', 'teamlore', 'scripts', 'recall.js');
const DISTILL = join(ROOT, '.claude', 'skills', 'teamlore', 'scripts', 'distill-check.js');

function run(script, args, cwd, input) {
    return spawnSync(process.execPath, [script, ...args], {
        cwd,
        input: JSON.stringify(input),
        encoding: 'utf8',
    });
}

test('Teamlore hooks are tracked and recall path-scoped lessons', () => {
    const settings = JSON.parse(readFileSync(join(ROOT, '.claude', 'settings.json'), 'utf8'));
    assert.equal(settings.hooks.SessionStart[0].hooks[0].command.includes('recall.js'), true);
    assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].command.includes('recall.js'), true);
    assert.equal(settings.hooks.Stop[0].hooks[0].command.includes('distill-check.js'), true);

    const repo = mkdtempSync(join(tmpdir(), 'sherman-teamlore-'));
    try {
        const git = spawnSync('git', ['init', '-q'], { cwd: repo, encoding: 'utf8' });
        assert.equal(git.status, 0, git.stderr);
        mkdirSync(join(repo, '.lore'), { recursive: true });
        mkdirSync(join(repo, 'shell', 'src'), { recursive: true });
        writeFileSync(join(repo, 'shell', 'src', 'example.js'), 'export const value = 1;\n');
        writeFileSync(
            join(repo, '.lore', '2026-08-05-example.md'),
            [
                '---',
                'paths: [shell/src/**]',
                'kind: gotcha',
                'by: Test',
                'commit: abc123',
                'verify_by: 2026-11-03',
                '---',
                'Keep this durable lesson available to every teammate.',
                '',
            ].join('\n')
        );

        const recalled = run(RECALL, ['session'], repo, { cwd: repo, session_id: 'test-session' });
        assert.equal(recalled.status, 0, recalled.stderr);
        const payload = JSON.parse(recalled.stdout);
        assert.match(payload.hookSpecificOutput.additionalContext, /TEAMLORE RECALL/);
        assert.match(payload.hookSpecificOutput.additionalContext, /\.lore\/2026-08-05-example\.md/);

        const sentinelDir = join(repo, '.claude', 'skills', 'teamlore');
        mkdirSync(sentinelDir, { recursive: true });
        writeFileSync(join(sentinelDir, '.needs-distill'), '');
        const nudged = run(DISTILL, [], repo, { cwd: repo, stop_hook_active: false });
        assert.equal(nudged.status, 0, nudged.stderr);
        assert.match(JSON.parse(nudged.stdout).hookSpecificOutput.additionalContext, /TEAMLORE:/);
    } finally {
        rmSync(repo, { recursive: true, force: true });
    }
});
