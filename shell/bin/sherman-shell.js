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
import { injectKeys } from '../src/keys.js';
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
        case 'advisory':
            return `  · engine note: ${event.message}`;
        default:
            // Forward-compatible: an event kind this build does not know about
            // must never take the harness down.
            return `  · (unrecognized event: ${event.kind})`;
    }
}

async function probe(prompts) {
    const config = loadConfig();
    // Same environment contract as the shell path: stored keys ride into the
    // probe's engine too, or --probe would debug a different machine than the
    // one the shell runs on.
    injectKeys();
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

    // The load-in shimmers the wordmark over the real startup below. Each label
    // is set immediately before the work it names, so what the screen says is
    // happening is what is happening; it is a no-op unless stdout is a TTY; and
    // it adds no delay of its own — `done()` fires the moment the shell is
    // ready, however early that is. Imported here rather than at module scope so
    // --version, --help and --probe keep paying nothing for it.
    // Name the terminal window. The desktop pet raises the window whose title
    // contains "Sherman Abrams", so this is what makes a click land on THIS
    // window rather than whichever window of the same terminal app was
    // frontmost (seen live: a Codex window in the same app took the click).
    // TTY-only so piped runs stay byte-identical, and reset on exit so the
    // title does not outlive the shell it names.
    if (process.stdout.isTTY) {
        process.stdout.write('\x1b]0;Sherman Abrams\x07');
        process.on('exit', () => {
            try { process.stdout.write('\x1b]0;\x07'); } catch { /* closing */ }
        });
    }

    const { startLoadIn } = await import('../src/ui/loadin.js');
    const loadIn = startLoadIn();

    let config;
    let session;
    let React;
    let render;
    let App;
    try {
        loadIn.step('reading config…');
        config = loadConfig();

        // The operator's stored keys (~/.sherman/keys.json) become engine
        // environment BEFORE the backend exists: both engines inherit
        // process.env at spawn, so this one call is what makes every stored
        // key available to every turn. Explicit exports outrank the store
        // (injectKeys never clobbers), and a corrupt store degrades to a
        // launch without keys rather than no launch — /key will name the fix.
        injectKeys();

        loadIn.step('preparing engine…');
        session = selectBackend(config);

        // Loading React and Ink is genuinely the slowest step here, and saying
        // so is more honest than covering it with a vaguer word.
        loadIn.step('loading interface…');
        [{ default: React }, { render }, { App }] = await Promise.all([
            import('react'),
            import('ink'),
            import('../src/ui/app.js'),
        ]);
    } finally {
        // Erased on the failure path too: a config error must print onto a clean
        // terminal with the cursor restored, not under a half-drawn wordmark.
        loadIn.done();
    }

    // exitOnCtrlC:false is what makes the two-stage interrupt possible: Ink would
    // otherwise quit on the first press, before the app could abort the turn.
    //
    // alternateScreen:true is the whole screen contract. On start Ink enters the
    // terminal's alternate buffer (1049h — cleared by definition, so the launch
    // screen paints from the top-left; the brief black flash IS the switch). On
    // exit Ink restores the primary buffer (1049l) and the cursor, and that
    // restore is registered with signal-exit, which fires on clean unmount,
    // double Ctrl+C, a thrown error, process.exit, SIGINT, SIGTERM and SIGHUP —
    // every exit path, not just the happy one — so the scrollback comes back
    // exactly as it was. A fault that reaches the catch in main() prints AFTER
    // the unmount has already restored the screen, so the message lands on the
    // primary buffer where it can be read. Ink emits the escapes only when
    // stdout is a real TTY, which keeps piped runs (smoke, CI) byte-identical.
    // --raw never reaches this file; the engines manage their own screens.
    //
    // incrementalRendering makes Ink rewrite only the lines that changed
    // between frames. Without it, every spinner tick erases and repaints the
    // whole fullscreen frame, which visibly flickers on terminals that ignore
    // synchronized output (stock Terminal.app).
    //
    // interactive is pinned to the stdout TTY check rather than left to Ink's
    // default, because the default also consults CI-marker env vars — and a
    // stray CI=1 in someone's profile would silently defer every frame to exit,
    // a blank screen on a perfectly good terminal. This function already
    // refuses to run without a TTY; a TTY session always renders live. Piped
    // fixtures still resolve non-interactive (isTTY is undefined there).
    const { waitUntilExit } = render(
        React.createElement(App, {
            session,
            sessionId: resolveSessionId(),

            // Every /subagent call gets a fresh engine thread with the exact
            // same config, persona workspace, vault scope, and safety posture.
            // An engine override (//subagent --engine, @name --engine) swaps
            // ONLY the backend: same workspace, same vault, same sandbox —
            // a model choice is a lens, never an authority upgrade.
            sessionFactory: (engineOverride) => selectBackend(
                engineOverride && engineOverride !== config.engine
                    ? { ...config, engine: engineOverride }
                    : config
            ),
        }),
        {
            exitOnCtrlC: false,
            alternateScreen: true,
            incrementalRendering: true,
            interactive: Boolean(process.stdout.isTTY),
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
