// The root component. All turn state lives here; every other component in ui/
// is presentational and takes props.
//
// It renders the 04-01 event union and nothing else. If something here seems to
// need a change inside src/engine/, that is the signal the change belongs behind
// EngineSession — not a licence to reach into codex.js.

import React, { useCallback, useRef, useState } from 'react';
import { Box, useApp, useInput } from 'ink';

import { Transcript } from './Transcript.js';
import { CompactHeader } from './Header.js';
import { StatusBar } from './StatusBar.js';
import { Composer } from './Composer.js';
import { Thinking } from './Thinking.js';
import { emptyUsage } from '../engine/session.js';

// Monotonic ids. <Static> needs a stable key per item, and array index is not
// one — Ink would re-emit rows when the array grows.
let seq = 0;
const nextId = () => `i${seq++}`;

/**
 * @param {{session: import('../engine/session.js').EngineSession}} props
 */
export function App({ session }) {
    const { exit } = useApp();

    // The banner rides in as the first committed item so it stays above the first
    // message and only ever prints once (D12/D13 — one <Static> for everything).
    const [items, setItems] = useState(() => [{ id: nextId(), kind: 'banner' }]);
    const [busy, setBusy] = useState(false);
    const [activity, setActivity] = useState(null);
    const [usage, setUsage] = useState(() => session.usage ?? emptyUsage());
    const [info, setInfo] = useState(() => session.info);

    // Mirrors `busy` for the Ctrl+C handler. React state is async, so two fast
    // presses would both observe the stale value and neither would exit.
    const busyRef = useRef(false);

    const commit = useCallback((kind, text) => {
        setItems((prev) => [...prev, { id: nextId(), kind, text }]);
    }, []);

    const setBusyBoth = useCallback((value) => {
        busyRef.current = value;
        setBusy(value);
    }, []);

    const submit = useCallback(
        async (text) => {
            commit('user', text);
            // Set busy BEFORE awaiting anything, so the indicator mounts on the
            // next render rather than waiting for the engine's first event. The
            // dead time at the start of a turn is exactly what it exists to cover.
            setBusyBoth(true);
            setActivity(null);

            try {
                for await (const event of session.send(text)) {
                    switch (event.kind) {
                        case 'turn-start':
                            break;

                        case 'message':
                            commit('message', event.text);
                            break;

                        // Committed dim so the transcript shows the work that
                        // happened, and mirrored into the indicator so the wait
                        // narrates itself.
                        case 'reasoning':
                            commit('reasoning', event.text);
                            setActivity(event.text);
                            break;

                        case 'tool':
                            commit('tool', event.label);
                            setActivity(event.label);
                            break;

                        case 'turn-end':
                            setUsage(session.usage);
                            setInfo(session.info);
                            break;

                        case 'interrupted':
                            commit('notice', 'interrupted');
                            break;

                        case 'error':
                            commit('error', event.message);
                            break;

                        default:
                            // Unknown kinds are ignored, matching the backend's own
                            // tolerance. A future codex event must not crash the UI.
                            break;
                    }
                }
            } catch (err) {
                commit('error', err?.message ?? String(err));
            } finally {
                setBusyBoth(false);
                setActivity(null);
                setInfo(session.info);
            }
        },
        [commit, session, setBusyBoth]
    );

    // Two-stage Ctrl+C, proven in a pty at plan time. Ink is started with
    // exitOnCtrlC:false so this handler is what decides.
    //
    // `busy` is the whole state machine: interrupting clears it, so the next
    // press falls through to exit — and starting a new turn re-arms it, so a
    // later Ctrl+C interrupts again instead of quitting.
    useInput((input, key) => {
        if (!(key.ctrl && input === 'c')) return;

        if (busyRef.current) {
            session.interrupt();
            return;
        }
        session.dispose();
        exit();
    });

    return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(Transcript, { items }),
        React.createElement(Thinking, { active: busy, activity }),
        React.createElement(Composer, { onSubmit: submit, busy }),
        React.createElement(
            Box,
            { marginTop: 1, flexDirection: 'column' },
            React.createElement(CompactHeader),
            React.createElement(StatusBar, { info, usage })
        )
    );
}
