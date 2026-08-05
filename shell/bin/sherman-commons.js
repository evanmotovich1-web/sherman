#!/usr/bin/env node

import {
    existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCommonsCommand } from '../src/commons/command.js';
import { reconcileCommonsMcpRegistration } from '../src/commons/mcp-registration.js';
import { parseFrontMatter } from '../src/registry.js';

function commandText(argv) {
    if (argv[0] === 'sync') return ['inventory', 'sync', ...argv.slice(1)].join(' ');
    if (argv[0] === 'revoke-this-device') return ['revoke', ...argv.slice(1)].join(' ');
    return argv.join(' ');
}

function inspectSkill(directory, expectedName) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(expectedName)) return { ok: false, reason: 'invalid name' };
    let root;
    try { root = lstatSync(directory); } catch { return { ok: false, reason: 'unreadable' }; }
    if (root.isSymbolicLink() || !root.isDirectory()) return { ok: false, reason: 'not a regular directory' };
    const files = [];
    function walk(current, relative = '') {
        const currentStat = lstatSync(current);
        if (currentStat.isSymbolicLink() || !currentStat.isDirectory()) throw new Error('symbolic link or special directory');
        for (const entry of readdirSync(current).sort()) {
            const absolute = join(current, entry);
            const nextRelative = relative ? join(relative, entry) : entry;
            const metadata = lstatSync(absolute);
            if (metadata.isSymbolicLink()) throw new Error('symbolic link');
            if (metadata.isDirectory()) walk(absolute, nextRelative);
            else if (metadata.isFile()) files.push({ absolute, relative: nextRelative });
            else throw new Error('special file');
        }
    }
    try { walk(directory); } catch { return { ok: false, reason: 'contains a link or special file' }; }
    const manifest = files.find((file) => file.relative === 'SKILL.md');
    if (!manifest) return { ok: false, reason: 'missing SKILL.md' };
    let fields;
    try { fields = parseFrontMatter(readFileSync(manifest.absolute, 'utf8')); } catch { return { ok: false, reason: 'unreadable SKILL.md' }; }
    if (!fields || fields.name !== expectedName || !fields.category || !fields.description) {
        return { ok: false, reason: 'malformed or mismatched SKILL.md' };
    }
    return { ok: true, files };
}

function copyInspectedSkill(skill, destination) {
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    for (const file of skill.files) {
        const output = join(destination, file.relative);
        mkdirSync(join(output, '..'), { recursive: true, mode: 0o700 });
        writeFileSync(output, readFileSync(file.absolute), { mode: 0o600 });
    }
}

function sourceEntries(root) {
    if (!existsSync(root)) return { ok: true, entries: [] };
    const metadata = lstatSync(root);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) return { ok: false, entries: [] };
    return { ok: true, entries: readdirSync(root).sort() };
}

/** Copy inert skill files into one generated engine skill directory. */
export function assembleSkills({ bundledRoot, personalRoot, targetRoot }) {
    if (existsSync(targetRoot)) throw new Error('Assembly target already exists.');
    mkdirSync(targetRoot, { recursive: true, mode: 0o700 });
    const accepted = new Set();
    let bundledCopied = 0;
    let personalCopied = 0;
    const rejected = [];

    const bundled = sourceEntries(bundledRoot);
    if (!bundled.ok) throw new Error('Bundled skills root is not a regular directory.');
    for (const name of bundled.entries) {
        const source = join(bundledRoot, name);
        const inspected = inspectSkill(source, name);
        if (!inspected.ok) continue;
        copyInspectedSkill(inspected, join(targetRoot, name));
        accepted.add(name);
        bundledCopied += 1;
    }

    const personal = sourceEntries(personalRoot);
    if (!personal.ok) {
        rejected.push({ name: basename(personalRoot), reason: 'personal skills root is a symbolic link or non-directory' });
    } else {
        for (const name of personal.entries) {
            if (accepted.has(name)) {
                rejected.push({ name, reason: 'bundled skill wins collision' });
                continue;
            }
            const inspected = inspectSkill(join(personalRoot, name), name);
            if (!inspected.ok) {
                rejected.push({ name, reason: inspected.reason });
                continue;
            }
            copyInspectedSkill(inspected, join(targetRoot, name));
            accepted.add(name);
            personalCopied += 1;
        }
    }
    return { bundledCopied, personalCopied, rejected };
}

export async function main(
    argv = process.argv.slice(2),
    io = console,
    { registration = reconcileCommonsMcpRegistration } = {},
) {
    try {
        if (argv[0] === '--reconcile-mcp') {
            const engine = argv[1];
            const workspace = argv[2];
            if (argv.length !== 3 || !['claude', 'codex'].includes(engine) || !isAbsolute(workspace)) {
                io.error('NOTE: Commons MCP registration was skipped because the local launch request was invalid.');
                return 0;
            }
            let outcome;
            try {
                const binDirectory = dirname(fileURLToPath(import.meta.url));
                outcome = await registration({
                    engine,
                    home: process.env.HOME,
                    workspace,
                    executablePath: process.execPath,
                    mcpPath: join(binDirectory, 'sherman-commons-mcp.js'),
                });
            } catch {
                io.error('NOTE: Commons MCP registration could not be checked safely; launch will continue without it.');
                return 0;
            }
            if (!outcome.active && outcome.reason !== 'unenrolled') {
                io.error(`NOTE: Commons MCP was disabled because active enrollment could not be confirmed (${outcome.reason}).`);
            }
            return 0;
        }
        if (argv[0] === '--assemble-skills') {
            const token = argv[1];
            if (argv.length !== 5 || typeof token !== 'string' || token.length !== 64
                || !/^[0-9a-f]+$/.test(token) || process.env.SHERMAN_SKILL_ASSEMBLY_TOKEN !== token) {
                throw new Error('invalid assembly capability');
            }
            delete process.env.SHERMAN_SKILL_ASSEMBLY_TOKEN;
            const outcome = assembleSkills({ bundledRoot: argv[2], personalRoot: argv[3], targetRoot: argv[4] });
            for (const item of outcome.rejected) io.error(`NOTE: personal skill ${item.name} rejected (${item.reason}).`);
            return 0;
        }
        const outcome = await runCommonsCommand(commandText(argv));
        (outcome.ok ? io.log : io.error)(outcome.text);
        return outcome.ok ? 0 : 1;
    } catch {
        io.error('The Commons operation could not be completed safely.');
        return 1;
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    process.exitCode = await main();
}
