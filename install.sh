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
chmod +x "$ROOT/bin/sherman"
[ -f "$ROOT/smoke.sh" ] && chmod +x "$ROOT/smoke.sh"
echo "  bin/sherman is executable"

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

echo "  linked $TARGET_DIR/sherman -> $ROOT/bin/sherman"
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
