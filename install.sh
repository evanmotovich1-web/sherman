#!/usr/bin/env bash
#
# install.sh — put `sherman` on your PATH, and provision what it needs.
#
# Idempotent: safe to run as many times as you like. Re-running repairs the
# symlink, reuses anything already provisioned, and re-reports where things
# landed.
#
# Missing prerequisites are INSTALLED, not just reported:
#
#   Node 22+     downloaded from nodejs.org into ~/.sherman/runtime (no sudo)
#   Codex CLI    npm install -g into that same runtime
#
# The one thing this script cannot do is sign you in: the engine's own login
# runs on first launch, in your browser, on your account.
#
# Every success line follows a CHECK, never an attempt -- the same honesty
# rule the shell lives under. SHERMAN_INSTALL_NO_FETCH=1 disables all
# network fetches (smoke.sh uses it); the skipped work is then said plainly.
#
# Target shell: macOS system bash 3.2. Also runs on Linux/WSL bash.

set -euo pipefail

ROOT=$(cd -P "$(dirname "$0")" && pwd)

NODE_VERSION="22.23.2"
RUNTIME="$HOME/.sherman/runtime"

echo
echo "Installing Sherman Abrams"
echo

# ------------------------------------------------------------ make runnable --
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

# ------------------------------------------------------------- pick a PATH --
# Chosen early because provisioned tools land here too. Priority order; first
# usable candidate wins.
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

# Provisioned tools become visible to the rest of THIS run immediately. The
# user's real PATH is remembered first: the report at the end must describe
# THEIR shell, not this script's temporarily widened one.
ORIG_PATH="$PATH"
PATH="$TARGET_DIR:$PATH"

# --------------------------------------------------------------- Node 22+ --
# The shell is an Ink app; Node 22+ is a hard requirement. If the machine has
# none (or one too old), fetch the official build into ~/.sherman/runtime and
# link it -- no sudo, no package manager, nothing outside Sherman's own dirs.
node_major_of() {
    printf '%s' "$1" | sed 's/^v//' | cut -d. -f1
}

node_is_ok() {
    command -v node >/dev/null 2>&1 || return 1
    v=$(node --version 2>/dev/null)
    m=$(node_major_of "$v")
    case "$m" in
        ''|*[!0-9]*) return 1 ;;
    esac
    [ "$m" -ge 22 ]
}

if node_is_ok; then
    echo "  node $(node --version) found (shell needs 22+: ok)"
else
    case "$(uname -s)" in
        Darwin) node_os="darwin" ;;
        Linux)  node_os="linux" ;;
        *)      node_os="" ;;
    esac
    case "$(uname -m)" in
        arm64|aarch64) node_arch="arm64" ;;
        x86_64)        node_arch="x64" ;;
        *)             node_arch="" ;;
    esac

    NODE_HOME="$RUNTIME/node-v$NODE_VERSION-$node_os-$node_arch"

    if [ -n "${SHERMAN_INSTALL_NO_FETCH:-}" ]; then
        echo "  NOTE: Node 22+ is missing and network fetches are disabled"
        echo "        (SHERMAN_INSTALL_NO_FETCH). Nothing was downloaded."
        echo "        Install Node 22+ yourself, then re-run ./install.sh"
    elif [ -z "$node_os" ] || [ -z "$node_arch" ]; then
        echo "  NOTE: no Node 22+ found and no official build exists for"
        echo "        $(uname -s)/$(uname -m). Install Node 22+ yourself,"
        echo "        then re-run ./install.sh"
    elif ! command -v curl >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
        echo "  NOTE: no Node 22+ found, and curl or tar is missing, so it"
        echo "        could not be downloaded. Install Node 22+ yourself,"
        echo "        then re-run ./install.sh"
    else
        # Reuse a runtime an earlier run already extracted -- idempotence is
        # cheaper than a re-download and proves the same thing at the end:
        # the version check below is what earns the "installed" line.
        if [ ! -x "$NODE_HOME/bin/node" ]; then
            tarball="node-v$NODE_VERSION-$node_os-$node_arch.tar.gz"
            echo "  downloading Node v$NODE_VERSION ($node_os-$node_arch) from nodejs.org"
            mkdir -p "$RUNTIME"
            if ! curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$tarball" \
                    -o "$RUNTIME/$tarball" \
                || ! tar -xzf "$RUNTIME/$tarball" -C "$RUNTIME"; then
                rm -f "$RUNTIME/$tarball"
                echo "  NOTE: the Node download failed. Nothing was installed."
                echo "        Install Node 22+ yourself, then re-run ./install.sh"
            fi
            rm -f "$RUNTIME/$tarball"
        fi

        if [ -x "$NODE_HOME/bin/node" ]; then
            ln -sfn "$NODE_HOME/bin/node" "$TARGET_DIR/node"
            ln -sfn "$NODE_HOME/bin/npm"  "$TARGET_DIR/npm"
            ln -sfn "$NODE_HOME/bin/npx"  "$TARGET_DIR/npx"

            got=$("$TARGET_DIR/node" --version 2>/dev/null || true)
            if [ "$got" = "v$NODE_VERSION" ]; then
                echo "  node $got installed (verified: node --version)"
            else
                echo "  NOTE: the downloaded Node did not verify"
                echo "        (expected v$NODE_VERSION, got '$got')."
                echo "        Install Node 22+ yourself, then re-run ./install.sh"
            fi
        fi
    fi
fi

# --------------------------------------------------------------- Codex CLI --
# Sherman runs on Codex today. If the CLI is missing, install it globally
# with whichever npm is now available (the provisioned runtime's npm keeps
# this sudo-free). Signing in stays Codex's own -- it happens on first
# launch, never here.
#
# "Present" means a codex THIS system can run. Under WSL, Windows' PATH
# shines through interop, and the Windows npm drops an extensionless shim
# at /mnt/c/.../npm/codex that Linux happily executes -- straight into
# "Missing optional dependency @openai/codex-linux-x64", because the
# package it loads is the Windows one. Counting that shim as an install
# left the first real Windows machine with no runnable codex at all, so
# anything under /mnt is disqualified here -- for codex, and for the npm
# used to install it.
linux_codex() {
    for c in "$RUNTIME"/node-*/bin/codex "$TARGET_DIR/codex"; do
        [ -x "$c" ] && { printf '%s' "$c"; return 0; }
    done
    c=$(command -v codex 2>/dev/null || true)
    case "$c" in ''|/mnt/*) return 1 ;; esac
    printf '%s' "$c"
}

npm_bin=$(command -v npm 2>/dev/null || true)
case "$npm_bin" in /mnt/*) npm_bin="" ;; esac

if codex_bin=$(linux_codex) && "$codex_bin" --version >/dev/null 2>&1; then
    echo "  codex CLI found (sign-in stays codex's own)"
elif [ -n "${SHERMAN_INSTALL_NO_FETCH:-}" ]; then
    echo "  NOTE: the codex CLI is missing and network fetches are disabled"
    echo "        (SHERMAN_INSTALL_NO_FETCH). Nothing was installed."
    echo "        Install it yourself:  npm install -g @openai/codex"
elif [ -z "$npm_bin" ]; then
    echo "  NOTE: the codex CLI is missing and there is no npm to install it"
    echo "        with. Once Node 22+ is present, re-run ./install.sh"
else
    echo "  installing the codex CLI (npm install -g @openai/codex)"
    "$npm_bin" install -g @openai/codex --silent >/dev/null 2>&1 || true

    # npm's global bin may not be on PATH (the provisioned runtime's is not,
    # until linked). Resolve where npm actually put it, link it next to
    # sherman, and only then decide whether "installed" is true.
    if ! linux_codex >/dev/null; then
        npm_prefix=$("$npm_bin" prefix -g 2>/dev/null || true)
        if [ -n "$npm_prefix" ] && [ -x "$npm_prefix/bin/codex" ]; then
            ln -sfn "$npm_prefix/bin/codex" "$TARGET_DIR/codex"
        fi
    fi

    if codex_bin=$(linux_codex) && "$codex_bin" --version >/dev/null 2>&1; then
        echo "  codex CLI installed (verified: codex --version)"
        echo "        sign-in is codex's own; it runs on first launch"
    else
        echo "  NOTE: npm ran but no working codex CLI was found afterward."
        echo "        Install it by hand:  npm install -g @openai/codex"
    fi
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

# ------------------------------------------------------------------ llm wiki --
# The personal research wiki (github.com/lucasastorian/llmwiki): every Sherman
# install gets one, so /wiki can fold each session's learnings into it over
# MCP. Provisioned OUTSIDE the repo at ~/.sherman/llmwiki with its workspace
# at ~/.sherman/research — it is per-machine tooling, not Sherman source.
#
# Every step degrades to an honest NOTE instead of failing the install: the
# wiki is an enhancement, and a machine without python3 still deserves a
# working Sherman. "Installed" is claimed only after the CLI answers --help
# from its own venv — pip exiting 0 is an attempt's report, not a verification.
echo "  installing the LLM Wiki (personal research wiki, used by /wiki)"
WIKI_DIR="$HOME/.sherman/llmwiki"
WIKI_WS="$HOME/.sherman/research"
if ! command -v git >/dev/null 2>&1; then
    echo "  NOTE: git not found, so the LLM Wiki was not installed."
elif ! command -v python3 >/dev/null 2>&1; then
    echo "  NOTE: python3 not found, so the LLM Wiki was not installed."
    echo "        Install Python 3.11+ and re-run ./install.sh"
else
    mkdir -p "$HOME/.sherman"
    if [ -d "$WIKI_DIR/.git" ]; then
        # ff-only: a user's local edits to their wiki tooling are theirs.
        (cd "$WIKI_DIR" && git pull --ff-only --quiet >/dev/null 2>&1) \
            || echo "  NOTE: could not update the existing LLM Wiki checkout; keeping it as is."
    else
        git clone --quiet https://github.com/lucasastorian/llmwiki.git "$WIKI_DIR" >/dev/null 2>&1 \
            || echo "  NOTE: could not clone the LLM Wiki repository (offline?)."
    fi

    WIKI_PY="$WIKI_DIR/.venv/bin/python"
    if [ -f "$WIKI_DIR/llmwiki" ]; then
        # venv creation itself fails outright on Debian/Ubuntu/WSL when the
        # python3-venv package is absent -- the same split the pip repair below
        # handles, one layer earlier. The trailing `|| true` keeps that failure
        # from tripping `set -e` and aborting the whole install; the venv is an
        # enhancement, so it must degrade to the NOTE below, not kill Sherman.
        [ -x "$WIKI_PY" ] || python3 -m venv "$WIKI_DIR/.venv" >/dev/null 2>&1 || true
        if [ -x "$WIKI_PY" ]; then
            # A venv can exist without pip (Debian and WSL split it out of
            # python3-venv's minimal install); ensurepip is the repair for
            # exactly that, and it is a no-op where pip already works.
            "$WIKI_PY" -m pip --version >/dev/null 2>&1 \
                || "$WIKI_PY" -m ensurepip --upgrade >/dev/null 2>&1
            # On failure, say what pip said — its last line names the actual
            # problem (a missing module, a network refusal, a compiler), and
            # a NOTE without it leaves the operator rerunning installs blind.
            wiki_pip_out=$("$WIKI_PY" -m pip install --quiet \
                -r "$WIKI_DIR/api/requirements.txt" \
                -r "$WIKI_DIR/mcp/requirements.txt" 2>&1) \
                || echo "  NOTE: pip could not install the wiki's dependencies: $(printf '%s\n' "$wiki_pip_out" | tail -1)"
            # The web app is optional UI; the MCP works without it. Installed
            # when npm exists, skipped silently when it does not.
            if command -v npm >/dev/null 2>&1 && [ -f "$WIKI_DIR/web/package.json" ]; then
                (cd "$WIKI_DIR/web" && npm install --silent >/dev/null 2>&1) || true
            fi
            if "$WIKI_PY" "$WIKI_DIR/llmwiki" --help >/dev/null 2>&1; then
                mkdir -p "$WIKI_WS"
                "$WIKI_PY" "$WIKI_DIR/llmwiki" init "$WIKI_WS" >/dev/null 2>&1 || true
                echo "  LLM Wiki installed (verified: its CLI answers from its own venv)"
                echo "  wiki workspace: $WIKI_WS"
            else
                echo "  NOTE: the LLM Wiki CLI did not answer from its venv; /wiki will say it is not installed."
            fi
        else
            echo "  NOTE: could not create the wiki's Python venv; /wiki will say it is not installed."
        fi
    fi
fi
echo

# --------------------------------------------------------------- link sherman --
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

# ----------------------------------------------------------- report on PATH --
# Judged against the PATH the user's shell actually has, not the one this
# script widened for its own run.
case ":$ORIG_PATH:" in
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
