#!/bin/sh
# Agent Reach — the connector that lets Sherman read the public internet.
#
# Shared by install.sh and `sherman update`, because those are the two moments
# a machine is allowed to grow a capability, and the LLM Wiki's split — one
# copy that provisions, another that repairs — has already drifted once. One
# file, called from both.
#
# What it provisions is NOT only the MCP server. Agent Reach's MCP server
# exposes exactly one tool, get_status; the fetching is its command-line tool.
# So the install has to land a CLI on the operator's PATH, which is what
# `uv tool install` does and what a private venv would not: a venv's bin
# directory is not on anyone's PATH, and the skill reaches for `agent-reach`
# through ordinary shell access.
#
# Pinned to a commit, deliberately. This is a third-party tool whose newest
# release already broke once against a dependency (MCP 2.0 vs the server API
# it is written for), and an install that silently follows someone else's main
# branch is a capability that stops working on a day nobody chose.
#
# Every step degrades to an honest NOTE and exits 0. Agent Reach is an
# enhancement: a machine that cannot have it still deserves a working Sherman,
# and the connector catalog already reports a missing one with its repair
# command rather than handing the engine a server that dies at startup.

set -u

PIN="b4d52c46c9113cb0f653d6df4cf71ebadf4930ac"
ARCHIVE="https://github.com/Panniantong/agent-reach/archive/$PIN.zip"
# The dependency floor that install verified. Agent Reach is written against
# the 1.x server API; MCP 2.0 changes it and the server dies on import.
MCP_SPEC='mcp[cli]>=1.0,<2'

TOOL_DIR="$HOME/.local/share/uv/tools/agent-reach"

# Where the caller's messages are indented to. install.sh indents by two.
PREFIX="${AGENT_REACH_LOG_PREFIX:-  }"
say() { echo "$PREFIX$1"; }

# The interpreter uv put in the tool environment, Unix or Windows layout.
tool_python() {
    if [ -x "$TOOL_DIR/bin/python" ]; then
        echo "$TOOL_DIR/bin/python"
    elif [ -x "$TOOL_DIR/Scripts/python.exe" ]; then
        echo "$TOOL_DIR/Scripts/python.exe"
    fi
}

# The same probe the connector catalog uses, for the same reason: files
# existing is not an install. A tool environment whose dependencies resolved
# wrong imports nothing, passes every existence check, and then hands the
# engine a server that dies on startup — far from here, where the operator
# cannot connect it to a cause.
answers() {
    py=$(tool_python)
    [ -n "$py" ] || return 1
    "$py" -c 'import agent_reach.integrations.mcp_server' >/dev/null 2>&1
}

if answers; then
    # Healthy costs one interpreter start and says nothing. `sherman update` is
    # pressed often; it should be quiet when there is nothing to report.
    exit 0
fi

if [ -n "${SHERMAN_INSTALL_NO_FETCH:-}" ]; then
    say "NOTE: network fetches are disabled, so Agent Reach was not installed."
    exit 0
fi

say "installing Agent Reach (internet access for /mcp — 15 platforms)"

# uv, or uv installed first. Checked on PATH and at the location its own
# installer uses, because a shell that has not been restarted since uv landed
# will not have picked it up yet.
UV=""
if command -v uv >/dev/null 2>&1; then
    UV="uv"
elif [ -x "$HOME/.local/bin/uv" ]; then
    UV="$HOME/.local/bin/uv"
else
    if ! command -v curl >/dev/null 2>&1; then
        say "NOTE: neither uv nor curl is here, so Agent Reach was not installed."
        say "      Install uv (https://astral.sh/uv) and re-run: sherman update"
        exit 0
    fi
    say "installing uv first (Agent Reach ships as a uv tool)"
    curl -LsSf https://astral.sh/uv/install.sh 2>/dev/null | sh >/dev/null 2>&1 || true
    if command -v uv >/dev/null 2>&1; then
        UV="uv"
    elif [ -x "$HOME/.local/bin/uv" ]; then
        UV="$HOME/.local/bin/uv"
    else
        say "NOTE: uv could not be installed, so Agent Reach was not installed."
        say "      Install it from https://astral.sh/uv and re-run: sherman update"
        exit 0
    fi
fi

# --force so a half-built or wrongly-resolved tool environment is replaced
# rather than kept. This is the repair path as much as the install path.
install_out=$("$UV" tool install --force --with "$MCP_SPEC" "$ARCHIVE" 2>&1) || true

if answers; then
    say "Agent Reach installed (verified: its MCP server imports from its own environment)"
    # Two separate facts, and the second is the one people trip on. The MCP
    # server is reachable through the connector regardless of PATH — the
    # catalog hands the engine an absolute interpreter path. The CLI is what
    # the skill actually fetches with, and that needs a PATH the operator has.
    if command -v agent-reach >/dev/null 2>&1; then
        say "agent-reach CLI on PATH ($(command -v agent-reach))"
    else
        say "NOTE: the agent-reach CLI is not on this PATH, so /mcp can read status but not fetch."
        say "      Add it:  export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi
    # Channels are per-machine and mostly need a login the operator owns, so
    # this reports rather than promises. Six work with no configuration.
    say "run /mcp in Sherman to see which of the 15 channels are live here"
else
    say "NOTE: Agent Reach did not install cleanly; /mcp will report it as not installed."
    if [ -n "$install_out" ]; then
        say "      $(printf '%s\n' "$install_out" | tail -1)"
    fi
fi

exit 0
