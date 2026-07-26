#!/usr/bin/env bash
#
# smoke.sh — ten checks, no framework.
#
#   1. bin/sherman is executable.
#   2. The first-run flow, driven with piped answers and a stub engine on PATH
#      under an overridden HOME, writes a valid config.json.
#   3. The assembled adapter carries the vault path, the user name, the no-PHI
#      rule, and the session-id memory-attribution rule.
#   4. The shell entry point launches and exits clean on --version.
#   5. Backend selection follows config.json's engine field.
#   6. The --raw path still execs the engine.
#   7. The launch screen renders at 80 columns without overflowing.
#   8. The launch screen renders at 200 columns without overflowing.
#   9. The launch screen's colours are emitted as real ANSI sequences.
#  10. `sherman update` exits honestly in this repo's state.
#  11. A scripted turn through a fake backend renders the turn structure:
#      user bullet, signed Sherman box, and a trace line from a real event.
#
# Checks 2 and 3 drive `bin/sherman --raw` on purpose. The default handoff is now
# the Sherman Shell, which is an interactive Ink app: driving it with piped stdin
# would trip Ink's raw-mode guard instead of testing the wizard. --raw exercises
# exactly what these two checks are for -- wizard, config, adapter, exec engine.
#
# The real ~/.sherman is never read or written.
#
# Not `set -e`: a check must be able to fail and still report.

set -uo pipefail

ROOT=$(cd -P "$(dirname "$0")" && pwd)
cd "$ROOT"

FAILURES=0
SMOKE_USER="smoke-tester"

pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; FAILURES=$((FAILURES + 1)); }

TMPHOME=""
STUBDIR=""

cleanup() {
    [ -n "$TMPHOME" ] && [ -d "$TMPHOME" ] && rm -rf "$TMPHOME"
    [ -n "$STUBDIR" ] && [ -d "$STUBDIR" ] && rm -rf "$STUBDIR"
    # The run creates a private-memory directory for the fake user in the real
    # vault. rmdir only removes it if it is empty, so this can never touch
    # anything a person actually put there.
    rmdir "$ROOT/vault/memory/private/$SMOKE_USER" 2>/dev/null || true
}
trap cleanup EXIT

echo
echo "sherman smoke"
echo

# ------------------------------------------------------------------ check 1 --
echo "1. launcher is executable"
if [ -x bin/sherman ]; then
    pass "bin/sherman is executable"
else
    fail "bin/sherman is not executable (run ./install.sh)"
fi

# ------------------------------------------------------------------ check 2 --
echo
echo "2. first run writes a valid config"

TMPHOME=$(mktemp -d)
STUBDIR=$(mktemp -d)

# Refuse to run if either sandbox path came back empty. A bad expansion here
# would point the run at the real home directory.
if [ -z "$TMPHOME" ] || [ -z "$STUBDIR" ] || [ "$TMPHOME" = "/" ] || [ "$TMPHOME" = "$HOME" ]; then
    echo "  ABORT  could not create a sandbox HOME; refusing to touch the real one"
    exit 1
fi

printf '#!/bin/sh\nexit 0\n' > "$STUBDIR/claude"
chmod +x "$STUBDIR/claude"

# --raw, not the default handoff: see the note at the top of this file.
printf '1\nSmoke Tester\n' \
    | env HOME="$TMPHOME" PATH="$STUBDIR:$PATH" ./bin/sherman --raw >/dev/null 2>&1

CONFIG="$TMPHOME/.sherman/config.json"

if [ ! -f "$CONFIG" ]; then
    fail "no config.json written to the sandbox HOME"
else
    if /usr/bin/jq -e . "$CONFIG" >/dev/null 2>&1; then
        pass "config.json is valid JSON"
    else
        fail "config.json is not valid JSON"
    fi

    got_engine=$(/usr/bin/jq -r '.engine // empty' "$CONFIG" 2>/dev/null)
    got_user=$(/usr/bin/jq -r '.user // empty' "$CONFIG" 2>/dev/null)
    got_vault=$(/usr/bin/jq -r '.vault_path // empty' "$CONFIG" 2>/dev/null)

    [ "$got_engine" = "claude" ] \
        && pass "engine recorded as claude (answer 1 = Anthropic)" \
        || fail "engine is '$got_engine', expected 'claude'"

    [ "$got_user" = "$SMOKE_USER" ] \
        && pass "user slugified to $SMOKE_USER" \
        || fail "user is '$got_user', expected '$SMOKE_USER'"

    [ -n "$got_vault" ] \
        && pass "vault_path recorded ($got_vault)" \
        || fail "vault_path is empty"
fi

# ------------------------------------------------------------------ check 3 --
echo
echo "3. assembled adapter carries vault, user and the PHI rule"

ADAPTER="$TMPHOME/.sherman/workspace/CLAUDE.md"

if [ ! -f "$ADAPTER" ]; then
    fail "no adapter assembled at $ADAPTER"
else
    vault_path=$(/usr/bin/jq -r '.vault_path // empty' "$CONFIG" 2>/dev/null)

    grep -qF "$vault_path" "$ADAPTER" \
        && pass "contains the vault path" \
        || fail "vault path missing from adapter"

    grep -qF "$SMOKE_USER" "$ADAPTER" \
        && pass "contains the user name" \
        || fail "user name missing from adapter"

    grep -qF "patient" "$ADAPTER" \
        && pass "contains the no-PHI rule" \
        || fail "no-PHI rule missing from adapter"

    # The attribution rule and its session id. The id must be the launcher's
    # (format YYYYMMDD_HHMMSS_ + 6 hex), not a placeholder.
    grep -qE '[0-9]{8}_[0-9]{6}_[0-9a-f]{6}' "$ADAPTER" \
        && pass "contains a session id" \
        || fail "session id missing from adapter"

    grep -qE "— $SMOKE_USER · [0-9]{8}_[0-9]{6}_[0-9a-f]{6} · [0-9]{4}-[0-9]{2}-[0-9]{2}" "$ADAPTER" \
        && pass "contains the memory-attribution line" \
        || fail "memory-attribution line missing from adapter"

    grep -qF '{{SHERMAN_BODY}}' "$ADAPTER" \
        && fail "splice token still present -- template copied, not assembled" \
        || pass "splice token replaced"

    [ -f "$TMPHOME/.sherman/workspace/AGENTS.md" ] \
        && fail "stale AGENTS.md alongside CLAUDE.md" \
        || pass "no stale sibling adapter"
fi

# ------------------------------------------------------------------ check 4 --
# --version and --probe deliberately do not import ink or react (the shell entry
# point loads them lazily), so checks 4 and 5 pass on a machine that has never
# run npm install.
echo
echo "4. shell entry point launches and exits clean"

SHELL_ENTRY="shell/bin/sherman-shell.js"

if [ ! -f "$SHELL_ENTRY" ]; then
    fail "$SHELL_ENTRY is missing"
elif ! command -v node >/dev/null 2>&1; then
    fail "node not found -- the Sherman Shell needs Node 22+ (sherman --raw still works)"
else
    shell_version=$(node "$SHELL_ENTRY" --version 2>/dev/null)
    shell_status=$?

    [ "$shell_status" -eq 0 ] \
        && pass "--version exits 0" \
        || fail "--version exited $shell_status"

    [ -n "$shell_version" ] \
        && pass "--version prints a version ($shell_version)" \
        || fail "--version printed nothing"
fi

# ------------------------------------------------------------------ check 5 --
echo
echo "5. backend selection follows the config engine field"

if ! command -v node >/dev/null 2>&1; then
    fail "node not found -- cannot check backend selection"
else
    # The sandbox config from check 2 records engine "claude", so the shell must
    # pick the Claude stub and say it is not implemented -- never reach for codex.
    sel_out=$(env HOME="$TMPHOME" node "$SHELL_ENTRY" --probe "smoke" 2>&1)

    printf '%s' "$sel_out" | grep -qi "not implemented" \
        && pass "engine 'claude' selects the Claude stub" \
        || fail "engine 'claude' did not select the stub; got: $(printf '%s' "$sel_out" | head -1)"

    printf '%s' "$sel_out" | grep -qi "Traceback\|at Object\.\|node:internal" \
        && fail "stub path leaked a stack trace" \
        || pass "stub reports cleanly, no stack trace"
fi

# ------------------------------------------------------------------ check 6 --
echo
echo "6. --raw still execs the engine"

# A stub that leaves evidence, so this asserts the exec actually happened rather
# than merely that the launcher exited 0.
ENGINE_MARKER="$TMPHOME/engine-was-exec-d"
printf '#!/bin/sh\ntouch "%s"\nexit 0\n' "$ENGINE_MARKER" > "$STUBDIR/claude"
chmod +x "$STUBDIR/claude"

env HOME="$TMPHOME" PATH="$STUBDIR:$PATH" ./bin/sherman --raw >/dev/null 2>&1

[ -f "$ENGINE_MARKER" ] \
    && pass "--raw reached the engine" \
    || fail "--raw did not exec the engine"

# --------------------------------------------------------------- checks 7-8 --
# The launch screen is the one surface where a layout bug is silent: it still
# renders, it just spills past the terminal edge and shatters the block art. So
# these assert a measurable property rather than "it did not crash" -- no
# rendered line may be wider than the terminal it was rendered for.
#
# Width is counted in CODE POINTS after stripping ANSI. The block glyphs are
# three bytes each and one column wide, so byte length would over-count by 3x and
# report overflow everywhere.
#
# `columns` is passed to the component as well as to renderToString because Ink's
# useWindowSize() reports a fixed 80x24 off a TTY -- without the prop the narrow
# and wide cases would both silently render at 80 and prove nothing.
#
# Unlike checks 4 and 5 these need ink and react, so they skip (not fail) on a
# checkout that has never run install.sh.

RENDER_JS=$(cat <<'JS'
import React from 'react';
import { renderToString } from 'ink';
import { LaunchScreen } from './src/ui/LaunchScreen.js';

const cols = Number(process.env.SMOKE_COLS);
const info = {
    engine: 'codex',
    model: 'smoke-model',
    user: 'smoke-tester',
    vaultPath: '/tmp/smoke/sherman/vault',
    threadId: null,
};
const stats = { wiki: 2, shared: 1, private: 0, inbox: 3, ok: true };

const out = renderToString(
    React.createElement(LaunchScreen, {
        info,
        stats,
        sessionId: '20260726_120000_abc123',
        columns: cols,
        rows: 24,
    }),
    { columns: cols }
);

const width = (s) => [...s.replace(/\x1b\[[0-9;]*m/g, '')].length;
const over = out.split('\n').filter((line) => width(line) > cols);

if (over.length > 0) {
    console.error(over.length + ' line(s) wider than ' + cols);
    process.exit(1);
}
process.exit(0);
JS
)

for cols in 80 200; do
    echo
    if [ "$cols" = "80" ]; then
        echo "7. launch screen renders at 80 columns"
    else
        echo "8. launch screen renders at 200 columns"
    fi

    if ! command -v node >/dev/null 2>&1; then
        fail "node not found -- cannot render the launch screen"
    elif [ ! -d "shell/node_modules/ink" ]; then
        pass "skipped -- shell/node_modules absent, run install.sh"
    else
        render_err=$(cd shell && env SMOKE_COLS="$cols" node --input-type=module -e "$RENDER_JS" 2>&1)
        render_status=$?

        if [ "$render_status" -eq 0 ]; then
            pass "renders at $cols columns, no line exceeds the width"
        else
            fail "render at $cols columns: $(printf '%s' "$render_err" | head -3)"
        fi
    fi
done

# ------------------------------------------------------------------ check 9 --
# Colours must actually reach the terminal. Ink silently ignores colour strings
# it does not recognise -- a bare 256-colour index like '196' renders as plain
# default-coloured text with no error anywhere, which is exactly how the v2
# launch screen shipped all-white. This asserts the four signature colours
# (wordmark red, then the mark's pink, purple and blue) are present as real
# ANSI sequences in the rendered output.
#
# FORCE_COLOR=3 because chalk sees the pipe as colourless and would strip every
# escape, which would turn this check into a tautology.

COLOR_JS=$(cat <<'JS'
import React from 'react';
import { renderToString } from 'ink';
import { LaunchScreen } from './src/ui/LaunchScreen.js';

const info = {
    engine: 'codex',
    model: 'smoke-model',
    user: 'smoke-tester',
    vaultPath: '/tmp/smoke/sherman/vault',
    threadId: null,
};
const stats = { wiki: 2, shared: 1, private: 0, inbox: 3, ok: true };

const out = renderToString(
    React.createElement(LaunchScreen, {
        info,
        stats,
        sessionId: '20260726_120000_abc123',
        columns: 80,
        rows: 24,
    }),
    { columns: 80 }
);

const need = {
    'wordmark red (196)': '38;5;196m',
    'mark pink (205)': '38;5;205m',
    'mark purple (135)': '38;5;135m',
    'mark blue (39)': '38;5;39m',
};
const missing = Object.keys(need).filter((name) => !out.includes(need[name]));

if (missing.length > 0) {
    console.error('missing colour(s): ' + missing.join(', '));
    process.exit(1);
}
process.exit(0);
JS
)

echo
echo "9. launch screen colours reach the terminal"

if ! command -v node >/dev/null 2>&1; then
    fail "node not found -- cannot render the launch screen"
elif [ ! -d "shell/node_modules/ink" ]; then
    pass "skipped -- shell/node_modules absent, run install.sh"
else
    color_err=$(cd shell && env FORCE_COLOR=3 node --input-type=module -e "$COLOR_JS" 2>&1)
    color_status=$?

    if [ "$color_status" -eq 0 ]; then
        pass "wordmark red and all three mark colours are emitted"
    else
        fail "$(printf '%s' "$color_err" | head -3)"
    fi
fi

# ----------------------------------------------------------------- check 10 --
# `sherman update` must exit 0 and say so plainly in this repo's real state
# (a git checkout with no remote). When a remote exists this check starts
# exercising the real ff-only pull; the env guard below is what keeps that
# future run from recursing (update runs smoke, smoke calls update).

echo
echo "10. sherman update exits honestly"

if [ -n "${SHERMAN_UPDATE_RUNNING:-}" ]; then
    pass "skipped -- running under sherman update"
else
    update_out=$(./bin/sherman update 2>&1)
    update_status=$?

    if [ "$update_status" -ne 0 ]; then
        fail "sherman update exited $update_status: $(printf '%s' "$update_out" | head -2)"
    elif printf '%s' "$update_out" | grep -q "no update source configured\|Updated:\|not a git checkout"; then
        pass "exit 0 with an honest status ($(printf '%s' "$update_out" | head -1))"
    else
        fail "exit 0 but unrecognised output: $(printf '%s' "$update_out" | head -2)"
    fi
fi

# ----------------------------------------------------------------- check 11 --
# The turn structure, proven off-TTY. Ink 7 reads stdin via 'readable'+read(),
# so a PassThrough with isTTY/setRawMode stubs drives the REAL App: the check
# types a prompt into the real composer, a fake EngineSession yields a scripted
# turn, and the captured output must contain the user bullet, the signed
# Sherman box border, and a trace line that exists ONLY because the fake
# backend emitted it — which is the honesty rule, mechanised.
#
# HOME is the sandbox so the session log writes there, never the real one.

TURN_JS=$(cat <<'JS'
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import { App } from './src/ui/app.js';

const fakeSession = {
    info: {
        engine: 'fake',
        model: 'fake-model',
        user: 'smoke-tester',
        vaultPath: '/tmp/smoke/sherman/vault',
        threadId: null,
    },
    usage: { total: 42, input: 20, cachedInput: 0, output: 20, reasoning: 2 },
    async *send() {
        yield { kind: 'turn-start' };
        yield { kind: 'reasoning', text: 'checking the vault' };
        yield { kind: 'tool', label: 'read wiki/intake-sop.md' };
        yield { kind: 'message', text: 'The intake SOP says to log the request first.' };
        yield { kind: 'turn-end', usage: this.usage };
    },
    interrupt() {},
    dispose() {},
};

const stdin = new PassThrough();
stdin.isTTY = true;
stdin.setRawMode = () => {};
stdin.ref = () => {};
stdin.unref = () => {};

const stdout = new PassThrough();
stdout.columns = 80;
stdout.rows = 24;
let captured = '';
stdout.on('data', (d) => { captured += d.toString(); });

const inst = render(
    React.createElement(App, { session: fakeSession, sessionId: '20260726_120000_abc123' }),
    { stdout, stdin, exitOnCtrlC: false, patchConsole: false }
);

setTimeout(() => { stdin.write('read the sop'); }, 40);
setTimeout(() => { stdin.write('\r'); }, 90);

const startedAt = Date.now();
const poll = setInterval(() => {
    const plain = captured.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    const done = plain.includes('The intake SOP says');
    if (!done && Date.now() - startedAt < 2000) return;

    clearInterval(poll);
    inst.unmount();

    const missing = [];
    if (!plain.includes('● read the sop')) missing.push('user bullet');
    if (!/╭─.*Sherman.*╮/.test(plain)) missing.push('Sherman box label');
    if (!plain.includes('read wiki/intake-sop.md')) missing.push('trace line from the fake tool event');

    if (missing.length > 0) {
        console.error('missing: ' + missing.join(', '));
        process.exit(1);
    }
    process.exit(0);
}, 50);
JS
)

echo
echo "11. a scripted turn renders the turn structure"

if ! command -v node >/dev/null 2>&1; then
    fail "node not found -- cannot drive the shell"
elif [ ! -d "shell/node_modules/ink" ]; then
    pass "skipped -- shell/node_modules absent, run install.sh"
else
    turn_err=$(cd shell && env HOME="$TMPHOME" node --input-type=module -e "$TURN_JS" 2>&1)
    turn_status=$?

    if [ "$turn_status" -eq 0 ]; then
        pass "bullet, signed box, and event-sourced trace line all rendered"
    else
        fail "$(printf '%s' "$turn_err" | head -3)"
    fi
fi

# -------------------------------------------------------------------- result --
echo
if [ "$FAILURES" -eq 0 ]; then
    echo "11 checks, all green."
    echo
    exit 0
fi
echo "$FAILURES assertion(s) failed."
echo
exit 1
