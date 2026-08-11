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
    parseAgentMention,
    parseEmailResult,
    parseSubmission,
    planRequest,
    shouldAutoCompact,
    skillTurn,
    submissionRecordText,
    wikiAvailable,
    wikiCaptureRequest,
    wikiPreflight,
    workerRequest,
} from '../commands.js';
import { describe as describeConnectors } from '../connectors.js';
import { customizePet, writePetState } from '../petstate.js';
import { composeUrl, openNotice, openPath, openUrl } from '../browser.js';
import { appendEvalReport, ungradedSessions, writeRecommendation } from '../evalstore.js';
import { collectWinSources, renderWinHtml, winRequest, writeWinSite } from '../win.js';
import { runCommonsCommand } from '../commons/command.js';

// Monotonic ids. React list keys must be stable per item, and array index is
// not one — items keep their identity while the array in front of them grows.
let seq = 0;
const nextId = () => `i${seq++}`;

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
    subagent: 'agent',
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
    // Whether the LLM Wiki capture is available. null means "measure it"
    // (wikiAvailable reads the install off disk); tests inject true/false so
    // they exercise both worlds without provisioning a wiki.
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
    // Whether the LLM Wiki is installed, measured once at mount like the
    // registry — an install appearing mid-session is next launch's news. The
    // ran flag mirrors the eval booking: set before a capture turn starts, so
    // an interrupted capture does not re-run on the way out, and a manual
    // /wiki satisfies the exit capture the way a manual /eval satisfies the
    // exit eval.
    const [wikiOn] = useState(() => (wiki === null || wiki === undefined ? wikiAvailable() : Boolean(wiki)));
    // An explicit `wiki` prop is the caller overriding the machine probe, so
    // the deeper /wiki preflight is skipped for the same reason wikiAvailable
    // was: both are probes of the same installation, and a caller that has
    // asserted the answer is not asking.
    const wikiProbed = wiki === null || wiki === undefined;
    const wikiRanRef = useRef(false);

    const [busy, setBusy] = useState(false);
    const [activities, setActivities] = useState([]);
    const [lifecycle, setLifecycle] = useState(null);
    const [goal, setGoal] = useState('');
    const [pendingEmail, setPendingEmail] = useState(null);
    const [emailChoice, setEmailChoice] = useState(0);

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
    // report lands beside the verdict in ~/.sherman/evals/, and the PAIR —
    // recommendation plus the grade of the recommender — is filed by the
    // SHELL (never the judge) into vault/inbox/eval-recommendations/ where
    // the operator reviews it and sherman sync publishes it. Shared by every
    // eval path: exit, manual /eval, checkpoint, catch-up.
    //
    // Quiet about its own failure modes by the eval store's own contract: a
    // meta worker that dies still leaves the eval verdict filed, just
    // ungraded — the loop must never cost the verdict it exists to check.
    const runMetaEval = useCallback(
        async ({ evalText, target, logPath }) => {
            const request = metaEvalRequest(evalText, logPath);
            if (!request || !sessionFactory) {
                return writeRecommendation({
                    vaultPath: session.info.vaultPath, sessionId: target, evalText,
                });
            }
            commit('notice', 'meta eval · grading the eval itself · read-only worker');
            const worker = sessionFactory();
            let metaReply = '';
            try {
                for await (const event of worker.send(request)) {
                    if (event.kind === 'message') {
                        metaReply = metaReply ? `${metaReply}\n\n${event.text}` : event.text;
                    }
                    if (event.kind === 'error') {
                        commit('error', `meta eval failed: ${event.message}`);
                        metaReply = '';
                        break;
                    }
                }
                if (metaReply) {
                    commit('worker-message', metaReply);
                    log.append('worker', metaReply);
                    appendEvalReport(target, 'meta eval', metaReply);
                }
            } catch (err) {
                commit('error', `meta eval failed: ${err?.message ?? String(err)}`);
                metaReply = '';
            } finally {
                workerUsageRef.current = addUsage(workerUsageRef.current, worker.usage ?? emptyUsage());
                setUsage(addUsage(session.usage, workerUsageRef.current));
                worker.dispose();
            }
            const file = writeRecommendation({
                vaultPath: session.info.vaultPath, sessionId: target, evalText, metaText: metaReply,
            });
            commit('notice', file
                ? `recommendation filed under the vault inbox · review it there, publish with sherman sync`
                : 'recommendation could not be filed under the vault inbox — the verdict is still in ~/.sherman/evals/');
            return file;
        },
        [commit, log, session, sessionFactory]
    );

    // The newest submit, for the one command that recurses into it: /exit runs
    // the end-of-session eval as a real submission, and a callback cannot name
    // itself inside its own useCallback body.
    const submitRef = useRef(null);
    const submit = useCallback(
        async (text) => {
            let parsed = parseSubmission(text);
            // Submitting is a statement that you are done reading history: the
            // answer is going to arrive at the tail, so snap there rather than
            // leaving the operator parked above their own new turn.
            setScrollOffset(0);
            offsetRef.current = 0;
            const recordedText = submissionRecordText(text, parsed);
            commit('user', recordedText);
            log.append('user', recordedText);

            // Clear imperative email prose takes the same evidence-first route
            // as /email. Questions ABOUT writing email remain normal prompts.
            if (parsed.kind === 'prompt') {
                const instruction = naturalEmailInstruction(parsed.text);
                if (instruction) parsed = { kind: 'command', name: 'email', args: instruction };
            }

            // A leading @name is an agent call, resolved against the loaded
            // roster. A name the roster does not carry is answered with the
            // roster, not silently sent to the engine as a typo-shaped prompt.
            let agentCall = null;
            if (parsed.kind === 'prompt') {
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
                    const skillTag = 'skill'.padEnd(TRACE_TAG_WIDTH);
                    commit('tool', `📚 ${skillTag}  skills/${skill.name}/SKILL.md`, {
                        trace: {
                            glyph: '📚',
                            tag: skillTag,
                            label: `skills/${skill.name}/SKILL.md`,
                            outcome: '',
                            duration: '',
                        },
                    });
                    parsed = { kind: 'prompt', text: skillTurn(skill.name, parsed.args) };
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
                if (command.name === 'clear') {
                    // The screen, not the record: the engine thread keeps its
                    // context (/compact is what resets it) and the session log
                    // on disk keeps every line, including this command.
                    setItems([]);
                    commit('notice', 'transcript cleared · engine context unchanged — /compact is what resets context');
                    return;
                }
                if (command.name === 'exit') {
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
                    // The wiki capture rides the same exit, AFTER the
                    // judgment and as its own turn: the eval stays read-only
                    // (a judge that writes is grading a brain it is editing),
                    // and the capture writes only through the wiki's MCP.
                    // Each stage is separately interruptible, so ctrl+c
                    // still cannot trap the operator — it just skips stages
                    // one at a time.
                    if (wikiOn && turnsRef.current > 0 && !wikiRanRef.current && !log.failed) {
                        await submitRef.current('/wiki');
                    }
                    session.dispose();
                    exit();
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

            if (parsed.kind === 'command' && parsed.name === 'wiki') {
                if (!wikiOn) {
                    commit('error', 'The LLM Wiki is not installed on this machine — re-run install.sh to provision it.');
                    return;
                }
                // Before spending a turn: is the wiki actually reachable from
                // THIS engine? A broken venv or an unregistered codex MCP
                // entry would otherwise surface as one causeless line from
                // the model after a whole turn of discovering it.
                const preflight = wikiProbed
                    ? wikiPreflight({ engine: session.info.engine })
                    : { ok: true, reason: null };
                if (!preflight.ok) {
                    commit('error', `The LLM Wiki cannot capture: ${preflight.reason}.`);
                    return;
                }
                request = wikiCaptureRequest(log.path, goal);
                if (!request) {
                    commit('error', 'No session log to capture from.');
                    return;
                }
                // Booked before the turn runs, mirroring the eval: an
                // interrupted capture must not turn one exit into two, and a
                // deliberate manual capture satisfies the exit's.
                wikiRanRef.current = true;
                commit('notice', "wiki capture · folding this session's learnings into your LLM Wiki · ctrl+c to skip");
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

            // An @-mentioned agent is the /subagent contract with a specialty:
            // same isolation, same read-only sandbox, plus the roster harness
            // in front of the task.
            if (agentCall?.agent) {
                if (!sessionFactory) {
                    commit('error', 'This shell cannot create an isolated worker session.');
                    return;
                }
                engine = sessionFactory();
                request = agentRequest(agentCall.agent, agentCall.task, goal);
                messageKind = 'worker-message';
                isWorker = true;
                commit('notice', `@${agentCall.agent.name} · isolated · read-only · ${agentCall.agent.specialty}`);
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
            // The desktop pet mirrors the same transitions the busy indicator
            // does; no-op unless this machine adopted it (see petstate.js).
            writePetState('working');
            let turnFailed = false;
            clearLingerTimers();
            setActivities([]);
            setLifecycle(null);
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
                                evalReply = evalReply ? `${evalReply}\n\n${event.text}` : event.text;
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
                                commit('tool', traceLine(event), { trace: traceParts(event) });
                                writePetState('working', event.label);
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
                            break;

                        case 'interrupted':
                            commit('notice', 'interrupted');
                            break;

                        case 'error':
                            commit('error', event.message);
                            turnFailed = true;
                            writePetState('failed', event.message);
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
                // The loop on the loop: this verdict now gets graded, and the
                // recommendation-plus-grade pair is filed for review. Awaited,
                // so an exit's filing lands before the shell disposes.
                await runMetaEval({ evalText: evalReply, target: sessionId, logPath: log.path });
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

            if (autoCompactPercent !== null) {
                commit('notice', `context ${autoCompactPercent}% · compacting automatically`);
                await compactSession('');
            }
        },
        [carryOver, clearLingerTimers, commit, commonsCommand, compactSession, exit, goal, mouseEnabled, runMetaEval, runUpdate, session, sessionFactory, sessionId, setBusyBoth, log, wikiOn, slashSkills, atAgents]
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
        async ({ request, kind, target, notice, logPath = null }) => {
            const worker = sessionFactory();
            bgEvalWorkerRef.current = worker;
            commit('notice', notice);
            let verdict = '';
            try {
                for await (const event of worker.send(request)) {
                    if (event.kind === 'message') {
                        verdict = verdict ? `${verdict}\n\n${event.text}` : event.text;
                    }
                    if (event.kind === 'error') {
                        commit('error', `${kind} failed: ${event.message}`);
                        return;
                    }
                }
                if (verdict) {
                    commit('worker-message', verdict);
                    log.append('worker', verdict);
                    appendEvalReport(target, kind, verdict);
                }
            } catch (err) {
                commit('error', `${kind} failed: ${err?.message ?? String(err)}`);
                verdict = '';
            } finally {
                workerUsageRef.current = addUsage(workerUsageRef.current, worker.usage ?? emptyUsage());
                setUsage(addUsage(session.usage, workerUsageRef.current));
                worker.dispose();
                bgEvalWorkerRef.current = null;
            }
            // After the judge's worker is disposed, the meta-judge takes its
            // turn — the loop runs on every eval path, background ones
            // included, or the least-watched judges would be the least checked.
            if (verdict) {
                await runMetaEval({ evalText: verdict, target, logPath });
            }
        },
        [commit, log, runMetaEval, session, sessionFactory]
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
            lastEvalTurnRef.current = turnsRef.current;

            await gradeOnWorker({
                request,
                kind: 'checkpoint eval',
                target: sessionId,
                logPath: log.path,
                notice: 'checkpoint eval · background · read-only worker grading the session so far',
            });
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
                notice: `catch-up eval · session ${stale.id} ended without a verdict · grading it in the background`,
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

        if (busyRef.current) {
            activeSessionRef.current.interrupt();
            return;
        }

        // The end-of-session evaluation, run on the way out.
        //
        // Only when the session has UNJUDGED turns: launching the shell and
        // quitting has no conduct to grade, a just-graded session owes
        // nothing — and a session that kept working after a checkpoint still
        // owes its tail, which is why this gates on turn debt rather than on
        // whether any eval ever ran.
        //
        // The escape hatch is deliberate and load-bearing. The eval sets busy,
        // so the NEXT ctrl+c takes the interrupt branch above and stops it, and
        // the one after that exits — an eval can never trap the operator in a
        // shell they asked to leave. The /eval branch books the debt before
        // the turn starts rather than after it, so an interrupted eval does
        // not re-run on the way out and turn one exit into two.
        // The wiki capture owed on the way out, if any — mirrors the exit
        // command: after the eval, as its own interruptible turn. The /wiki
        // branch books wikiRanRef before its turn starts, so an interrupted
        // capture is skipped by the next ctrl+c rather than re-run by it.
        const wikiOwed = () =>
            wikiOn && turnsRef.current > 0 && !wikiRanRef.current && !log.failed;

        if (turnsRef.current > lastEvalTurnRef.current && !log.failed) {
            commit('notice', 'evaluating this session before exit · ctrl+c to skip');
            submit('/eval')
                .then(() => (wikiOwed() ? submit('/wiki') : null))
                .finally(() => {
                    session.dispose();
                    exit();
                });
            return;
        }

        if (wikiOwed()) {
            submit('/wiki').finally(() => {
                session.dispose();
                exit();
            });
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
        React.createElement(Composer, {
            onSubmit: submit,
            busy: busy || Boolean(pendingEmail),
            click,
            skills: slashSkills,
        })
    );
}
