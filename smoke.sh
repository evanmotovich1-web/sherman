#!/usr/bin/env bash
#
# smoke.sh — six checks, no framework.
#
#   1. bin/sherman is executable.
#   2. The first-run flow, driven with piped answers and a stub engine on PATH
#      under an overridden HOME, writes a valid config.json.
#   3. The assembled adapter carries the vault path, the user name, and the
#      no-PHI rule.
#   4. The shell entry point launches and exits clean on --version.
#   5. Backend selection follows config.json's engine field.
#   6. The --raw path still execs the engine.
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

# -------------------------------------------------------------------- result --
echo
if [ "$FAILURES" -eq 0 ]; then
    echo "6 checks, all green."
    echo
    exit 0
fi
echo "$FAILURES assertion(s) failed."
echo
exit 1
