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

# ------------------------------------------------------------ OpenCode CLI --
# The Z.AI GLM provider runs through OpenCode, so a fresh install should leave
# BOTH engines launchable — otherwise picking Z.AI in the wizard turns into an
# install step the wizard has to run mid-question. Same contract as the codex
# block: install with a non-/mnt npm, link if npm's global bin is off PATH,
# and claim "installed" only after the CLI answers --version. Optional like
# the wiki: a machine that cannot have it still deserves a working Sherman.
linux_opencode() {
    for c in "$RUNTIME"/node-*/bin/opencode "$TARGET_DIR/opencode"; do
        [ -x "$c" ] && { printf '%s' "$c"; return 0; }
    done
    c=$(command -v opencode 2>/dev/null || true)
    case "$c" in ''|/mnt/*) return 1 ;; esac
    printf '%s' "$c"
}

if opencode_bin=$(linux_opencode) && "$opencode_bin" --version >/dev/null 2>&1; then
    echo "  opencode CLI found (Z.AI GLM engine; sign-in stays its own)"
elif [ -n "${SHERMAN_INSTALL_NO_FETCH:-}" ]; then
    echo "  NOTE: the opencode CLI is missing and network fetches are disabled"
    echo "        (SHERMAN_INSTALL_NO_FETCH). Nothing was installed."
    echo "        Install it yourself:  npm install -g opencode-ai"
elif [ -z "$npm_bin" ]; then
    echo "  NOTE: the opencode CLI is missing and there is no npm to install it"
    echo "        with. Once Node 22+ is present, re-run ./install.sh"
else
    echo "  installing the opencode CLI for Z.AI GLM (npm install -g opencode-ai)"
    "$npm_bin" install -g opencode-ai --silent >/dev/null 2>&1 || true

    if ! linux_opencode >/dev/null; then
        npm_prefix=$("$npm_bin" prefix -g 2>/dev/null || true)
        if [ -n "$npm_prefix" ] && [ -x "$npm_prefix/bin/opencode" ]; then
            ln -sfn "$npm_prefix/bin/opencode" "$TARGET_DIR/opencode"
        fi
    fi

    if opencode_bin=$(linux_opencode) && "$opencode_bin" --version >/dev/null 2>&1; then
        echo "  opencode CLI installed (verified: opencode --version)"
    else
        echo "  NOTE: npm ran but no working opencode CLI was found afterward."
        echo "        Install it by hand:  npm install -g opencode-ai"
        echo "        Codex remains fully usable without it."
    fi
fi

# --------------------------------------------------------- shell dependencies --
# The Sherman Shell is a Node app (Ink). `npm ci` installs the lockfile
# EXACTLY -- it wipes node_modules first, so re-running install.sh repairs a
# tree that has drifted from the lock rather than layering onto it. That
# matters: a stale transitive width dependency (an older get-east-asian-width
# that measures the composer box one cell short) is how the first Linux
# machine failed the composer and node:test width checks while a fresh macOS
# tree passed. `npm ci` is idempotent too, so this stays safe to re-run -- R7.
# Only a machine with no lockfile to be exact against falls back to install.
#
# A missing npm is a warning, not a failure: the PATH symlink below is still
# worth creating, and `sherman --raw` works with no Node at all. Aborting here
# would leave the user with no `sherman` command over an optional dependency.
if [ -f "$ROOT/shell/package.json" ]; then
    if command -v npm >/dev/null 2>&1; then
        if [ -f "$ROOT/shell/package-lock.json" ]; then
            echo "  installing shell dependencies (npm ci)"
            shell_npm="npm ci --silent"
        else
            echo "  installing shell dependencies (npm install)"
            shell_npm="npm install --silent"
        fi
        # "installed" is claimed only if the artifacts the shell actually
        # imports exist afterward -- npm exiting 0 is an attempt's report,
        # not a verification.
        if (cd "$ROOT/shell" && $shell_npm >/dev/null 2>&1) \
            && [ -d "$ROOT/shell/node_modules/ink" ] \
            && [ -d "$ROOT/shell/node_modules/react" ]; then
            echo "  shell dependencies installed (node_modules/ink and react verified)"
        else
            echo "  NOTE: npm did not produce the shell's dependencies."
            echo "        Run it by hand:  cd $ROOT/shell && npm ci"
            echo "        Until then:      sherman --raw"
        fi
    else
        echo "  NOTE: npm not found, so shell dependencies were not installed."
        echo "        The shell needs Node 22+ and npm. Until then: sherman --raw"
    fi
fi

# ------------------------------------------------------------------ llm wiki --
# The optional personal research wiki (github.com/lucasastorian/llmwiki).
# Sherman's explicit /wiki writes to vault/wiki; this separate
# MCP exists only for explicit personal-research requests. Provisioned OUTSIDE
# the repo at ~/.sherman/llmwiki with its workspace at ~/.sherman/research.
#
# Every step degrades to an honest NOTE instead of failing the install: the
# wiki is an enhancement, and a machine without python3 still deserves a
# working Sherman. "Installed" is claimed only after the CLI answers --help
# from its own venv — pip exiting 0 is an attempt's report, not a verification.
echo "  installing the optional personal research LLM Wiki"
WIKI_DIR="$HOME/.sherman/llmwiki"
WIKI_WS="$HOME/.sherman/research"
if ! command -v git >/dev/null 2>&1; then
    echo "  NOTE: git not found, so the LLM Wiki was not installed."
elif ! command -v python3 >/dev/null 2>&1; then
    echo "  NOTE: python3 not found, so the LLM Wiki was not installed."
    echo "        Install Python 3.11+ and re-run ./install.sh"
else
    mkdir -p "$HOME/.sherman"
    # The clone and pull are network fetches, and the no-fetch guard covers
    # them like every other fetch in this script -- an "offline" smoke run
    # was reaching across the network here. An already-present checkout is
    # still provisioned below from whatever state it has.
    if [ -n "${SHERMAN_INSTALL_NO_FETCH:-}" ]; then
        [ -d "$WIKI_DIR" ] \
            || echo "  NOTE: network fetches are disabled, so the LLM Wiki was not cloned."
    elif [ -d "$WIKI_DIR/.git" ]; then
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
            # A venv can exist without pip: Debian/Ubuntu's `python3 -m venv`
            # without python3-venv half-creates it -- bin/python exists and
            # runs, then venv creation dies at the pip stage, because Debian
            # DISABLES ensurepip system-wide. So this repair can fail on both
            # sides, and without the trailing `|| true` that double failure
            # trips `set -e` and silently kills the whole install right here --
            # the second, quieter instance of the venv-creation bug one line up.
            "$WIKI_PY" -m pip --version >/dev/null 2>&1 \
                || "$WIKI_PY" -m ensurepip --upgrade >/dev/null 2>&1 || true
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
                echo "  NOTE: the optional personal research LLM Wiki CLI did not answer from its venv."
            fi
        else
            echo "  NOTE: could not create the optional personal research wiki's Python venv."
        fi
    fi
fi
echo

# ----------------------------------------------------------------- mnemosyne --
# Long-term agent memory (github.com/mnemosyne-oss/mnemosyne, MIT): a local
# MCP every Sherman gets — remember/recall/knowledge-graph over a SQLite +
# vector store that lives entirely on this machine. Pinned to a reviewed
# version; no cloud, no telemetry, data under ~/.sherman/mnemosyne/data.
# Same degradation contract as the wiki: every failure is an honest NOTE,
# and "installed" is claimed only after the CLI answers from its own venv.
echo "  installing mnemosyne — Sherman's long-term memory"
MNEMO_DIR="$HOME/.sherman/mnemosyne"
MNEMO_PIN="mnemosyne-memory==3.15.1"
MNEMO_BIN="$MNEMO_DIR/.venv/bin/mnemosyne"
[ -x "$MNEMO_BIN" ] || MNEMO_BIN="$MNEMO_DIR/.venv/Scripts/mnemosyne.exe"
if ! command -v python3 >/dev/null 2>&1; then
    echo "  NOTE: python3 not found, so mnemosyne was not installed."
elif [ -n "${SHERMAN_INSTALL_NO_FETCH:-}" ] && [ ! -x "$MNEMO_BIN" ]; then
    echo "  NOTE: network fetches are disabled, so mnemosyne was not installed."
else
    mkdir -p "$MNEMO_DIR/data"
    MNEMO_PY="$MNEMO_DIR/.venv/bin/python"
    [ -x "$MNEMO_PY" ] || MNEMO_PY="$MNEMO_DIR/.venv/Scripts/python.exe"
    # Same two-stage venv repair as the wiki: creation can fail without
    # python3-venv, and a half-created venv can lack pip entirely.
    [ -x "$MNEMO_PY" ] || python3 -m venv "$MNEMO_DIR/.venv" >/dev/null 2>&1 || true
    MNEMO_PY="$MNEMO_DIR/.venv/bin/python"
    [ -x "$MNEMO_PY" ] || MNEMO_PY="$MNEMO_DIR/.venv/Scripts/python.exe"
    if [ -x "$MNEMO_PY" ]; then
        "$MNEMO_PY" -m pip --version >/dev/null 2>&1 \
            || "$MNEMO_PY" -m ensurepip --upgrade >/dev/null 2>&1 || true
        if [ -z "${SHERMAN_INSTALL_NO_FETCH:-}" ]; then
            mnemo_pip_out=$("$MNEMO_PY" -m pip install --quiet "$MNEMO_PIN" 2>&1) \
                || echo "  NOTE: pip could not install mnemosyne: $(printf '%s\n' "$mnemo_pip_out" | tail -1)"
        fi
        MNEMO_BIN="$MNEMO_DIR/.venv/bin/mnemosyne"
        [ -x "$MNEMO_BIN" ] || MNEMO_BIN="$MNEMO_DIR/.venv/Scripts/mnemosyne.exe"
        if [ -x "$MNEMO_BIN" ] && "$MNEMO_BIN" --help >/dev/null 2>&1; then
            echo "  mnemosyne installed (verified: its CLI answers from its own venv)"
            echo "  memory store: $MNEMO_DIR/data"
        else
            echo "  NOTE: mnemosyne's CLI did not answer from its venv."
        fi
    else
        echo "  NOTE: could not create mnemosyne's Python venv (is python3-venv installed?)."
    fi
fi
echo

# --------------------------------------------------------------- desktop pet --
# macOS only. The pet compiles from pet/sherman-pet.swift with the system
# Swift toolchain; doing it here means `sherman pet` starts instantly on a
# fresh machine instead of pausing on a first-run compile. The binary name
# carries the source hash — the same contract as `sherman pet` — so the two
# never fight over staleness. A Mac without the Xcode Command Line Tools
# gets an honest NOTE, not a failure: the pet is an enhancement, and git
# needing those same tools means most machines that cloned this repo have
# them already.
if [ "$(uname -s)" = "Darwin" ] && [ -f "$ROOT/pet/sherman-pet.swift" ]; then
    if command -v swiftc >/dev/null 2>&1; then
        pet_hash=$(shasum "$ROOT/pet/sherman-pet.swift" 2>/dev/null | cut -c1-12)
        pet_bin="$HOME/.sherman/pet/sherman-pet-$pet_hash"
        if [ -x "$pet_bin" ]; then
            echo "  desktop pet already compiled (start it with: sherman pet)"
        else
            echo "  compiling the desktop pet (sherman pet starts it)"
            mkdir -p "$HOME/.sherman/pet"
            if swiftc -swift-version 5 -O "$ROOT/pet/sherman-pet.swift" -o "$pet_bin" >/dev/null 2>&1 \
                && [ -x "$pet_bin" ]; then
                echo "  desktop pet compiled (verified: binary present and executable)"
                echo "        start it any time with:  sherman pet"
            else
                rm -f "$pet_bin"
                echo "  NOTE: the pet did not compile; sherman pet will retry and report the error."
            fi
        fi
    else
        echo "  NOTE: the desktop pet needs the Xcode Command Line Tools to compile."
        echo "        Install them with:  xcode-select --install   then run sherman pet."
    fi
fi
echo

# -------------------------------------------------------------- agent reach --
# Internet access for /mcp. Shared with `sherman update` rather than copied,
# because the wiki's provision-here/repair-there split has already drifted.
if [ -x "$ROOT/bin/provision-agent-reach.sh" ]; then
    "$ROOT/bin/provision-agent-reach.sh" || true
else
    echo "  NOTE: bin/provision-agent-reach.sh is missing, so Agent Reach was not installed."
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
        # The paste finishes the job: the PATH line is appended to the shell
        # profile HERE, idempotently, and claimed only after reading it back —
        # telling a person to edit a dotfile is the installer not finishing.
        # zsh (macOS default) reads ~/.zprofile at login and ~/.zshrc for
        # interactive shells; writing both covers every terminal app. The
        # marker comment is what makes re-runs and human edits detectable.
        path_line="export PATH=\"$TARGET_DIR:\$PATH\""
        case "${SHELL:-/bin/zsh}" in
            */bash) profiles="$HOME/.bash_profile" ;;
            */zsh)  profiles="$HOME/.zprofile $HOME/.zshrc" ;;
            *)      profiles="$HOME/.profile" ;;
        esac
        path_added=""
        for profile in $profiles; do
            if grep -Fqs "$TARGET_DIR" "$profile" 2>/dev/null; then
                path_added="$path_added $profile"
                continue
            fi
            { printf '\n# Added by Sherman install.sh — puts the sherman command on PATH\n%s\n' "$path_line" >> "$profile"; } 2>/dev/null || continue
            if grep -Fqs "$TARGET_DIR" "$profile" 2>/dev/null; then
                path_added="$path_added $profile"
            fi
        done
        if [ -n "$path_added" ]; then
            echo "  PATH configured in:$path_added (verified: read back)"
            echo
            echo "  New terminals pick it up automatically. In THIS terminal, run:"
            echo
            echo "      export PATH=\"$TARGET_DIR:\$PATH\""
            echo
            echo "  then:"
            echo
            echo "      sherman"
            echo
        else
            echo "  NOTE: $TARGET_DIR is NOT on your PATH and no shell profile"
            echo "  could be written. Add this line to your shell profile yourself:"
            echo
            echo "      export PATH=\"$TARGET_DIR:\$PATH\""
            echo
            echo "  Until then you can run it directly:"
            echo
            echo "      $ROOT/bin/sherman"
            echo
        fi
        ;;
esac
