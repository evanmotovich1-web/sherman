// The root component. All turn state lives here; every other component in ui/
// is presentational and takes props.
//
// It renders the 04-01 event union and nothing else. If something here seems to
// need a change inside src/engine/, that is the signal the change belongs behind
// EngineSession — not a licence to reach into codex.js.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdin, useStdout, useWindowSize } from 'ink';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Transcript } from './Transcript.js';
import { historyLabel, scrollBy } from './scrollback.js';
import { enableMouse, parseMouse } from './mouse.js';
import { color, ACTIVITY_GLYPH } from './theme.js';
import { StatusBar } from './StatusBar.js';
import { Composer } from './Composer.js';
import { ChoiceBox } from './ChoiceBox.js';
import { Thinking, activityBudget } from './Thinking.js';
import { ActivityLine } from './ActivityLine.js';
import { copyNotice, copyText, lastReplyText } from '../clipboard.js';
import { projectContext } from '../contextestimate.js';
import { addUsage, emptyUsage } from '../engine/session.js';
import { readVaultStats } from '../vault.js';
import { loadRegistry } from '../registry.js';
import { createSessionLog } from '../sessionlog.js';
import {
    agentRequest,
    carryOverEnvelope,
    commandFor,
    compactRequest,
    emailRequest,
    evalRequest,
    goalEnvelope,
    helpText,
    metaEvalRequest,
    naturalEmailInstruction,
    naturalResearchInstruction,
    navigateReminder,
    parseAgentMention,
    parseEngineFlag,
    parseRetentionProposals,
    parseEmailResult,
    parseSubmission,
    researchTurn,
    planRequest,
    shouldAutoCompact,
    skillTurn,
    submissionRecordText,
    verifyWorkRequest,
    workerRequest,
} from '../commands.js';
import { describe as describeConnectors } from '../connectors.js';
import { describeKeys, removeKey, saveKey, validKeyName } from '../keys.js';
import { engineAvailable } from '../engine/index.js';
import { customizePet, writePetState } from '../petstate.js';
import { composeUrl, openNotice, openPath, openUrl } from '../browser.js';
import { appendEvalReport, ungradedSessions } from '../evalstore.js';
import { collectWinSources, renderWinHtml, winRequest, writeWinSite } from '../win.js';
import { runCommonsCommand } from '../commons/command.js';
import { applyRetentionResult } from '../retention.js';

// Monotonic ids. React list keys must be stable per item, and array index is
// not one — items keep their identity while the array in front of them grows.
let seq = 0;
const nextId = () => `i${seq++}`;

// Transcript bounds (see commit). Generous on purpose: the caps exist to
// keep a multi-day session from exhausting the heap, not to trim anything a
// person is actually reading. The full record lives in the session log.
const MAX_ITEM_CHARS = 64000;
const MAX_TRANSCRIPT_ITEMS = 4000;

// Resolved from THIS file, never process.cwd() — at runtime the cwd is the
// engine's workspace, not the repo. Same reasoning as LaunchScreen.js. /update
// launches the repo's own launcher, which owns the whole update flow.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Rows a single wheel notch moves the transcript. Three is the conventional
// terminal notch; it is fed through the same clamped scroll the keys use, so it
// cannot travel past the oldest row either.
const WHEEL_ROWS = 3;

/**
 * The category tag a committed trace row carries beside its glyph, in the
 * reference's register: `$` for a shell command the way a prompt writes one,
 * short nouns for the rest. Padded to one width so the detail column lines up
 * down the trace. A category with no entry falls back to its own name — a new
 * engine category must never render untagged, because an untagged row reads as
 * a different KIND of thing rather than an unstyled one.
 */
const TRACE_TAG = Object.freeze({
    command: '$',
    read: 'read',
    'file-change': 'patch',
    'file-create': 'create',
    'file-search': 'find',
    'web-search': 'search',
    mcp: 'mcp',
    subagent: 'delegate',
    plan: 'plan',
    tool: 'tool',
});
// Padded past the longest tag on purpose: the reference trace gives its tag
// column air, and the detail column starting at one fixed offset down the
// whole trace is what makes a burst of tool calls readable as a table.
const TRACE_TAG_WIDTH = Math.max(8, ...Object.values(TRACE_TAG).map((t) => t.length));

/**
 * One committed trace row: glyph, padded tag, the engine's own label, and the
 * measured duration. `✓` is not printed on success — in a trace where nearly
 * every row succeeds, the mark is noise and its ABSENCE is what must carry
 * information, so only failures and declines keep their outcome mark.
 */
function traceParts(event) {
    const glyph = ACTIVITY_GLYPH[event.category] ?? '';
    const tag = (TRACE_TAG[event.category] ?? String(event.category ?? 'tool')).padEnd(TRACE_TAG_WIDTH);
    // Only a REPORTED success goes unmarked. The engine always sets an
    // outcome (see codex.js toolOutcome), so an event without one is malformed
    // — and rendering it bare would silently claim a success nobody reported.
    const outcome = event.outcome === 'succeeded' ? '' : ` ${OUTCOME_MARK[event.outcome] ?? '?'}`;
    const duration = typeof event.durationMs === 'number'
        ? `  ${(event.durationMs / 1000).toFixed(1)}s`
        : '';
    return { glyph, tag, label: event.label, outcome, duration };
}

function traceLine(event) {
    const { glyph, tag, label, outcome, duration } = traceParts(event);
    return `${glyph ? `${glyph} ` : ''}${tag}  ${label}${outcome}${duration}`;
}

/** Outcome marks, shared so a row's glyph and its text cannot disagree. */
const OUTCOME_MARK = {
    succeeded: '✓',
    failed: '×',
    declined: '–',
    unknown: '?',
};

/** The mark for a completed tool, matching what formatTool renders. */
// A steering delivery: notes the operator typed while the previous turn was
// still running, delivered at the turn boundary as one follow-up turn. Framed
// so the engine folds them into the work in progress instead of reading them
// as a fresh assignment — the whole point of steering is not starting over.
function steerTurn(notes) {
    return [
        'Steering from the operator, typed while your previous turn was still',
        'running and delivered at the turn boundary. Continue the work in',
        'progress — do not restart it or re-plan from scratch. Fold these in:',
        '',
        ...notes.map((note) => `- ${note}`),
    ].join('\n');
}

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
 * @param {{session: import('../engine/session.js').EngineSession, sessionId: string, sessionFactory?: (() => import('../engine/session.js').EngineSession), rows?: number, evalEveryMs?: number, catchUpDelayMs?: number}} props
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
    // How often the background checkpoint eval considers running. Injectable
    // so tests do not wait ten real minutes; the product value is the default.
    evalEveryMs = 10 * 60_000,
    // How long after launch the catch-up eval looks for a prior session that
    // died ungraded. A grace delay, not an interval: the launch moment is the
    // shell's busiest, and the backlog has already waited since that session
    // ended. Injectable for the same reason as evalEveryMs.
    catchUpDelayMs = 15_000,
    // Retained for caller compatibility; vault wiki capture no longer depends
    // on an external LLMWiki installation.
    wiki = null,
    commonsCommand = runCommonsCommand,
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
    // Read once, for the same reason as the vault stats: the registry is a
    // property of the installation, not of the frame.
    const [registry] = useState(() => loadRegistry());
    // The rows the slash palette shows below the first-party commands, and the
    // names a /skill submission resolves against. An unreadable registry means
    // no skill rows — the palette must not advertise what the loader could not
    // verify exists.
    const slashSkills = registry.skills.ok ? registry.skills.list : [];
    // The roster an @-mention resolves against, under the same contract: an
    // unreadable agent registry means no @-routing, never a guessed harness.
    const atAgents = registry.agents?.ok ? registry.agents.list : [];
    const [items, setItems] = useState(() => [
        {
            id: nextId(),
            kind: 'launch',
            info: session.info,
            sessionId,
            stats: vaultStats,
            registry,
        },
    ]);
    // The transcript, mirrored into a ref. /copy and ctrl+y both need the
    // newest reply at the moment the key is pressed, and both run from stable
    // callbacks that would otherwise close over whatever `items` was when they
    // were built -- copying the second-to-last reply, or nothing at all on the
    // first one. The ref is the live array; `items` stays the render source.
    const itemsRef = useRef(items);
    useEffect(() => { itemsRef.current = items; }, [items]);

    // The pet's goodbye. Unmount is the one point every exit path crosses —
    // /exit, double ctrl+c, a crash of the render — so it is where "this
    // session stopped reporting" becomes the recorded truth. No-op on
    // machines that never adopted the pet.
    useEffect(() => () => { writePetState('offline'); }, []);

    // Whether this session has anything worth grading, and whether it has been
    // graded. A session that was launched and quit has no conduct to judge, and
    // spending a real engine turn to say so on every exit would be a tax on
    // opening the shell.
    const turnsRef = useRef(0);
    // The turn count the last eval of any kind graded up to — the single gate
    // for every eval path. Exit and checkpoint both run only when turns have
    // happened since, so an idle session is never re-graded, a manual /eval
    // resets the clock's debt to zero, and a session that kept working after
    // a checkpoint is still graded on the way out. (This used to be a
    // separate "an eval ever ran" flag, and that flag was the bug: one
    // checkpoint ten minutes in silenced the exit eval forever, leaving every
    // turn after it unjudged.) A main-thread /eval is itself a counted turn,
    // so it books turns+1 — booking only turns would leave a permanent debt
    // of one and exit would re-grade a session that was just graded. Booked
    // BEFORE the turn runs, so an interrupted eval does not re-run and turn
    // one exit into two.
    const lastEvalTurnRef = useRef(0);
    // The in-flight background judge, if any: one at a time, and disposed on
    // unmount so quitting the shell never orphans a worker process.
    const bgEvalWorkerRef = useRef(null);

    const [busy, setBusy] = useState(false);
    const [activities, setActivities] = useState([]);
    // Whether the turn in flight IS an isolated worker (subagent, @agent,
    // /plan, evals, the auto work-check). Drives the status rule's 🤖 chip;
    // engine-reported subagent and mcp activities drive the rest of it.
    const [workerBusy, setWorkerBusy] = useState(false);
    const [lifecycle, setLifecycle] = useState(null);
    const [goal, setGoal] = useState('');
    const [pendingEmail, setPendingEmail] = useState(null);
    const [emailChoice, setEmailChoice] = useState(0);
    // The one-keypress retention gate: an eval-proposed fact awaiting the
    // operator keypress. Holds the proposal plus the promise resolver the
    // eval flow is awaiting on; the operator remains the only path to a file.
    const [pendingRetention, setPendingRetention] = useState(null);
    const [retentionChoice, setRetentionChoice] = useState(0);

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

    // A fullscreen alternate buffer has no native terminal scrollback, but
    // mouse capture also blocks ordinary text selection in some terminals.
    // Native selection wins by default; operators can opt into wheel capture
    // at launch or toggle it for the session with /select.
    const [mouseEnabled, setMouseEnabled] = useState(() => process.env.SHERMAN_MOUSE === '1');
    const terminalModes = useRef(null);
    useEffect(() => {
        const close = enableMouse(stdout, { mouse: mouseEnabled });
        terminalModes.current = close;
        return () => {
            terminalModes.current = null;
            close();
        };
    }, [stdout]);
    useEffect(() => terminalModes.current?.setMouse(mouseEnabled), [mouseEnabled]);

    useEffect(() => {
        if (!mouseEnabled || !stdin || !isRawModeSupported) return undefined;
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
    }, [mouseEnabled, stdin, isRawModeSupported, scroll]);

    const [usage, setUsage] = useState(() => session.usage ?? emptyUsage());
    // The engine's latest measured live-context size, from 'context' events —
    // never turn-end usage, which is the turn's bill rather than the thread's
    // size (see session.js).
    const [contextUsed, setContextUsed] = useState(null);
    // Characters this turn has genuinely sent and received. Codex reports no
    // usage until turn.completed, so between those two moments the meter is
    // driven by what actually crossed the wire -- see contextestimate.js. Reset
    // at the head of every turn; ignored entirely once a measured figure lands.
    const [liveChars, setLiveChars] = useState(null);
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
    // Steering notes typed while a turn runs, waiting for its boundary. A ref,
    // not state: submit reads and drains it inside the same async run that set
    // busy, and a render in between must not lose a note.
    const steerQueueRef = useRef([]);
    const activeSessionRef = useRef(session);
    const workerUsageRef = useRef(emptyUsage());
    // True only while /exit owns the current eval/sync chain. A second Ctrl+C
    // can then be the documented force-exit without turning a single Ctrl+C
    // during an ordinary answer into process termination.
    const exitFlowRef = useRef(false);

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
    //
    // BOUNDED, both per item and in rows. The transcript is React state, and
    // an unbounded one is a slow OOM: a days-long machine-learning session
    // aborted the whole shell with a V8 heap exhaustion — every giant tool
    // output of every turn held on screen forever, for a scrollback nobody
    // was ever going to read. The session log on disk keeps every byte; the
    // screen keeps what a person could plausibly still be looking at.
    const commit = useCallback((kind, text, extra = null) => {
        const bounded = typeof text === 'string' && text.length > MAX_ITEM_CHARS
            ? `${text.slice(0, MAX_ITEM_CHARS)}\n… trimmed on screen · the session log holds the full text`
            : text;
        setItems((prev) => {
            const next = [...prev, { id: nextId(), kind, text: bounded, ...(extra ?? {}) }];
            return next.length > MAX_TRANSCRIPT_ITEMS
                ? next.slice(next.length - MAX_TRANSCRIPT_ITEMS)
                : next;
        });
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

    // A shell-launched worker gets the reference's delegate row: the 🔀 mark
    // and the task it was handed, committed to the trace like any other act
    // the shell performed. The launch notices this replaces carried the same
    // facts in prose; the trace register is where acts belong.
    const commitDelegate = useCallback((label) => {
        const tag = 'delegate'.padEnd(TRACE_TAG_WIDTH);
        commit('tool', `🔀 ${tag}  ${label}`, {
            trace: { glyph: '🔀', tag, label, outcome: '', duration: '' },
        });
    }, [commit]);

    // /update runs the launcher's own update flow in a background child, so
    // the shell stays usable while the pull, npm ci, provisioner repairs, and
    // smoke suite run. One at a time, and the result is committed only from
    // what the child actually printed — the same honesty rule as everywhere
    // else: "updated" is claimed by the flow that verified it, never here.
    const updateRunningRef = useRef(false);
    const runUpdate = useCallback(() => {
        if (updateRunningRef.current) {
            commit('notice', 'an update is already running — its result prints here when it lands');
            return;
        }
        updateRunningRef.current = true;
        commit('notice', 'updating · pulling this checkout forward, reconciling dependencies, and running the smoke suite · the shell stays usable meanwhile');
        let child;
        try {
            child = spawn(join(REPO_ROOT, 'bin', 'sherman'), ['update'], {
                stdio: ['ignore', 'pipe', 'pipe'],
                env: process.env,
            });
        } catch (err) {
            updateRunningRef.current = false;
            commit('error', `update could not start: ${err?.message ?? String(err)}`);
            return;
        }
        let output = '';
        const collect = (chunk) => {
            output += String(chunk);
            // Smoke output is long; keep a bounded tail rather than the session's memory.
            if (output.length > 200_000) output = output.slice(-100_000);
        };
        child.stdout?.on('data', collect);
        child.stderr?.on('data', collect);
        child.on('error', (err) => {
            updateRunningRef.current = false;
            commit('error', `update could not start: ${err?.message ?? String(err)}`);
        });
        child.on('close', (code) => {
            updateRunningRef.current = false;
            const tail = output.trim().split('\n').slice(-12).join('\n');
            if (code === 0) {
                commit('notice', `${tail}\n\nrestart sherman to run the updated code`);
            } else {
                commit('error', `update failed (exit ${code}):\n${tail}`);
            }
        });
    }, [commit]);

    /** Add engine output to this turn's running character count. */
    const addStreamed = useCallback((text) => {
        if (typeof text !== 'string' || text.length === 0) return;
        setLiveChars((prev) => (prev === null
            ? null
            : { ...prev, streamed: prev.streamed + text.length }));
    }, []);

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
            // No live estimate for a compaction turn. It exists to SHRINK the
            // context, so a meter climbing through it would point the wrong way
            // — and the figure that matters lands as a real measurement on the
            // next turn of the new thread anyway.
            setLiveChars(null);
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

    // The meta-eval: the judge gets judged, every time a judge runs. A fresh
    // read-only worker grades the verdict against the meta-eval skill, its
    // report lands beside the verdict in local ~/.sherman/evals/. Eval output
    // never enters the Vault: it is model-generated from session evidence and
    // therefore cannot become durable synchronized content implicitly. Shared
    // by every eval path: exit, manual /eval, checkpoint, catch-up.
    //
    // Quiet about its own failure modes by the eval store's own contract: a
    // meta worker that dies still leaves the eval verdict filed, just
    // ungraded — the loop must never cost the verdict it exists to check.
    const runMetaEval = useCallback(
        async ({ evalText, target, logPath }) => {
            const request = metaEvalRequest(evalText, logPath);
            if (!request || !sessionFactory) return null;
            // The eval loop is filed, never shown. The meta-judge grades the
            // judge in the background and writes its verdict to the eval store
            // (read it with /win); its output is not the operator's terminal
            // to fill. Nothing here commits to the transcript.
            const worker = sessionFactory();
            let metaReply = '';
            try {
                for await (const event of worker.send(request)) {
                    if (event.kind === 'message') {
                        metaReply = metaReply ? `${metaReply}\n\n${event.text}` : event.text;
                    }
                    // Outcome decides, an error mid-stream does not — the reply
                    // may still arrive. A meta-eval that produces nothing fails
                    // silently by the eval store's own contract.
                }
                if (metaReply) {
                    log.append('worker', metaReply);
                    appendEvalReport(target, 'meta eval', metaReply);
                }
            } catch (err) {
                metaReply = '';
            } finally {
                workerUsageRef.current = addUsage(workerUsageRef.current, worker.usage ?? emptyUsage());
                setUsage(addUsage(session.usage, workerUsageRef.current));
                worker.dispose();
            }
            return null;
        },
        [log, session, sessionFactory]
    );


    const syncVaultOnExit = useCallback(async () => {
        if (!process.env.SHERMAN_SESSION_ID || process.env.SHERMAN_NO_FETCH) return;
        commit('notice', 'vault sync · pulling and publishing the shared lanes');
        const outcome = await new Promise((resolve) => {
            let child;
            try {
                child = spawn(join(REPO_ROOT, 'bin', 'sherman'), ['sync'], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    env: process.env,
                });
            } catch (err) {
                resolve(`vault sync could not start: ${err?.message ?? String(err)}`);
                return;
            }
            let output = '';
            const collect = (chunk) => { output += String(chunk); };
            child.stdout?.on('data', collect);
            child.stderr?.on('data', collect);
            const timer = setTimeout(() => child.kill('SIGTERM'), 45_000);
            child.on('error', (err) => {
                clearTimeout(timer);
                resolve(`vault sync could not start: ${err?.message ?? String(err)}`);
            });
            child.on('close', () => {
                clearTimeout(timer);
                resolve(output.trim().split('\n').slice(-2).join(' · ')
                    || 'vault sync produced no report');
            });
        });
        commit('notice', outcome);
    }, [commit]);

    // The newest submit, for the one command that recurses into it: /exit runs
    // the end-of-session eval as a real submission, and a callback cannot name
    // itself inside its own useCallback body.
    const submitRef = useRef(null);
    const submit = useCallback(
        async (text, opts = {}) => {
            // Typed while a turn is running: steering, not a new turn. The
            // exec transport is one child per turn with stdin ignored, so
            // there is no live channel INTO a running turn — the note shows
            // in the transcript immediately, queues, and the moment the turn
            // completes it is delivered on the same thread (see the drain at
            // the tail of this function), framed so the engine folds it into
            // the work in progress instead of starting over. Ctrl+C remains
            // the interrupt; steering never is one.
            if (busyRef.current && !opts.steer) {
                const note = text.trim();
                if (!note) return;
                setScrollOffset(0);
                offsetRef.current = 0;
                if (note.startsWith('/')) {
                    commit('notice', 'commands cannot run mid-turn — send plain steering, or ctrl+c to interrupt');
                    return;
                }
                steerQueueRef.current.push(note);
                commit('user', note);
                log.append('user', note);
                commit('notice', 'steering queued · delivered the moment the current turn completes');
                return;
            }

            // A steering delivery arrives pre-framed and pre-committed: the
            // notes hit the transcript and the log when they were queued, so
            // recording the envelope too would show the same words twice.
            let parsed = opts.steer ? { kind: 'prompt', text } : parseSubmission(text);
            // Submitting is a statement that you are done reading history: the
            // answer is going to arrive at the tail, so snap there rather than
            // leaving the operator parked above their own new turn.
            setScrollOffset(0);
            offsetRef.current = 0;
            if (!opts.steer) {
                const recordedText = submissionRecordText(text, parsed);
                commit('user', recordedText);
                log.append('user', recordedText);
            }

            // Clear imperative email prose takes the same evidence-first route
            // as /email. Questions ABOUT writing email remain normal prompts.
            // Steering deliveries skip every natural-language route below: a
            // note about work in progress must reach the thread as steering
            // even when it happens to open with a routing verb.
            if (parsed.kind === 'prompt' && !opts.steer) {
                const instruction = naturalEmailInstruction(parsed.text);
                if (instruction) parsed = { kind: 'command', name: 'email', args: instruction };
            }

            // "research X" runs the research stack the way "write X an email"
            // runs the email flow: the leading verb is the routing.
            if (parsed.kind === 'prompt' && !opts.steer) {
                const query = naturalResearchInstruction(parsed.text);
                if (query) {
                    commit('notice', 'research turn · deep-research + fact-checking + matching domain skills');
                    parsed = { kind: 'prompt', text: researchTurn(query) };
                }
            }

            // A leading @name is an agent call, resolved against the loaded
            // roster. A name the roster does not carry is answered with the
            // roster, not silently sent to the engine as a typo-shaped prompt.
            let agentCall = null;
            if (parsed.kind === 'prompt' && !opts.steer) {
                const mention = parseAgentMention(parsed.text, atAgents);
                if (mention && !mention.agent) {
                    const roster = atAgents.map((a) => `@${a.name}`).join(', ');
                    commit('error', `No agent named @${mention.name}.${roster ? ` Agents: ${roster}.` : ' No agents are loaded.'}`);
                    return;
                }
                if (mention && !mention.task) {
                    commit('error', `Usage: @${mention.name} <task> — ${mention.agent.specialty}.`);
                    return;
                }
                if (mention) agentCall = mention;
            }

            // A slash that names a SKILL is an invocation, not a typo. It
            // becomes a normal prompt turn — the goal envelope and sandbox
            // apply exactly as if the operator had typed prose — whose text
            // points the engine at the skill's own SKILL.md. First-party
            // commands are checked first so a skill can never shadow one.
            if (parsed.kind === 'command' && !commandFor(parsed.name)) {
                const skill = slashSkills.find((entry) => entry.name === parsed.name);
                if (skill) {
                    // A trace row, not a notice: invoking a skill is an act the
                    // shell itself performed, and the trace is where acts live.
                    // The reference renders its skill loads exactly this way.
                    // navigate carries its blue globe here too.
                    const skillTag = 'skill'.padEnd(TRACE_TAG_WIDTH);
                    const skillGlyph = skill.name === 'navigate' ? '🌐' : '📚';
                    commit('tool', `${skillGlyph} ${skillTag}  skills/${skill.name}/SKILL.md`, {
                        trace: {
                            glyph: skillGlyph,
                            tag: skillTag,
                            label: `skills/${skill.name}/SKILL.md`,
                            outcome: '',
                            duration: '',
                        },
                    });
                    parsed = {
                        kind: 'prompt',
                        text: skillTurn(skill.name, parsed.args),
                        source: `skill:${skill.name}`,
                    };
                }
            }

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
                if (command.name === 'select') {
                    const next = !mouseEnabled;
                    setMouseEnabled(next);
                    commit('notice', next
                        ? 'wheel scrolling restored · Shift+drag selects text · /select releases the mouse again'
                        : 'selection mode · drag to select and use your terminal copy shortcut · /select restores wheel scrolling');
                    return;
                }
                if (command.name === 'agents') {
                    // Local, like /connectors: the roster the shell already
                    // loaded is the whole answer, and it names its sources.
                    if (!registry.agents?.ok) {
                        commit('error', `The agent roster did not load: ${registry.agents?.reason ?? 'unknown'}.`);
                        return;
                    }
                    const width = Math.max(...atAgents.map((a) => a.name.length)) + 1;
                    commit('notice', [
                        'Agents — @name <task> runs one as an isolated read-only worker',
                        ...atAgents.map((a) =>
                            `  @${a.name.padEnd(width)} ${a.specialty}${a.personal ? ' · personal' : ''}`),
                        '',
                        'Bundled roster: agent/agents.json · personal: ~/.sherman/agents/ · new ones: the agent-forge skill',
                    ].join('\n'));
                    return;
                }
                if (command.name === 'customize') {
                    // Local, like /connectors: two small files under
                    // ~/.sherman/pet own the whole answer.
                    const result = customizePet(parsed.args);
                    commit(result.ok ? 'notice' : 'error', result.text);
                    return;
                }
                if (command.name === 'update') {
                    runUpdate();
                    return;
                }
                if (command.name === 'connectors') {
                    // Local, like /help: it reads the catalog and this
                    // machine's enablement file. Spending an engine turn to
                    // report what two local files say would be slower and less
                    // reliable than reading them.
                    commit('notice', describeConnectors());
                    return;
                }
                if (command.name === 'commons') {
                    const commons = await commonsCommand(parsed.args);
                    commit(commons.ok ? 'notice' : 'error', commons.text);
                    return;
                }
                if (command.name === 'key') {
                    // Shell-owned end to end, /learn's contract: the model
                    // never handles the value. The submission was already
                    // redacted before the transcript and log saw it
                    // (submissionRecordText), so by the time this runs the
                    // secret exists nowhere but the parsed args and the store.
                    const args = parsed.args.trim();
                    if (args === '') {
                        commit('notice', describeKeys());
                        return;
                    }
                    const removal = args.match(/^remove\s+(\S+)$/i);
                    if (removal) {
                        const result = removeKey(removal[1]);
                        if (!result.ok) {
                            commit('error', `remove failed · ${result.reason}`);
                            return;
                        }
                        // Un-inject so "removed" is true for the very next
                        // turn, not just the next launch.
                        delete process.env[removal[1]];
                        commit('notice', result.removed
                            ? `${removal[1]} removed (verified: read back) · gone from the environment now`
                            : `${removal[1]} was not stored · nothing to remove`);
                        return;
                    }
                    const pair = args.match(/^(\S+)\s+([\s\S]+)$/);
                    if (!pair) {
                        commit('error', 'Usage: /key <NAME> <value> · /key remove <NAME> · bare /key lists stored names');
                        return;
                    }
                    const result = saveKey(pair[1], pair[2]);
                    if (!result.ok) {
                        // The one mistake operators actually make is pasting
                        // the value first; the name-gate message alone reads
                        // like a riddle from inside that mistake, so name the
                        // argument order in the same breath.
                        const hint = validKeyName(pair[1])
                            ? ''
                            : ' · the NAME comes first, then the value — e.g. /key SERVICE_API_KEY <the key you pasted>';
                        commit('error', `key rejected · nothing stored · ${result.reason}${hint}`);
                        return;
                    }
                    // Live immediately: both engines inherit process.env, so
                    // the very next turn can use it — no relaunch.
                    process.env[result.name] = pair[2].trim();
                    commit('notice', `${result.name} ${result.replaced ? 'replaced' : 'stored'} (verified: read back) · chmod 600, outside the repo and the vault · live for this and every future session · value redacted from the log`);
                    return;
                }
                if (command.name === 'learn' || command.name === 'wiki') {
                    const divider = parsed.args.indexOf('|');
                    const rawName = divider < 0 ? '' : parsed.args.slice(0, divider).trim();
                    const content = divider < 0 ? '' : parsed.args.slice(divider + 1).trim();
                    const path = rawName.endsWith('.md') ? rawName : `${rawName}.md`;
                    if (!rawName || !content) {
                        commit('error', `Usage: /${command.name} <fact-name> | <fact text>`);
                        return;
                    }
                    try {
                        const changed = applyRetentionResult({
                            vaultPath: session.info.vaultPath,
                            source: command.name,
                            text: JSON.stringify({ operations: [{ path, content }] }),
                        });
                        commit('notice', `${command.name} retained ${changed.length} shell-validated fact file`);
                    } catch (error) {
                        commit('error', `${command.name} rejected · nothing written · ${error?.message ?? String(error)}`);
                    }
                    return;
                }
                if (command.name === 'clear') {
                    // The screen, not the record: the engine thread keeps its
                    // context (/compact is what resets it) and the session log
                    // on disk keeps every line, including this command.
                    setItems([]);
                    commit('notice', 'transcript cleared · engine context unchanged — /compact is what resets context');
                    return;
                }
                if (command.name === 'exit') {
                    if (exitFlowRef.current) {
                        commit('notice', 'exit already in progress · ctrl+c once more to force exit');
                        return false;
                    }
                    exitFlowRef.current = true;
                    // The same contract as the second ctrl+c: a session with
                    // UNJUDGED turns is graded on the way out — turns since
                    // the last eval, not "no eval ever ran", so working past
                    // a checkpoint still ends with the tail judged. The eval
                    // turn is interruptible (ctrl+c) so it can never trap the
                    // operator in a shell they asked to leave; the /eval
                    // branch books the debt before the turn starts, so an
                    // interrupted eval does not re-run and turn one exit
                    // into two.
                    if (turnsRef.current > lastEvalTurnRef.current && !log.failed) {
                        commit('notice', 'evaluating this session before exit · ctrl+c to skip');
                        await submitRef.current('/eval');
                    }

                    // The vault syncs itself on the way out: pull what other
                    // machines published, publish what this session learned —
                    // the drift between two machines' wiki counts was exactly
                    // the sync nobody ran. Real launches only (the launcher
                    // sets SHERMAN_SESSION_ID; fixtures and tests do not),
                    // SHERMAN_NO_FETCH opts out, a 45s cap keeps a dead
                    // network from holding the door shut, and ctrl+c twice
                    // remains the skip-everything exit.
                    await syncVaultOnExit();
                    session.dispose();
                    exit();
                    return true;
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
            // A steering envelope goes verbatim: it already frames itself, and
            // the standing navigate reminder is for fresh assignments, not for
            // a mid-work course correction.
            const promptText = parsed.kind === 'prompt'
                ? goalEnvelope(opts.steer ? parsed.text : navigateReminder(parsed.text), goal)
                : null;
            let request = promptText && parsed.source
                ? { text: promptText, mode: 'normal', source: parsed.source }
                : promptText;
            let messageKind = 'message';
            let isWorker = false;
            // An email turn's reply is machine-shaped (the draft as JSON), so
            // it accumulates here instead of committing raw to the transcript;
            // what commits is the readable draft, after the turn.
            let isEmail = false;
            let emailReply = '';
            let emailInstruction = '';
            // Eval verdicts commit to the transcript like any reply AND
            // accumulate here, so the verdict outlives the session in
            // ~/.sherman/evals/ where /win and the operator can find trends.
            let isEval = false;
            let evalReply = '';

            // /win's verdict becomes a page: accumulated, rendered, opened.
            let isWin = false;
            let winSources = null;
            let winReply = '';

            if (parsed.kind === 'command' && parsed.name === 'plan') {
                request = planRequest(parsed.args, goal);
                if (!request) {
                    commit('error', 'Usage: /plan <task>, or set a session goal first with /goal.');
                    return;
                }
                commit('notice', 'planning turn · read-only sandbox');
            }

            if (parsed.kind === 'command' && parsed.name === 'email') {
                request = emailRequest(parsed.args, goal);
                if (!request) {
                    commit('error', 'Usage: /email <who to write and what to say>.');
                    return;
                }
                isEmail = true;
                emailInstruction = parsed.args;
                commit('notice', 'drafting turn · read-only · the compose window opens when the draft is ready');
            }

            if (parsed.kind === 'command' && parsed.name === 'eval') {
                request = evalRequest(log.path, { gaps: parsed.args !== 'conduct' });
                if (!request) {
                    commit('error', 'No session log to evaluate.');
                    return;
                }
                if (log.failed) {
                    // The log is where the judgment comes from. Grading a
                    // session whose record stopped being written would produce
                    // a confident report about a fraction of what happened.
                    commit('error', 'The session log stopped being written, so there is nothing complete to grade.');
                    return;
                }
                // turns+1, not turns: this eval turn is itself about to be
                // counted at its own turn-end, and grading must not create
                // the very debt it just paid.
                lastEvalTurnRef.current = turnsRef.current + 1;
                isEval = true;
                commit('notice', 'evaluating this session · read-only · judging conduct, not answers');
            }



            if (parsed.kind === 'command' && parsed.name === 'win') {
                if (!sessionFactory) {
                    commit('error', 'This shell cannot create an isolated worker session.');
                    return;
                }
                const sources = collectWinSources();
                if (sources.sessions.length === 0 && sources.evals.length === 0) {
                    commit('error', 'Nothing to judge yet: no session logs under ~/.sherman/sessions/. Work a session or two first.');
                    return;
                }
                engine = sessionFactory();
                request = winRequest(sources, goal);
                messageKind = 'worker-message';
                isWorker = true;
                isWin = true;
                winSources = sources;
                commit('notice', [
                    `judging ${sources.sessions.length} session log${sources.sessions.length === 1 ? '' : 's'}`,
                    `${sources.evals.length} eval verdict${sources.evals.length === 1 ? '' : 's'}`,
                    sources.extras.length ? `${sources.extras.length} export${sources.extras.length === 1 ? '' : 's'}` : null,
                    'isolated · read-only · the page opens when the verdict lands',
                ].filter(Boolean).join(' · '));
            }

            if (parsed.kind === 'command' && parsed.name === 'subagent') {
                if (!parsed.args) {
                    commit('error', 'Usage: /subagent [--engine codex|claude|zai] <task>');
                    return;
                }
                if (!sessionFactory) {
                    commit('error', 'This shell cannot create an isolated worker session.');
                    return;
                }
                // The engine override: one worker on a named model, the
                // parent session untouched. Unknown names and absent
                // binaries fail HERE, with the roster or the repair, never
                // mid-turn as a spawn error.
                const routed = parseEngineFlag(parsed.args);
                if (routed.error) {
                    commit('error', routed.error);
                    return;
                }
                if (routed.engine && !engineAvailable(routed.engine)) {
                    commit('error', `${routed.engine} is not installed on this machine — install and sign in to it first, or drop the --engine flag.`);
                    return;
                }
                engine = sessionFactory(routed.engine);
                request = workerRequest(routed.task, goal);
                messageKind = 'worker-message';
                isWorker = true;
                commitDelegate(`${routed.task} · isolated · read-only${routed.engine ? ` · engine ${routed.engine}` : ''}`);
            }

            // An @-mentioned agent is the /subagent contract with a specialty:
            // same isolation, same read-only sandbox, plus the roster harness
            // in front of the task.
            if (agentCall?.agent) {
                if (!sessionFactory) {
                    commit('error', 'This shell cannot create an isolated worker session.');
                    return;
                }
                // Same engine override as /subagent: `@name --engine zai
                // <task>` runs that specialist on the named model.
                const routedAgent = parseEngineFlag(agentCall.task);
                if (routedAgent.error) {
                    commit('error', routedAgent.error);
                    return;
                }
                if (routedAgent.engine && !engineAvailable(routedAgent.engine)) {
                    commit('error', `${routedAgent.engine} is not installed on this machine — install and sign in to it first, or drop the --engine flag.`);
                    return;
                }
                engine = sessionFactory(routedAgent.engine);
                request = agentRequest(agentCall.agent, routedAgent.task, goal);
                messageKind = 'worker-message';
                isWorker = true;
                commitDelegate(`@${agentCall.agent.name} ${routedAgent.task} · isolated · read-only${routedAgent.engine ? ` · engine ${routedAgent.engine}` : ''}`);
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
            setWorkerBusy(isWorker);
            // The desktop pet mirrors the same transitions the busy indicator
            // does; no-op unless this machine adopted it (see petstate.js).
            writePetState('working');
            let turnFailed = false;
            // pre-seeded below (not null) so the dead time between submit and
            // the engine's first event reads as a stage, not a stall; the
            // engine's own status events overwrite it the moment they arrive.
            // Mutating events this turn: file changes, creations, commands,
            // and diffs. Past a threshold the turn counts as deep work and
            // earns an automatic verification pass (below).
            let turnMutations = 0;
            clearLingerTimers();
            setActivities([]);
            setLifecycle('initializing agent');
            // Seed this turn's live character count with what is being sent.
            // A worker's tokens are not the main thread's context, so a worker
            // turn must never move the main meter.
            setLiveChars(isWorker ? null : {
                sent: (typeof request === 'string' ? request : request.text ?? '').length,
                streamed: 0,
            });
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
                            if (isEmail) {
                                // Logged (it is what the engine said) but not
                                // committed: the operator reads the draft the
                                // shell prints after the turn, not its JSON.
                                emailReply = emailReply ? `${emailReply}\n\n${event.text}` : event.text;
                                log.append('sherman', event.text);
                                addStreamed(event.text);
                                break;
                            }
                            if (isEval) {
                                // Filed, not shown: the eval verdict accumulates
                                // for the eval store and lands in the log, but
                                // never commits to the transcript. The CLI stays
                                // about the work; read verdicts with /win.
                                evalReply = evalReply ? `${evalReply}\n\n${event.text}` : event.text;
                                log.append('sherman', event.text);
                                break;
                            }
                            if (isWin) {
                                winReply = winReply ? `${winReply}\n\n${event.text}` : event.text;
                            }
                            commit(messageKind, event.text);
                            log.append(isWorker ? 'worker' : 'sherman', event.text);
                            if (!isWorker) addStreamed(event.text);
                            break;

                        // Self-talk commits immediately, so it appears in the
                        // trace WHILE the turn runs and stays there afterward:
                        // it is the model's own account of what it was doing,
                        // which is part of the record of the turn.
                        case 'reasoning':
                            commit('selftalk', event.text);
                            if (!isWorker) addStreamed(event.text);
                            break;

                        // Lifecycle, by contrast, is transient. "starting…" is
                        // true for a moment and worthless once the turn has
                        // visibly moved on, so it rides the same activity slot
                        // the in-flight tool uses and is overwritten by it --
                        // never committed, never scrolled past as history.
                        case 'status':
                            setLifecycle(event.text);
                            break;

                        // A RUNNING tool is live chrome: it shows on the
                        // activity slot while the task runs and leaves the
                        // moment it completes. A COMPLETED tool commits to the
                        // transcript — glyph, category tag, label, measured
                        // duration — so the session reads as a permanent trace
                        // of what the engine actually did, the way the
                        // reference's does. Every committed row is a reported
                        // engine event; the trace still never invents a line.
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
                                // The text is the row's canonical plain form;
                                // the parts ride along so the transcript can
                                // ink the tag and detail columns separately
                                // without re-parsing its own output.
                                //
                                // A read of a skill file is re-tagged as the
                                // skill row it factually is: the engine loading
                                // skills/<name>/ IS the automatic skill use,
                                // and the trace shows it in the same 📚
                                // register as a slash invocation — several per
                                // turn when several skills stack.
                                let parts = traceParts(event);
                                let text = traceLine(event);
                                const skillRead = event.category === 'read' && typeof event.label === 'string'
                                    ? event.label.match(/skills\/([a-z0-9][a-z0-9_-]*)\/([^\s]+)/i)
                                    : null;
                                if (skillRead) {
                                    const tag = 'skill'.padEnd(TRACE_TAG_WIDTH);
                                    const detail = skillRead[2] === 'SKILL.md'
                                        ? skillRead[1]
                                        : `${skillRead[1]} → ${skillRead[2]}`;
                                    // navigate wears its own mark: the blue
                                    // globe, for the skill that finds where
                                    // things live.
                                    const glyph = skillRead[1] === 'navigate' ? '🌐' : '📚';
                                    parts = { ...parts, glyph, tag, label: detail };
                                    text = `${glyph} ${tag}  ${detail}${parts.outcome}${parts.duration}`;
                                }
                                // A shell command that runs a language runtime
                                // is the reference's `exec` register, not `$`:
                                // same reported fact, more precise tag.
                                const execRun = !skillRead && event.category === 'command' && typeof event.label === 'string'
                                    ? event.label.match(/^exec ((?:python3?|node|swift|ruby|perl|deno|bun)\b[\s\S]*)$/)
                                    : null;
                                if (execRun) {
                                    const tag = 'exec'.padEnd(TRACE_TAG_WIDTH);
                                    parts = { ...parts, glyph: '🐍', tag, label: execRun[1] };
                                    text = `🐍 ${tag}  ${execRun[1]}${parts.outcome}${parts.duration}`;
                                }
                                commit('tool', text, { trace: parts });
                                writePetState('working', event.label);
                                if (['file-change', 'file-create', 'command'].includes(event.category)) {
                                    turnMutations += 1;
                                }
                                // Committed is the record; the live slot's copy
                                // would be the same row twice on one screen.
                                setActivities((current) =>
                                    current.filter((a) => a.id !== event.id)
                                );
                            }
                            break;
                        }

                        // The engine's own measurement of the live thread —
                        // the ONLY thing allowed to move the context meter or
                        // arm compaction. turn-end usage is the turn's bill
                        // (input summed across sub-requests) and must not:
                        // acting on the bill reads several hundred percent on
                        // a healthy thread and would discard real conversation
                        // over arithmetic on the wrong number. The estimate
                        // must never reach this decision either: it moves a
                        // meter; only a measurement moves the session.
                        case 'context':
                            if (!isWorker) {
                                setContextUsed(event.used);
                                // The measured figure supersedes the estimate
                                // outright. Blending a fact with a guess yields
                                // a guess, so the guess is simply dropped.
                                setLiveChars(null);
                                const window = event.window ?? session.info.contextWindow;
                                // Recomputed on every measurement, including
                                // back to null: codex can compact its own
                                // thread mid-turn, and a later, smaller figure
                                // must disarm a compaction an earlier one
                                // armed. Arriving mid-turn, the decision still
                                // ACTS at the turn boundary below — the
                                // earliest point a compaction turn can run.
                                autoCompactPercent = shouldAutoCompact(event.used, window)
                                    ? Math.round((event.used / window) * 100)
                                    : null;
                            }
                            break;

                        case 'turn-end':
                            if (isWorker && event.usage) {
                                workerUsageRef.current = addUsage(workerUsageRef.current, event.usage);
                            }
                            setUsage(addUsage(session.usage, workerUsageRef.current));
                            if (!isWorker) {
                                turnsRef.current += 1;
                                // A turn that produced no measurement leaves
                                // the estimate up rather than promoting the
                                // bill to the meter; only 'context' clears it.
                                setInfo(session.info);
                            }
                            break;

                        // Committed, not transient: a file change is part of
                        // the record of what the turn DID, the same way a
                        // completed tool line is.
                        case 'diff':
                            commit('diff', '', { diff: event });
                            turnMutations += 1;
                            break;

                        case 'interrupted':
                            commit('notice', 'interrupted');
                            break;

                        case 'error':
                            commit('error', event.message);
                            turnFailed = true;
                            writePetState('failed', event.message);
                            break;

                        case 'advisory':
                            // An engine housekeeping note on a turn that is
                            // still succeeding — shown, never treated as
                            // failure (see session.js).
                            commit('notice', event.message);
                            break;

                        default:
                            // Unknown kinds are ignored, matching the backend's own
                            // tolerance. A future codex event must not crash the UI.
                            break;
                    }
                }
            } catch (err) {
                commit('error', err?.message ?? String(err));
                turnFailed = true;
                writePetState('failed', err?.message ?? String(err));
            } finally {
                setBusyBoth(false);
                setWorkerBusy(false);
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
                // The pet celebrates a finished turn; a failure keeps the
                // failed face the error event already reported.
                if (!turnFailed) writePetState('done');
            }


            if (isEval && evalReply) {
                appendEvalReport(sessionId, 'session eval', evalReply);
                // A hand-typed /eval gets ONE line back so the operator knows
                // it ran and where the verdict went — the panel itself stays
                // out of the CLI. On exit (exitFlowRef set) even that is
                // skipped: the shell is already leaving and said so.
                if (!exitFlowRef.current) {
                    commit('notice', 'session evaluated · filed under ~/.sherman/evals · read it with /win');
                }
                // The loop on the loop: this verdict now gets graded, and the
                // recommendation-plus-grade pair is filed for review. Awaited,
                // so an exit's filing lands before the shell disposes.
                await runMetaEval({ evalText: evalReply, target: sessionId, logPath: log.path });

                // The vault-growth gate. Sixty-nine sessions produced three
                // proposals and zero filed facts, because a proposal had to
                // be re-typed to become real. Now each complete /learn and
                // /wiki the verdict proposed is offered as one keypress:
                // Enter files it, Esc skips it. The operator is still the
                // only path to a write — nothing files without the keypress
                // — and the write still goes through the same shell
                // validation and confinement as a hand-typed command.
                for (const proposal of parseRetentionProposals(evalReply)) {
                    const accepted = await new Promise((resolve) => {
                        setRetentionChoice(0);
                        setPendingRetention({ ...proposal, resolve });
                    });
                    setPendingRetention(null);
                    if (!accepted) continue;
                    try {
                        applyRetentionResult({
                            vaultPath: session.info.vaultPath,
                            source: proposal.command,
                            text: JSON.stringify({
                                operations: [{ path: `${proposal.name}.md`, content: proposal.content }],
                            }),
                        });
                        commit('notice', `${proposal.command} filed ${proposal.name} · shell-validated · publishes on the next vault sync`);
                    } catch (error) {
                        commit('error', `${proposal.command} rejected · nothing written · ${error?.message ?? String(error)}`);
                    }
                }
            }

            if (isWin) {
                if (!winReply.trim()) {
                    commit('error', 'The review produced no verdict, so no page was written.');
                } else {
                    const file = writeWinSite(renderWinHtml(winReply, {
                        sessions: winSources.sessions.length,
                        evals: winSources.evals.length,
                        extras: winSources.extras.length,
                    }));
                    if (!file) {
                        commit('error', 'Could not write the report page under ~/.sherman/win/ — the verdict above is the report.');
                    } else {
                        const opened = openPath(file);
                        commit('notice', opened.ok
                            ? `report written to ${file} · opening in your browser`
                            : `report written to ${file} · could not open a browser here (${opened.reason})`);
                    }
                }
            }

            if (isEmail) {
                const result = parseEmailResult(emailReply);
                if (!result) {
                    // The reply, whatever it was, still belongs to the record —
                    // and no compose window opens on a reply that did not parse.
                    if (emailReply.trim()) commit('message', emailReply);
                    commit('error', 'The draft did not come back in an openable shape, so no compose window was opened.');
                } else if (result.kind === 'error') {
                    commit('error', result.error);
                } else if (result.kind === 'question') {
                    setEmailChoice(0);
                    setPendingEmail({ ...result, instruction: emailInstruction });
                    commit('notice', 'No prior recipient correspondence found · choose a tone to continue.');
                } else {
                    const { draft } = result;
                    commit('message', [
                        `To: ${draft.to || '(add the recipient in the compose window)'}`,
                        `Subject: ${draft.subject || '(none)'}`,
                        '',
                        draft.body,
                    ].join('\n'));
                    commit('notice', openNotice(openUrl(composeUrl(draft))));
                }
            }

            // Deep work earns an automatic verification pass: enough mutating
            // events in a normal prompt turn, and a fresh read-only worker
            // checks the finished work's claims against the actual files
            // before the operator builds on them. Prompt turns only — eval,
            // email, and worker turns already are or produce judgments —
            // and interruptible like any turn (ctrl+c skips it).
            if (!isWorker && !turnFailed && parsed.kind === 'prompt'
                && turnMutations >= 4 && sessionFactory && !log.failed) {
                const check = verifyWorkRequest(log.path, goal);
                if (check) {
                    commitDelegate(`verify the finished work · ${turnMutations} mutating steps · read-only · ctrl+c to skip`);
                    const verifier = sessionFactory();
                    activeSessionRef.current = verifier;
                    setBusyBoth(true);
                    setWorkerBusy(true);
                    let verdict = '';
                    const engineErrors = [];
                    try {
                        for await (const event of verifier.send(check)) {
                            if (event.kind === 'message') {
                                verdict = verdict ? `${verdict}\n\n${event.text}` : event.text;
                            }
                            // Same contract as gradeOnWorker: the check is
                            // judged by whether its verdict arrived.
                            if (event.kind === 'error') engineErrors.push(event.message);
                        }
                        if (verdict) {
                            commit('worker-message', verdict);
                            log.append('worker', verdict);
                        } else if (engineErrors.length > 0) {
                            commit('error', `work check failed: ${engineErrors[engineErrors.length - 1]}`);
                        }
                    } catch (err) {
                        commit('error', `work check failed: ${err?.message ?? String(err)}`);
                    } finally {
                        setBusyBoth(false);
                        setWorkerBusy(false);
                        activeSessionRef.current = session;
                        workerUsageRef.current = addUsage(workerUsageRef.current, verifier.usage ?? emptyUsage());
                        setUsage(addUsage(session.usage, workerUsageRef.current));
                        verifier.dispose();
                    }
                }
            }

            if (autoCompactPercent !== null) {
                commit('notice', `context ${autoCompactPercent}% · compacting automatically`);
                await compactSession('');
            }

            // Steering typed while this turn ran is delivered now, before the
            // shell goes idle: one follow-up turn on the same thread carries
            // every queued note in order. Notes typed during THAT turn queue
            // and drain the same way, so steering chains without interrupting
            // anything. After a compaction, the carry-over envelope rides this
            // delivery like it would any next turn.
            if (steerQueueRef.current.length > 0) {
                const notes = steerQueueRef.current.splice(0);
                await submitRef.current(steerTurn(notes), { steer: true });
            }
        },
        [carryOver, clearLingerTimers, commit, commitDelegate, commonsCommand, compactSession, exit, goal, mouseEnabled, runMetaEval, runUpdate, session, sessionFactory, sessionId, setBusyBoth, log, slashSkills, atAgents, syncVaultOnExit]
    );
    submitRef.current = submit;

    // One background judge, shared by the checkpoint and catch-up evals: an
    // isolated read-only worker runs the request, the verdict accumulates
    // across message events (an engine that replies in parts must not have
    // all but its last part dropped — the single-message assignment this
    // replaces did exactly that), commits to the transcript, lands in this
    // session's log, and persists under ~/.sherman/evals/ AGAINST THE SESSION
    // IT JUDGED — which for a catch-up is not this one. Worker tokens land in
    // the worker usage total like any worker's.
    const gradeOnWorker = useCallback(
        async ({ request, kind, target, logPath = null }) => {
            const worker = sessionFactory();
            bgEvalWorkerRef.current = worker;
            let verdict = '';
            try {
                for await (const event of worker.send(request)) {
                    if (event.kind === 'message') {
                        verdict = verdict ? `${verdict}\n\n${event.text}` : event.text;
                    }
                    // A worker turn is judged by whether its verdict arrived,
                    // not by whether the engine grumbled on the way; a mid-
                    // stream error does not abort. The background eval loop
                    // never speaks in the transcript — it FILES.
                }
                if (verdict) {
                    log.append('worker', verdict);
                    appendEvalReport(target, kind, verdict);
                }
                // A background eval that produced no verdict fails silently:
                // the caller restores the grading debt from the false return,
                // so the coverage is kept without a line in the operator's
                // terminal that was never theirs to watch.
            } catch (err) {
                verdict = '';
            } finally {
                workerUsageRef.current = addUsage(workerUsageRef.current, worker.usage ?? emptyUsage());
                setUsage(addUsage(session.usage, workerUsageRef.current));
                worker.dispose();
                bgEvalWorkerRef.current = null;
            }
            // The meta-judge takes its turn — the loop runs on every eval path,
            // background ones included, or the least-watched judges would be
            // the least checked. Silent, like the judge it grades.
            if (verdict) {
                await runMetaEval({ evalText: verdict, target, logPath });
            }
            // Whether a verdict actually landed: the caller uses this to
            // restore the grading debt after a failed background judge, so a
            // transient engine error costs one checkpoint, not the coverage.
            return Boolean(verdict);
        },
        [log, runMetaEval, session, sessionFactory]
    );

    // The background checkpoint eval: every `evalEveryMs`, a session with new
    // turns since the last grading is judged by an isolated read-only worker
    // reading the session LOG — the same evidence the exit eval uses — so the
    // operator sees drift while there is still session left to correct it in.
    //
    // It runs OUTSIDE the submit machinery on purpose. submit() owns the busy
    // state, the composer, and the activity chrome; a checkpoint that seized
    // those would be a modal interruption, not a background judge. The worker
    // is a fresh engine session (never the main thread — grading must not
    // spend the conversation's own context), one runs at a time, and a tick
    // that lands mid-turn skips rather than interleaving its report with the
    // turn's output.
    useEffect(() => {
        if (!sessionFactory || !Number.isFinite(evalEveryMs) || evalEveryMs <= 0) return undefined;

        const tick = async () => {
            if (bgEvalWorkerRef.current !== null) return;
            if (busyRef.current) return;
            if (log.failed) return;
            if (turnsRef.current === 0 || turnsRef.current <= lastEvalTurnRef.current) return;

            const request = evalRequest(log.path);
            if (!request) return;

            // Booked before the turn runs, same as every other eval path: an
            // interrupted checkpoint must not re-run immediately and double
            // up. Exactly turns (not turns+1): the judge is a worker, so no
            // main-thread turn follows from the grading itself.
            const before = lastEvalTurnRef.current;
            const booked = turnsRef.current;
            lastEvalTurnRef.current = booked;

            const graded = await gradeOnWorker({
                request,
                kind: 'checkpoint eval',
                target: sessionId,
                logPath: log.path,
            });
            // A failed judge must not mark the turns graded: restore the debt
            // (unless something else — a manual /eval — booked meanwhile) so
            // the next tick or the exit eval retries. Silent: the retry is the
            // loop's business, not a line for the operator's terminal.
            if (!graded && lastEvalTurnRef.current === booked) {
                lastEvalTurnRef.current = before;
            }
        };

        const timer = setInterval(tick, evalEveryMs);
        return () => {
            clearInterval(timer);
            bgEvalWorkerRef.current?.dispose();
            bgEvalWorkerRef.current = null;
        };
    }, [evalEveryMs, gradeOnWorker, log, sessionFactory, sessionId]);

    // The catch-up eval: the loop's guarantee that EVERY session ends with a
    // verdict, including the ones that never got to say goodbye. A closed
    // window, a kill, a crash — the log survives under ~/.sherman/sessions/
    // but no exit eval ever ran, and a verdict that was never written cannot
    // show a trend in /win. So each launch, after a grace delay, looks for
    // the newest prior session that has real Sherman turns, no eval file, and
    // has been quiet long enough to be over (a parallel LIVE shell must not
    // have its session graded out from under it — ungradedSessions holds that
    // line), and grades it on an isolated worker. One per launch, so a
    // backlog drains a session at a time instead of billing a storm at once;
    // /win still sees every file either way.
    useEffect(() => {
        if (!sessionFactory || !Number.isFinite(catchUpDelayMs) || catchUpDelayMs <= 0) return undefined;

        const timer = setTimeout(async () => {
            if (bgEvalWorkerRef.current !== null || busyRef.current) return;
            const [stale] = ungradedSessions({ exclude: sessionId });
            if (!stale) return;
            const request = evalRequest(stale.path, { closed: true });
            if (!request) return;
            await gradeOnWorker({
                request,
                kind: 'catch-up eval',
                target: stale.id,
                logPath: stale.path,
            });
        }, catchUpDelayMs);

        return () => {
            clearTimeout(timer);
            bgEvalWorkerRef.current?.dispose();
            bgEvalWorkerRef.current = null;
        };
    }, [catchUpDelayMs, gradeOnWorker, sessionFactory, sessionId]);

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
        if (pendingRetention) {
            // Any arrow toggles between the two choices; Enter commits the
            // highlighted one; Esc skips. Ctrl+C also resolves as a skip so
            // the box can never trap an operator who is trying to leave —
            // the next press reaches the normal exit handling.
            if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
                setRetentionChoice((value) => (value + 1) % 2);
                return;
            }
            if (key.return) {
                pendingRetention.resolve(retentionChoice === 0);
                return;
            }
            if (key.escape || (key.ctrl && input === 'c')) {
                pendingRetention.resolve(false);
                return;
            }
            return;
        }
        if (pendingEmail) {
            if (key.upArrow) {
                setEmailChoice((value) => (value - 1 + pendingEmail.choices.length) % pendingEmail.choices.length);
                return;
            }
            if (key.downArrow) {
                setEmailChoice((value) => (value + 1) % pendingEmail.choices.length);
                return;
            }
            if (key.return) {
                const selected = pendingEmail.choices[emailChoice];
                const instruction = pendingEmail.instruction;
                setPendingEmail(null);
                setEmailChoice(0);
                void submitRef.current(`/email ${instruction}\nNew-recipient tone choice: ${selected}`);
                return;
            }
            return;
        }
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

        if (exitFlowRef.current) {
            activeSessionRef.current.interrupt();
            // Dispose the active worker, not only the main chat session:
            // OpenCode uses this hook to synchronously remove its disposable
            // candidate store before the process exits. This branch also owns
            // the tiny idle gaps between retention/sync stages, so a second
            // exit flow can never start there.
            activeSessionRef.current.dispose();
            if (activeSessionRef.current !== session) session.dispose();
            exit();
            return;
        }

        if (busyRef.current) {
            activeSessionRef.current.interrupt();
            return;
        }
        // Ctrl+C and /exit deliberately share one implementation. That keeps
        // eval, validated retention, debt handling, and vault sync in the same
        // order instead of letting the keyboard path silently skip a stage.
        void submitRef.current('/exit');
    });

    // One row for the activity line, and only from surplus: the tool trace has
    // priority for the last available row. The trace names a specific action the
    // engine reported, which beats a decorated one-line summary of the same
    // thing when there is only room for one of them.
    const showActivityLine = busy && activityBudget(columns, rows) >= 2;

    // Launch-only remains top-anchored. Once conversation items exist, the
    // The meter's figure, and whether it is measured or projected. Computed
    // here rather than inside StatusBar so the estimate's inputs stay in the
    // component that owns the turn -- StatusBar renders what it is told and
    // never reaches for engine state of its own.
    const projected = projectContext({
        measured: contextUsed,
        sentChars: liveChars?.sent ?? 0,
        streamedChars: liveChars?.streamed ?? 0,
    });

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
                  contextUsed: projected ? projected.used : null,
                  contextEstimated: projected ? projected.estimated : false,
                  busy,
                  sessionStart,
                  lastTurnMs,
                  goal,
                  vaultOk: vaultStats.ok,
                  // Reported facts only: an in-flight mcp/subagent activity
                  // from the engine, or a worker turn this shell itself runs.
                  live: {
                      mcp: activities.some((a) => a.category === 'mcp' && !a.mark),
                      agent: workerBusy
                          || activities.some((a) => a.category === 'subagent' && !a.mark),
                  },
              })
            : null,
        pendingEmail
            ? React.createElement(ChoiceBox, {
                  question: pendingEmail.question,
                  choices: pendingEmail.choices,
                  selected: emailChoice,
                  width: columns,
              })
            : null,
        pendingRetention
            ? React.createElement(ChoiceBox, {
                  question: `File to the vault? /${pendingRetention.command} ${pendingRetention.name} | ${
                      pendingRetention.content.length > 200
                          ? `${pendingRetention.content.slice(0, 200)}…`
                          : pendingRetention.content}`,
                  choices: ['File it', 'Skip'],
                  selected: retentionChoice,
                  width: columns,
              })
            : null,
        React.createElement(Composer, {
            onSubmit: submit,
            // `busy` blocks the composer outright — only the email tone choice
            // does that now, because its arrow keys must not land in the
            // buffer. A running engine turn is `steering` instead: the input
            // stays live and Enter queues a mid-work note (see submit).
            busy: Boolean(pendingEmail || pendingRetention),
            steering: busy,
            click,
            skills: slashSkills,
        })
    );
}
