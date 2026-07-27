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
import { readVaultStats } from '../vault.js';
import { createSessionLog } from '../sessionlog.js';

// Monotonic ids. <Static> needs a stable key per item, and array index is not
// one — Ink would re-emit rows when the array grows.
let seq = 0;
const nextId = () => `i${seq++}`;

function formatTool(event, includeDuration) {
    const glyph = event.glyph || '›';
    const duration =
        includeDuration && typeof event.durationMs === 'number'
            ? `  ${(event.durationMs / 1000).toFixed(1)}s`
            : '';
    return `${glyph} ${event.label}${duration}`;
}

/**
 * @param {{session: import('../engine/session.js').EngineSession, sessionId: string}} props
 */
export function App({ session, sessionId }) {
    const { exit } = useApp();

    // One log per session, created once. useState, not useRef: the initialiser
    // contract ("runs once") is the same one the launch item already relies on.
    const [log] = useState(() => createSessionLog(sessionId));

    // The launch screen rides in as the first committed item so it stays above the
    // first message and only ever prints once (D12/D13 — one <Static> for
    // everything).
    //
    // Its info and vault counts are captured HERE, at mount, and travel on the
    // item itself. Two reasons: the initialiser runs once, so the vault readdir
    // is not repeated on every <Static> commit; and a committed transcript item
    // should show what was true when it was written, not mutate as the session
    // goes on.
    const [items, setItems] = useState(() => [
        {
            id: nextId(),
            kind: 'launch',
            info: session.info,
            sessionId,
            stats: readVaultStats({
                vaultPath: session.info.vaultPath,
                user: session.info.user,
            }),
        },
    ]);
    const [busy, setBusy] = useState(false);
    const [activity, setActivity] = useState(null);
    const [usage, setUsage] = useState(() => session.usage ?? emptyUsage());
    const [info, setInfo] = useState(() => session.info);

    // Real clocks for the status bar: when this session started, and how long
    // the last turn took. The live in-turn timer is useAnimation's, down in
    // StatusBar itself — only the durable numbers live here.
    const [sessionStart] = useState(() => Date.now());
    const [lastTurnMs, setLastTurnMs] = useState(null);
    const turnStartRef = useRef(0);

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
            log.append('user', text);
            // Set busy BEFORE awaiting anything, so the indicator mounts on the
            // next render rather than waiting for the engine's first event. The
            // dead time at the start of a turn is exactly what it exists to cover.
            setBusyBoth(true);
            setActivity(null);
            turnStartRef.current = Date.now();

            try {
                for await (const event of session.send(text)) {
                    switch (event.kind) {
                        case 'turn-start':
                            break;

                        case 'message':
                            commit('message', event.text);
                            log.append('sherman', event.text);
                            break;

                        // Reasoning summaries commit immediately and also become
                        // the live tail. Tool starts stay dynamic; only their
                        // measured completion commits below.
                        case 'reasoning':
                            commit('reasoning', event.text);
                            setActivity(event.text);
                            break;

                        case 'tool':
                            if (event.phase === 'started') {
                                setActivity(formatTool(event, false));
                            } else {
                                const line = formatTool(event, true);
                                commit('tool', line);
                                setActivity(line);
                            }
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
                // In `finally`, not on turn-end: an interrupted or failed turn
                // still ran for a true amount of time, and that is the honest
                // value for "last".
                setLastTurnMs(Date.now() - turnStartRef.current);
            }
        },
        [commit, session, setBusyBoth, log]
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

    // Hermes stacking, top-anchored: transcript (launch panel + welcome),
    // activity, then the status region, then the prompt LAST — directly under
    // the status bar, never pinned to the bottom of the screen with a gap.
    return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(Transcript, { items }),
        React.createElement(Thinking, { active: busy, activity }),
        React.createElement(
            Box,
            { flexDirection: 'column' },
            React.createElement(CompactHeader),
            React.createElement(StatusBar, { info, usage, busy, sessionStart, lastTurnMs })
        ),
        React.createElement(Composer, { onSubmit: submit, busy })
    );
}
