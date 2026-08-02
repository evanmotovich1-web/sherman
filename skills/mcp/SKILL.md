---
name: mcp
category: agent
summary: reach outside Sherman through a wired connector, and name the one you used
description: Use a wired MCP connector to reach something outside Sherman — the public internet, web search, your research wiki — instead of guessing or giving up. Use whenever a request needs live information, a page, a repository, a video, or a feed, and to report what Sherman is connected to.
---

# Reach outside through something that is actually wired

Sherman's own knowledge stops at the vault and the model's weights. Everything
past that — a live page, a search, a repository, a video transcript, a feed —
arrives through a **connector**: an MCP server the launcher wired into this
session from the catalog at `agent/connectors.json`.

This skill is how you use one. `0-1` is how you get one you do not have.

## When to use it

Whenever the answer depends on something outside the vault and outside general
knowledge: what a page says right now, what a repository contains, what people
are saying about a product, what a video covers, what a feed has published.

Do not use it to answer a company question. Company questions go to
`vault-search` first — the vault is the truth about this business, and the
public internet is not.

Do not use it to avoid saying "I do not know." A connector that is not wired is
a gap to close with `0-1`, not a reason to invent the answer you would have
found.

## First: know what is actually wired

Two sources, and they answer different questions.

- `/connectors` — what the catalog holds and what this machine enabled. Three
  headings: Connected, Needs a key, Available.
- `.mcp.json` in your workspace — what the launcher actually rendered for this
  session. This is the file the engine read.

Read one of them before claiming a capability. "Sherman can search the web" is
true or false depending on a file, and the file is right there.

A connector is wired only when everything holds: enabled, secrets present,
files present, command executable, and its probe answered. Anything short of
that is omitted and reported, never half-written — so a name that appears in
`.mcp.json` is a name that answered at launch.

## What is in the catalog today

| Connector | Reaches | Shape |
| --- | --- | --- |
| `llmwiki` | your personal research memory | MCP tools: search, then write |
| `agent-reach` | the public internet, 15 platforms | one MCP tool plus a command-line tool |
| `exa` | semantic web search over live pages | MCP tools, Claude Code only |

`exa` is HTTP transport, and HTTP connectors are wired for Claude Code alone.
Under Codex it is not there. Check rather than assume, and say which engine you
are in if the answer differs.

## Using agent-reach, honestly

Agent Reach is the one connector whose MCP server is **not** where its power
is, and getting this wrong wastes a turn.

Its MCP server exposes exactly one tool: `get_status`. That tool reports which
of the fifteen channels are installed and active on this machine. It does not
fetch anything.

The fetching is the `agent-reach` command-line tool and the per-platform
commands it routes to, run through your ordinary shell access.

So the order is:

1. **Check first.** Call `get_status`, or run `agent-reach doctor --json`.
   Channels differ per machine, and several need a login the operator owns.
   Six work with no configuration at all; the rest do not.
2. **Say what you are using** before you use it — which platform, which
   backend. One line.
3. **Run the command for the backend the status reported.** Do not invent a
   command for a channel that is dark, and do not substitute a scrape for a
   channel that needs a login.
4. **Report what you could not reach.** A four-of-fifteen answer described as
   a complete sweep is the confident-and-wrong this whole project refuses. Name
   the channels that were dark and what would light them.

Its own skill documentation ships with the tool and carries the per-platform
command tables and retry chains. Read those rather than guessing at flags.

Scratch files belong in the system temp directory or `~/.agent-reach`, never in
the workspace.

## When nothing wired fits

Say so in one sentence, then use `0-1`. That skill verifies the connector is
real, wires it when no person is required, and hands over one precise
account-and-key checklist when one is. Do every unblocked part of the work
before you ask for the key.

Never invent a catalog entry to make a capability appear. An invented entry is
engine config that fails at startup, which the operator meets as one causeless
error a long way from its cause.

## The boundaries

These are not adjustable by a request.

- **No PHI crosses a connector.** Not in a search query, not in a page fetch,
  not in a repository issue, not in a wiki write. A connector is an outbound
  path off this machine, and patient-identifying information does not take it.
  If a request would send PHI outward, stop that part and say why.
- **Secret names, never values.** You may say a connector needs a key and name
  it. You may not print, log, echo, or write its value — not to the vault, not
  to a file, not into a command you show.
- **External reach is stated, not slipped in.** When a turn reaches outside the
  company, say that it did and where. Nobody should learn from a bill.
- **Public search is not company truth.** What you find outside is evidence
  about the world. It does not overrule the vault about this company, and it
  does not become a company fact until someone records it as one.

## What done looks like

The answer names the connector and the platform it came through, separates what
was reached from what was dark, and cites what it found well enough that
somebody can check it. If part of the request needed a channel that is not
wired, that is stated plainly with the one action that would fix it.
