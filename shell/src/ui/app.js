// The root component. All turn state lives here; every other component in ui/
// is presentational and takes props.
//
// It renders the 04-01 event union and nothing else. If something here seems to
// need a change inside src/engine/, that is the signal the change belongs behind
// EngineSession — not a licence to reach into codex.js.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdin, useStdout, useWindowSize } from 'ink';

import { Transcript } from './Transcript.js';
import { historyLabel, scrollBy } from './scrollback.js';
import { enableMouse, parseMouse } from './mouse.js';
import { color } from './theme.js';
import { StatusBar } from './StatusBar.js';
import { Composer } from './Composer.js';
import { Thinking, activityBudget } from './Thinking.js';
import { ActivityLine } from './ActivityLine.js';
import { copyNotice, copyText, lastReplyText } from '../clipboard.js';
import { addUsage, emptyUsage } from '../engine/session.js';
import { readVaultStats } from '../vault.js';
import { createSessionLog } from '../sessionlog.js';
import {
    carryOverEnvelope,
    commandFor,
    compactRequest,
    goalEnvelope,
    helpText,
    parseSubmission,
    planRequest,
    shouldAutoCompact,
    workerRequest,
} from '../commands.js';

// Monotonic ids. React list keys must be stable per item, and array index is
// not one — items keep their identity while the array in front of them grows.
let seq = 0;
const nextId = () => `i${seq++}`;

// Rows a single wheel notch moves the transcript. Three is the conventional
// terminal notch; it is fed through the same clamped scroll the keys use, so it
// cannot travel past the oldest row either.
const WHEEL_ROWS = 3;

/**
 * How long a finished task stays on screen before it goes.
 *
 * Completed tool lines are no longer committed to the transcript, so this is
 * the ONLY window in which a finished task is visible. Long enough to register
 * that the thing landed and read its duration; short enough that a burst of
 * quick tasks does not queue up into a standing list. A turn ending sooner than
 * this still clears everything -- the turn being over outranks the linger.
 */
export const ACTIVITY_LINGER_MS = 1000;

/** Outcome marks, shared so a row's glyph and its text cannot disagree. */
const OUTCOME_MARK = {
    succeeded: '✓',
    failed: '×',
    declined: '–',
    unknown: '?',
};

/** The mark for a completed tool, matching what formatTool renders. */
function completionMark(event) {
    return OUTCOME_MARK[event.outcome] ?? event.glyph ?? '›';
}

function formatTool(event, includeDuration) {
    const outcomeGlyph = OUTCOME_MARK;
    const glyph = includeDuration ? outcomeGlyph[event.outcome] ?? event.glyph ?? '›' : event.glyph || '›';
    const duration =
        includeDuration && typeof event.durationMs === 'number'
            ? `  ${(event.durationMs / 1000).toFixed(1)}s`
            : '';
    return `${glyph} ${event.label}${duration}`;
}

/**
 * @param {{session: import('../engine/session.js').EngineSession, sessionId: string, sessionFactory?: (() => import('../engine/session.js').EngineSession), rows?: number}} props
 */
/**
 * `clipboard` is injectable for one concrete reason: the real implementation
 * shells out to pbcopy, and a test suite that exercised /copy would overwrite
 * the operator's actual clipboard every time it ran. A test must not reach out
 * of the process and take something of the user's away.
 */
export function App({
    session,
    sessionId,
    sessionFactory = null,
    rows: rowsOverride,
    clipboard = copyText,
}) {
    const { exit } = useApp();

    // The alternate screen has no scrollback, so the app owns the whole
    // viewport: the root Box is exactly the terminal's height every frame.
    // That keeps every Ink frame fullscreen (stable incremental redraws, no
    // accidental scrolling of the alt buffer) and gives the transcript a hard
    // edge to shrink against. The hook re-renders on resize.
    const measured = useWindowSize();
    const columns = measured.columns;
    const rows = typeof rowsOverride === 'number' ? rowsOverride : measured.rows;

    // One log per session, created once. useState, not useRef: the initialiser
    // contract ("runs once") is the same one the launch item already relies on.
    const [log] = useState(() => createSessionLog(sessionId));

    // The launch screen rides in as the first transcript item so it stays above
    // the first message and scrolls out of the viewport like anything else
    // (D12/D13 — one history, the opener included).
    //
    // Its info and vault counts are captured HERE, at mount, and travel on the
    // item itself. Two reasons: the initialiser runs once, so the vault readdir
    // is not repeated on every render; and a committed transcript item should
    // show what was true when it was written, not mutate as the session goes on.
    const [vaultStats] = useState(() => readVaultStats({
        vaultPath: session.info.vaultPath,
        user: session.info.user,
    }));
    const [items, setItems] = useState(() => [
        {
            id: nextId(),
            kind: 'launch',
            info: session.info,
            sessionId,
            stats: vaultStats,
        },
    ]);
    // The transcript, mirrored into a ref. /copy and ctrl+y both need the
    // newest reply at the moment the key is pressed, and both run from stable
    // callbacks that would otherwise close over whatever `items` was when they
    // were built -- copying the second-to-last reply, or nothing at all on the
    // first one. The ref is the live array; `items` stays the render source.
    const itemsRef = useRef(items);
    useEffect(() => { itemsRef.current = items; }, [items]);

    const [busy, setBusy] = useState(false);
    const [activities, setActivities] = useState([]);
    const [lifecycle, setLifecycle] = useState(null);
    const [goal, setGoal] = useState('');

    // ------------------------------------------------------------ scrollback --
    // How many rows above the live tail the transcript is parked. 0 follows the
    // tail, which is the state every off-TTY render is in and the state any
    // submit returns to.
    //
    // `window` is what the transcript MEASURED — its own height and its
    // content's — reported back up after layout. The offset is the shell's
    // intent; the window is the fact, and the indicator prints the fact. They
    // can disagree for exactly one frame after a resize, which is why the
    // handler clamps against the window rather than against a remembered total.
    const [scrollOffset, setScrollOffset] = useState(0);
    const [scrollState, setScrollState] = useState({
        total: 0, viewport: 0, below: 0, following: true,
    });
    const windowRef = useRef(scrollState);
    const offsetRef = useRef(0);
    const onWindow = useCallback((next) => {
        // Content appended while parked would otherwise slide the window down
        // by however many rows arrived, because the offset is measured from the
        // tail and the tail just moved. Growing the offset by the same amount
        // is what keeps the rows under the operator's eyes still — a turn
        // finishing behind you must not yank you forward through history.
        const grew = next.total - windowRef.current.total;
        if (grew > 0 && offsetRef.current > 0) {
            setScrollOffset((current) =>
                scrollBy(current, grew, next.total, next.viewport)
            );
        }

        windowRef.current = next;
        setScrollState((current) =>
            current.total === next.total
            && current.viewport === next.viewport
            && current.below === next.below
            && current.following === next.following
                ? current
                : next
        );
    }, []);

    const scroll = useCallback((delta) => {
        const { total, viewport } = windowRef.current;
        setScrollOffset((current) => scrollBy(current, delta, total, viewport));
    }, []);

    // The offset the append-compensation above reads. State is async, and that
    // callback fires from a layout effect, so a ref is the only value guaranteed
    // to describe the frame that was just measured.
    offsetRef.current = scrollOffset;

    // ----------------------------------------------------------------- mouse --
    // Reporting is enabled for as long as the shell is mounted and disabled on
    // every exit path (see mouse.js). Off a TTY this is a no-op returning a
    // no-op, so piped runs never see a mode change or a mouse byte.
    //
    // The reports are read straight off stdin rather than through `useInput`:
    // Ink's key parser has no notion of a mouse packet, and a chunk that
    // arrives mid-sequence would be delivered as text. Reading the raw chunk
    // means the parser sees whole packets. Keystrokes are untouched — this
    // listener acts only on what parses as a mouse report and ignores the rest,
    // so a terminal that never sends one behaves exactly as it always did.
    const { stdout } = useStdout();
    const { stdin, isRawModeSupported } = useStdin();
    const [click, setClick] = useState(null);
    const clickSeq = useRef(0);

    useEffect(() => enableMouse(stdout), [stdout]);

    useEffect(() => {
        if (!stdin || !isRawModeSupported) return undefined;
        const onData = (chunk) => {
            const events = parseMouse(String(chunk));
            if (events.length === 0) return;
            for (const event of events) {
                if (event.type === 'wheel') {
                    // One notch, one row of overlap short of a page: the wheel
                    // feeds the same clamped scroll the keys do, so it can no
                    // more run past the oldest row than PgUp can.
                    scroll(event.direction === 'up' ? WHEEL_ROWS : -WHEEL_ROWS);
                } else if (event.type === 'press' && event.button === 0) {
                    clickSeq.current += 1;
                    setClick({ column: event.column, row: event.row, seq: clickSeq.current });
                }
            }
        };
        stdin.on('data', onData);
        return () => { stdin.off('data', onData); };
    }, [stdin, isRawModeSupported, scroll]);

    const [usage, setUsage] = useState(() => session.usage ?? emptyUsage());
    // Latest per-turn input, not the running total. Codex reports this on
    // turn.completed and, for resumed threads, it is the current context size.
    const [contextUsed, setContextUsed] = useState(null);
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
    const activeSessionRef = useRef(session);
    const workerUsageRef = useRef(emptyUsage());

    // What survived the last compaction, waiting for a turn to ride along with.
    // It is spent on the first request after the reset and then forgotten --
    // once the new thread has heard the handoff, resending it would be paying
    // for the same context twice.
    const [carryOver, setCarryOver] = useState('');
    // Re-entrancy guard. Auto-compaction is triggered by the end of a turn, and
    // compaction is itself a turn; without this a slow-summarizing session
    // could stack a second compaction on top of the first.
    const compactingRef = useRef(false);

    // Completed activities linger briefly before they disappear. The timers are
    // tracked so turn end and unmount can cancel them -- an orphaned timer would
    // fire setActivities on a dead tree, or resurrect a row into the next turn.
    const lingerTimersRef = useRef(new Map());
    const clearLingerTimers = useCallback(() => {
        for (const timer of lingerTimersRef.current.values()) clearTimeout(timer);
        lingerTimersRef.current.clear();
    }, []);
    useEffect(() => clearLingerTimers, [clearLingerTimers]);

    // `extra` carries structured payloads for kinds whose content is not a
    // string -- currently only 'diff', whose event is stored whole so the
    // renderer reads the engine's own fields instead of a re-serialized copy.
    const commit = useCallback((kind, text, extra = null) => {
        setItems((prev) => [...prev, { id: nextId(), kind, text, ...(extra ?? {}) }]);
    }, []);

    // Copying the last reply, from the source text rather than the screen.
    //
    // Reachable two ways -- /copy and ctrl+y -- and both land here so there is
    // exactly one place where the wording is decided. `copyNotice` owns that
    // decision: this function must not compose a success message of its own,
    // because the whole point is that the shell never claims a copy it cannot
    // evidence. An OSC 52 write is unacknowledged by design, and a notice that
    // read "copied" after one would be a lie the terminal cannot contradict.
    const copyLastReply = useCallback(() => {
        const text = lastReplyText(itemsRef.current);
        if (!text) {
            commit('notice', 'Nothing to copy yet — Sherman has not replied in this session.');
            return;
        }
        const result = clipboard(text, { stdout });
        commit(result.ok ? 'notice' : 'error', copyNotice(result, text.split('\n').length));
    }, [clipboard, commit, stdout]);

    const setBusyBoth = useCallback((value) => {
        busyRef.current = value;
        setBusy(value);
    }, []);

    /**
     * Summarize the session, then reset the engine thread.
     *
     * Deliberately NOT routed through `submit`: this is not a user turn. It
     * commits no user row, it must not be re-entered by the auto-trigger, and
     * its summary is the payload for the next request rather than an answer to
     * this one. Sharing submit's body to save a dozen lines would mean teaching
     * submit four exceptions to what a turn is.
     */
    const compactSession = useCallback(
        async (focus = '') => {
            if (compactingRef.current) return;
            compactingRef.current = true;

            setBusyBoth(true);
            clearLingerTimers();
            setActivities([]);
            setLifecycle(null);
            activeSessionRef.current = session;
            turnStartRef.current = Date.now();

            let summary = '';
            let failed = false;
            try {
                for await (const event of session.send(compactRequest(focus, goal))) {
                    if (event.kind === 'message') {
                        summary = summary ? `${summary}\n\n${event.text}` : event.text;
                    } else if (event.kind === 'status') {
                        setLifecycle(event.text);
                    } else if (event.kind === 'error') {
                        commit('error', event.message);
                        failed = true;
                    } else if (event.kind === 'interrupted') {
                        commit('notice', 'compaction interrupted');
                        failed = true;
                    }
                }
            } catch (err) {
                commit('error', err?.message ?? String(err));
                failed = true;
            } finally {
                setBusyBoth(false);
                clearLingerTimers();
                setActivities([]);
                setLifecycle(null);
                setLastTurnMs(Date.now() - turnStartRef.current);
                compactingRef.current = false;
            }

            // An empty or failed summary leaves the thread ALONE. Resetting
            // context we failed to preserve would turn a bad turn into lost work.
            if (failed || !summary.trim()) {
                if (!failed) commit('error', 'Compaction produced no summary.');
                commit('notice', 'not compacted · the engine thread was left intact');
                return;
            }

            commit('message', summary);
            log.append('sherman', summary);

            const fresh = session.startNewThread?.() === true;
            if (fresh) {
                setCarryOver(summary);
                // Nothing has been sent on the new thread yet, so there is no
                // honest number to print. The meter comes back with the next
                // turn's real reported input rather than a projection of it.
                setContextUsed(null);
                setInfo(session.info);
                commit('notice', 'compacted · new engine thread · the summary above is what carried over');
            } else {
                commit('notice', 'summarized · this engine cannot start a new thread, so context was not reduced');
            }
        },
        [clearLingerTimers, commit, goal, log, session, setBusyBoth]
    );

    const submit = useCallback(
        async (text) => {
            const parsed = parseSubmission(text);
            // Submitting is a statement that you are done reading history: the
            // answer is going to arrive at the tail, so snap there rather than
            // leaving the operator parked above their own new turn.
            setScrollOffset(0);
            offsetRef.current = 0;
            commit('user', text);
            log.append('user', text);

            if (parsed.kind === 'command') {
                const command = commandFor(parsed.name);
                if (!command) {
                    commit('error', `Unknown command /${parsed.name || '?'}. Type /help to list commands.`);
                    return;
                }
                if (command.name === 'help') {
                    commit('notice', helpText(parsed.args));
                    return;
                }
                if (command.name === 'copy') {
                    copyLastReply();
                    return;
                }
                if (command.name === 'goal') {
                    if (parsed.args === 'clear' || parsed.args === '--clear') {
                        setGoal('');
                        commit('notice', 'Session goal cleared.');
                    } else if (parsed.args === '' || parsed.args === 'status') {
                        commit('notice', goal ? `Session goal: ${goal}` : 'No session goal is set.');
                    } else {
                        setGoal(parsed.args);
                        commit('notice', `Session goal set: ${parsed.args}`);
                    }
                    return;
                }
                if (command.name === 'compact') {
                    commit('notice', 'compacting · summarizing this session');
                    await compactSession(parsed.args);
                    return;
                }
            }

            let engine = session;
            let request = parsed.kind === 'prompt' ? goalEnvelope(parsed.text, goal) : null;
            let messageKind = 'message';
            let isWorker = false;

            if (parsed.kind === 'command' && parsed.name === 'plan') {
                request = planRequest(parsed.args, goal);
                if (!request) {
                    commit('error', 'Usage: /plan <task>, or set a session goal first with /goal.');
                    return;
                }
                commit('notice', 'planning turn · read-only sandbox');
            }

            if (parsed.kind === 'command' && parsed.name === 'subagent') {
                if (!parsed.args) {
                    commit('error', 'Usage: /subagent <task>');
                    return;
                }
                if (!sessionFactory) {
                    commit('error', 'This shell cannot create an isolated worker session.');
                    return;
                }
                engine = sessionFactory();
                request = workerRequest(parsed.args, goal);
                messageKind = 'worker-message';
                isWorker = true;
                commit('notice', 'worker 01 · isolated · read-only');
            }

            // The handoff rides the first request the reset thread receives,
            // whatever kind it is. A worker never gets it: it is a fresh
            // isolated session that was never party to the compacted thread.
            if (!isWorker && carryOver) {
                request = typeof request === 'string'
                    ? carryOverEnvelope(carryOver, request)
                    : { ...request, text: carryOverEnvelope(carryOver, request.text) };
                setCarryOver('');
            }

            // Set busy BEFORE awaiting anything, so the indicator mounts on the
            // next render rather than waiting for the engine's first event. The
            // dead time at the start of a turn is exactly what it exists to cover.
            setBusyBoth(true);
            clearLingerTimers();
            setActivities([]);
            setLifecycle(null);
            activeSessionRef.current = engine;
            turnStartRef.current = Date.now();

            // Decided inside the loop, acted on after it: compaction is another
            // turn, and starting one while this turn's stream is still open
            // would interleave two conversations on the same session.
            let autoCompactPercent = null;

            try {
                for await (const event of engine.send(request)) {
                    switch (event.kind) {
                        case 'turn-start':
                            break;

                        case 'message':
                            commit(messageKind, event.text);
                            log.append(isWorker ? 'worker' : 'sherman', event.text);
                            break;

                        // Self-talk commits immediately, so it appears in the
                        // trace WHILE the turn runs and stays there afterward:
                        // it is the model's own account of what it was doing,
                        // which is part of the record of the turn.
                        case 'reasoning':
                            commit('selftalk', event.text);
                            break;

                        // Lifecycle, by contrast, is transient. "starting…" is
                        // true for a moment and worthless once the turn has
                        // visibly moved on, so it rides the same activity slot
                        // the in-flight tool uses and is overwritten by it --
                        // never committed, never scrolled past as history.
                        case 'status':
                            setLifecycle(event.text);
                            break;

                        // A tool row is live chrome, not transcript history: it
                        // shows while the task runs, flips to its outcome and
                        // duration when the engine reports completion, then
                        // leaves after ACTIVITY_LINGER_MS. Nothing about it is
                        // committed, so a turn's permanent record is the
                        // messages and file diffs, not the tool trace.
                        case 'tool': {
                            const done = event.phase === 'completed';
                            const entry = {
                                id: event.id,
                                // `line` carries the trace's own glyph prefix; `label` is
                                // the engine's raw text, which the one-line activity
                                // indicator uses so it does not print two glyphs for
                                // one event.
                                line: formatTool(event, done),
                                label: event.label,
                                category: event.category,
                                mark: done ? completionMark(event) : null,
                                durationMs: done ? event.durationMs ?? null : null,
                            };
                            // Replaced in place rather than moved to the end, so a
                            // task finishing does not make the list jump around.
                            setActivities((current) => {
                                const index = current.findIndex((a) => a.id === event.id);
                                if (index === -1) return [...current, entry];
                                const next = current.slice();
                                next[index] = entry;
                                return next;
                            });
                            if (done) {
                                const timer = setTimeout(() => {
                                    lingerTimersRef.current.delete(event.id);
                                    setActivities((current) =>
                                        current.filter((a) => a.id !== event.id)
                                    );
                                }, ACTIVITY_LINGER_MS);
                                lingerTimersRef.current.set(event.id, timer);
                            }
                            break;
                        }

                        case 'turn-end':
                            if (isWorker && event.usage) {
                                workerUsageRef.current = addUsage(workerUsageRef.current, event.usage);
                            }
                            setUsage(addUsage(session.usage, workerUsageRef.current));
                            if (!isWorker) {
                                const used = Number.isFinite(event.usage?.input)
                                    ? event.usage.input
                                    : null;
                                setContextUsed(used);
                                setInfo(session.info);

                                const window = session.info.contextWindow;
                                if (shouldAutoCompact(used, window)) {
                                    autoCompactPercent = Math.round((used / window) * 100);
                                }
                            }
                            break;

                        // Committed, not transient: a file change is part of
                        // the record of what the turn DID, the same way a
                        // completed tool line is.
                        case 'diff':
                            commit('diff', '', { diff: event });
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
                clearLingerTimers();
                setActivities([]);
                setLifecycle(null);
                activeSessionRef.current = session;
                if (isWorker) engine.dispose();
                setInfo(session.info);
                // In `finally`, not on turn-end: an interrupted or failed turn
                // still ran for a true amount of time, and that is the honest
                // value for "last".
                setLastTurnMs(Date.now() - turnStartRef.current);
            }

            if (autoCompactPercent !== null) {
                commit('notice', `context ${autoCompactPercent}% · compacting automatically`);
                await compactSession('');
            }
        },
        [carryOver, clearLingerTimers, commit, compactSession, goal, session, sessionFactory, setBusyBoth, log]
    );

    // Two-stage Ctrl+C, proven in a pty at plan time. Ink is started with
    // exitOnCtrlC:false so this handler is what decides.
    //
    // `busy` is the whole state machine: interrupting clears it, so the next
    // press falls through to exit — and starting a new turn re-arms it, so a
    // later Ctrl+C interrupts again instead of quitting.
    //
    // Scrollback rides in the same handler, and deliberately without
    // `isActive`: browsing history has to work WHILE a turn runs, which is
    // exactly when the composer stops listening. A page is the measured
    // viewport less one row of overlap, so a paged-past line is never a line
    // you did not see. PgUp/PgDn page; shift+arrows step a single row. The
    // composer already ignores all four, so nothing here steals a keystroke
    // from it.
    useInput((input, key) => {
        if (key.pageUp) return scroll(Math.max(1, scrollState.viewport - 1));
        if (key.pageDown) return scroll(-Math.max(1, scrollState.viewport - 1));
        if (key.shift && key.upArrow) return scroll(1);
        if (key.shift && key.downArrow) return scroll(-1);

        // ctrl+y copies the last reply. Free to bind: ctrl+c is the only other
        // ctrl binding in the shell, and Composer.js drops every ctrl chord
        // rather than inserting it, so nothing loses a keystroke. macOS maps
        // ^Y to DSUSP at the tty layer, but raw mode clears IEXTEN, so it never
        // reaches the driver -- verified against ink's own decoding, which
        // reports it as input 'y' with key.ctrl set.
        //
        // Deliberately allowed while a turn is running: the reply you want is
        // the one already on screen, and waiting for the engine to finish
        // before you may copy older text serves nothing.
        if (key.ctrl && input === 'y') return copyLastReply();

        if (!(key.ctrl && input === 'c')) return;

        if (busyRef.current) {
            activeSessionRef.current.interrupt();
            return;
        }
        session.dispose();
        exit();
    });

    // One row for the activity line, and only from surplus: the tool trace has
    // priority for the last available row. The trace names a specific action the
    // engine reported, which beats a decorated one-line summary of the same
    // thing when there is only room for one of them.
    const showActivityLine = busy && activityBudget(columns, rows) >= 2;

    // Launch-only remains top-anchored. Once conversation items exist, the
    // transcript owns the available height and anchors newest content above the
    // factual activity, status, and reserved composer rows.
    return React.createElement(
        Box,
        { flexDirection: 'column', height: rows },
        React.createElement(Transcript, { items, offset: scrollOffset, onWindow }),
        // Only while parked above the tail, and only ever a measured count. The
        // row costs transcript height, which is the honest trade: the shell
        // says how much it is hiding from you, in the same units you scroll in.
        historyLabel(scrollState)
            ? React.createElement(
                  Box,
                  { flexShrink: 0 },
                  React.createElement(
                      Text,
                      { color: color.secondary, wrap: 'truncate' },
                      historyLabel(scrollState)
                  )
              )
            : null,
        // The activity line takes one row out of the same budget the tool trace
        // draws from, and only when there is a row to take. Both clear together
        // on turn end, because `busy` is the only thing gating either.
        React.createElement(Thinking, {
            active: busy,
            activities,
            lifecycle,
            columns,
            rows,
            reserveRows: showActivityLine ? 1 : 0,
        }),
        showActivityLine
            ? React.createElement(ActivityLine, { active: busy, activities, lifecycle, columns })
            : null,
        // Worst-case activity occupies three rows; reserve the composer before
        // admitting the one-row status rule. Thinking budgets itself below that.
        rows >= 2
            ? React.createElement(StatusBar, {
                  info,
                  usage,
                  contextUsed,
                  busy,
                  sessionStart,
                  lastTurnMs,
                  goal,
                  vaultOk: vaultStats.ok,
              })
            : null,
        React.createElement(Composer, {
            onSubmit: submit,
            busy,
            click,
        })
    );
}
