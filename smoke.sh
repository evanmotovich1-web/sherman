#!/usr/bin/env bash
#
# smoke.sh — three checks, no framework.
#
#   1. bin/sherman is executable.
#   2. The first-run flow, driven with piped answers and a stub engine on PATH
#      under an overridden HOME, writes a valid config.json.
#   3. The assembled adapter carries the vault path, the user name, and the
#      no-PHI rule.
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

printf '1\nSmoke Tester\n' \
    | env HOME="$TMPHOME" PATH="$STUBDIR:$PATH" ./bin/sherman >/dev/null 2>&1

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

# -------------------------------------------------------------------- result --
echo
if [ "$FAILURES" -eq 0 ]; then
    echo "3 checks, all green."
    echo
    exit 0
fi
echo "$FAILURES assertion(s) failed."
echo
exit 1
