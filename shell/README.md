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
press it again to exit.** The conversation lives in your terminal's own
scrollback, so the mouse wheel works normally.

Type `/` to open the command palette. First-party commands:

- `/goal [text|status|clear]` — set, inspect, or clear a visible session-local goal.
- `/plan [task]` — ask the current engine for a plan under an isolated read-only
  sandbox with every configured MCP server and inherited apps/browser/hooks disabled.
- `/subagent <task>` — run a fresh isolated read-only engine session with inherited
  host-side tools disabled and ephemeral session persistence. The worker
  sees only its task and the active goal, not the parent transcript.
- `/help [command]` — show command behavior and limits.

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

## What phase 04-02 added

The **UI**, in `src/ui/`:

- `app.js` — the root component. All turn state lives here; everything else is
  presentational. It renders the event union below and nothing else.
- `Thinking.js` — concurrent factual activity plus the neutral working indicator.
- `Transcript.js` — committed history through a single `<Static>`.
- `Header.js` — the banner, and the compact header line.
- `StatusBar.js` — engine · model · user · vault · tokens.
- `Composer.js` — the input line.
- `theme.js` — the house palette, in one place.

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

## Permissions: the engine is sealed inside the vault

This is the §4 company-data boundary enforced at the engine, and it is the same
posture for every user.

Every invocation — turn 1 and every resume, built by one function so they cannot
drift — carries:

```
--json
--skip-git-repo-check
-c sandbox_mode="workspace-write"
-c sandbox_workspace_write.writable_roots=["<vault path>"]
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
seatbelt sandbox. Shell commands may run, but the kernel denies every read and
write outside the permitted roots and blocks network egress. That is a *stronger*
boundary than an allow-list of tool names, because the model cannot talk its way
past the kernel — no prompt injection, no clever rephrasing, no "the user said it
was fine."

### What was actually proven

Not asserted — tested, with the real engine:

| Test | Result |
|---|---|
| Write a file **inside** the vault | Succeeded |
| Write a file **outside** the vault and workspace (`$HOME`) | **Denied** — "outside the permitted writable project roots" |
| `curl https://example.com` | **Denied** — exit 6, DNS could not resolve |

The engine did run `/bin/zsh -lc` during the first test. That is the point: shell
ran, and the write outside the roots was still refused.

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
Pointing cwd at the vault would seal the sandbox correctly and orphan the
persona. The vault becomes writable through `writable_roots` instead.

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

## UI decisions worth knowing

**Perceived speed is a feature here, not polish.** Because there are no token
deltas, an answer lands all at once after a wait, and the *first* turn is the
slowest one in the product — nothing is cached until turn 2. So the shell always
shows an animated indicator with a running elapsed time, and the label is replaced
by the newest reasoning or tool line so the wait narrates itself. Without it a
perfectly healthy shell reads as hung on the very first thing a new user does.
`useAnimation` supplies both the spinner frame and the elapsed milliseconds, so
there is no manual timer to get wrong.

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
only thing on screen it anchors to the *top*, so on a short terminal the
wordmark and version border still paint from the top-left and it is the panel's
tail that clips, never its head.

**Known limitation:** there is no page-up browsing of what has left the screen —
the visible tail is all you can see. That includes a single reply taller than
the viewport, which shows its tail (as a terminal would); and at pathologically
small windows a partially clipped panel border can render imperfectly at the cut
line. The session JSONL log under `~/.sherman/sessions/` is the durable record
either way.

**The banner prints once, not pinned.** It is 18 lines. Pinning it would leave six
rows for the conversation on a 24-row terminal, so the full mark is the launch
moment and a single compact line stays in the chrome. `bin/sherman` deliberately
does *not* print the banner when handing off to the shell — the shell draws it —
or you would see it twice on every launch.

**The composer is hand-rolled** on `useInput`. Ink 7 ships no text input, and
`ink-text-input` only claims `ink>=5`. Bulk input is stripped of control
characters, because a paste arrives as one chunk and could otherwise carry CR/LF
straight into the prompt.

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
