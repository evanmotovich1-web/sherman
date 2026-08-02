# Connectors

How Sherman reaches things outside itself — MCP servers and credentialed APIs.

Two files, deliberately kept apart.

## The catalog — `agent/connectors.json`

Committed. It describes what a connector **is**: its transport, how it launches,
what files must exist, what secret names it needs, what to run when it is broken,
and where a human signs up when a credential is required.

It carries the same rule as `agent/capabilities.json`: **an entry describes a
connector that really exists and really launches this way.** A speculative entry
is not a roadmap item here — it is engine config that fails at startup, which
the operator meets as one causeless error a long way from its cause.

The `0-1` skill is what adds entries, and it is required to verify before it
writes. The `mcp` skill is what uses them once they are there.

### The `env` field

A stdio connector may declare `env` — the environment its server process runs
under, with the same `${...}` expansion as every other field, and one extra
variable: `${PATH}`, the launcher's own.

That exists for servers that shell out to their own helper binaries. A
committed catalog cannot know an operator's PATH, and a server handed a
truncated one reports its own helpers as missing — a wrong answer that looks
exactly like a correct one. So an entry writes `${HOME}/.local/bin:${PATH}` and
means "the operator's, plus this one place". Duplicate entries are collapsed on
render, first occurrence winning, because the result is written into a person's
codex config and read by a person debugging a server.

The probe runs under the same environment, so what is tested is what the engine
is handed. A value that does not resolve blocks the connector rather than
rendering a half-built environment.

## The enablement file — `~/.sherman/connectors.json`

Per machine. **Never committed, never synced, never written to the vault.**
`chmod 600`. It says which catalogued connectors are on, and holds their keys:

```json
{
  "enabled": {
    "some-service": {
      "secrets": { "SOME_SERVICE_API_KEY": "…" }
    }
  },
  "disabled": ["llmwiki"]
}
```

- `enabled` — turn a catalogued connector on and supply its secrets.
- `disabled` — turn off a connector that would otherwise wire itself.

A connector with `autoEnable: true` in the catalog needs no entry here. Those are
the ones that require no credential and are gated by a probe instead — the LLM
Wiki is the shipping example: install it and it wires itself; remove it and it
stops, with no config edit either way.

### Why the split

A connector's *shape* is company knowledge and belongs in the repo. A connector's
*key* is a machine's secret, and it must not be able to reach a commit, a sync,
or the vault. One file would make that a matter of remembering, and secrets do
not survive a policy of remembering.

## What the launcher does

On every launch, `bin/sherman` runs the resolver once and rebuilds engine config
from scratch:

- `~/.sherman/workspace/.mcp.json` — Claude Code reads this from its working
  directory.
- `[mcp_servers.<name>]` appended to the codex config, once per connector,
  backed up first and claimed only after read-back.

Both are removed and rewritten every launch, so a connector removed from the
catalog cannot survive one.

A connector is wired only when **all** of these hold: it is enabled, every
required secret is present and non-empty, every `requiresFile` exists, its
command is executable, and its `probe` exits 0. Anything short of that is
**omitted entirely and reported** — never half-written.

Files existing is not an install. A Python venv whose packages never installed
passes every existence check and then hands the engine a server that dies on
startup. That is what the probe is for, and it costs one process start per
launch.

## Seeing the state

```
/connectors
```

Three headings, and a heading with nothing under it is omitted rather than
printed empty:

- **Connected** — wired and answering.
- **Needs a key** — enabled, but a secret is missing. Names the secret and the
  signup URL.
- **Available** — in the catalog, not enabled.

It prints secret **names**, never values. Changes take effect on the next
launch, because the launcher is what renders engine config.

## Who installs the thing a connector points at

A catalog entry describes how to launch something; it does not put that
something on the machine. Two connectors ship with a provisioner, because a
catalogued capability that every operator has to install by hand is a
capability most machines will not have:

| Connector | Provisioned by | Where |
| --- | --- | --- |
| `llmwiki` | `install.sh`, repaired by `sherman update` | `~/.sherman/llmwiki` |
| `agent-reach` | `bin/provision-agent-reach.sh`, called by both | uv tool dir |
| `exa` | nothing to install — a public HTTP endpoint | — |

`bin/provision-agent-reach.sh` is one file called from **both** entry points on
purpose. The wiki's arrangement — provisioned in `install.sh`, repaired in
`sherman update` — is two copies of one idea, and they have already drifted.
Being in the update path is also what lets a machine installed before this
existed grow the capability by pressing update, instead of only new installs
getting it.

Agent Reach is pinned to a commit and its MCP dependency held below 2.0. Both
are load-bearing: it is third-party software whose newest release already broke
against the MCP 2.0 server API, and an install that follows someone else's main
branch is a capability that stops working on a day nobody chose. Smoke check 27
asserts both, along with the provisioner staying offline and claimless when
fetches are disabled.

## Adding one by hand

1. Add the entry to `agent/connectors.json`. Verify it launches first.
2. If it needs a credential, add it to `~/.sherman/connectors.json` under
   `enabled`, with the secret under the name the catalog's `requires` lists.
3. Relaunch. `/connectors` should show it under **Connected**.

Or ask Sherman: `/0-1 <what you want to do>`. It does steps 1 and 2 when no
human is required, and hands you a signup checklist when one is.

## The boundaries

- Secret **values** never appear in repo files, printed output, session logs, or
  the vault. Only names, and whether they are present.
- The no-PHI rule crosses every connector. A connector whose purpose is to move
  patient data is refused, not catalogued with a caveat.
- Enabling a connector gives the engine new external reach. Sherman states
  plainly when it adds one — nobody should learn from a bill.
- HTTP-transport connectors are wired for Claude Code only. Codex's config
  surface for url-based MCP has not been verified here, and writing an unverified
  key into someone's `config.toml` is the kind of confident guess this project
  refuses everywhere else.
