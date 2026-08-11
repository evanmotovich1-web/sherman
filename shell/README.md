# The Sherman Shell

Sherman's own terminal UI. Our screen on top, the engine running headless
underneath.

Before this existed, `bin/sherman` ended in `exec codex` and you landed in
OpenAI's chrome — Sherman was branded up to the banner and unbranded after it.
Design doc §3c: like Hermes, Sherman owns the screen.

## Running it

```
sherman           the Sherman Shell — our UI, engine headless underneath
sherman --raw     exec the engine directly, its own chrome, for debugging
```

Inside the shell: type, Enter to send. **Ctrl+C interrupts the turn in flight;
press it again to exit.** Conversation history lives in the alternate-screen
viewport, not the terminal's scrollback, and the shell scrolls it itself:
**PgUp/PgDn** page and **shift+↑/↓** step a row, at any time, including while a
turn is running, and the **mouse wheel** does the same. While you are parked
above the tail the shell says so and says how far — `viewing history — N lines
below` — and new output keeps appending underneath without moving what you are
reading. Any submit snaps back to live.

**Clicking** the composer's input line places the caret at that column, clamped
to the text; typing then inserts there. Clicks anywhere else do nothing — there
are no invisible buttons. Mouse reporting (SGR 1006) is on only while the shell
is running and is disabled on every exit path, including faults and signals, on
the same discipline as the alternate-screen restore; smoke check 14 proves it.
Terminals that never send mouse reports are unaffected: not one keystroke is
handled differently.

Type `/` to open the command palette. First-party commands:

- `/goal [text|status|clear]` — set, inspect, or clear a visible session-local goal.
- `/plan [task]` — ask the current engine for a plan under an isolated read-only
  sandbox with every configured MCP server and inherited apps/browser/hooks disabled.
- `/subagent <task>` — run a fresh isolated read-only engine session with inherited
  host-side tools disabled and ephemeral session persistence. The worker
  sees only its task and the active goal, not the parent transcript.
- `/compact [focus]` — spend one read-only turn writing a handoff summary, then
  start a fresh engine thread carrying only that summary. The transcript keeps
  every line; the engine's context does not. The summary travels with the next
  request rather than as a turn of its own, and is spent exactly once.
- `/commons <subcommand>` — use the opt-in local Commons client. Enrollment
  tokens and proposal bodies are redacted before transcript/session logging;
  model-reachable MCP can create only pending intents; publication and adopted
  skill installation require separate local human commands. Metadata inventory
  is off by default; signed artifact publication, scanner-gated download, local
  quarantine/review, and owner-confirmed installation are separate stages. No
  network content auto-installs or executes. See `docs/COMMONS.md`.
- `/clear` — clear the transcript from the screen. The engine thread keeps its
  context (`/compact` is what resets it) and the session log keeps every line.
- `/help [command]` — show command behavior and limits.
- `/exit` — leave the shell by the same contract as the second ctrl+c: a
  session with turns in it is evaluated first (ctrl+c skips the eval), then
  the shell closes.

Compaction also runs on its own. When the engine's measured live context — the
same number the status meter prints, never an estimate and never the turn's
cumulative token bill — reaches 90% of the model's window, the shell announces
`context NN% · compacting automatically` and compacts at the turn boundary. An
unknown window shows no meter and never auto-compacts, and a summary that comes
back empty or interrupted leaves the thread intact rather than resetting context
that was never preserved.

The eval loop also runs on its own. Every 10 minutes, a session with new turns
since the last grading is judged by an isolated read-only worker — a fresh
engine session reading the session log, the same evidence the exit eval uses —
so drift is reported while there is still session left to correct it in. It
runs outside the turn machinery: the composer stays live, one judge runs at a
time, a tick that lands mid-turn skips rather than interleaving output, and an
idle session is never re-graded. The verdict commits to the transcript and the
log as a worker message.

Up/down selects a command and Tab completes it. Start with `//` to send a
literal slash-prefixed prompt.

Needs Node 22 or newer, and `./install.sh` to have installed the shell's
dependencies. If either is missing, `sherman` says so and stops — it does not
quietly fall back to the engine (see the UI decisions below).

## What phase 04-01 delivered

The **engine layer**, which 04-02's UI is built on.

- `src/engine/session.js` — the `EngineSession` contract and the normalized
  event stream. Engine-agnostic by rule.
- `src/engine/codex.js` — the real backend, driving Codex headless.
- `src/engine/claude.js` — a stub. Implements the full contract, reports that it
  is not built yet, points at `sherman --raw`.
- `src/engine/index.js` — backend selection from the config's `engine` field.
- `src/config.js` — reads `~/.sherman/config.json` (read-only; the wizard owns it).
- `bin/sherman-shell.js` — `--version`, `--help`, `--probe`.

## The UI today

Phase 04-02 established the UI layer. Its current inventory in `src/ui/` is:

- `app.js` — root state and orchestration for turns, commands, workers, usage,
  and transcript items.
- `LaunchScreen.js` — the truthful, content-hugging launch card.
- `Wordmark.js` — the full Sherman wordmark.
- `Mark.js` — the compact Sherman identity mark.
- `Transcript.js` — inset viewport history with compact signed responses.
- `Thinking.js` — concurrent factual lifecycle and tool activity.
- `StatusBar.js` — one-row state, engine/model, context, and goal summary.
- `Composer.js` — the borderless input and row-budgeted slash palette.
- `CommandMenu.js` — command suggestions, selection, and descriptions.
- `Header.js` — fallback renderer for legacy `banner` transcript items.
- `sanitize.js` — terminal-safe text normalization for displayed data.
- `theme.js` — the house palette in one place.

Plus the wire-up: `bin/sherman` execs the shell, `sherman --raw` execs the
engine, and `install.sh` installs the shell's dependencies.

The board view is still a later phase.

## The engine-layer harness

```
node shell/bin/sherman-shell.js --probe "Reply with exactly: PONG"
```

Several turns in one session, to exercise conversation memory:

```
node shell/bin/sherman-shell.js --probe "Remember the word BANANA." "What word did I ask you to remember?"
```

`--probe` prints normalized events with no UI in the way. It survives on purpose:
when the shell misbehaves, `--probe` tells you whether the engine layer or the
renderer is at fault. `--version` and `--probe` also load neither Ink nor React —
the UI is imported lazily — so they keep working on a machine that has never run
`npm install`, and a broken UI dependency cannot take down the tool you would use
to debug it.

## Transport: `codex exec --json`, not the app-server protocol

Two headless routes into Codex exist. We drive the CLI:

- Turn 1: `codex exec --json "<prompt>"`
- Every later turn: `codex exec resume <thread_id> --json "<prompt>"`

**The event stream** (real output, codex-cli 0.145.0):

```json
{"type":"thread.started","thread_id":"019f9ce8-af8b-71b3-bc72-41b2ca2d2bcb"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"PONG"}}
{"type":"turn.completed","usage":{"input_tokens":39245,"cached_input_tokens":19200,"cache_write_input_tokens":0,"output_tokens":128,"reasoning_output_tokens":79}}
```

Multi-turn genuinely works: resuming a thread and asking for a word established
in the previous turn returns it, with `cached_input_tokens: 19200` confirming the
prompt is being reused rather than resent cold. `turn.completed.usage` is where
the status bar's token count comes from — free, no extra accounting.

### The cost we accepted

**There is no token-level streaming on this transport.** A 128-token answer
arrived as one `item.completed`, roughly 5.5 seconds after `turn.started`. There
were no incremental deltas.

Streaming is therefore *item*-level, not *token*-level. In practice a multi-step
turn still fills the pane progressively, because reasoning summaries, tool calls
and messages each arrive as they complete. It is a single short answer that lands
all at once after a pause.

### Why not app-server, which does stream

`codex app-server` exposes a v2 JSON-RPC protocol that includes exactly what we
gave up:

```
AgentMessageDeltaNotification { delta, itemId, threadId, turnId }
```

That is true typewriter output. We did not take it because:

- It is marked `[experimental]`. The protocol can change on any `codex update`,
  and a v1 built on it means the whole shell breaks when it does.
- It carries 39+ message types and needs a JSON-RPC handshake that was never
  verified working, against a CLI surface that was verified working in minutes.
- Stability matters more than polish for a tool the company is meant to depend on.

**This is not a lock-in.** Swapping transports touches `src/engine/codex.js` and
no UI code — that is what `EngineSession` is for. If the missing typewriter
effect turns out to bother us more than the experimental risk, the swap is a
contained change.

Until then, 04-02's UI carries the perceived-responsiveness load: an activity
indicator and an elapsed timer, so a wait never reads as a dead screen.

### The context meter under this transport

`turn.completed.usage` is the only usage this transport carries. Re-verified
against codex-cli 0.145.0 by capturing a live turn: seven events, and only the
last had a `usage` key. `codex exec --help` exposes no usage-streaming flag, and
the `TokenUsageUpdatedNotification` present in the binary belongs to app-server,
not to `exec`.

So the meter would sit frozen on the previous turn's figure for the whole of a
long turn, which reads as a broken widget. It now shows a local estimate during
a turn — `~` on the figure and the percent, a lighter `▒` fill — built from the
characters actually sent and actually streamed back. See
`src/contextestimate.js` for why it is crude on purpose and why it understates.

**The estimate never reaches compaction — and neither does the bill.**
Compaction discards real conversation; doing that on a guessed number would
throw away context nobody measured. And `turn.completed` usage is not a
measurement of the thread: probed against codex 0.145.0, its `input_tokens` is
the SUM across every sub-request of the turn, so a healthy ~22k thread bills
109k for one three-command turn and a marathon agentic turn can bill several
times the window (the 576%-context incident) while codex keeps the live thread
comfortably inside it. The figure that IS the live context — `last_token_usage`,
with the model's real `model_context_window` — lives in the per-thread rollout
file under `$CODEX_HOME/sessions/`, so the backend tails it at each completed
item and at turn end and surfaces the measurement as normalized `context`
events. Only those events move the meter or arm `shouldAutoCompact` (mid-turn
measurements arm it early; the compaction turn still runs at the turn boundary,
the earliest safe point). Smoke check 18 pins the gate's arithmetic, and
`test/compact.test.js` pins that neither an estimate nor the bill ever compacts.

## Permissions: models read the vault but never author it directly

This is the §4 company-data boundary enforced at the engine, and it is the same
posture for every user.

Every invocation — turn 1 and every resume, built by one function so they cannot
drift — carries:

```
--json
--skip-git-repo-check
-c sandbox_mode="workspace-write"
-c approval_policy="never"
```

`--dangerously-bypass-approvals-and-sandbox` and
`--dangerously-bypass-hook-trust` are never passed. Adding either defeats
everything below.

### Why the OS sandbox instead of removing the shell tool

The instinct is to disable Codex's shell tool outright. That does not work, and
it is worth knowing why before someone tries it again.

On Codex, file read, search and write are delivered *through* the shell and
`apply_patch` tools. `shell_tool` is a real feature flag and can be turned off —
but doing so strips the capability Sherman actually needs, leaving an agent that
cannot read the vault at all. The requirement to allow file access inside the
vault and the requirement to forbid shell execution are, on this engine, in
direct conflict.

So the boundary is implemented where it is genuinely enforceable: the macOS
seatbelt sandbox. Shell commands may run and read the vault, but writes remain
inside the disposable workspace because the vault is not a writable root.
Authoritative `/learn` and `/wiki` writes bypass the model entirely and go
through the shell-owned deterministic validator and writer.

### What the tests pin

| Test | Result |
|---|---|
| Normal Codex posture adds the vault as `writable_roots` | **No** |
| Normal OpenCode file tools may edit the vault | **Denied** |
| OpenCode `apply_patch` move-path bypass is available | **Denied** |
| `/learn` or `/wiki` writes without a model turn | **Yes** |

Re-run these if you change any flag above. A posture claim that has not been
tested since the last change is not a posture claim.

## Two traps, both hit while building this

Documented so nobody rediscovers them the slow way.

**1. stdin must be ignored.** `codex exec` reads stdin whenever stdin is not a
TTY, and will sit there forever printing `Reading additional input from
stdin...`. From Node that means `stdio: ['ignore', 'pipe', 'pipe']`. Get this
wrong and you get a hung shell with no error message.

**2. `codex exec resume` takes a narrower flag set than `codex exec`.** It
rejects `-s/--sandbox`, `-C/--cd`, `--add-dir` and `-p/--profile`. It accepts
`-c`, `--enable/--disable`, `-m`, `--json`, `--skip-git-repo-check`.

The consequence is not cosmetic: pass the sandbox as `-s` and your posture is
correct on the first turn and **silently absent on every turn after it**. So all
posture travels as `-c` overrides, and the working directory comes from Node's
spawn `cwd` option rather than `-C`.

Validate any new `-c` key with `--strict-config`, which rejects unknown fields.
A bad key name fails immediately; a bad *value* also fails immediately and names
the valid options, which is a cheap way to check a key exists without spending a
model call.

**A related constraint:** cwd stays `~/.sherman/workspace`, because Codex reads
`AGENTS.md` from its cwd and that file is Sherman's assembled system prompt.
The workspace is model-writable; the vault is readable but not a model write
root. The shell owns every authoritative memory/wiki mutation.

## The contract 04-02 builds against

`EngineSession`:

| Member | Purpose |
|---|---|
| `get info()` | `{engine, model, user, vaultPath, threadId}` — the status bar |
| `send(text)` | one user turn; async-iterates normalized events |
| `interrupt()` | abort the in-flight turn; the session stays usable |
| `get usage()` | cumulative session token totals |
| `dispose()` | release resources; safe to call twice |

Normalized events — the only shapes a UI ever sees. Tool events cover command,
file-change, MCP, web-search, plan, and collaborative-agent activity with a
truthful outcome and measured duration when a start event existed:

| Event | Meaning |
|---|---|
| `{kind:'turn-start'}` | the engine began working |
| `{kind:'reasoning', text}` | thinking summary |
| `{kind:'message', text}` | assistant prose |
| `{kind:'tool', label}` | one line of tool activity, for progress |
| `{kind:'turn-end', usage}` | turn finished; `{input, cachedInput, output, reasoning, total}` |
| `{kind:'interrupted'}` | the turn was aborted by the user |
| `{kind:'error', message}` | something failed; message is written to be shown |

A UI written against this list must be unable to tell which engine answered. If
you find yourself wanting to leak an engine detail through, that detail belongs
in the backend.

Two deliberate robustness rules in the Codex backend, worth preserving:
unrecognized event types are ignored rather than thrown on, and malformed JSON
lines are skipped. The codex event set will grow; an unknown `type` must never
take the shell down.

`model` is a **display hint only**, read best-effort from Codex's own config so
the status bar shows the model you actually chose. The backend deliberately does
not pass `-m` to force one — hijacking a user's model choice to make a label
easier is not a trade worth making.

## Interrupts

Interrupting is just killing the turn's process. The thread survives, because
Codex persists it — so the next `send()` resumes the same conversation. That
falls out of the one-process-per-turn model for free, and it is the main
consolation for not having the app-server's protocol-level interrupt.

At the UI layer that becomes the two-stage Ctrl+C: `busy` is the entire state
machine. Interrupting clears it, so the next press falls through to exit — and
starting a new turn re-arms it, so a later Ctrl+C interrupts again rather than
quitting. Ink is started with `exitOnCtrlC: false`, or it would quit on the first
press before the app could abort anything.

Set `SHERMAN_MOTION=off` (or any explicit value other than `on`) to replace the
animated spinner with a static activity marker. The factual session clock still
refreshes once per second; reduced motion disables decorative motion, not truth.

## UI decisions worth knowing

**Perceived speed is a feature here, not polish.** Because there are no token
deltas, an answer lands all at once after a wait, and the *first* turn is the
slowest one in the product — nothing is cached until turn 2. At terminals with at
least two rows and nine columns, the one-row status rule shows an activity marker
with real elapsed time; factual reasoning and tool lines appear immediately above
it when space permits. During a silent turn the activity component renders no row,
so this status indicator intentionally carries the perceived-responsiveness burden.
Without that feedback a healthy shell reads as hung on the first thing a user does.

**Alternate screen, viewport transcript.** The shell runs on the terminal's
alternate screen buffer — the same switch that makes hermes, claude and codex
appear to take the screen over (the brief black flash on launch *is* the
switch; there is no splash animation). Ink enters it with `1049h` on start and
restores the primary buffer with `1049l` on exit, and the restore is registered
through signal-exit so it fires on **every** exit path — clean quit, double
Ctrl+C, a crash, an engine failure, SIGTERM — leaving the scrollback exactly as
it was. The escapes only emit when stdout is a real TTY, so piped runs (smoke,
CI) are unaffected. `--raw` is untouched: the engines manage their own screens.

Inside the alternate screen there is no scrollback to append into, so `<Static>`
is gone: history renders inside the viewport. Every turn stays in memory for
the session; the newest fill the screen and the oldest scroll out of the top
edge. The one anchoring exception is the launch moment: while the opener is the
only thing on screen it anchors to the *top*. `LaunchScreen` switches to its
compact summary before the opener would crowd the two-row persistent chrome;
only pathologically small windows may clip its tail.

Scrollback works by pushing that same content column past the bottom of the
clip with a negative margin, so the component tree is identical at every scroll
position — what you scroll back to is the frame that was rendered, never a
second, tidier rendering of the same events. The row count in the indicator is
Yoga's measurement of the content and the viewport, so it is a fact about the
screen rather than a model of it, and it clamps at the oldest row instead of
counting past it.

**Known limitations:** a single reply taller than the viewport still shows its
tail on arrival (as a terminal would) — scroll up to read it; and at
pathologically small windows a partially clipped panel border can render
imperfectly at the cut line. The session JSONL log under `~/.sherman/sessions/`
is the durable record either way.

Layout assumes East Asian Ambiguous glyphs such as `◆`, `◇`, and `●` render as
one terminal cell. Profiles configured to render ambiguous characters
double-width may wrap or misalign signature and status rows; Ink/string-width
fixtures cannot reproduce that terminal setting. The prompt glyph `❯` is East
Asian Neutral and is not part of this assumption.

**The banner prints once, not pinned.** It is the launch moment, and persistent
chrome is deliberately limited to two rows: one status rule plus one prompt row,
preserving the rest of the terminal for the transcript. Hermes informed this
footprint as prior art; it is not Sherman's sizing contract.
`bin/sherman` deliberately
does *not* print the banner when handing off to the shell — the shell draws it —
or you would see it twice on every launch.

**The composer is hand-rolled** on `useInput`. Ink 7 ships no text input, and
`ink-text-input` only claims `ink>=5`. At rest it is one borderless `❯` row so
persistent chrome leaves maximum room for the transcript; pasted multi-line input
grows only to its real content. Bulk input is
stripped of control characters because a paste arrives as one chunk and could
otherwise carry CR/LF straight into the prompt.

**Missing Node fails loudly.** If Node is absent, older than 22, or the
dependencies are not installed, `bin/sherman` explains and exits non-zero. It
never silently execs the engine instead: that would drop you into the engine's own
chrome while you believed you were in Sherman, which is the exact failure this
shell exists to remove. `--raw` remains available — the point is that you choose
it.

**Smoke drives `--raw` for the wizard checks.** The default handoff is now an
interactive Ink app, so piping stdin at `bin/sherman` would trip Ink's raw-mode
guard instead of testing the wizard. Checks 2 and 3 use `--raw`, which exercises
exactly what they are for: wizard → config → adapter → exec engine.
