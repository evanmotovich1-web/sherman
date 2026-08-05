import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const readRepo = (path) => readFileSync(resolve(root, path), 'utf8');

function frontmatter(markdown) {
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(match, 'skill must start with frontmatter');
    return Object.fromEntries(match[1].split('\n').map((line) => {
        const separator = line.indexOf(':');
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }));
}

test('commons skill defines the closed participation and generation contract', () => {
    const policy = readRepo('skills/commons/SKILL.md');
    const metadata = frontmatter(policy);

    assert.equal(metadata.name, 'commons');
    assert.equal(metadata.category, 'agent');
    assert.ok(metadata.summary);
    assert.ok(metadata.description);

    for (const kind of [
        'complaint', 'observation', 'idea', 'question', 'fix_proposal',
        'skill_manifest', 'connector_manifest',
    ]) {
        assert.match(policy, new RegExp(`\\b${kind}\\b`));
    }
    assert.match(policy, /closed[- ]world/i);
    assert.match(policy, /reject.*(other|unknown).*kind/i);

    for (const prohibited of [
        /raw chats?/i, /reasoning/i, /private files?/i, /secrets?/i,
        /credentials?/i, /PHI/i, /arbitrary tool output/i,
    ]) {
        assert.match(policy, prohibited);
    }
    assert.match(policy, /DO NOT POST/);

    assert.match(policy, /Sherman for <owner>/);
    assert.match(policy, /owner_requested/);
    assert.match(policy, /agent_observed/);
    assert.match(policy, /never.*speak as (?:the )?owner/i);

    assert.match(policy, /independent local evidence/i);
    assert.match(policy, /source/i);
    assert.match(policy, /reproduc/i);
    assert.match(policy, /agreement.*never.*popularity/is);
    assert.match(policy, /ask.*before.*external publication/is);
    assert.match(policy, /explicitly pre-enabled category/i);
    assert.match(policy, /read virality/i);
    assert.match(policy, /never auto-install/i);
    assert.match(policy, /safe.*installed.*verified/i);
    assert.match(policy, /local evidence/i);

    for (const stage of ['metadata', 'quarantine', 'digest', 'signature', 'scan', 'diff', 'explicit approval']) {
        assert.match(policy, new RegExp(stage, 'i'));
    }
    assert.match(policy, /trusted publisher record/i);
    assert.match(policy, /revoked publisher/i);
});

test('shared persona and skill index expose the Commons boundary without weakening no-PHI', () => {
    const system = readRepo('agent/SYSTEM.md');
    const skillsReadme = readRepo('skills/README.md');

    assert.match(system, /Commons/);
    assert.match(system, /ask.*external publication/is);
    assert.match(system, /Never send PHI/i);
    assert.match(system, /commons.*skill/is);
    assert.match(skillsReadme, /`commons`\s*\|\s*agent/i);
    assert.match(skillsReadme, /closed[- ]world/i);
    assert.match(skillsReadme, /explicit approval/i);
});
