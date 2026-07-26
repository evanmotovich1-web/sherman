#!/usr/bin/env node
//
// sherman-shell — Sherman Abrams' own terminal UI.
//
// In this phase the entry point is a plain-text harness only: --version, --help
// and --probe. Phase 04-02 replaces the default no-flag path with the Ink app.
// Keeping the harness around after that is deliberate -- when the UI misbehaves,
// --probe is how you find out whether the engine layer or the renderer is at
// fault, without a UI in the way.

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config.js';
import { selectBackend } from '../src/engine/index.js';
import { emptyUsage } from '../src/engine/session.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// The launcher mints the session id and passes it down, so the id on the launch
// panel, in the adapter's attribution rule, and on the session log are all the
// SAME id. The fallback mint (same format) is for running this entry point
// directly, where there is no launcher and nothing upstream to agree with.
const SESSION_ID_PATTERN = /^[0-9]{8}_[0-9]{6}_[0-9a-f]{6}$/;

function resolveSessionId() {
    const fromEnv = process.env.SHERMAN_SESSION_ID;
    if (typeof fromEnv === 'string' && SESSION_ID_PATTERN.test(fromEnv)) {
        return fromEnv;
    }

    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const stamp =
        `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
        `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    return `${stamp}_${randomBytes(3).toString('hex')}`;
}

function version() {
    const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));
    return pkg.version;
}

const HELP = `sherman-shell — Sherman Abrams' own terminal UI

Usage:
  sherman-shell                     start the shell
  sherman-shell --probe "<text>"    send one turn headlessly and print events
  sherman-shell --probe "<a>" "<b>" send several turns in one session
  sherman-shell --version
  sherman-shell --help

In the shell, Ctrl+C interrupts the turn in flight; press it again to exit.

--probe is the engine-layer harness: no UI, normalized events printed as they
arrive. Use it to tell an engine problem from a rendering problem.`;

/** Render one normalized event as a single readable line. */
function renderEvent(event) {
    switch (event.kind) {
        case 'turn-start':
            return '  · turn started';
        case 'reasoning':
            return `  · thinking: ${event.text}`;
        case 'tool':
            return `  · ${event.label}`;
        case 'message':
            return `\n${event.text}\n`;
        case 'turn-end': {
            const u = event.usage;
            return `  · turn complete — ${u.total} tokens ` +
                `(in ${u.input}, cached ${u.cachedInput}, out ${u.output}, reasoning ${u.reasoning})`;
        }
        case 'interrupted':
            return '  · interrupted';
        case 'error':
            return `\n! ${event.message}\n`;
        default:
            // Forward-compatible: an event kind this build does not know about
            // must never take the harness down.
            return `  · (unrecognized event: ${event.kind})`;
    }
}

async function probe(prompts) {
    const config = loadConfig();
    const session = selectBackend(config);
    const info = session.info;

    console.log(`engine ${info.engine} · model ${info.model} · user ${info.user}`);
    console.log(`vault  ${info.vaultPath}`);

    // Ctrl+C aborts the in-flight turn rather than the process, matching the
    // shell's interrupt contract so the harness exercises the real code path.
    let interrupts = 0;
    process.on('SIGINT', () => {
        interrupts += 1;
        if (interrupts === 1) {
            console.log('\n  · interrupting turn (Ctrl+C again to exit)');
            session.interrupt();
        } else {
            console.log('\n  · exiting');
            session.dispose();
            process.exit(130);
        }
    });

    let sawError = false;

    for (const prompt of prompts) {
        console.log(`\n> ${prompt}`);
        for await (const event of session.send(prompt)) {
            if (event.kind === 'error') sawError = true;
            console.log(renderEvent(event));
        }
    }

    const u = session.usage ?? emptyUsage();
    console.log(
        `\nsession total: ${u.total} tokens ` +
        `(in ${u.input}, cached ${u.cachedInput}, out ${u.output}, reasoning ${u.reasoning})`
    );
    if (session.info.threadId) console.log(`thread: ${session.info.threadId}`);

    session.dispose();
    return sawError ? 1 : 0;
}

async function main(argv) {
    if (argv.includes('--version') || argv.includes('-v')) {
        console.log(version());
        return 0;
    }
    if (argv.includes('--help') || argv.includes('-h')) {
        console.log(HELP);
        return 0;
    }

    const probeAt = argv.indexOf('--probe');
    if (probeAt !== -1) {
        const prompts = argv.slice(probeAt + 1).filter((a) => !a.startsWith('--'));
        if (prompts.length === 0) {
            console.error('--probe needs at least one prompt.');
            return 2;
        }
        return probe(prompts);
    }

    return startShell();
}

/**
 * Launch the Ink UI.
 *
 * Imported lazily so --version, --help and --probe never pay for loading React
 * and Ink, and so a broken UI dependency cannot take down the diagnostic that
 * exists to debug it.
 */
async function startShell() {
    // Ink throws "Raw mode is not supported on the current process.stdin" when
    // stdin is not a TTY. Guarding here turns that stack trace into a sentence,
    // and it is also what stops a piped run (smoke, CI, `echo x | sherman`) from
    // hanging on a UI that can never accept input.
    if (!process.stdin.isTTY) {
        console.error('The Sherman Shell needs an interactive terminal.');
        console.error('Piping input? Use --probe "<text>" instead, or sherman --raw.');
        return 2;
    }

    const config = loadConfig();
    const session = selectBackend(config);

    const [{ default: React }, { render }, { App }] = await Promise.all([
        import('react'),
        import('ink'),
        import('../src/ui/app.js'),
    ]);

    // exitOnCtrlC:false is what makes the two-stage interrupt possible: Ink would
    // otherwise quit on the first press, before the app could abort the turn.
    const { waitUntilExit } = render(
        React.createElement(App, { session, sessionId: resolveSessionId() }),
        {
            exitOnCtrlC: false,
        }
    );

    await waitUntilExit();
    session.dispose();
    return 0;
}

main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
        // A thrown error here is a real fault (bad config, unknown engine), not
        // a model refusal. Print the message, not a stack trace -- the messages
        // are written to tell a person what to do about it.
        console.error(`\n${err.message}\n`);
        process.exit(1);
    });
