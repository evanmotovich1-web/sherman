#!/usr/bin/env bash
#
# install.sh — put `sherman` on your PATH.
#
# Idempotent: safe to run as many times as you like. Re-running repairs the
# symlink and re-reports where things landed.
#
# Target shell: macOS system bash 3.2.

set -euo pipefail

ROOT=$(cd -P "$(dirname "$0")" && pwd)

echo
echo "Installing Sherman Abrams"
echo

# ------------------------------------------------------------ make runnable --
# Every success line in this script follows a CHECK, never an attempt: claim
# only what was verified, the same honesty rule the shell lives under.
chmod +x "$ROOT/bin/sherman"
[ -f "$ROOT/smoke.sh" ] && chmod +x "$ROOT/smoke.sh"
[ -f "$ROOT/shell/bin/sherman-shell.js" ] && chmod +x "$ROOT/shell/bin/sherman-shell.js"
if [ -x "$ROOT/bin/sherman" ]; then
    echo "  bin/sherman is executable"
else
    echo >&2
    echo "bin/sherman is still not executable after chmod +x." >&2
    echo "Check the filesystem (mount options, permissions) and re-run." >&2
    exit 1
fi

# --------------------------------------------------------- shell dependencies --
# The Sherman Shell is a Node app (Ink). `npm install` is idempotent, so this
# stays safe to re-run -- R7.
#
# A missing npm is a warning, not a failure: the PATH symlink below is still
# worth creating, and `sherman --raw` works with no Node at all. Aborting here
# would leave the user with no `sherman` command over an optional dependency.
if [ -f "$ROOT/shell/package.json" ]; then
    if command -v npm >/dev/null 2>&1; then
        echo "  installing shell dependencies (npm install)"
        # "installed" is claimed only if the artifacts the shell actually
        # imports exist afterward -- npm exiting 0 is an attempt's report,
        # not a verification.
        if (cd "$ROOT/shell" && npm install --silent >/dev/null 2>&1) \
            && [ -d "$ROOT/shell/node_modules/ink" ] \
            && [ -d "$ROOT/shell/node_modules/react" ]; then
            echo "  shell dependencies installed (node_modules/ink and react verified)"
        else
            echo "  NOTE: npm install did not produce the shell's dependencies."
            echo "        Run it by hand:  cd $ROOT/shell && npm install"
            echo "        Until then:      sherman --raw"
        fi
    else
        echo "  NOTE: npm not found, so shell dependencies were not installed."
        echo "        The shell needs Node 22+ and npm. Until then: sherman --raw"
    fi
fi

# ------------------------------------------------------------- pick a PATH --
# Priority order. First usable candidate wins.
#
#   ~/.local/bin     — where claude, codex and hermes already live on macOS
#   ~/bin            — classic personal bin
#   /usr/local/bin   — system-wide; usually needs sudo, so it is last
#
# A candidate is usable if it exists and is writable, or if it does not exist
# but its parent is writable so we can create it.
TARGET_DIR=""
for candidate in "$HOME/.local/bin" "$HOME/bin" "/usr/local/bin"; do
    if [ -d "$candidate" ] && [ -w "$candidate" ]; then
        TARGET_DIR="$candidate"
        break
    fi
    if [ ! -d "$candidate" ]; then
        parent=$(dirname "$candidate")
        if [ -d "$parent" ] && [ -w "$parent" ]; then
            mkdir -p "$candidate"
            TARGET_DIR="$candidate"
            echo "  created $candidate"
            break
        fi
    fi
done

if [ -z "$TARGET_DIR" ]; then
    echo >&2
    echo "Could not find a writable directory for the sherman command." >&2
    echo "Tried: ~/.local/bin, ~/bin, /usr/local/bin" >&2
    echo >&2
    echo "Create one and re-run, for example:" >&2
    echo "    mkdir -p ~/.local/bin && ./install.sh" >&2
    exit 1
fi

# -f replaces an existing link so reinstall is clean.
# -n stops ln nesting a new link *inside* an existing symlinked directory.
ln -sfn "$ROOT/bin/sherman" "$TARGET_DIR/sherman"

# Claim the link only after reading it back. readlink without -f -- macOS
# system bash 3.2 land has no readlink -f, and the first hop is what ln wrote.
if [ "$(readlink "$TARGET_DIR/sherman" 2>/dev/null)" = "$ROOT/bin/sherman" ]; then
    echo "  linked $TARGET_DIR/sherman -> $ROOT/bin/sherman"
else
    echo >&2
    echo "The symlink at $TARGET_DIR/sherman does not point at $ROOT/bin/sherman." >&2
    echo "Something else owns that path. Remove it and re-run ./install.sh" >&2
    exit 1
fi
echo

# --------------------------------------------------- what you still need --
# Reported, never installed: install.sh does not provide Node or the engine
# CLI, and saying nothing would read as "handled".
if command -v node >/dev/null 2>&1; then
    node_version=$(node --version 2>/dev/null)
    node_major=$(printf '%s' "$node_version" | sed 's/^v//' | cut -d. -f1)
    case "$node_major" in
        ''|*[!0-9]*)
            echo "  NOTE: could not read a Node version from '$node_version'. The shell needs Node 22+." ;;
        *)
            if [ "$node_major" -ge 22 ]; then
                echo "  node $node_version found (shell needs 22+: ok)"
            else
                echo "  NOTE: node $node_version is too old -- the shell needs Node 22+."
                echo "        Until you upgrade: sherman --raw"
            fi ;;
    esac
else
    echo "  NOTE: node not found. The Sherman Shell needs Node 22+."
    echo "        Until then: sherman --raw"
fi

if command -v codex >/dev/null 2>&1; then
    echo "  codex CLI found (sign-in stays codex's own)"
else
    echo "  NOTE: codex CLI not found -- Sherman runs on Codex today."
    echo "        Install it:  npm install -g @openai/codex"
fi
echo

# ----------------------------------------------------------- report on PATH --
case ":$PATH:" in
    *":$TARGET_DIR:"*)
        echo "  $TARGET_DIR is on your PATH."
        echo
        echo "Done. Run:"
        echo
        echo "    sherman"
        echo
        ;;
    *)
        echo "  NOTE: $TARGET_DIR is NOT on your PATH."
        echo
        echo "  Add this to your shell profile (~/.zshrc or ~/.bash_profile):"
        echo
        echo "      export PATH=\"$TARGET_DIR:\$PATH\""
        echo
        echo "  Then open a new terminal and run:"
        echo
        echo "      sherman"
        echo
        echo "  Until then you can run it directly:"
        echo
        echo "      $ROOT/bin/sherman"
        echo
        ;;
esac
