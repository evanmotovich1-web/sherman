#!/usr/bin/env bash
#
# smoke.sh — thirteen checks, no framework.
#
#   1. bin/sherman is executable.
#   2. The first-run flow, driven with piped answers and a stub engine on PATH
#      under an overridden HOME, writes a valid config.json.
#   3. The assembled adapter carries the vault path, the user name, the no-PHI
#      rule, and the session-id memory-attribution rule.
#   4. The shell entry point launches and exits clean on --version.
#   5. Backend selection follows config.json's engine field.
#   6. The --raw path still execs the engine.
#   7. The launch screen crosses its compact/full boundary at 80 columns, no overflow.
#   8. The launch screen crosses its compact/full boundary at 200 columns, no overflow.
#   9. The launch screen's colours are emitted as real ANSI sequences.
#  10. `sherman update` exits honestly in this repo's state.
#  11. A scripted turn through a fake backend renders the prompt marker,
#      signed reply, factual trace, composer placeholder, and persistent status.
#  12. A real codex reasoning payload renders as an explicit purple summary line.
#  13. The Sherman Shell node:test suite passes.
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

PASSES=0
SKIPPED=0
FAILURES=0
TOTAL_CHECKS=13
SMOKE_USER="smoke-tester"

pass() { echo "  PASS  $*"; PASSES=$((PASSES + 1)); }
skip() { echo "  SKIP  $*"; SKIPPED=$((SKIPPED + 1)); }
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

    if [ -z "$vault_path" ]; then
        fail "vault_path empty"
    elif grep -qF "$vault_path" "$ADAPTER"; then
        pass "contains the vault path"
    else
        fail "vault path missing from adapter"
    fi

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

    if [ -z "$sel_out" ]; then
        fail "engine probe produced no output"
    elif printf '%s' "$sel_out" | grep -qi "Traceback\|at Object\.\|node:internal"; then
        fail "stub path leaked a stack trace"
    else
        pass "stub reports cleanly, no stack trace"
    fi
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
# Unlike checks 4 and 5 these need ink and react. A missing installation is
# reported as SKIP and makes the commit gate fail unless explicitly allowed.

RENDER_JS=$(cat <<'JS'
import React from 'react';
import { renderToString } from 'ink';
import { LaunchScreen } from './src/ui/LaunchScreen.js';

const cols = Number(process.env.SMOKE_COLS);
// Exercise the real layout boundary at every width: 28 rows uses CompactSummary;
// 29 rows uses the full launch panel. Both must remain within the terminal.
const ROWS = [28, 29];
const info = {
    engine: 'codex',
    model: 'smoke-model',
    user: 'smoke-tester',
    vaultPath: '/tmp/smoke/sherman/vault',
    threadId: null,
};
const stats = { wiki: 2, shared: 1, private: 0, inbox: 3, ok: true };

const width = (s) => [...s.replace(/\x1b\[[0-9;]*m/g, '')].length;
// NOTE: no apostrophes in this heredoc -- bash 3.2 tracks quotes inside
// $( ) command substitution and an unbalanced one breaks the parse.
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

const fullPanelModes = [];

for (const rows of ROWS) {
    const out = renderToString(
        React.createElement(LaunchScreen, {
            info,
            stats,
            sessionId: '20260726_120000_abc123',
            columns: cols,
            rows,
        }),
        { columns: cols }
    );

    const lines = out.split('\n');
    const over = lines.filter((line) => width(line) > cols);

    if (over.length > 0) {
        console.error(over.length + ' line(s) wider than ' + cols + ' at ' + rows + ' rows');
        process.exit(1);
    }

    // v3 full-bleed: the panel top border must span the full render width.
    const plain = lines.map(strip);
    const top = plain.findIndex((l) => l.startsWith('╭─') && l.trimEnd().endsWith('╮'));
    if (top < 0) {
        console.error('panel top border not found at ' + rows + ' rows');
        process.exit(1);
    }
    if (width(plain[top].trimEnd()) !== cols) {
        console.error(
            'panel border is ' + width(plain[top].trimEnd()) + ' cols, expected ' + cols
        );
        process.exit(1);
    }

    const bottom = plain.findIndex((l, i) => i > top && l.startsWith('╰'));
    if (bottom < 0) {
        console.error('panel bottom border not found at ' + rows + ' rows');
        process.exit(1);
    }
    fullPanelModes.push(plain.some((line) => line.includes('│                  Vault')));
}

if (fullPanelModes[0] || !fullPanelModes[1]) {
    console.error('launch did not cross compact/full boundary between 28 and 29 rows');
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
        skip "shell/node_modules absent, run install.sh"
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
# launch screen shipped all-white. This asserts the three signature colours
# (brand pink, purple and blue) are present as real ANSI sequences in the
# rendered output, and the retired red ramp is absent.
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
    'brand pink (205)': '38;5;205m',
    'brand purple (135)': '38;5;135m',
    'brand blue (39)': '38;5;39m',
};
const missing = Object.keys(need).filter((name) => !out.includes(need[name]));
const retired = {
    'old red (196)': '38;5;196m',
    'old deep red (160)': '38;5;160m',
    'old frame red (124)': '38;5;124m',
};
const present = Object.keys(retired).filter((name) => out.includes(retired[name]));

if (missing.length > 0 || present.length > 0) {
    if (missing.length > 0) console.error('missing colour(s): ' + missing.join(', '));
    if (present.length > 0) console.error('retired colour(s) still present: ' + present.join(', '));
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
    skip "shell/node_modules absent, run install.sh"
else
    color_err=$(cd shell && env FORCE_COLOR=3 node --input-type=module -e "$COLOR_JS" 2>&1)
    color_status=$?

    if [ "$color_status" -eq 0 ]; then
        pass "pink, purple and blue are emitted; retired red ramp is absent"
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
# turn, and the final rendered screen must contain the prompt marker, signed
# Sherman reply, completed trace line that exists ONLY because the fake backend
# emitted it, composer placeholder, and persistent status. Off a TTY Ink defers the
# viewport frame until unmount, so the check waits for the scripted turn to
# finish, unmounts, then asserts on the capture. It also passes the same
# alternateScreen option the real entry point uses and asserts the 1049 escapes
# never reach piped output -- the alt screen is a TTY-only behavior.
#
# HOME is the sandbox so the session log writes there, never the real one.

TURN_JS=$(cat <<'JS'
import React from 'react';
import { render, renderToString } from 'ink';
import { PassThrough } from 'node:stream';
import { App } from './src/ui/app.js';
import { Composer } from './src/ui/Composer.js';
import { LaunchScreen } from './src/ui/LaunchScreen.js';
import { StatusBar } from './src/ui/StatusBar.js';
import { Transcript } from './src/ui/Transcript.js';
import { CodexSession } from './src/engine/codex.js';

const mapper = new CodexSession({
    engine: 'codex',
    user: 'smoke-tester',
    vaultPath: '/tmp/smoke/vault',
    workspacePath: '/tmp/smoke/workspace',
});
const map = (type, item) => mapper._mapLine(JSON.stringify({ type, item }));
const readStart = map('item.started', {
    id: 'read-1', type: 'command_execution',
    command: "/bin/zsh -lc 'cat input.txt'", status: 'in_progress',
});
const readDone = map('item.completed', {
    id: 'read-1', type: 'command_execution',
    status: 'completed', exit_code: 0,
});
const sedStart = map('item.started', {
    id: 'read-2', type: 'command_execution',
    command: `/bin/zsh -lc "sed -n '1p' input.txt"`, status: 'in_progress',
});
map('item.completed', {
    id: 'read-2', type: 'command_execution',
    command: `/bin/zsh -lc "sed -n '1p' input.txt"`, status: 'completed', exit_code: 0,
});
const sedEditStart = map('item.started', {
    id: 'exec-1', type: 'command_execution',
    command: `/bin/zsh -lc "sed -i '' 's/a/b/' input.txt"`, status: 'in_progress',
});
map('item.completed', {
    id: 'exec-1', type: 'command_execution',
    command: `/bin/zsh -lc "sed -i '' 's/a/b/' input.txt"`, status: 'completed', exit_code: 0,
});
const uncertainSedStarts = [
    `sed -i'' 's/a/b/' input.txt`,
    `sed -i.bak 's/a/b/' input.txt`,
    `sed --in-place 's/a/b/' input.txt`,
    `sed -n '1w output.txt' input.txt`,
].map((command, index) => {
    const id = `sed-uncertain-${index}`;
    const [start] = map('item.started', {
        id, type: 'command_execution', command, status: 'in_progress',
    });
    map('item.completed', {
        id, type: 'command_execution', command, status: 'completed', exit_code: 0,
    });
    return start;
});
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const controlStart = map('item.started', {
    id: 'exec-2', type: 'command_execution',
    command: `/bin/zsh -lc 'printf ${ESC}[31mBAD'`, status: 'in_progress',
});
map('item.completed', {
    id: 'exec-2', type: 'command_execution',
    command: `/bin/zsh -lc 'printf ${ESC}[31mBAD'`, status: 'completed', exit_code: 0,
});
const patchStart = map('item.started', {
    id: 'patch-1', type: 'file_change',
    changes: [{ path: `/tmp/smoke/workspace/${ESC}]0;pwn${BEL}output.txt`, kind: 'add' }],
    status: 'in_progress',
});
const patchDone = map('item.completed', {
    id: 'patch-1', type: 'file_change',
    changes: [{ path: `/tmp/smoke/workspace/${ESC}]0;pwn${BEL}output.txt`, kind: 'add' }],
    status: 'completed',
});
const unknown = map('item.completed', { id: 'future-1', type: 'future_item' });

const mappingMissing = [];
if (readStart[0]?.phase !== 'started' || readStart[0]?.label !== 'read input.txt') {
    mappingMissing.push('Codex read start mapping');
}
if (
    readDone[0]?.phase !== 'completed' ||
    readDone[0]?.label !== 'read input.txt' ||
    typeof readDone[0]?.durationMs !== 'number'
) {
    mappingMissing.push('Codex read completion duration');
}
if (!sedStart[0]?.label?.startsWith('exec sed -n')) {
    mappingMissing.push('uncertain sed remains an exec');
}
if (!sedEditStart[0]?.label?.startsWith('exec sed -i')) {
    mappingMissing.push('mutating sed remains an exec');
}
if (uncertainSedStarts.some((event) => !event?.label?.startsWith('exec sed'))) {
    mappingMissing.push('all unproven sed forms remain exec');
}
if (/[\x00-\x1f\x7f-\x9f]/.test(controlStart[0]?.label ?? '')) {
    mappingMissing.push('tool label control-character stripping');
}
if (patchStart[0]?.phase !== 'started' || patchStart[0]?.label !== 'patch output.txt') {
    mappingMissing.push('Codex patch start mapping');
}
if (patchDone[0]?.phase !== 'completed' || typeof patchDone[0]?.durationMs !== 'number') {
    mappingMissing.push('Codex patch completion duration');
}
if (unknown.length !== 0) mappingMissing.push('unknown Codex item silence');

const composerPlain = renderToString(
    React.createElement(Composer, { onSubmit() {}, busy: false }),
    { columns: 80 }
).replace(/\x1b\[[0-9;]*m/g, '');
const meterPlain = renderToString(
    React.createElement(StatusBar, {
        info: { engine: 'fake', model: 'fake-model', contextWindow: 272000 },
        usage: { total: 68042 },
        contextUsed: 68000,
        busy: false,
        columns: 80,
    }),
    { columns: 80 }
).replace(/\x1b\[[0-9;]*m/g, '');
if (!meterPlain.includes('68.0k/272.0k') || !meterPlain.includes('25%')) {
    mappingMissing.push('real context meter');
}

const visualWidth = (line) => [...line.replace(/\x1b\[[0-9;]*m/g, '')].length;
const maxWidth = (out) => Math.max(...out.split('\n').map(visualWidth));
const narrowInfo = {
    engine: 'codex', model: 'smoke-model', user: 'smoke-tester',
    vaultPath: '/tmp/smoke/vault', threadId: null,
};
const narrowStats = { wiki: 1, shared: 1, private: 0, inbox: 0, ok: true };
for (const columns of [19, 20]) {
    const launch = renderToString(
        React.createElement(LaunchScreen, {
            info: narrowInfo, stats: narrowStats, sessionId: 'smoke-session', columns,
        }),
        { columns }
    );
    if (maxWidth(launch) > columns) mappingMissing.push(`launch overflow at ${columns} columns`);
}
const narrowReplyInput = '0123456789'.repeat(20);
const narrowReply = renderToString(
    React.createElement(Transcript, {
        items: [{ id: 'narrow-reply', kind: 'message', text: narrowReplyInput }],
        columns: 3,
    }),
    { columns: 3 }
);
if (maxWidth(narrowReply) > 3) mappingMissing.push('reply overflow below four columns');

const fullReplyLines = renderToString(
    React.createElement(Transcript, {
        items: [{ id: 'full-reply', kind: 'message', text: 'reply body' }], columns: 80,
    }),
    { columns: 80 }
).replace(/\x1b\[[0-9;]*m/g, '').split('\n');
// 80 columns, one gutter column each side => a 78-cell reply box. The
// signature is embedded in the top border one dash in, the body sits inside
// the side borders, and the bottom border replaces the old trailing blank row
// as the thing that terminates the reply.
if (
    fullReplyLines.length !== 3 ||
    fullReplyLines[0] !== ' ╭─ Sherman ' + '─'.repeat(66) + '╮' ||
    fullReplyLines[1] !== ' │ reply body' + ' '.repeat(65) + '│' ||
    fullReplyLines[2] !== ' ╰' + '─'.repeat(76) + '╯'
) {
    mappingMissing.push('signed Sherman reply geometry and trailing rhythm');
}

const longReplyInput = '0123456789'.repeat(20);
const longReplyLines = renderToString(
    React.createElement(Transcript, {
        items: [{ id: 'long-reply', kind: 'message', text: longReplyInput }],
        columns: 80,
    }),
    { columns: 80 }
).replace(/\x1b\[[0-9;]*m/g, '').split('\n');
const longBodyLines = longReplyLines.slice(1, -1);
// Body rows now live inside the box: gutter, '│', one padding space, the
// wrapped chunk, padding out to the closing '│'. Every row is exactly the
// 79 cells of gutter + box, and the chunks still reassemble the input.
if (
    longBodyLines.length < 3 ||
    longBodyLines.some((line) => !line.startsWith(' │ ')) ||
    longBodyLines.some((line) => !line.endsWith('│')) ||
    longBodyLines.some((line) => [...line].length !== 79) ||
    longBodyLines.map((line) => line.slice(3).replace(/ *│$/, '')).join('') !== longReplyInput
) {
    mappingMissing.push('long Sherman reply wraps without overflow or dropped text');
}
// The composer is a full-width rounded box now: ╭─…─╮ / │ ❯ … │ / ╰─…─╯, with
// the prompt gutter, the input and the placeholder all inside it.
const composerLines = composerPlain.split('\n');
if (
    composerLines.length !== 3 ||
    !/^╭─+╮$/.test(composerLines[0]) ||
    !/^│ ❯ Ask about company operations… +│$/.test(composerLines[1]) ||
    !/^╰─+╯$/.test(composerLines[2]) ||
    maxWidth(composerPlain) !== 80
) {
    mappingMissing.push('rounded full-width composer box with the placeholder inside it');
}

const narrowComposer = renderToString(
    React.createElement(Composer, { onSubmit() {}, busy: false, columns: 3 }),
    { columns: 3 }
);
if (maxWidth(narrowComposer) > 3) mappingMissing.push('composer overflow below four columns');

const sent = [];
let turnComplete = false;
const fakeSession = {
    info: {
        engine: 'fake',
        model: 'fake-model',
        contextWindow: 272000,
        user: 'smoke-tester',
        vaultPath: '/tmp/smoke/sherman/vault',
        threadId: null,
    },
    usage: { total: 68042, input: 68000, cachedInput: 0, output: 40, reasoning: 2 },
    async *send(text) {
        sent.push(text);
        yield { kind: 'turn-start' };
        yield { kind: 'reasoning', text: 'checking the vault' };
        yield { kind: 'tool', id: 'tool-1', phase: 'started', glyph: '›', label: 'patch smoke.sh' };
        yield { kind: 'tool', id: 'tool-1', phase: 'completed', glyph: '›', label: 'patch smoke.sh', durationMs: 900 };
        yield {
            kind: 'message',
            text: `The intake SOP says${ESC}]0;pwn${BEL}${ESC}[31m to log the request first.`,
        };
        yield { kind: 'turn-end', usage: this.usage };
        turnComplete = true;
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
stdout.rows = 40;
let captured = '';
stdout.on('data', (d) => { captured += d.toString(); });

// alternateScreen mirrors bin/sherman-shell.js. Ink must resolve it OFF here,
// because this stdout is a pipe -- the leak assertion below proves it does.
const inst = render(
    React.createElement(App, { session: fakeSession, sessionId: '20260726_120000_abc123' }),
    { stdout, stdin, exitOnCtrlC: false, patchConsole: false, alternateScreen: true, debug: true }
);

let draftEchoedBeforeSubmit = false;
setTimeout(() => { stdin.write('read\nthe sop'); }, 40);
const draftStartedAt = Date.now();
const draftPoll = setInterval(() => {
    const frame = captured.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    draftEchoedBeforeSubmit = draftEchoedBeforeSubmit || (sent.length === 0
        && frame.includes('read')
        && frame.includes('❯ the sop'));
    if (draftEchoedBeforeSubmit || Date.now() - draftStartedAt >= 500) {
        clearInterval(draftPoll);
        stdin.write('\r');
    }
}, 10);

const startedAt = Date.now();
const poll = setInterval(() => {
    if (!turnComplete && Date.now() - startedAt < 2000) return;
    clearInterval(poll);

    // Off a TTY Ink writes the viewport frame only at unmount. Give React one
    // beat to commit the completed turn, unmount, give the final write one
    // beat to land in the capture, then assert on the rendered screen.
    setTimeout(() => {
        inst.unmount();
        setTimeout(() => {
            const plain = captured.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

            const missing = [...mappingMissing];
            if (!plain.includes('The intake SOP says')) missing.push('Sherman reply text');
            if (!draftEchoedBeforeSubmit) missing.push('composer echoes draft before submission');
            if (sent.length !== 1 || sent[0] !== 'read\nthe sop') {
                missing.push('multi-line paste preserved until Enter');
            }
            // The signature is ON the border now, not on a row of its own: the
            // top border row must literally read ╭─ Sherman ───…───╮.
            if (!/╭─ Sherman ─+╮/.test(plain)) missing.push('Sherman reply label');
            if (!plain.includes('› patch smoke.sh  0.9s')) missing.push('completed trace line with duration');

            // The raw capture, not the stripped one: 1049h/1049l anywhere in
            // piped output means the alt screen leaked off-TTY.
            if (captured.includes(ESC + '[?1049')) {
                missing.push('alt-screen escapes leaked into piped output');
            }
            if (captured.includes(ESC + ']0;pwn' + BEL) || captured.includes(ESC + '[31m')) {
                missing.push('hostile reply controls reached terminal output');
            }

            const width = (s) => [...s].length;
            const lines = plain.split(/\r?\n/);
            if (!lines.includes(' ❯ read') || !lines.includes('   the sop')) {
                missing.push('committed multiline user turn');
            }
            const statusLine = lines.find(
                (line) => line.includes('blocked') && line.includes('fake-model')
            );
            // The chips deliberately stop after the last segment instead of
            // ruling to the right edge, so what is asserted is the bound the
            // old full-bleed check protected -- the strip never exceeds the
            // gutter-inset width -- plus the chip shape and every real segment:
            // state, engine·model, reported tokens, and session time.
            if (
                !statusLine ||
                width(statusLine) > stdout.columns - 1 ||
                !/^ {2}blocked {3}fake·fake-model {3}68\.0k tok {3}session \d+[smh]$/
                    .test(statusLine)
            ) {
                missing.push('status chip strip with every real segment, inside the viewport');
            }

            const finalLines = lines.filter((line) => line.trim().length > 0);
            const finalComposer = finalLines.slice(-3);
            if (
                !/^╭─+╮$/.test(finalComposer[0] ?? '') ||
                !/^│ ❯ Ask about company operations… +│$/.test(finalComposer[1] ?? '') ||
                !/^╰─+╯$/.test(finalComposer[2] ?? '')
            ) {
                missing.push('composer cleared to final placeholder');
            }

            if (missing.length > 0) {
                console.error('missing: ' + missing.join(', '));
                process.exit(1);
            }
            process.exit(0);
        }, 60);
    }, 120);
}, 50);
JS
)

echo
echo "11. a scripted turn renders the turn structure"

if ! command -v node >/dev/null 2>&1; then
    fail "node not found -- cannot drive the shell"
elif [ ! -d "shell/node_modules/ink" ]; then
    skip "shell/node_modules absent, run install.sh"
else
    # FORCE_COLOR=0 pins chalk's colour level instead of inheriting it. This
    # check reads the RAW capture for hostile control sequences, and Ink's own
    # styling emits the very bytes the payload does (ESC[31m) -- with colour on,
    # the leak check would trip on Sherman's own red text and the chip strip
    # would carry uncollapsed padding. At level 0 Ink emits no escapes of its
    # own, so any ESC in the capture is genuine leakage. Colour output itself is
    # covered by check 9, which pins FORCE_COLOR=3.
    turn_err=$(cd shell && env HOME="$TMPHOME" FORCE_COLOR=0 node --input-type=module -e "$TURN_JS" 2>&1)
    turn_status=$?

    if [ "$turn_status" -eq 0 ]; then
        pass "mapping, sanitization, narrow layout, prompt marker, signed reply, timed trace, composer placeholder and status width; no alt-screen leak off-TTY"
    else
        fail "$turn_err"
    fi
fi

# ----------------------------------------------------------------- check 12 --
# Self-talk, end to end. The input is a REAL codex 0.145.0 reasoning payload --
# `item.completed` carrying `{type:"reasoning", text:"**Planning ...**"}`, the
# exact shape captured when probing `codex exec --json` with
# model_reasoning_summary set -- and it is fed through CodexSession._mapLine, so
# this exercises the whole chain rather than a hand-built event:
#
#   codex JSON -> ev.reasoning -> App commits 'selftalk' -> purple summary line
#
# FORCE_COLOR=3 because chalk strips colour when it sees a pipe. Without it the
# escape assertion would pass on plain text and prove nothing about hierarchy.
#
# It also pins the honest half of the probe: a turn that emits NO reasoning item
# must produce no self-talk line. Rendering one anyway would be the invented
# activity line the transcript exists to not have.

SELFTALK_JS=$(cat <<'JS'
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import { App } from './src/ui/app.js';
import { CodexSession } from './src/engine/codex.js';

const mapper = new CodexSession({
    engine: 'codex', user: 'smoke-tester',
    vaultPath: '/tmp/smoke/vault', workspacePath: '/tmp/smoke/workspace',
});

// The captured payload, verbatim: a Markdown-bolded title on one line.
const reasoningEvents = mapper._mapLine(JSON.stringify({
    type: 'item.completed',
    item: { id: 'rs-1', type: 'reasoning', text: '**Planning alternative awk command**' },
}));
const lifecycleEvents = mapper._mapLine(JSON.stringify({ type: 'turn.started' }));

const problems = [];
if (reasoningEvents.length !== 1 || reasoningEvents[0].kind !== 'reasoning') {
    problems.push('codex reasoning item maps to a reasoning event');
}
// The asterisks must be stripped: the trace is plain text, not Markdown.
if (reasoningEvents[0]?.text !== 'Planning alternative awk command') {
    problems.push('reasoning summary undressed of Markdown emphasis');
}
if (!lifecycleEvents.some((e) => e.kind === 'status')) {
    problems.push('turn.started yields a lifecycle status event');
}

let turnComplete = false;
const fakeSession = {
    info: {
        engine: 'fake', model: 'fake-model', contextWindow: 272000,
        user: 'smoke-tester', vaultPath: '/tmp/smoke/sherman/vault', threadId: null,
    },
    usage: { total: 10, input: 8, cachedInput: 0, output: 2, reasoning: 1 },
    async *send() {
        yield { kind: 'turn-start' };
        for (const e of lifecycleEvents) if (e.kind === 'status') yield e;
        for (const e of reasoningEvents) yield e;
        yield { kind: 'message', text: 'Two lines.' };
        yield { kind: 'turn-end', usage: this.usage };
        turnComplete = true;
    },
    interrupt() {}, dispose() {},
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

// Two writes, like check 11: the composer commits on a carriage return that
// arrives as its own input event, not one buried in the same chunk as the text.
setTimeout(() => { stdin.write('count the lines'); }, 40);
setTimeout(() => { stdin.write('\r'); }, 90);

const startedAt = Date.now();
const poll = setInterval(() => {
    if (!turnComplete && Date.now() - startedAt < 2000) return;
    clearInterval(poll);
    setTimeout(() => {
        inst.unmount();
        setTimeout(() => {
            const plain = captured.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

            if (!plain.includes('⋯ summary: Planning alternative awk command')) {
                problems.push('reasoning item rendered as an explicit summary');
            }
            if (plain.includes('**Planning')) {
                problems.push('Markdown asterisks kept out of the trace');
            }
            // Purple 135, the summary role in the Sherman palette.
            const styled = captured
                .split('\n')
                .find((l) => l.includes('Planning alternative awk command'));
            if (!styled || !styled.includes('38;5;135m')) {
                problems.push('reasoning summary uses the purple summary role');
            }

            if (problems.length > 0) {
                console.error('missing: ' + problems.join(', '));
                process.exit(1);
            }
            process.exit(0);
        }, 60);
    }, 120);
}, 50);
JS
)

echo
echo "12. a reasoning item renders as an explicit summary line"

if ! command -v node >/dev/null 2>&1; then
    fail "node not found -- cannot drive the shell"
elif [ ! -d "shell/node_modules/ink" ]; then
    skip "shell/node_modules absent, run install.sh"
else
    st_err=$(cd shell && env HOME="$TMPHOME" FORCE_COLOR=3 node --input-type=module -e "$SELFTALK_JS" 2>&1)
    st_status=$?

    if [ "$st_status" -eq 0 ]; then
        pass "codex reasoning payload becomes a purple ⋯ summary line"
    else
        fail "$(printf '%s' "$st_err" | head -3)"
    fi
fi

# ----------------------------------------------------------------- check 13 --
echo
echo "13. Sherman Shell test suite passes"

if ! command -v node >/dev/null 2>&1; then
    fail "node not found -- cannot run the Sherman Shell tests"
elif ! command -v npm >/dev/null 2>&1; then
    fail "npm not found -- cannot run the Sherman Shell tests"
elif [ ! -d "shell/node_modules/ink" ]; then
    skip "shell/node_modules absent, run install.sh"
else
    test_err=$(npm test --prefix shell 2>&1)
    test_status=$?

    if [ "$test_status" -eq 0 ]; then
        pass "node:test suite passes"
    else
        fail "node:test suite failed: $(printf '%s' "$test_err" | tail -10)"
    fi
fi

# -------------------------------------------------------------------- result --
echo
echo "$PASSES passed, $SKIPPED skipped, $FAILURES failed."
if [ "$FAILURES" -eq 0 ] && [ "$SKIPPED" -eq 0 ]; then
    echo "$TOTAL_CHECKS checks, all green."
    echo
    exit 0
fi
if [ "$FAILURES" -eq 0 ] && [ "${SMOKE_ALLOW_SKIP:-0}" = "1" ]; then
    echo "Skipped UI checks explicitly allowed by SMOKE_ALLOW_SKIP=1."
    echo
    exit 0
fi
if [ "$FAILURES" -eq 0 ]; then
    echo "Skipped UI checks make the commit gate incomplete."
fi
echo
exit 1
