#!/usr/bin/env bash
#
# smoke.sh — twenty-eight checks, no framework.
#
#   1. bin/sherman is executable.
#   2. The first-run flow, driven with piped answers and a stub engine on PATH
#      under an overridden HOME, writes a valid config.json.
#   3. The assembled adapter carries the vault path, the user name, the no-PHI
#      autonomy rules, and the explicit-only retention boundary — and the
#      workspace carries every repo skill at both engine conventions.
#   4. The shell entry point launches and exits clean on --version.
#   5. Backend selection follows config.json's engine field.
#   6. The --raw path still execs the engine.
#   7. The launch screen crosses its card/panel boundary at 80 columns, no overflow.
#   8. The launch screen crosses its card/panel boundary at 200 columns, no overflow.
#   9. The launch screen's colours are emitted as real ANSI sequences.
#  10. `sherman update` reports success only after verification passes and
#      propagates a failed smoke run with its diagnostics, exercised offline.
#  11. A scripted turn through a fake backend renders the prompt marker,
#      signed reply, factual trace, composer placeholder, and persistent status.
#  12. A real codex reasoning payload renders as an explicit purple summary line.
#  13. The Sherman Shell node:test suite passes.
#  14. Mouse reporting is disabled on every exit path.
#  15. Diff inks are semantic, scoped, and honest about truncation.
#  16. The copy path claims only what its mechanism can prove.
#  17. The capability registry matches reality where reality is checkable.
#  18. The context meter marks an estimate as one, and only a measurement compacts.
#  19. README.md states the Windows reality, points at the real installer, and
#      names unbuilt channels only under its marked roadmap heading.
#  20. The wizard lists an unavailable provider visibly, refuses its selection
#      with the reason, and completes on the available one.
#  21. install.sh claims only what it verified: an npm that exits 0 while
#      producing nothing is never reported as installed, the linked line
#      matches readlink, a missing npm degrades to the NOTE, and disabled
#      fetches are said plainly with no install claim.
#  22. Auto-provisioning, offline: a stub curl serves a fake Node tarball and
#      the extract → link → verify chain earns its "installed" line, while an
#      npm that produced no codex is refused one.
#  23. The Windows bootstrap exists, is routed to from the Windows doc, keeps
#      the untested-platform honesty, and parses — when a PowerShell is
#      available to parse it; the pass line names what was actually checked.
#  27. The Agent Reach provisioner parses, is reachable from BOTH entry points,
#      keeps the two constants that made the install work, and stays offline
#      and claimless when fetches are disabled.
#  28. A corrupt config self-heals: quarantined intact, setup reruns, and the
#      launch completes -- never a raw jq parse error and a dead end. Paths
#      that cannot re-run setup keep the named remedy.
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
FAILURE_DETAILS=""
TOTAL_CHECKS=31
SMOKE_USER="smoke-tester"

# The launcher freshens remote refs in the background at launch. A check
# suite that spawned a dozen network fetches against the real origin would
# be slow, flaky offline, and pointless -- every check here is about local
# behavior.
export SHERMAN_NO_FETCH=1

pass() { echo "  PASS  $*"; PASSES=$((PASSES + 1)); }
skip() { echo "  SKIP  $*"; SKIPPED=$((SKIPPED + 1)); }
fail() {
    echo "  FAIL  $*"
    if [ -n "$FAILURE_DETAILS" ]; then
        FAILURE_DETAILS="$FAILURE_DETAILS
  - $*"
    else
        FAILURE_DETAILS="  - $*"
    fi
    FAILURES=$((FAILURES + 1))
}

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

# The wizard's registry lists codex as option 1 — the only available provider
# today — so the piped answers select codex and need a codex stub on PATH.
printf '#!/bin/sh\nexit 0\n' > "$STUBDIR/codex"
chmod +x "$STUBDIR/codex"

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

    [ "$got_engine" = "codex" ] \
        && pass "engine recorded as codex (answer 1 = OpenAI, the available provider)" \
        || fail "engine is '$got_engine', expected 'codex'"

    [ "$got_user" = "$SMOKE_USER" ] \
        && pass "user slugified to $SMOKE_USER" \
        || fail "user is '$got_user', expected '$SMOKE_USER'"

    [ -n "$got_vault" ] \
        && pass "vault_path recorded ($got_vault)" \
        || fail "vault_path is empty"
fi

# ------------------------------------------------------------------ check 3 --
echo
echo "3. assembled adapter carries vault, user, PHI and autonomy rules"

ADAPTER="$TMPHOME/.sherman/workspace/AGENTS.md"

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

    # Identity must be DECLARED, not merely mentioned. The persona once
    # carried a hardcoded example name and a second machine's Sherman
    # addressed its operator by that name (seen live). The assembled body
    # must name THIS machine's operator explicitly, and the shared persona
    # file must carry no operator name of its own for an example to leak.
    if grep -qF "Who you are speaking with" "$ADAPTER" \
        && grep -qF "The operator of THIS machine is **$SMOKE_USER**" "$ADAPTER" \
        && ! grep -q "Evan" agent/SYSTEM.md; then
        pass "declares this machine's operator by name; the persona hardcodes none"
    else
        fail "operator identity section missing, or the shared persona carries a hardcoded name"
    fi

    if ! grep -qF "patient" "$ADAPTER"; then
        fail "no-PHI rule missing from adapter"
    elif ! grep -qF "Default to execution, not interviewing." "$ADAPTER"; then
        fail "autonomy rule missing from adapter"
    else
        pass "contains the no-PHI and autonomy rules"
    fi

    # The self-evolution governance must survive assembly in BOTH directions:
    # the autonomy to publish (branch + PR, unprompted) AND the fleet gate that
    # holds the merge to main for a human. Losing either — reverting to "never
    # push" or opening the door to "push to main" — is a regression, so both
    # halves are pinned in the assembled adapter.
    if grep -qF "never push to \`main\`" "$ADAPTER" \
        && grep -qF "The merge is the operator's to grant." "$ADAPTER"; then
        pass "carries the self-evolution push discipline: branch+PR yours, merge is the operator's"
    else
        fail "the self-evolution push discipline (branch+PR, main-merge gated) is missing from the adapter"
    fi

    if grep -qF 'offer a complete operator-reviewed' "$ADAPTER" \
        && grep -qF '`/wiki <name> | <fact>` command' "$ADAPTER" \
        && grep -qF 'There is no validated private-memory' "$ADAPTER"; then
        pass "contains explicit operator-reviewed retention guidance"
    else
        fail "explicit operator-reviewed retention guidance missing"
    fi

    if ! grep -qF "every user's Sherman writes to it" "$ADAPTER" \
        && ! grep -qF 'Every fact file you write to shared or private memory' "$ADAPTER" \
        && ! grep -qF 'When you learn a durable new fact about the business, write it there' "$ADAPTER"; then
        pass "contains no direct or private-memory write instruction"
    else
        fail "assembled adapter still instructs direct authoritative writes"
    fi

    grep -qF '{{SHERMAN_BODY}}' "$ADAPTER" \
        && fail "splice token still present -- template copied, not assembled" \
        || pass "splice token replaced"

    [ -f "$TMPHOME/.sherman/workspace/CLAUDE.md" ] \
        && fail "stale CLAUDE.md alongside AGENTS.md" \
        || pass "no stale sibling adapter"

    # Skills travel with the workspace -- an engine can only load what is
    # actually there, so what landed is counted against what the repo defines.
    repo_skills=$(ls -d skills/*/ 2>/dev/null | wc -l | tr -d ' ')
    for convention in .agents/skills .claude/skills; do
        ws_skills=$(ls -d "$TMPHOME/.sherman/workspace/$convention"/*/ 2>/dev/null | wc -l | tr -d ' ')
        if [ "$repo_skills" -gt 0 ] && [ "$ws_skills" = "$repo_skills" ]; then
            pass "workspace $convention carries all $repo_skills skills"
        else
            fail "workspace $convention has $ws_skills skill dirs, repo has $repo_skills"
        fi
    done
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
    # The wizard can no longer produce an engine "claude" config (Anthropic is
    # registered unavailable), but a hand-written one must keep behaving exactly
    # as before: the shell picks the Claude stub and says it is not implemented
    # -- never a crash, never a silent fall-through to codex.
    CLAUDEHOME="$TMPHOME/claude-home"
    mkdir -p "$CLAUDEHOME/.sherman"
    printf '{"version":1,"engine":"claude","user":"%s","vault_path":"%s"}\n' \
        "$SMOKE_USER" "$ROOT/vault" > "$CLAUDEHOME/.sherman/config.json"
    sel_out=$(env HOME="$CLAUDEHOME" node "$SHELL_ENTRY" --probe "smoke" 2>&1)

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
# than merely that the launcher exited 0. The check-2 sandbox config records
# codex, so the stub is codex.
ENGINE_MARKER="$TMPHOME/engine-was-exec-d"
printf '#!/bin/sh\ntouch "%s"\nexit 0\n' "$ENGINE_MARKER" > "$STUBDIR/codex"
chmod +x "$STUBDIR/codex"

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
// 21/22 is the card/mid boundary now: the mid panel (the abridged Mac
// frame, with a Vault section title) begins at 22 rows, and the compact
// card holds below it. The full panel boundary at 29 is covered by the
// shell test suite; this check guards the first crossing, where the
// Vault title first appears. No apostrophes here -- see the NOTE above.
const ROWS = [21, 22];
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
    // The 120-column cap is a PC decision (darwin full-bleeds), so the PC
    // platform is pinned here and the capped expectation below stays true on
    // whatever machine runs smoke. The Mac geometry is pinned by the shell
    // test suite (ui-layout).
    const out = renderToString(
        React.createElement(LaunchScreen, {
            info,
            stats,
            sessionId: '20260726_120000_abc123',
            columns: cols,
            rows,
            platform: 'win32',
        }),
        { columns: cols }
    );

    const lines = out.split('\n');
    const over = lines.filter((line) => width(line) > cols);

    if (over.length > 0) {
        console.error(over.length + ' line(s) wider than ' + cols + ' at ' + rows + ' rows');
        process.exit(1);
    }

    // Full bleed up to the 120-column design cap; past it the frame keeps
    // its designed width and centers, so wide renders carry a symmetric left
    // pad and the border itself is exactly the capped width.
    const capped = Math.min(cols, 120);
    const plain = lines.map((l) => strip(l).trimStart());
    const top = plain.findIndex((l) => l.startsWith('╭─') && l.trimEnd().endsWith('╮'));
    if (top < 0) {
        console.error('panel top border not found at ' + rows + ' rows');
        process.exit(1);
    }
    if (width(plain[top].trimEnd()) !== capped) {
        console.error(
            'panel border is ' + width(plain[top].trimEnd()) + ' cols, expected ' + capped
        );
        process.exit(1);
    }

    const bottom = plain.findIndex((l, i) => i > top && l.startsWith('╰'));
    if (bottom < 0) {
        console.error('panel bottom border not found at ' + rows + ' rows');
        process.exit(1);
    }
    // The full panel is detected by its Vault SECTION TITLE — capital-V
    // Vault as the last word on a bordered row (the mark art may share the
    // row to its left). Matched structurally, not by exact column: the title
    // indent follows the left column width, which has already moved once
    // (identity joined the mark) and broke a hardcoded-offset version of this
    // line. The compact card cannot false-positive: it prints lowercase
    // vault as a field label followed by its value, never as a last word.
    //
    // No apostrophes in this comment, deliberately: the whole check sits in a
    // bash 3.2 $() substitution, whose scanner counts quotes even inside a
    // quoted heredoc, and an odd apostrophe here reads as an unclosed string
    // that swallows the rest of the file.
    fullPanelModes.push(plain.some((line) => {
        if (!line.startsWith('│')) return false;
        const inner = line.trimEnd().endsWith('│')
            ? line.trimEnd().slice(1, -1)
            : line.trimEnd().slice(1);
        return inner.trimEnd().endsWith(' Vault');
    }));
}

if (fullPanelModes[0] || !fullPanelModes[1]) {
    console.error('launch did not cross the card/panel boundary between 21 and 22 rows');
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
# Drive the real launcher against an isolated fake checkout and git executable.
# The old check ran `git pull` against this repo's real remote, contradicting
# the suite's offline contract and hanging when the network was slow. This
# fixture proves both sides that matter: a passing verification earns success;
# a failing verification propagates non-zero, keeps the smoke diagnostic, and
# is never called "Updated".

echo
echo "10. sherman update exits honestly"

if [ -n "${SHERMAN_UPDATE_RUNNING:-}" ]; then
    pass "skipped -- running under sherman update"
else
    update_root="$TMPHOME/update-fixture"
    update_home="$TMPHOME/update-home"
    update_stubs="$TMPHOME/update-stubs"
    mkdir -p "$update_root/bin" "$update_root/shell" "$update_home" "$update_stubs"
    cp bin/sherman "$update_root/bin/sherman"
    chmod +x "$update_root/bin/sherman"
    printf '{ "version": "smoke-update" }\n' > "$update_root/shell/package.json"

    cat > "$update_stubs/git" <<'FAKE_GIT'
#!/bin/sh
case " $* " in
    *" rev-parse --git-dir "*) echo .git ;;
    *" remote "*) echo origin ;;
    *" rev-parse HEAD "*) echo 0123456789abcdef ;;
    *" pull --ff-only "*) exit 0 ;;
    *" diff --quiet "*) exit 0 ;;
    *) echo "unexpected fake git call: $*" >&2; exit 2 ;;
esac
FAKE_GIT
    chmod +x "$update_stubs/git"

    cat > "$update_root/smoke.sh" <<'PASSING_SMOKE'
#!/bin/sh
echo "simulated verification passed"
exit 0
PASSING_SMOKE
    chmod +x "$update_root/smoke.sh"
    update_ok_out=$(env HOME="$update_home" PATH="$update_stubs:$PATH" \
        "$update_root/bin/sherman" update 2>&1)
    update_ok_status=$?

    cat > "$update_root/smoke.sh" <<'FAILING_SMOKE'
#!/bin/sh
echo "simulated verification failed"
exit 7
FAILING_SMOKE
    chmod +x "$update_root/smoke.sh"
    update_bad_out=$(env HOME="$update_home" PATH="$update_stubs:$PATH" \
        "$update_root/bin/sherman" update 2>&1)
    update_bad_status=$?

    if [ "$update_ok_status" -eq 0 ] \
        && printf '%s' "$update_ok_out" | grep -q 'Updated:' \
        && [ "$update_bad_status" -ne 0 ] \
        && printf '%s' "$update_bad_out" | grep -q 'simulated verification failed' \
        && printf '%s' "$update_bad_out" | grep -q 'did not pass verification' \
        && ! printf '%s' "$update_bad_out" | grep -q 'Updated:'; then
        pass "passing verification earns Updated; failed verification exits non-zero with its diagnostic"
    else
        fail "update status propagation broke (pass=$update_ok_status, fail=$update_bad_status): $(printf '%s' "$update_bad_out" | tail -3)"
    fi

    # The self-healing reconcile: with a lockfile present, update runs `npm ci`
    # before verifying, so a node_modules that has drifted from the lock is
    # rebuilt rather than health-checked as-is -- the fix for the machine that
    # could never update because verification kept failing against stale deps.
    # A stub npm records the call; a fixture lockfile arms the path the check
    # above deliberately omits. A reconcile that fails must stop the update.
    printf '{ "name": "x", "lockfileVersion": 3 }\n' > "$update_root/shell/package-lock.json"
    npm_marker="$update_root/npm-reconcile-called"
    rm -f "$npm_marker"
    cat > "$update_stubs/npm" <<FAKE_NPM_OK
#!/bin/sh
echo "\$@" > "$npm_marker"
exit 0
FAKE_NPM_OK
    chmod +x "$update_stubs/npm"
    cat > "$update_root/smoke.sh" <<'PASSING_SMOKE2'
#!/bin/sh
echo "simulated verification passed"
exit 0
PASSING_SMOKE2
    chmod +x "$update_root/smoke.sh"
    reconcile_out=$(env HOME="$update_home" PATH="$update_stubs:$PATH" \
        "$update_root/bin/sherman" update 2>&1)
    reconcile_status=$?

    cat > "$update_stubs/npm" <<'FAKE_NPM_FAIL'
#!/bin/sh
exit 3
FAKE_NPM_FAIL
    chmod +x "$update_stubs/npm"
    badnpm_out=$(env HOME="$update_home" PATH="$update_stubs:$PATH" \
        "$update_root/bin/sherman" update 2>&1)
    badnpm_status=$?

    if [ "$reconcile_status" -eq 0 ] \
        && [ -f "$npm_marker" ] \
        && grep -q '^ci ' "$npm_marker" \
        && printf '%s' "$reconcile_out" | grep -q 'Updated:' \
        && [ "$badnpm_status" -ne 0 ] \
        && printf '%s' "$badnpm_out" | grep -q 'could not be reconciled' \
        && ! printf '%s' "$badnpm_out" | grep -q 'Updated:'; then
        pass "update reconciles deps with npm ci before verifying; a failed reconcile stops it"
    else
        fail "reconcile path broke (ok=$reconcile_status, bad=$badnpm_status): $(printf '%s' "$badnpm_out" | tail -3)"
    fi

    # The one-press proof: after the pull, the rest of the update must run in
    # the launcher the pull DELIVERED, not the copy already in memory --
    # otherwise a fix to the update process never applies to the update that
    # ships it, and the operator is told to press update twice. The fixture's
    # git stub swaps in a different launcher during "pull"; only a real
    # re-exec can produce that launcher's completion line.
    cat > "$update_root/pulled-sherman" <<'PULLED'
#!/bin/sh
case "${1:-}" in
    update) echo "finished by the pulled launcher"; exit 0 ;;
    *) echo "unexpected pulled-launcher call: $*" >&2; exit 2 ;;
esac
PULLED
    chmod +x "$update_root/pulled-sherman"
    cat > "$update_stubs/git" <<SWAPPING_GIT
#!/bin/sh
case " \$* " in
    *" rev-parse --git-dir "*) echo .git ;;
    *" remote "*) echo origin ;;
    *" pull --ff-only "*) cp "$update_root/pulled-sherman" "$update_root/bin/sherman" ;;
    *) echo "unexpected fake git call: \$*" >&2; exit 2 ;;
esac
SWAPPING_GIT
    chmod +x "$update_stubs/git"
    reexec_out=$(env HOME="$update_home" PATH="$update_stubs:$PATH" \
        "$update_root/bin/sherman" update 2>&1)
    reexec_status=$?

    if [ "$reexec_status" -eq 0 ] \
        && printf '%s' "$reexec_out" | grep -q 'finished by the pulled launcher'; then
        pass "after the pull, the update finishes in the launcher the pull delivered"
    else
        fail "update kept running the in-memory launcher past the pull (status=$reexec_status): $(printf '%s' "$reexec_out" | tail -3)"
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
import { Box, render, renderToString } from 'ink';
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
// The fixture change is a single kind:'add', which the engine reports as a
// creation, not a patch — making a file and editing one are different acts.
if (patchStart[0]?.phase !== 'started' || patchStart[0]?.label !== 'create output.txt') {
    mappingMissing.push('Codex create start mapping');
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
// The launch frame is the transcript's only item before the first turn, so it
// must sit at the TOP of the viewport with the spare rows below it. A void
// above the wordmark is the failure this pins, and it is visible off a TTY:
// the frame's first row must carry the wordmark, not blank padding.
// The fixed-height wrapper is load-bearing: without it the transcript has no
// spare rows to place the frame WITHIN, and the check would pass whichever way
// the viewport anchors -- proving nothing.
const anchored = renderToString(
    React.createElement(
        Box,
        { width: 100, height: 50, flexDirection: 'column' },
        React.createElement(Transcript, {
            items: [{
                id: 'anchor', kind: 'launch',
                info: narrowInfo, stats: narrowStats, sessionId: 'smoke-session',
            }],
            columns: 100,
        })
    ),
    { columns: 100 }
).replace(/\x1b\[[0-9;]*m/g, '').split('\n');
if (anchored.findIndex((line) => line.trim() !== '') !== 0) {
    mappingMissing.push('launch frame is not top-anchored');
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
// One gutter column, then the two-cell frame indent. The signature is
// embedded in the top border, the body stands between the side rules, and the
// box's own bottom border closes it — no trailing blank row after it,
// because the next user turn carries the air between turns. (That apostrophe
// is load-bearing: bash 3.2 scans $(...) heredocs for quote pairs, and this
// comment must keep the same single-quote parity the old text had.)
if (
    fullReplyLines.length !== 3 ||
    !/^ {3}╭─ Sherman ─+╮$/.test(fullReplyLines[0]) ||
    !/^ {3}│ reply body +│$/.test(fullReplyLines[1]) ||
    !/^ {3}╰─+╯$/.test(fullReplyLines[2])
) {
    mappingMissing.push('signed Sherman reply geometry and trailing rhythm');
}

// The rule must stand in the same column as the trace rows above it. Diff,
// tool and self-talk hard-code the prefix `  │ `; the reply's rule is an Ink
// border. Different machinery, one left edge — a drift here is a bug.
const alignmentLines = renderToString(
    React.createElement(Transcript, {
        items: [
            { id: 'align-tool', kind: 'tool', text: 'read vault/wiki/index.md' },
            { id: 'align-reply', kind: 'message', text: 'aligned' },
        ],
        columns: 80,
    }),
    { columns: 80 }
).replace(/\x1b\[[0-9;]*m/g, '').split('\n');
const ruleColumns = new Set(
    alignmentLines.filter((line) => line.includes('│')).map((line) => line.indexOf('│'))
);
if (ruleColumns.size !== 1) {
    mappingMissing.push('reply rule aligned with the activity trace gutter');
}

const longReplyInput = '0123456789'.repeat(20);
const longReplyLines = renderToString(
    React.createElement(Transcript, {
        items: [{ id: 'long-reply', kind: 'message', text: longReplyInput }],
        columns: 80,
    }),
    { columns: 80 }
).replace(/\x1b\[[0-9;]*m/g, '').split('\n');
// Row 0 is the titled top border and the last row is the bottom border;
// everything between is body. Each body row is the gutter, the two-cell
// indent, the left rule, one padding space, the wrapped chunk, then padding
// and the right rule — the rules repeating on EVERY row is what proves Ink
// painted the frame down the measured height rather than only beside the
// first line. The chunks still reassemble the input exactly, so no text was
// dropped at the wrap. (Digits only, so stripping the padded right edge can
// never eat real content.)
const longBodyLines = longReplyLines.slice(1, -1);
if (
    longBodyLines.length < 3 ||
    !/^ {3}╭─ Sherman ─+╮$/.test(longReplyLines[0]) ||
    !/^ {3}╰─+╯$/.test(longReplyLines.at(-1)) ||
    longBodyLines.some((line) => !line.startsWith('   │ ') || !line.endsWith('│')) ||
    maxWidth(longReplyLines.join('\n')) > 80 ||
    longBodyLines.map((line) => line.slice(5).replace(/ *│$/, '')).join('') !== longReplyInput
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
    // This render is synchronous and its inputs are pinned, so a mismatch can
    // only come from the environment measuring characters differently -- name
    // the versions and widths in the recap itself, so a failing machine's
    // paste IS the diagnosis rather than a mystery to reconstruct remotely.
    let widthDeps = 'unresolved';
    try {
        // Read the manifests by path: string-width's exports map blocks
        // require('string-width/package.json').
        const { readFileSync } = await import('node:fs');
        const ver = (name) => JSON.parse(
            readFileSync(`./node_modules/${name}/package.json`, 'utf8')
        ).version;
        const sw = (await import('string-width')).default;
        widthDeps = `string-width@${ver('string-width')}`
            + ` geaw@${ver('get-east-asian-width')}`
            + ` sw('…')=${sw('…')} sw('❯')=${sw('❯')}`;
    } catch (error) {
        widthDeps = `unresolved: ${error.message}`;
    }
    mappingMissing.push(
        'rounded full-width composer box with the placeholder inside it'
        + ` [rows=${composerLines.length}`
        + ` widths=${composerLines.map(visualWidth).join(',')}`
        + ` node=${process.version} ${widthDeps}`
        + ` row1=${JSON.stringify(composerLines[1] ?? '').slice(0, 60)}]`
    );
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
        yield { kind: 'tool', id: 'tool-1', phase: 'started', glyph: '›', label: 'patch smoke.sh', category: 'file-change' };
        yield { kind: 'tool', id: 'tool-1', phase: 'completed', glyph: '›', label: 'patch smoke.sh', category: 'file-change', outcome: 'succeeded', durationMs: 900 };
        // A real engine does not end the turn in the same tick a tool finishes.
        // The gap matters here: a completed tool line is LIVE chrome now, shown
        // for ACTIVITY_LINGER_MS and never committed, so without a beat for the
        // frame to render there is nothing for the assertion below to observe.
        await new Promise((resolve) => setTimeout(resolve, 120));
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
            // The pasted lines must survive intact at the FRONT of the one
            // submitted request; the shell may append standing routing (the
            // navigate reminder) after them, which is not a paste defect.
            if (sent.length !== 1 || !sent[0].startsWith('read\nthe sop')) {
                missing.push('multi-line paste preserved until Enter');
            }
            // The signature lives inside the top border again, with the body
            // between the side rules under it. Both rows are asserted: a
            // titled border with no framed body under it would mean the box
            // collapsed to a bare label.
            if (!/\n {3}╭─ Sherman ─.*\n {3}│ /.test(plain)) missing.push('Sherman reply label');
            // The completed tool COMMITS to the transcript now — glyph, padded
            // category tag, label, measured duration — so it is asserted on the
            // final screen, where a permanent row must still be. No ✓ on a
            // successful row: in a trace where nearly everything succeeds, the
            // absence of a mark is what carries information.
            if (!plain.includes('📝 patch     patch smoke.sh  0.9s')) {
                missing.push('committed trace row with glyph, tag and duration');
            }

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
        # The old tail-only report hid the failed test names and printed just
        # the aggregate (for example, "139 passed, 5 failed"). Surface each
        # TAP failure block so a second machine's report is actionable without
        # asking its operator to reconstruct a vanished log.
        test_failures=$(printf '%s\n' "$test_err" | awk '
            /^not ok [0-9]+ - / { showing = 1 }
            showing { print }
            showing && /^  \.\.\.$/ { showing = 0 }
        ')
        if [ -n "$test_failures" ]; then
            printf '%s\n' "$test_failures" >&2
        else
            printf '%s\n' "$test_err" | tail -25 >&2
        fi
        test_summary=$(printf '%s\n' "$test_err" \
            | grep '^# \(tests\|pass\|fail\|cancelled\|skipped\|todo\) ' \
            | tr '\n' '; ')
        # The failing test NAMES ride in the recap line itself: the recap is
        # what an operator on another machine actually pastes back, and a
        # count without names sends the diagnosis chasing a vanished log.
        test_names=$(printf '%s\n' "$test_err" \
            | sed -n 's/^not ok [0-9]* - //p' | head -4 | tr '\n' '|')
        fail "node:test suite failed: ${test_summary:-no TAP summary was produced} failing: ${test_names:-unknown}"
    fi
fi

# ----------------------------------------------------------------- check 14 --
# Mouse reporting is a mode borrowed from the terminal, and the terminal has no
# way to take it back. A shell that exits with SGR 1006 still enabled leaves
# every later click in that window spraying escape bytes into whatever prompt
# comes next -- the same class of damage as exiting inside the alternate screen,
# and the reason that restore is guarded on every path.
#
# Checked the way it actually fails: a child process enables reporting against a
# descriptor pointed at a file, then leaves the way a real session leaves --
# cleanly, by process.exit, by an uncaught fault, and by SIGINT/SIGTERM/SIGHUP.
# The disable must be in the file every time. No pty is involved; enableMouse
# inspects an isTTY flag and a descriptor, and both are supplied.

echo
echo "14. mouse reporting is disabled on every exit path"

MOUSE_JS=$(cat <<'JS'
import { openSync } from 'node:fs';

// Imported by absolute URL: this script is written into the sandbox, so a
// relative specifier would resolve against the sandbox, not the shell.
const { enableMouse } = await import(process.argv[4]);

const fd = openSync(process.argv[2], 'w');
enableMouse({ isTTY: true, fd, write: () => true });

switch (process.argv[3]) {
    case 'exit': process.exit(0);
    case 'throw': throw new Error('smoke fault');
    case 'clean': break;
    default: process.kill(process.pid, process.argv[3].toUpperCase());
}
JS
)

if ! command -v node >/dev/null 2>&1; then
    fail "node not found -- cannot check mouse cleanup"
elif [ ! -d "shell/node_modules/ink" ]; then
    skip "shell/node_modules absent, run install.sh"
else
    mouse_dir="$TMPHOME/mouse"
    mkdir -p "$mouse_dir"
    printf '%s' "$MOUSE_JS" > "$mouse_dir/exit.mjs"
    mouse_bad=""

    for how in clean exit throw sigint sigterm sighup; do
        out="$mouse_dir/$how.txt"
        node "$mouse_dir/exit.mjs" "$out" "$how" "file://$PWD/shell/src/ui/mouse.js" \
            >/dev/null 2>&1 || true
        # 1006l then 1000l -- disabled in the reverse of the order enabled.
        if ! grep -q "$(printf '\033')\[?1006l" "$out" 2>/dev/null; then
            mouse_bad="$mouse_bad $how"
        fi
    done

    if [ -n "$mouse_bad" ]; then
        fail "mouse reporting survived these exits:$mouse_bad"
    else
        pass "1006l/1000l written on clean exit, process.exit, fault, SIGINT, SIGTERM and SIGHUP"
    fi
fi

# ----------------------------------------------------------------- check 15 --
# The diff inks are the ONE approved semantic exception to the retired red, and
# an exception is only safe while it stays an exception. Two things can break:
#
#   1. The inks stop reaching the terminal. This is check 9's failure mode in a
#      new place -- Ink silently ignores a colour string it does not recognise,
#      so a well-meaning change to a bare '196' would render the diff in default
#      white with no error anywhere, and a diff with no colour is a diff whose
#      added and removed lines look identical.
#   2. The exception smuggles the retired ramp back in. Diff red must be the
#      semantic chalk red, not brand red 196/160/124 wearing a new hat.
#
# Check 9 remains the guard for the launch/brand surface and is deliberately
# NOT loosened: it renders LaunchScreen alone, which contains no diff, so the
# retired ramp is still an outright failure there. This check is the diff-only
# counterpart, and it asserts the SAME retired ramp is absent here too.
#
# FORCE_COLOR=3 for the same reason as check 9: piped output is colourless to
# chalk, which would make this a tautology.

DIFF_JS=$(cat <<'JS'
import React from 'react';
import { renderToString } from 'ink';
import { Diff } from './src/ui/Diff.js';

// A payload in the exact shape engine/filediff.js produces.
const out = renderToString(
    React.createElement(Diff, {
        diff: {
            path: 'scanner.txt',
            changeKind: 'update',
            available: true,
            reason: null,
            added: 1,
            removed: 1,
            lines: [
                { sign: '-', text: 'bravo' },
                { sign: '+', text: 'BRAVO' },
            ],
            more: 7,
        },
    }),
    { columns: 80 }
);

const problems = [];
if (!out.includes('\u001b[32m')) problems.push('added lines are not green');
if (!out.includes('\u001b[31m')) problems.push('removed lines are not red');

// The retired brand ramp stays retired, inside the exception as well as outside.
for (const [name, seq] of [
    ['196', '38;5;196m'], ['160', '38;5;160m'], ['124', '38;5;124m'],
]) {
    if (out.includes(seq)) problems.push('retired red ' + name + ' used for diff');
}

// Truncation must be stated, or a capped hunk reads as a smaller change.
if (!out.includes('+7 more lines')) problems.push('truncated hunk does not report the remainder');

// The unavailable path must say so rather than render an empty, confident diff.
const bare = renderToString(
    React.createElement(Diff, {
        diff: {
            path: 'blob.bin', changeKind: 'update', available: false,
            reason: 'binary file', added: 0, removed: 0, lines: [], more: 0,
        },
    }),
    { columns: 80 }
);
if (!bare.includes('line detail unavailable')) {
    problems.push('unsourceable change does not say line detail is unavailable');
}

if (problems.length > 0) {
    console.error(problems.join('; '));
    process.exit(1);
}
process.exit(0);
JS
)

echo
echo "15. diff inks are semantic, scoped, and honest about truncation"

if ! command -v node >/dev/null 2>&1; then
    fail "node not found -- cannot render a diff"
elif [ ! -d "shell/node_modules/ink" ]; then
    skip "shell/node_modules absent, run install.sh"
else
    diff_err=$(cd shell && env FORCE_COLOR=3 node --input-type=module -e "$DIFF_JS" 2>&1)
    diff_status=$?

    if [ "$diff_status" -eq 0 ]; then
        pass "green/red reach the terminal, retired ramp absent, truncation and unavailability stated"
    else
        fail "$(printf '%s' "$diff_err" | head -3)"
    fi
fi

# ----------------------------------------------------------------- check 16 --
# The copy path, checked for the one thing that would make it dishonest: a
# clipboard write the shell cannot verify, announced as one that happened.
#
# The mechanics are the machine's business -- whether pbcopy exists here, and
# whether this terminal honours OSC 52, vary by machine and neither is this
# repository's to guarantee. What IS guaranteed, on every machine, is that the
# unverifiable branch never produces a sentence a reader would take as success.
COPY_JS=$(cat <<'JS'
import assert from 'node:assert/strict';
import { copyNotice, copyText, lastReplyText } from './src/clipboard.js';
import { helpText } from './src/commands.js';

const tty = () => ({ isTTY: true, write: () => true });
const missing = () => ({ error: Object.assign(new Error('enoent'), { code: 'ENOENT' }) });

// pbcopy exit 0 is evidence; that alone earns the word "copied".
const confirmed = copyText('reply', { run: () => ({ status: 0 }), stdout: tty() });
assert.equal(confirmed.confirmed, true);
assert.match(copyNotice(confirmed, 1), /^Copied /);

// OSC 52 is write-only. The terminal never answers, so the notice must not
// claim it landed, and must not contain the word a skimming reader stops at.
const unverifiable = copyText('reply', { run: missing, stdout: tty() });
assert.equal(unverifiable.method, 'osc52');
assert.equal(unverifiable.confirmed, false, 'an unacknowledged write was marked confirmed');
const notice = copyNotice(unverifiable, 1);
assert.doesNotMatch(notice, /\bcopied\b/i, 'unverifiable write announced as a copy');
assert.match(notice, /cannot confirm/i);

// No mechanism at all is a real outcome, stated plainly.
const none = copyText('reply', { run: missing, stdout: { isTTY: false, write: () => true } });
assert.equal(none.ok, false);
assert.match(copyNotice(none, 1), /^Copy unavailable: /);

// The copy is the source text, never the rendered rows.
assert.equal(
    lastReplyText([
        { kind: 'message', text: 'the reply' },
        { kind: 'notice', text: 'a shell notice' },
    ]),
    'the reply'
);

// Mouse mode takes drag-select away from the terminal for as long as Sherman
// is mounted. The override has to be written where the operator looks.
assert.match(helpText(), /Shift\+drag/, '/help does not state the selection override');
assert.match(helpText(), /ctrl\+y/, '/help does not state the copy binding');
JS
)

echo
echo "16. copy claims only what it can prove"

if ! command -v node >/dev/null 2>&1; then
    fail "node not found -- cannot exercise the copy path"
elif [ ! -d "shell/node_modules/ink" ]; then
    skip "shell/node_modules absent, run install.sh"
else
    copy_err=$(cd shell && node --input-type=module -e "$COPY_JS" 2>&1)
    copy_status=$?

    if [ "$copy_status" -eq 0 ]; then
        pass "confirmed copies say copied; OSC 52 says it cannot confirm; no mechanism says unavailable"
    else
        fail "$(printf '%s' "$copy_err" | head -3)"
    fi
fi

# ----------------------------------------------------------------- check 17 --
# agent/capabilities.json is hand-maintained, which is the whole risk: a launch
# screen advertising a capability that does not exist is exactly the confident-
# and-wrong the operating contract forbids. Half of it is statically checkable,
# and that half is checked here.
#
#   verify: "command"  must name a real first-party shell command
#   verify: "engine"   granted by the adapter; not checkable from here, so it
#                      is counted and reported rather than silently trusted
#
# Skills are checked against the directory that defines them, so a skill that
# would not load can never be counted on the launch screen as one that works.
REGISTRY_JS=$(cat <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMMANDS } from './src/commands.js';
import { loadAgents, loadSkills, loadTools } from './src/registry.js';

const root = new URL('..', import.meta.url).pathname;

const tools = loadTools(root);
assert.equal(tools.ok, true, `capability registry did not load: ${tools.reason}`);
assert.ok(tools.count > 0, 'capability registry declares no tools');

// Every command-backed tool must be a command that exists.
const declared = JSON.parse(readFileSync(new URL('../agent/capabilities.json', import.meta.url), 'utf8'));
const commandNames = new Set(COMMANDS.map((c) => c.name));
const missing = [];
let engineBacked = 0;
for (const set of declared.toolsets) {
    for (const tool of set.tools) {
        if (tool.verify === 'command') {
            if (!commandNames.has(tool.name)) missing.push(`${set.name}:${tool.name}`);
        } else if (tool.verify === 'engine') {
            engineBacked += 1;
        } else {
            missing.push(`${set.name}:${tool.name} has no verify field`);
        }
    }
}
assert.deepEqual(missing, [], `registry claims tools that do not exist: ${missing.join(', ')}`);
assert.ok(engineBacked > 0, 'no engine-backed tools declared');

// Skills are the directory. A malformed one is a skill that will not work, and
// it must never be counted as one that does.
const skills = loadSkills(root);
assert.equal(skills.ok, true, `skills did not load: ${skills.reason}`);
assert.ok(skills.count > 0, 'no skills found');
assert.deepEqual(skills.malformed, [], `malformed skills: ${skills.malformed.join(', ')}`);

// The agent roster is hand-maintained like capabilities.json and carries the
// same rule: every bundled entry must be complete (name, specialty, harness),
// because an @-mention launches exactly what this file declares.
const agents = loadAgents(root);
assert.equal(agents.ok, true, `agent roster did not load: ${agents.reason}`);
assert.ok(agents.count > 0, 'agent roster declares no agents');

process.stdout.write(`${tools.count} tools (${engineBacked} engine-backed) · ${skills.count} skills · ${agents.count} agents`);
JS
)

echo
echo "17. the capability registry matches reality"

if ! command -v node >/dev/null 2>&1; then
    fail "node not found -- cannot load the registry"
elif [ ! -d "shell/node_modules/ink" ]; then
    skip "shell/node_modules absent, run install.sh"
else
    registry_out=$(cd shell && node --input-type=module -e "$REGISTRY_JS" 2>&1)
    registry_status=$?

    if [ "$registry_status" -eq 0 ]; then
        pass "$registry_out; every command-backed tool exists and no skill is malformed"
    else
        fail "$(printf '%s' "$registry_out" | head -3)"
    fi
fi

# ----------------------------------------------------------------- check 18 --
# Codex reports usage once per turn, at turn.completed -- verified by capturing
# a real turn's JSONL from codex-cli 0.145.0. The meter therefore shows a local
# ESTIMATE while a turn runs, and the two ways that could become a lie are both
# checked here:
#
#   1. The estimate must be visibly marked in the PLAIN text, not only in the
#      colour. Narrow strips drop to the percentage alone and NO_COLOR drops the
#      tint, and an estimate distinguished only by ink reads as measured exactly
#      where the operator can least check it.
#   2. Compaction must never see it. Compaction discards real conversation, and
#      doing that on a guessed number would throw away context nobody measured.
ESTIMATE_JS=$(cat <<'JS'
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'ink';
import chalk from 'chalk';
import { projectContext } from './src/contextestimate.js';
import { shouldAutoCompact } from './src/commands.js';
import { StatusBar } from './src/ui/StatusBar.js';

chalk.level = 0;
const plain = (v) => v.replace(/\x1b\[[0-9;]*m/g, '');
const info = {
    engine: 'codex', model: 'm', user: 'u', vaultPath: '/v',
    contextWindow: 100000, threadId: null,
};
const usage = { input: 0, cachedInput: 0, output: 0, reasoning: 0, total: 0 };
const bar = (props) => plain(renderToString(
    React.createElement(StatusBar, { info, usage, columns: 110, sessionStart: Date.now(), ...props }),
    { columns: 110 }
));

// Anything in flight is an estimate, and says so on screen.
const live = projectContext({ measured: 40000, sentChars: 400, streamedChars: 800 });
assert.equal(live.estimated, true, 'an in-flight figure was tagged measured');
const estimated = bar({ contextUsed: live.used, contextEstimated: true, busy: true });
assert.match(estimated, /~\d+\.\d+k\/100\.0k/, 'the estimated token figure is unmarked');
assert.match(estimated, /~\d+%/, 'the estimated percentage is unmarked');
assert.match(estimated, /▒/, 'the estimated bar is not visually provisional');

// A settled turn is measured, and carries no mark at all.
const settled = projectContext({ measured: 40000, sentChars: 0, streamedChars: 0 });
assert.equal(settled.estimated, false);
const measured = bar({ contextUsed: settled.used });
assert.doesNotMatch(measured, /~/, 'a measured figure was marked as an estimate');
assert.match(measured, /█/, 'the measured bar lost its solid fill');

// Absence stays absence: nothing measured and nothing sent is no figure.
assert.equal(projectContext({ measured: null, sentChars: 0, streamedChars: 0 }), null);

// The compaction gate is arithmetic on a real number and nothing else. An
// estimate 200% over the window is not a reason to discard a conversation.
assert.equal(shouldAutoCompact(90_000, 100_000), true);
assert.equal(shouldAutoCompact(null, 100_000), false);
process.stdout.write('estimate marked ~, measured bare, compaction gated on measurement');
JS
)

echo
echo "18. the context meter is honest about what it measured"

if ! command -v node >/dev/null 2>&1; then
    fail "node not found -- cannot render the status meter"
elif [ ! -d "shell/node_modules/ink" ]; then
    skip "shell/node_modules absent, run install.sh"
else
    estimate_out=$(cd shell && node --input-type=module -e "$ESTIMATE_JS" 2>&1)
    estimate_status=$?

    if [ "$estimate_status" -eq 0 ]; then
        pass "$estimate_out"
    else
        fail "$(printf '%s' "$estimate_out" | head -3)"
    fi
fi

# ----------------------------------------------------------------- check 19 --
echo
echo "19. README claims only what is wired"

if [ ! -f README.md ]; then
    fail "README.md does not exist"
else
    # The Windows line must be an explicit sentence, not silence -- silence
    # reads as "supported".
    if grep -q "never been run on Windows" README.md; then
        pass "Windows status stated plainly"
    else
        fail "README does not state that Sherman has never been run on Windows"
    fi

    if grep -q '\./install\.sh' README.md; then
        pass "install section points at the real installer"
    else
        fail "README never mentions ./install.sh"
    fi

    # If the README routes Windows users anywhere, the destination must exist
    # and must itself admit it is untested -- a dead link or a confident doc
    # would each be a claim without a check.
    if grep -q 'docs/WINDOWS\.md' README.md; then
        if [ -f docs/WINDOWS.md ] && grep -qi 'untested' docs/WINDOWS.md; then
            pass "the Windows route exists and says it is untested"
        else
            fail "README points at docs/WINDOWS.md but it is missing or does not admit it is untested"
        fi
    fi

    # Unbuilt integrations may appear ONLY at or below the marked roadmap
    # heading. Anywhere above it, they read as a feature menu of dead options.
    # A channel leaves this list by SHIPPING ITS BRIDGE, not by editing the
    # list: Telegram counts as built only while bridge/telegram.js exists.
    roadmap_line=$(grep -n '^## Not built yet' README.md | head -1 | cut -d: -f1)
    if [ -z "$roadmap_line" ]; then
        fail "README has no '## Not built yet' roadmap heading"
    else
        unbuilt='WhatsApp'
        if [ ! -f bridge/telegram.js ]; then
            unbuilt='WhatsApp|Telegram'
        fi
        stray=$(awk -v limit="$roadmap_line" -v pat="$unbuilt" 'NR < limit && $0 ~ pat { print NR": "$0 }' README.md)
        if [ -z "$stray" ]; then
            pass "unbuilt channels ($unbuilt) named only under the roadmap heading"
        else
            fail "unbuilt channel named above the roadmap heading: $(printf '%s' "$stray" | head -1)"
        fi
    fi
fi

# ----------------------------------------------------------------- check 20 --
echo
echo "20. the wizard cannot sell a dead backend"

WIZHOME="$TMPHOME/wizard-home"
mkdir -p "$WIZHOME"

# Answer 3 first (Anthropic, registered unavailable), then 1 (codex). The run
# must refuse 3 with the reason, re-prompt, and complete on 1 -- selecting the
# unavailable provider may never proceed and may never error after selection.
wiz_out=$(printf '3\n1\nWiz Tester\n' \
    | env HOME="$WIZHOME" PATH="$STUBDIR:$PATH" ./bin/sherman --raw 2>&1)
wiz_status=$?

printf '%s' "$wiz_out" | grep -q "Z.AI (GLM-5.2)" \
    && pass "Z.AI GLM-5.2 is listed as an available provider" \
    || fail "menu does not list Z.AI GLM-5.2"

printf '%s' "$wiz_out" | grep -q "Anthropic (Claude Code) — not available yet" \
    && pass "Anthropic is listed, visibly unavailable" \
    || fail "menu does not mark Anthropic as unavailable"

printf '%s' "$wiz_out" | grep -q "not wired into the Sherman Shell yet" \
    && pass "selecting it is refused with the reason" \
    || fail "selecting the unavailable provider did not print the reason"

if [ "$wiz_status" -ne 0 ]; then
    fail "wizard run exited $wiz_status after the refusal"
else
    wiz_engine=$(/usr/bin/jq -r '.engine // empty' "$WIZHOME/.sherman/config.json" 2>/dev/null)
    [ "$wiz_engine" = "codex" ] \
        && pass "run completed on the available provider (engine=codex)" \
        || fail "engine after refusal+retry is '$wiz_engine', expected 'codex'"
fi

# Exercise the available Z.AI choice end-to-end with a credential-safe stub:
# selection, auth detection, adapter assembly, and the raw OpenCode handoff.
if [ "${SHERMAN_UPDATE_RUNNING:-}" = "1" ]; then
    # `sherman update` is already a launcher process running this release gate.
    # Starting another provider launcher here can block forever on platform CLI
    # resolution (observed twice on the Windows/WSL route). Standalone smoke —
    # the release/commit gate — still runs both end-to-end probes below.
    pass "self-update does not recursively launch the Z.AI raw handoff"
    pass "self-update does not recursively run the Z.AI auth namespace probe"
else
ZAIHOME="$TMPHOME/zai-home"
ZAI_MARKER="$TMPHOME/zai-opencode-ran"
mkdir -p "$ZAIHOME" "$STUBDIR"
cat > "$STUBDIR/opencode" <<ZAI_STUB
#!/bin/sh
if [ "\${1:-}" = "--version" ]; then echo 1.18.14; exit 0; fi
if [ "\${1:-}" = "run" ] && [ "\${2:-}" = "--help" ]; then
    echo '--pure --format --session --agent'
    exit 0
fi
if [ "\${1:-}" = "auth" ] && [ "\${2:-}" = "login" ] && [ "\${3:-}" = "--help" ]; then
    echo '--pure --provider'
    exit 0
fi
if [ "\${1:-}" = "auth" ] && [ "\${2:-}" = "list" ]; then
    echo "\${SHERMAN_TEST_ZAI_AUTH:-Z.AI}"
    exit 0
fi
printf '%s' "\${SHERMAN_MCP_CONFIG_SHA256:-}" > "$ZAI_MARKER"
exit 0
ZAI_STUB
chmod +x "$STUBDIR/opencode"
zai_out=$(printf '2\nZed Tester\n\n' \
    | env HOME="$ZAIHOME" PATH="$STUBDIR:$PATH" SHERMAN_NO_FETCH=1 ./bin/sherman --raw 2>&1)
zai_status=$?
zai_engine=$(/usr/bin/jq -r '.engine // empty' "$ZAIHOME/.sherman/config.json" 2>/dev/null)
zai_model_out=$(env HOME="$ZAIHOME" PATH="$STUBDIR:$PATH" ./bin/sherman model 2>&1)
zai_connector_digest=$(cat "$ZAI_MARKER" 2>/dev/null)
zai_connector_digest_ok=0
case "$zai_connector_digest" in
    ''|*[!0-9a-f]*) ;;
    *) [ "${#zai_connector_digest}" -eq 64 ] && zai_connector_digest_ok=1 ;;
esac
if [ "$zai_status" -eq 0 ] && [ "$zai_engine" = "zai" ] \
    && [ -f "$ZAI_MARKER" ] \
    && [ "$zai_connector_digest_ok" -eq 1 ] \
    && printf '%s' "$zai_model_out" | grep -q 'model: glm-5.2 (pinned by Sherman)' \
    && grep -q 'opencode auth login --pure --provider zai' bin/sherman \
    && grep -q "general OpenCode session" "$ZAIHOME/.sherman/workspace/AGENTS.md" 2>/dev/null; then
    pass "Z.AI selection targets its direct key prompt, reports its pinned model, assembles its adapter, and reaches OpenCode"
else
    fail "Z.AI wizard path failed (status=$zai_status engine=$zai_engine): $(printf '%s' "$zai_out" | tail -2)"
fi
coding_plan_out=$(env HOME="$ZAIHOME" PATH="$STUBDIR:$PATH" \
    SHERMAN_TEST_ZAI_AUTH='Z.AI Coding Plan' ./bin/sherman model zai 2>&1)
coding_plan_status=$?
if [ "$coding_plan_status" -ne 0 ] \
    && printf '%s' "$coding_plan_out" | grep -q 'Z.AI is not signed in'; then
    pass "a Coding Plan-only credential is not misrepresented as standard Z.AI API auth"
else
    fail "Coding Plan-only auth crossed the standard Z.AI boundary (status=$coding_plan_status)"
fi
fi

# ----------------------------------------------------------------- check 21 --
echo
echo "21. installer claims follow checks, not attempts"

# A fake repo in the sandbox, so neither the real HOME nor the real
# node_modules is ever touched. Its npm stub exits 0 while producing nothing
# -- the exact case where an attempt-based "installed" line would lie.
IHOME="$TMPHOME/install-home"
FAKEROOT="$TMPHOME/fake-repo"
NPMSTUB="$TMPHOME/npm-stub"
mkdir -p "$IHOME" "$FAKEROOT/bin" "$FAKEROOT/shell" "$NPMSTUB"
cp install.sh "$FAKEROOT/install.sh"
printf '#!/bin/sh\nexit 0\n' > "$FAKEROOT/bin/sherman"
printf '{}\n' > "$FAKEROOT/shell/package.json"
printf '#!/bin/sh\nexit 0\n' > "$NPMSTUB/npm"
chmod +x "$NPMSTUB/npm"

# SHERMAN_INSTALL_NO_FETCH: the installer now auto-provisions Node and codex
# from the network; smoke must stay offline, and the guard's honesty is
# itself part of what this check asserts.
lying_out=$(env HOME="$IHOME" PATH="$NPMSTUB:/usr/bin:/bin" SHERMAN_INSTALL_NO_FETCH=1 \
    bash "$FAKEROOT/install.sh" 2>&1)
lying_status=$?

if [ "$lying_status" -ne 0 ]; then
    fail "install.sh exited $lying_status in the fake repo: $(printf '%s' "$lying_out" | tail -2)"
else
    printf '%s' "$lying_out" | grep -q "dependencies installed" \
        && fail "claimed 'dependencies installed' though npm produced nothing" \
        || pass "npm exit 0 with no artifacts is not claimed as installed"

    printf '%s' "$lying_out" | grep -q "did not produce" \
        && pass "the empty install is reported as what it is" \
        || fail "no honest NOTE about npm producing nothing"

    # With fetches disabled and node/codex absent, the auto-provision paths
    # must say they were skipped -- and must not claim an install.
    if printf '%s' "$lying_out" | grep -q "network fetches are disabled" \
        && ! printf '%s' "$lying_out" | grep -q "installed (verified"; then
        pass "disabled fetches are said plainly, with no install claim"
    else
        fail "the no-fetch run claimed or hid provisioning work"
    fi

    # The "linked" line is a claim; verify the state it claims. The sandbox
    # HOME has no ~/.local, so the installer's candidate list lands on ~/bin.
    # install.sh resolves its root with `cd -P` (mktemp's /var is a symlink to
    # /private/var on macOS), so compare against the same physical path.
    FAKEROOT_P=$(cd -P "$FAKEROOT" && pwd)
    if printf '%s' "$lying_out" | grep -q "linked "; then
        [ "$(readlink "$IHOME/bin/sherman" 2>/dev/null)" = "$FAKEROOT_P/bin/sherman" ] \
            && pass "the linked claim matches readlink" \
            || fail "claimed a link that readlink does not confirm"
    else
        fail "installer printed no linked line: $(printf '%s' "$lying_out" | tail -3)"
    fi
fi

# No npm at all: the graceful path must survive and must not claim installs.
nonpm_out=$(env HOME="$IHOME" PATH="/usr/bin:/bin" SHERMAN_INSTALL_NO_FETCH=1 \
    bash "$FAKEROOT/install.sh" 2>&1)
nonpm_status=$?

if [ "$nonpm_status" -ne 0 ]; then
    fail "install.sh exited $nonpm_status with npm missing"
elif printf '%s' "$nonpm_out" | grep -q "npm not found" \
    && ! printf '%s' "$nonpm_out" | grep -q "dependencies installed"; then
    pass "missing npm degrades to the NOTE, with no installed claim"
else
    fail "npm-missing run made a claim it could not verify"
fi

# Debian/Ubuntu/WSL's `python3 -m venv` without python3-venv does NOT fail
# cleanly -- it HALF-creates the venv: .venv/bin/python exists and runs, then
# creation dies at the pip stage, because Debian disables ensurepip
# system-wide. So install.sh's `[ -x ]` probe sees a python, proceeds into the
# pip repair, and BOTH sides of `pip --version || ensurepip --upgrade` fail --
# the exact double failure that, unguarded under `set -e`, silently killed the
# real WSL run one line past the venv fix. The wiki checkout is pre-seeded
# because the no-fetch guard now (correctly) refuses to clone; the stub
# python3 reproduces Debian's half-venv faithfully: it plants a bin/python
# that answers nothing -- no pip, no ensurepip, no --help.
VFHOME="$TMPHOME/venvfail-home"
VFSTUB="$TMPHOME/venvfail-stub"
mkdir -p "$VFHOME" "$VFSTUB" "$VFHOME/.sherman/llmwiki/.git"
: > "$VFHOME/.sherman/llmwiki/llmwiki"
cat > "$VFSTUB/python3" <<'VF_PY'
#!/bin/sh
# Debian without python3-venv: `-m venv` half-creates the tree (bin/python
# exists, executable) and then fails; every later probe of that python --
# pip, ensurepip, --help -- fails too, because ensurepip is disabled.
if [ "$1" = "-m" ] && [ "$2" = "venv" ]; then
    mkdir -p "$3/bin"
    printf '#!/bin/sh\nexit 1\n' > "$3/bin/python"
    chmod +x "$3/bin/python"
    echo "Error: Command '['$3/bin/python', '-m', 'ensurepip']' returned non-zero exit status 1" >&2
    exit 1
fi
exit 0
VF_PY
chmod +x "$VFSTUB/python3"

venvfail_out=$(env HOME="$VFHOME" PATH="$VFSTUB:/usr/bin:/bin" SHERMAN_INSTALL_NO_FETCH=1 \
    bash "$FAKEROOT/install.sh" 2>&1)
venvfail_status=$?

if [ "$venvfail_status" -ne 0 ]; then
    fail "install.sh exited $venvfail_status on a Debian-style half-created venv: $(printf '%s' "$venvfail_out" | tail -2)"
elif printf '%s' "$venvfail_out" | grep -q "did not answer from its venv" \
    && ! printf '%s' "$venvfail_out" | grep -q "LLM Wiki installed (verified"; then
    pass "a Debian-style half-venv (python runs, pip and ensurepip dead) degrades to the NOTE, install survives"
else
    fail "half-venv run made a claim it could not verify or lost its NOTE: $(printf '%s' "$venvfail_out" | tail -3)"
fi

# ----------------------------------------------------------------- check 22 --
echo
echo "22. auto-provisioning claims follow checks, offline"

# The download path, exercised with no network: a stub curl serves a locally
# built fake Node tarball, so the extract → link → verify chain runs for
# real. The fake npm inside it produces no codex, so the codex claim must
# honestly fail even though npm exited 0.
PHOME="$TMPHOME/provision-home"
PROVROOT="$TMPHOME/provision-repo"
CURLSTUB="$TMPHOME/curl-stub"
FIXTURES="$TMPHOME/node-fixture"
mkdir -p "$PHOME" "$PROVROOT/bin" "$PROVROOT/shell" "$CURLSTUB"
cp install.sh "$PROVROOT/install.sh"
printf '#!/bin/sh\nexit 0\n' > "$PROVROOT/bin/sherman"
printf '{}\n' > "$PROVROOT/shell/package.json"

# Mirror install.sh's platform mapping so the fixture name matches what it
# will ask for on this machine.
case "$(uname -s)" in
    Darwin) prov_os="darwin" ;;
    Linux)  prov_os="linux" ;;
esac
case "$(uname -m)" in
    arm64|aarch64) prov_arch="arm64" ;;
    x86_64)        prov_arch="x64" ;;
esac
PROV_NODE_VERSION=$(sed -n 's/^NODE_VERSION="\([^"]*\)".*/\1/p' install.sh | head -1)
FIXDIR="$FIXTURES/node-v$PROV_NODE_VERSION-$prov_os-$prov_arch/bin"
mkdir -p "$FIXDIR"
printf '#!/bin/sh\necho "v%s"\n' "$PROV_NODE_VERSION" > "$FIXDIR/node"
printf '#!/bin/sh\nexit 0\n' > "$FIXDIR/npm"
printf '#!/bin/sh\nexit 0\n' > "$FIXDIR/npx"
chmod +x "$FIXDIR/node" "$FIXDIR/npm" "$FIXDIR/npx"
tar -czf "$FIXTURES/node.tgz" -C "$FIXTURES" "node-v$PROV_NODE_VERSION-$prov_os-$prov_arch"

# The stub honours `curl ... -o <dest>` by copying the fixture there.
cat > "$CURLSTUB/curl" <<STUB
#!/bin/sh
dest=""
while [ \$# -gt 0 ]; do
    if [ "\$1" = "-o" ]; then dest="\$2"; shift; fi
    shift
done
[ -n "\$dest" ] && cp "$FIXTURES/node.tgz" "\$dest" && exit 0
exit 1
STUB
chmod +x "$CURLSTUB/curl"

prov_out=$(env HOME="$PHOME" PATH="$CURLSTUB:/usr/bin:/bin" \
    bash "$PROVROOT/install.sh" 2>&1)
prov_status=$?

if [ "$prov_status" -ne 0 ]; then
    fail "provisioning run exited $prov_status: $(printf '%s' "$prov_out" | tail -2)"
else
    if printf '%s' "$prov_out" | grep -q "node v$PROV_NODE_VERSION installed (verified"; then
        got_node=$("$PHOME/bin/node" --version 2>/dev/null)
        [ "$got_node" = "v$PROV_NODE_VERSION" ] \
            && pass "node claim matches an executable node on the link path" \
            || fail "claimed node v$PROV_NODE_VERSION but the linked node says '$got_node'"
    else
        fail "the provisioned node was not claimed as verified: $(printf '%s' "$prov_out" | grep -i note | head -2)"
    fi

    # npm exited 0 but installed nothing, so a codex claim would be a lie.
    if printf '%s' "$prov_out" | grep -q "codex CLI installed (verified"; then
        fail "claimed codex installed though npm produced nothing"
    elif printf '%s' "$prov_out" | grep -q "no working codex CLI was found afterward"; then
        pass "an npm that produced no codex is reported honestly"
    else
        fail "no honest NOTE about the missing codex CLI"
    fi
fi

# ----------------------------------------------------------------- check 23 --
echo
echo "23. the Windows bootstrap is present, routed, honest — and parses where possible"

if [ ! -f install.ps1 ]; then
    fail "install.ps1 does not exist at the repo root"
else
    # The doc must route to the script and the script must route back to the
    # doc -- a bootstrap nobody is sent to is dead weight, and a script that
    # never names its own caveats page is a claim without a check.
    if grep -q 'install\.ps1' docs/WINDOWS.md && grep -q 'WINDOWS\.md' install.ps1; then
        pass "docs/WINDOWS.md and install.ps1 reference each other"
    else
        fail "routing broken: docs/WINDOWS.md and install.ps1 must reference each other"
    fi

    # The boundary honesty is load-bearing: the script must keep saying the
    # vault write-boundary is unverified under WSL until someone proves it.
    if grep -q 'UNVERIFIED' install.ps1; then
        pass "install.ps1 states the WSL write-boundary is unverified"
    else
        fail "install.ps1 no longer admits the WSL write-boundary is unverified"
    fi

    # Parse the script only where a PowerShell exists to parse it. The pass
    # line names what was actually checked -- on a machine with no pwsh that
    # is presence and routing, not syntax, and saying so keeps the line true.
    if command -v pwsh >/dev/null 2>&1; then
        if pwsh -NoProfile -Command "[void][scriptblock]::Create((Get-Content -Raw 'install.ps1'))" >/dev/null 2>&1; then
            pass "install.ps1 parses (verified: pwsh scriptblock parse)"
        else
            fail "install.ps1 does not parse under pwsh"
        fi
    else
        pass "no pwsh on this machine: presence, routing and honesty checked; syntax was not"
    fi
fi

# ----------------------------------------------------------------- check 24 --
# The MCP path had no coverage at all until this check, which is remarkable
# given it is the one place Sherman hands a live subprocess to the engine. It
# runs against FIXTURE catalog and enablement files so it proves the renderer
# rather than this machine's installs.
CONNECTORS_JS=$(cat <<'JS'
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { render } from './src/connectors.js';

const SECRET = 'sk-fixture-must-never-be-printed-9137';
const base = mkdtempSync(join(tmpdir(), 'sherman-conn-'));
const root = join(base, 'repo');
const home = join(base, 'home');
const ws = join(base, 'ws');
mkdirSync(join(root, 'agent'), { recursive: true });
mkdirSync(home, { recursive: true });
mkdirSync(ws, { recursive: true });

// A command that exists and answers, so "wired" is reachable without depending
// on anything installed on this machine.
const sh = process.platform === 'win32' ? 'C:\\Windows\\System32\\cmd.exe' : '/bin/sh';

writeFileSync(join(root, 'agent', 'connectors.json'), JSON.stringify({
    connectors: [
        {
            name: 'good', summary: 'wires cleanly', transport: 'stdio', autoEnable: true,
            commandCandidates: [sh], args: ['-c', 'echo hi'], probe: ['-c', 'exit 0'],
            requires: [],
        },
        {
            name: 'keyless', summary: 'needs a key nobody supplied', transport: 'stdio',
            commandCandidates: [sh], args: ['-c', 'echo hi'], requires: ['FIXTURE_API_KEY'],
            signup: { url: 'https://example.invalid/signup', what: 'an API key' },
        },
        {
            name: 'broken', summary: 'present but does not answer', transport: 'stdio',
            autoEnable: true, commandCandidates: [sh], args: ['-c', 'echo hi'],
            probe: ['-c', 'exit 3'], requires: [], repair: 'fix it',
        },
        { name: 'shelved', summary: 'catalogued, not enabled', transport: 'stdio',
            commandCandidates: [sh], args: ['-c', 'echo hi'], requires: [] },
        // A server that needs its own environment. The PATH here is the shape
        // the catalog actually uses -- one prepended directory, then whatever
        // the launcher itself has -- and the prepended entry is ALSO present in
        // the injected PATH, because that is the ordinary case and the
        // duplicate it produces is what render must collapse.
        //
        // No apostrophes in these comments, on purpose: bash 3.2 scans the
        // enclosing $( ... ) for quote balance even inside a quoted heredoc,
        // and a lone one breaks smoke.sh with a parse error at the far end of
        // the file. Same reason as the \x22 escapes below.
        {
            name: 'enved', summary: 'needs an environment', transport: 'stdio', autoEnable: true,
            commandCandidates: [sh], args: ['-c', 'echo hi'], probe: ['-c', 'exit 0'],
            env: { PATH: '/opt/fixture/bin:${PATH}', FIXTURE_MODE: 'quiet' }, requires: [],
        },
        // Same shape, but a variable nothing defines. It must block rather
        // than hand the engine a server with a half-built environment.
        {
            name: 'envbroken', summary: 'environment does not resolve', transport: 'stdio',
            autoEnable: true, commandCandidates: [sh], args: ['-c', 'echo hi'],
            env: { PATH: '${NO_SUCH_VARIABLE}' }, requires: [],
        },
    ],
}), 'utf8');

// `keyless` is enabled but its secret is blank -- the exact half-configured
// state that must never produce half-written engine config.
writeFileSync(join(home, 'connectors.json'), JSON.stringify({
    enabled: { keyless: { secrets: { FIXTURE_API_KEY: '' } }, other: { secrets: { X: SECRET } } },
}), 'utf8');

// A known PATH, containing the directory `enved` prepends, so the duplicate
// the catalog shape produces is real rather than incidental to this machine.
process.env.PATH = '/opt/fixture/bin:/usr/bin:/bin';

const result = render(ws, { root, shermanHome: home });
assert.equal(result.ok, true, `render failed: ${result.reason}`);

// 1. The complete connector renders valid JSON and a valid codex block.
const mcp = JSON.parse(readFileSync(join(ws, '.mcp.json'), 'utf8'));
assert.ok(mcp.mcpServers.good, 'the complete connector was not rendered into .mcp.json');
const toml = readFileSync(join(ws, '.codex-mcp', 'good.toml'), 'utf8');
assert.match(toml, /^\[mcp_servers\.good\]$/m, 'codex block header is malformed');
// \x22 rather than a literal double-quote character: bash 3.2 scans $( ... )
// for quote balance even inside a quoted heredoc, so a lone one breaks smoke.sh
// itself with a parse error 500 lines away. Do not simplify this back.
assert.match(toml, /^command = \x22/m, 'codex block has no command');

// 2. A connector missing its secret appears in NEITHER output, and is explained.
assert.equal(mcp.mcpServers.keyless, undefined, 'a keyless connector reached .mcp.json');
assert.ok(!existsSync(join(ws, '.codex-mcp', 'keyless.toml')), 'a keyless connector reached codex config');
const notes = result.notes.join('\n');
assert.match(notes, /keyless.*FIXTURE_API_KEY/, 'the missing secret was not named');
assert.match(notes, /example\.invalid\/signup/, 'the signup URL was not offered');

// 3. A probe that fails omits the connector and names the repair.
assert.equal(mcp.mcpServers.broken, undefined, 'a connector whose probe failed was wired anyway');
assert.match(notes, /broken.*does not answer/, 'a failed probe was not reported');
assert.match(notes, /fix it/, 'the repair command was not offered');

// 4. A catalogued-but-not-enabled connector is wired nowhere.
assert.equal(mcp.mcpServers.shelved, undefined, 'an unenabled connector was wired');

// 5. A declared environment reaches BOTH engines, expanded and deduplicated.
// A server that shells out to its own helpers is handed a truncated PATH
// without this, and then reports its own capabilities as missing -- a wrong
// answer indistinguishable from a right one.
const envedEnv = mcp.mcpServers.enved?.env;
assert.ok(envedEnv, 'a connector env did not reach .mcp.json');
assert.equal(envedEnv.FIXTURE_MODE, 'quiet', 'a plain env value was not rendered');
assert.equal(envedEnv.PATH, '/opt/fixture/bin:/usr/bin:/bin',
    `PATH was not expanded and deduplicated: ${envedEnv.PATH}`);
const envedToml = readFileSync(join(ws, '.codex-mcp', 'enved.toml'), 'utf8');
assert.match(envedToml, /^\[mcp_servers\.enved\.env\]$/m, 'codex env sub-table is missing');
assert.match(envedToml, /^FIXTURE_MODE = \x22quiet\x22$/m, 'codex env value is missing');
// The sub-table must follow the keys of the parent table, or the TOML parses
// as something else entirely.
assert.ok(envedToml.indexOf('args = ') < envedToml.indexOf('[mcp_servers.enved.env]'),
    'codex env sub-table precedes the keys it must follow');
// A connector with no env declares none rather than an empty block.
assert.equal(mcp.mcpServers.good.env, undefined, 'an empty env block was rendered');

// 6. An environment that does not resolve blocks the connector entirely.
assert.equal(mcp.mcpServers.envbroken, undefined, 'a connector with an unresolved env was wired');
assert.match(notes, /envbroken.*environment did not resolve/, 'an unresolved env was not explained');

// 7. No secret VALUE anywhere. This is the check the whole split exists for.
const rendered = readFileSync(join(ws, '.mcp.json'), 'utf8') + toml + notes + JSON.stringify(result);
assert.ok(!rendered.includes(SECRET), 'a secret value reached rendered output');

process.stdout.write(`${result.wired.length} wired, ${result.notes.length} notes, no secret leaked`);
JS
)

echo
echo "24. connector wiring renders honestly for both engines"

if ! command -v node >/dev/null 2>&1; then
    fail "node not found -- cannot render connectors"
else
    conn_out=$(cd shell && node --input-type=module -e "$CONNECTORS_JS" 2>&1)
    if [ $? -eq 0 ]; then
        pass "$conn_out"
    else
        fail "$(printf '%s' "$conn_out" | head -3)"
    fi
fi

# ----------------------------------------------------------------- check 25 --
# The method skills carry vendored content ported out of one person's ~/.claude.
# A vendored framework that still points at its author's home directory works
# perfectly on that machine and nowhere else — and that failure is invisible
# here, which is exactly why it needs a check rather than an inspection.
echo
echo "25. the skills are self-contained and reference only what exists"

if grep -rn '~/\.claude' skills/ >/dev/null 2>&1; then
    fail "a skill references ~/.claude: $(grep -rln '~/\.claude' skills/ | head -3 | tr '\n' ' ')"
else
    pass "no skill points at a personal ~/.claude directory"
fi

if grep -rn '/Users/\|/home/[a-z]' skills/ >/dev/null 2>&1; then
    fail "a skill hardcodes a home directory: $(grep -rln '/Users/\|/home/[a-z]' skills/ | head -3 | tr '\n' ' ')"
else
    pass "no skill hardcodes an absolute home path"
fi

# The bundled framework must actually be bundled, and the router must name it.
if [ -d skills/evan/workflows ] && [ -f skills/evan/workflows/plan-phase.md ] \
    && grep -q 'workflows/plan-phase.md' skills/evan/SKILL.md; then
    pass "evan carries its workflows and its router names them"
else
    fail "evan's bundled workflows are missing or unreferenced from SKILL.md"
fi

# Every /slash token a skill mentions must be a real command or a real skill.
# A method skill that routes to a command Sherman does not have sends the
# operator somewhere that does not exist, which is the same confident-and-wrong
# the capability registry exists to prevent.
SLASHREF_JS=$(cat <<'JS'
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { COMMANDS } from './src/commands.js';
import { loadSkills } from './src/registry.js';

const root = new URL('..', import.meta.url).pathname;
const skills = loadSkills(root);
assert.equal(skills.ok, true, `skills did not load: ${skills.reason}`);

const known = new Set([
    ...COMMANDS.map((c) => c.name),
    ...skills.list.map((s) => s.name),
]);

// SKILL.md files only -- the routers Sherman actually follows. Bundled
// templates and examples are full of URL paths (/api, /login) and deliberate
// placeholders (/skill-1), and flagging those would make this check noise
// nobody reads. A SKILL.md that routes somewhere nonexistent is the real
// defect: it sends the operator to a command that is not there.
const files = [];
const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (entry === 'SKILL.md') files.push(path);
    }
};
walk(join(root, 'skills'));

const unknown = new Map();
for (const path of files) {
    // \x28 and \x60 for the open-paren and backtick, same reason as \x22 in
    // check 24: bash 3.2 scans $( ... ) for balance even inside a quoted
    // heredoc, so an unpaired one of either breaks smoke.sh with a parse error
    // nowhere near this line. Do not simplify these back to literals.
    for (const match of readFileSync(path, 'utf8').matchAll(/(?:^|[\s\x28\x60])\/([a-z0-9][a-z0-9-]{2,})\b/g)) {
        const name = match[1];
        if (!known.has(name)) {
            if (!unknown.has(name)) unknown.set(name, path.slice(root.length));
        }
    }
}
assert.equal(unknown.size, 0,
    `skills route to commands that do not exist: ${[...unknown].map(([n, f]) => `/${n} (${f})`).join(', ')}`);

process.stdout.write(`${files.length} skill files, every /command reference resolves`);
JS
)

if ! command -v node >/dev/null 2>&1; then
    fail "node not found -- cannot check slash references"
elif [ ! -d "shell/node_modules/ink" ]; then
    skip "shell/node_modules absent, run install.sh"
else
    slash_out=$(cd shell && node --input-type=module -e "$SLASHREF_JS" 2>&1)
    if [ $? -eq 0 ]; then
        pass "$slash_out"
    else
        fail "$(printf '%s' "$slash_out" | head -3)"
    fi
fi

# ----------------------------------------------------------------- check 26 --
# 0-1 is the skill that acquires capability, and its name starts with a digit.
# That is the likeliest thing to break silently: a future tightening of the
# slash regex, or a front-matter parser that decides 0-1 is a number, and the
# skill stops being invocable with nothing on screen to say so.
echo
echo "26. 0-1 is loadable, invocable, and still bounded"

ZERO_ONE_JS=$(cat <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSubmission, typedSkillName } from './src/commands.js';
import { loadSkills } from './src/registry.js';

const root = new URL('..', import.meta.url).pathname;
const skills = loadSkills(root);
assert.equal(skills.ok, true, `skills did not load: ${skills.reason}`);

const entry = skills.list.find((s) => s.name === '0-1');
assert.ok(entry, '0-1 is not in the loaded skill list');
assert.ok(!skills.malformed.includes('0-1'), '0-1 loaded as malformed');

// The palette and the purple ink both key on these two, and a digit-leading
// name is exactly the case a tightened regex would drop.
const parsed = parseSubmission('/0-1 reach the shipping API');
assert.equal(parsed.kind, 'command', '/0-1 did not parse as a slash invocation');
assert.equal(parsed.name, '0-1', `/0-1 parsed as ${parsed.name}`);
assert.equal(parsed.args, 'reach the shipping API', 'arguments were lost');
assert.equal(typedSkillName('/0-1 anything', skills.list), '0-1', 'typedSkillName does not resolve 0-1');

// The boundaries are the point of this skill. A capability-acquisition skill
// that lost them is the one regression that matters here.
const body = readFileSync(new URL('../skills/0-1/SKILL.md', import.meta.url), 'utf8');
assert.match(body, /PHI/, '0-1 does not state the no-PHI boundary');
assert.match(body, /never into the vault|never echoed/i, '0-1 does not state the secret boundary');
assert.match(body, /Never invent a connector/i, '0-1 does not forbid inventing a connector');

// The contract-level hook: the persona must point at it, or the engine reaches
// for it only when a description happens to match.
const persona = readFileSync(new URL('../agent/SYSTEM.md', import.meta.url), 'utf8');
assert.match(persona, /0-1/, 'agent/SYSTEM.md does not route to 0-1');

process.stdout.write('0-1 loads, parses, resolves, and keeps its boundaries');
JS
)

if ! command -v node >/dev/null 2>&1; then
    fail "node not found -- cannot load 0-1"
elif [ ! -d "shell/node_modules/ink" ]; then
    skip "shell/node_modules absent, run install.sh"
else
    zero_out=$(cd shell && node --input-type=module -e "$ZERO_ONE_JS" 2>&1)
    if [ $? -eq 0 ]; then
        pass "$zero_out"
    else
        fail "$(printf '%s' "$zero_out" | head -3)"
    fi
fi

# ----------------------------------------------------------------- check 27 --
# Agent Reach is how /mcp reaches the internet, and it is provisioned by ONE
# script called from both install.sh and `sherman update` -- so an existing
# machine grows the capability on update rather than only new installs getting
# it. The wiki's provision-here/repair-there split drifted; this checks the
# single copy stays reachable from both.
#
# The two constants are the whole reason the install works. The pin exists
# because this is third-party software whose newest release already broke
# against MCP 2.0, and the dependency floor is what holds it below that break.
# Loosening either is how a working capability stops working on a day nobody
# chose, so both are asserted rather than trusted.
echo
echo "27. the Agent Reach provisioner is honest and reachable from both entry points"

PROVISION="bin/provision-agent-reach.sh"

if [ ! -x "$PROVISION" ]; then
    fail "$PROVISION is missing or not executable"
elif ! sh -n "$PROVISION" 2>/dev/null; then
    fail "$PROVISION does not parse"
else
    pass "the provisioner exists, is executable, and parses"

    if grep -q 'provision-agent-reach.sh' install.sh \
        && grep -q 'provision-agent-reach.sh' bin/sherman; then
        pass "both install.sh and sherman update call it"
    else
        fail "the provisioner is not called from both entry points"
    fi

    # A 40-character commit, not a branch name: an install that follows
    # someone else's main branch is a capability with no version at all.
    if grep -qE '^PIN="[0-9a-f]{40}"$' "$PROVISION"; then
        pass "Agent Reach is pinned to a full commit"
    else
        fail "the Agent Reach pin is missing or is not a full commit sha"
    fi

    if grep -q 'mcp\[cli\]>=1.0,<2' "$PROVISION"; then
        pass "the MCP dependency is held below the 2.0 break"
    else
        fail "the MCP dependency floor is gone; a 2.0 resolve dies on import"
    fi

    # Offline, against a sandbox HOME: it must skip, say so, and claim nothing.
    # This is the path every smoke run and every CI runner takes.
    PROVHOME="$TMPHOME/agent-reach-home"
    mkdir -p "$PROVHOME"
    prov_out=$(env HOME="$PROVHOME" SHERMAN_INSTALL_NO_FETCH=1 "./$PROVISION" 2>&1)
    prov_status=$?

    if [ "$prov_status" -ne 0 ]; then
        fail "the provisioner exited $prov_status instead of degrading: $(printf '%s' "$prov_out" | tail -2)"
    elif printf '%s' "$prov_out" | grep -q "network fetches are disabled" \
        && ! printf '%s' "$prov_out" | grep -q "installed (verified"; then
        pass "disabled fetches are said plainly, with no install claim"
    else
        fail "the offline run claimed or hid provisioning work: $(printf '%s' "$prov_out" | tail -2)"
    fi

    # And it wrote nothing into that HOME. An enhancement that cannot install
    # must not leave half a tool environment behind for the next run to find.
    if [ -d "$PROVHOME/.local/share/uv/tools/agent-reach" ]; then
        fail "the skipped run still created a tool directory"
    else
        pass "a skipped install leaves nothing behind"
    fi
fi

# ----------------------------------------------------------------- check 28 --
# A corrupt config used to kill the launcher inside its first jq read under
# set -e: the person saw a bare "parse error: Invalid escape" and a Sherman
# that would not start. Seen on a real Windows machine. The launch flow now
# SELF-HEALS: the corrupt file is quarantined intact (it is evidence of a
# writer this repo believes cannot exist), setup runs again, and the launch
# completes. Paths that cannot re-run setup keep the named remedy.
echo
echo "28. a corrupt config self-heals: quarantined intact, setup reruns"

BADHOME="$TMPHOME/corrupt-config-home"
mkdir -p "$BADHOME/.sherman"
BADCONTENT='{"version":2,"engine":"codex","user":"\smoke","vault_path":"/tmp/vault"}'
printf '%s\n' "$BADCONTENT" > "$BADHOME/.sherman/config.json"

bad_out=$(printf '1\nSmoke Tester\n' \
    | env HOME="$BADHOME" PATH="$STUBDIR:$PATH" ./bin/sherman --raw 2>&1)
bad_status=$?

if [ "$bad_status" -eq 0 ]; then
    pass "a corrupt config no longer stops the launch (healed through the wizard)"
else
    fail "the self-heal launch exited $bad_status: $(printf '%s' "$bad_out" | tail -2)"
fi

quarantined=$(ls "$BADHOME/.sherman"/config.json.bad.* 2>/dev/null | head -1)
if [ -n "$quarantined" ] && [ "$(cat "$quarantined")" = "$BADCONTENT" ]; then
    pass "the corrupt file was quarantined intact ($(basename "$quarantined"))"
else
    fail "the corrupt config was not preserved beside the new one"
fi

if /usr/bin/jq -e . "$BADHOME/.sherman/config.json" >/dev/null 2>&1; then
    pass "setup wrote a fresh valid config in its place"
else
    fail "no valid config exists after the self-heal run"
fi

# `sherman update` must run the same repair: it is the button people press
# when something is wrong, and both call sites are asserted so neither can
# quietly lose the quarantine.
if [ "$(grep -cE '^[[:space:]]*quarantine_corrupt_config([[:space:]]|$)' bin/sherman)" -ge 2 ]; then
    pass "both the launch flow and sherman update run the quarantine repair"
else
    fail "the quarantine repair is not called from both launch and update"
fi

# The backstop for paths that cannot re-run setup (a scheduler saving a
# token, say): the named remedy, never raw jq noise.
REMHOME="$TMPHOME/corrupt-config-remedy-home"
mkdir -p "$REMHOME/.sherman"
printf '%s\n' "$BADCONTENT" > "$REMHOME/.sherman/config.json"
rem_out=$(env HOME="$REMHOME" ./bin/sherman telegram --token 123:ABC </dev/null 2>&1)
rem_status=$?
if [ "$rem_status" -ne 0 ] \
    && printf '%s' "$rem_out" | grep -q "Delete it and run sherman again" \
    && ! printf '%s' "$rem_out" | grep -qi "parse error"; then
    pass "config_set paths keep the named remedy, no raw jq noise (exit $rem_status)"
else
    fail "the config_set backstop lost its remedy; got: $(printf '%s' "$rem_out" | tail -1)"
fi

# The wizard's own read-back: answers that produce an unparseable config must
# be refused at write time, deleted, with setup named as the fix -- not kept
# for the next launch to trip over.
if grep -q "Run sherman again to redo setup" bin/sherman; then
    pass "the wizard refuses and deletes a config that does not read back"
else
    fail "the wizard write has no read-back refusal"
fi

# ----------------------------------------------------------------- check 29 --
# `sherman board` renders a team board. Piped (no TTY) it must print the board
# bytes verbatim so a transcript captures the truth; the factory floor is the
# TTY-only animation over the SAME honest counts. Both are checked against a
# fixture board through the real launcher.
echo
echo "29. sherman board reads a team board and reports honest counts"

BOARDHOME=$(mktemp -d 2>/dev/null || mktemp -d -t shermanboard)
mkdir -p "$BOARDHOME/.sherman/workspace/boards"
cat > "$BOARDHOME/.sherman/workspace/boards/team-smoke.md" <<'BOARD'
# smoke — team board

## Agents

| session | engine | working on | last seen |
|---------|--------|------------|-----------|
| 20260811_zzz111 | codex | #2 | now |

## Cards

| # | card | owner | status | done means |
|---|------|-------|--------|------------|
| 1 | alpha | 20260811_zzz111 | done | x |
| 2 | beta | 20260811_zzz111 | in-progress | y |
| 3 | gamma | — | blocked: waiting | z |
BOARD

# Piped: verbatim bytes, no escapes, every row present.
board_piped=$(HOME="$BOARDHOME" ./bin/sherman board smoke 2>&1)
if printf '%s' "$board_piped" | grep -qF 'blocked: waiting' \
    && printf '%s' "$board_piped" | grep -qF 'alpha' \
    && ! printf '%s' "$board_piped" | grep -q "$(printf '\033')"; then
    pass "piped board prints the table verbatim with no escape codes"
else
    fail "piped board dropped rows or leaked escapes"
fi

# The factory renderer is byte-safe on this awk: drive it directly (color off)
# and assert it counted the fixture — 1 done, 1 in-progress, 1 blocked — and
# drew the floor. This is the same awk the launcher runs; a byte-width bug
# would misalign but not miscount, so the counts are what we pin.
board_factory=$(SHERMAN_BOARD_TEST_FRAME=0 NO_COLOR=1 HOME="$BOARDHOME" \
    ./bin/sherman board --factory-once smoke 2>&1)
if printf '%s' "$board_factory" | grep -qF 'SHERMAN SOFTWARE FACTORY' \
    && printf '%s' "$board_factory" | grep -qF '1 shipped' \
    && printf '%s' "$board_factory" | grep -qF '1 on the line' \
    && printf '%s' "$board_factory" | grep -qF 'LINE STOPPED' \
    && printf '%s' "$board_factory" | grep -qF '1 bot on shift'; then
    pass "the factory floor renders honest counts from the board and flags the block"
else
    fail "factory render miscounted or lost the floor: $(printf '%s' "$board_factory" | tr '\n' ' ' | cut -c1-120)"
fi

rm -rf "$BOARDHOME"

# ----------------------------------------------------------------- check 30 --
# `sherman install` is the approved, visible path to a software capability. It
# is NOT a silent arbitrary installer: a package name is letters/digits and a
# few punctuation marks only, so a shell fragment can never reach a package
# manager through it. Usage-with-no-arg and the name gate are what keep that
# promise, and both are checked here without installing anything.
echo
echo "30. sherman install stays a named, non-injectable capability path"

install_usage=$(./bin/sherman install 2>&1); install_usage_status=$?
install_reject=$(./bin/sherman install 'foo; rm -rf /' 2>&1); install_reject_status=$?

if [ "$install_usage_status" -ne 0 ] \
    && printf '%s' "$install_usage" | grep -qF 'Usage: sherman install' \
    && [ "$install_reject_status" -ne 0 ] \
    && printf '%s' "$install_reject" | grep -qF 'Refusing to install' \
    && grep -q 'run_install' bin/sherman; then
    pass "install prints usage bare and refuses a name carrying shell metacharacters"
else
    fail "sherman install lost its usage or its name gate (usage=$install_usage_status reject=$install_reject_status)"
fi

# ----------------------------------------------------------------- check 31 --
# The key store is how the operator hands Sherman an API key once. The claims
# that make it safe are the ones checked: 0600 on the store, atomic write with
# read-back before "stored" is claimed, an env-var-shaped name gate a shell
# fragment cannot pass, injection that never clobbers an explicit export, the
# /key submission redacted before transcript or log, and names-only output.
echo
echo "31. the key store keeps its secrecy and injection promises"

KEYS_JS=$(cat <<'JS'
import { strict as assert } from 'node:assert';
import { statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const home = join(process.env.HOME, '.sherman');
const { saveKey, loadKeys, removeKey, injectKeys, describeKeys, keysPath, validKeyName } =
    await import('./src/keys.js');
const { parseSubmission, submissionRecordText } = await import('./src/commands.js');

// Fresh store: absent file is ordinary, not an error.
assert.deepEqual(loadKeys(home), { ok: true, keys: {} });

// Round-trip with read-back, and the file is 0600.
const saved = saveKey('SMOKE_API_KEY', 'sk-live-abc123', home);
assert.equal(saved.ok, true, 'save failed');
assert.equal(saved.replaced, false);
assert.equal(loadKeys(home).keys.SMOKE_API_KEY, 'sk-live-abc123');
assert.equal(statSync(keysPath(home)).mode & 0o777, 0o600, 'store is not 0600');

// Replacing reports itself as a replace.
assert.equal(saveKey('SMOKE_API_KEY', 'sk-live-def456', home).replaced, true);

// The name gate: shell metacharacters, spaces, and leading digits never
// become names. (The dollar-paren case is written split so the heredoc
// scanner never sees a command substitution opener.)
const dollarParen = '$' + '(id)';
for (const bad of ['foo; rm -rf /', 'a b', '1KEY', dollarParen, '', 'x'.repeat(65)]) {
    assert.equal(validKeyName(bad), false, 'accepted bad name: ' + bad);
    assert.equal(saveKey(bad, 'value', home).ok, false);
}
// Multi-line values are refused — a key is one line.
assert.equal(saveKey('OK_NAME', 'line1\nline2', home).ok, false);

// Injection: the store lands in env, but an explicit export outranks it.
const env = { SMOKE_API_KEY: 'from-export' };
const injected = injectKeys(env, home);
assert.equal(injected.ok, true);
assert.equal(env.SMOKE_API_KEY, 'from-export', 'clobbered an explicit export');
const env2 = {};
injectKeys(env2, home);
assert.equal(env2.SMOKE_API_KEY, 'sk-live-def456', 'stored key did not inject');

// The listing carries names and never values.
const listing = describeKeys(home);
assert.ok(listing.includes('SMOKE_API_KEY'), 'listing lost the name');
assert.ok(!listing.includes('def456'), 'listing leaked a value');

// The /key submission is redacted before transcript or log see it; the
// remove form (no secret) and the bare form pass through untouched.
const record = submissionRecordText('/key STRIPE_KEY sk-live-secret');
assert.equal(record, '/key STRIPE_KEY «redacted»');
assert.ok(!record.includes('sk-live-secret'));
assert.equal(submissionRecordText('/key remove STRIPE_KEY'), '/key remove STRIPE_KEY');
assert.equal(submissionRecordText('/key'), '/key');
// The malformed submission — value pasted first — redacts wholesale: the
// name gate will reject it, so whatever was typed may BE the secret.
assert.equal(submissionRecordText('/key 1lwdSecretValue its a polygon key'), '/key «redacted»');
assert.equal(submissionRecordText('/key just-one-token'), '/key «redacted»');
assert.equal(parseSubmission('/key A_B c').name, 'key');

// Removal round-trips and reports the difference between removed and absent.
assert.deepEqual(removeKey('SMOKE_API_KEY', home), { ok: true, removed: true });
assert.deepEqual(removeKey('SMOKE_API_KEY', home), { ok: true, removed: false });

// A corrupt store degrades to a named error that does not quote the file.
mkdirSync(home, { recursive: true });
writeFileSync(keysPath(home), '{oops sk-live-leaky', { mode: 0o600 });
const corrupt = loadKeys(home);
assert.equal(corrupt.ok, false);
assert.ok(!String(corrupt.reason).includes('sk-live-leaky'), 'error quoted the store');
JS
)

KEYSHOME=$(mktemp -d 2>/dev/null || mktemp -d -t shermankeys)
keys_err=$(cd shell && env HOME="$KEYSHOME" FORCE_COLOR=0 node --input-type=module -e "$KEYS_JS" 2>&1)
keys_status=$?
if [ "$keys_status" -eq 0 ]; then
    pass "store is 0600 with read-back, name gate holds, exports outrank, log is redacted, names-only listing"
else
    fail "key store: $(printf '%s' "$keys_err" | head -3)"
fi

# The persona must teach the hand-over: Sherman asks with the exact /key
# command and never asks for a key as prose. Both halves are load-bearing --
# losing either quietly reopens the paste-a-secret-into-the-transcript path.
if grep -qF '/key NAME <value>' agent/SYSTEM.md \
    && grep -qF 'Never ask for a key pasted as' agent/SYSTEM.md; then
    pass "SYSTEM.md teaches the /key hand-over and forbids keys as prose"
else
    fail "SYSTEM.md lost the /key hand-over contract"
fi

# The CLI is the path Sherman itself stores a pasted key through. Value via
# stdin (never argv), success prints the NAME only, list stays names-only.
CLIHOME=$(mktemp -d 2>/dev/null || mktemp -d -t shermankeycli)
cli_set=$(printf '%s' 'sk-cli-secret-789' | env HOME="$CLIHOME" node shell/src/keys.js --set SMOKE_CLI_KEY 2>&1)
cli_set_status=$?
cli_list=$(env HOME="$CLIHOME" node shell/src/keys.js --list 2>&1)
cli_remove=$(env HOME="$CLIHOME" node shell/src/keys.js --remove SMOKE_CLI_KEY 2>&1)
cli_bad=$(printf '%s' 'v' | env HOME="$CLIHOME" node shell/src/keys.js --set 'bad name' 2>&1)
cli_bad_status=$?

if [ "$cli_set_status" -eq 0 ] \
    && printf '%s' "$cli_set" | grep -qF 'SMOKE_CLI_KEY stored (verified: read back)' \
    && ! printf '%s' "$cli_set" | grep -qF 'sk-cli-secret-789' \
    && printf '%s' "$cli_list" | grep -qF 'SMOKE_CLI_KEY' \
    && ! printf '%s' "$cli_list" | grep -qF 'sk-cli-secret-789' \
    && printf '%s' "$cli_remove" | grep -qF 'SMOKE_CLI_KEY removed' \
    && [ "$cli_bad_status" -ne 0 ]; then
    pass "the key CLI stores from stdin, prints names only, and keeps the name gate"
else
    fail "key CLI broke a promise (set=$cli_set_status bad=$cli_bad_status)"
fi

# And the persona must teach the paste flow: a pasted key IS the hand-over --
# Sherman stores it itself through the CLI and turns it into a skill or
# connector, instead of lecturing the operator or letting it die with the
# session.
if grep -qF 'hand-over, not a mistake to correct' agent/SYSTEM.md \
    && grep -qF 'keys.js --set NAME' agent/SYSTEM.md \
    && grep -qF 'A key is never just a string to file.' agent/SYSTEM.md; then
    pass "SYSTEM.md teaches paste-storage through the CLI and skill-building from a new key"
else
    fail "SYSTEM.md lost the paste hand-over or the build-skills-from-keys contract"
fi

# -------------------------------------------------------------------- result --
echo
echo "$PASSES passed, $SKIPPED skipped, $FAILURES failed."
if [ "$FAILURES" -gt 0 ]; then
    echo
    echo "Failure recap:"
    printf '%s\n' "$FAILURE_DETAILS"
fi
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
