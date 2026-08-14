// `sherman loop [n]` — the self-direction loop's terminal entry.
//
// Same split as `sherman money`: bin/sherman owns the bash 3.2 dispatch and
// this file owns the logic. Subcommands:
//
//   (default) [n]  run n iterations (default 3, max 10). A fresh invocation
//                  clears a stale STOP file — starting the loop IS operator
//                  intent — then prints each pick and outcome as it lands.
//   stop           write the STOP file. A running loop halts at its next
//                  seam: between the pick and the execute, or between
//                  iterations. The file stays until the next fresh `loop`.
//
// The loop never merges, never spends, never sends: those gates live in the
// code paths it schedules, not here, and smoke check 40 pins this file's
// honesty about it.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config.js';
import { runLoop, stopPath } from './run.js';

/** `sherman loop stop`: request a halt at the next seam. */
export function requestStop(home = homedir()) {
    try {
        mkdirSync(dirname(stopPath(home)), { recursive: true });
        writeFileSync(stopPath(home), '');
        return { ok: true, text: 'STOP is set — a running loop halts at its next seam (between pick and execute, or between iterations).' };
    } catch (error) {
        return { ok: false, text: `could not write the STOP file: ${error?.message ?? error}` };
    }
}

/** A fresh invocation clears a forgotten STOP; returns whether one was cleared. */
export function clearStaleStop(home = homedir()) {
    if (!existsSync(stopPath(home))) return false;
    rmSync(stopPath(home), { force: true });
    return true;
}

async function main(argv) {
    const [verb] = argv;
    if (verb === 'stop') {
        const result = requestStop();
        process.stdout.write(`${result.text}\n`);
        process.exitCode = result.ok ? 0 : 1;
        return;
    }
    const iterations = verb === undefined ? undefined : Number(verb);
    if (verb !== undefined && (!Number.isInteger(iterations) || iterations < 1)) {
        process.stdout.write('Usage: sherman loop [n | stop]  (n = 1..10 iterations, default 3)\n');
        process.exitCode = 1;
        return;
    }

    const config = loadConfig();
    mkdirSync(join(config.vaultPath, 'direction'), { recursive: true });
    if (clearStaleStop()) {
        process.stdout.write('cleared a stale STOP file from a previous run\n');
    }

    const result = await runLoop({
        config,
        iterations,
        onProgress: (line) => process.stdout.write(`${line}\n`),
    });
    const ending = result.halted === 'stop'
        ? 'halted by STOP'
        : result.halted === 'failures'
            ? 'halted after two consecutive failures'
            : 'finished';
    process.stdout.write(`loop ${ending}: ${result.completed} iteration${result.completed === 1 ? '' : 's'} completed\n`);
    process.exitCode = result.halted === 'failures' ? 1 : 0;
}

// Run only when invoked as a program (bin/sherman does), never on import.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    await main(process.argv.slice(2));
}
