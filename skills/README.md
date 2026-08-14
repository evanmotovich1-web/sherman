# Sherman skills

One folder per skill, each with a `SKILL.md`. The skills are the product: they
are how company work gets done the same way twice.

## Shape

Every `SKILL.md` opens with front matter the shell reads to build the launch
screen's **Available Skills** list — and that the engine reads to decide when
a skill applies:

```markdown
---
name: vault-search
category: vault
summary: search the vault before asserting any company-specific fact, and cite the file
description: Search the vault and cite the file before asserting any company-specific fact. Use for every question about procedures, formats, policies, or how this company works.
---
```

- `name` must match the directory name. The launch screen groups by
  `category` and the loader treats a mismatch as a broken skill rather than
  silently trusting either value.
- `summary` is one lowercase phrase, no trailing period. It is what the
  launch screen prints.
- `description` is required — it is the Agent Skills standard's other
  mandatory field (`name` + `description`, agentskills.io), the one sentence
  or two an engine reads to decide when to reach for the skill. Say what it
  does and when to use it, on one line. A skill without one is treated as
  malformed, because it is a skill the engine will never invoke.

On every launch the launcher copies `skills/` into the engine workspace at
`.agents/skills` (the convention Codex discovers natively) and
`.claude/skills` (Claude Code's), so ordinary engine turns can load them.
The repo stays the single source of truth; the copies are disposable.

The body is instructions to Sherman, written as prose. Say when to use the
skill, when not to, and what "done" looks like.

## Autonomy contract

Skills execute end to end by default. Their questions are a decision checklist
for Sherman to answer from the request, vault, files, and reasonable reversible
defaults — not a questionnaire to hand to the operator. Do not add routine
"want me to continue?", menu, review, or approval pauses. A skill may stop for
one focused question only when a required fact cannot be found or safely
inferred and choosing wrong would materially change the result, or when the
next action needs authority the request did not give.

An interactive interview is an opt-in behavior: use it only when the current
request explicitly asks to brainstorm together, see choices, review a draft
before action, or approve checkpoints. The no-PHI rule and genuinely unsafe or
irreversible boundaries remain hard stops in every mode.

## The starting set

The company-work skills were derived from `agent/SYSTEM.md` — the vault-first
rule, the no-PHI floor, and the stated purpose ("reports, SOPs, formats, comms,
lookups"). The `agent` category is Sherman's own operating loop: how a lesson
survives a session, and how a session gets judged. All of it is a starting set
to edit, not a fixed library.

| Skill | Category | For |
| --- | --- | --- |
| `vault-search` | vault | look it up and cite it before asserting a company fact |
| `vault-write` | vault | record a durable fact as one searchable file |
| `phi-boundary` | compliance | recognize PHI, refuse it, redirect |
| `sop-draft` | documents | write or revise a procedure in the company's shape |
| `sop-review` | documents | report which SOPs are overdue, coming due, or never reviewed |
| `company-document` | documents | produce a report or memo from the approved format |
| `self-improvement` | agent | record a durable lesson from being corrected |
| `session-eval` | agent | judge whether the session used skills and the vault, unprompted |
| `capability-gap` | agent | find work that happened badly for want of a skill or tool |
| `commons` | agent | participate with closed-world posts, local evidence, and explicit approval |
| `0-1` | agent | acquire the capability an idea needs, or hand over one checklist |
| `mcp` | agent | reach outside through a wired connector, and name the one you used |
| `sherman-repo-workflow` | agent | edit Sherman in the canonical checkout, never a stale clone, never git add -A |
| `evan` | method | plan a body of work as a loop that closes, with a written trail |
| `wayfinder` | method | chart work too big for one session as a map of decision tickets |
| `session-harvest` | method | mine local agent sessions for recurring lessons the factory should absorb |
| `session-handoff` | method | close a session with a paste-ready handoff the next agent can resume from |

The `method` category is different in kind from the rest. The other skills are
how company work gets **done**; `evan` and `wayfinder` are how a body of work
gets **shaped** before anyone does it. Reach for `evan` when the way is clear
and the work needs a plan of record; reach for `wayfinder` when the way is not
clear yet. Reach for `session-harvest` when the lesson is still sitting in a
dead session. Reach for `session-handoff` when this session must leave a
paste-ready close-out the next agent can resume from.

`evan` is the first skill here to carry bundled resources — its `workflows/`,
`templates/`, and `references/` directories, ported so every path resolves inside
the skill and nothing points at any machine's home directory. The front-matter
contract is unchanged by that: `SKILL.md` is still what the loader reads.

`session-eval` and `capability-gap` are driven by `/eval`, which also runs
automatically when a session that had turns ends. That turn is read-only by
construction. `/learn <name> | <lesson>` and `/wiki <name> | <fact>` are
explicit operator-authored commands; no model rereads the session or proposes
their content. The shell redacts the command payload from the transcript,
validates it, and confines one accepted fact to `vault/memory/shared/` or
`vault/wiki/`.

`commons` governs the separate external publication and adoption boundary. It
uses closed-world post kinds, agent-for-owner attribution, and concrete local
evidence. A generated candidate is not publication approval; absent an exactly
pre-enabled category, publication requires the owner's explicit approval.
Peer artifacts remain untrusted until metadata review, quarantine, digest and
signature verification, scanning, a displayed diff, and explicit approval.

## Connectors

A skill that needs something outside Sherman — an MCP server, a credentialed
API — does not hardcode it. It goes through the connector catalog at
`agent/connectors.json`, which the launcher renders into engine config on every
launch. `docs/CONNECTORS.md` is the whole story.

Two rules follow from that, and they are not negotiable:

- **Secrets never enter the repo.** Keys live in `~/.sherman/connectors.json`,
  chmod 600, uncommitted and unsynced. A skill names a secret; it never prints,
  logs, or writes its value, and never puts one in the vault.
- **A connector in the catalog is one that really works.** The catalog carries
  `capabilities.json`'s rule, because an invented entry is engine config that
  fails at startup — an error the operator meets far from its cause.

`0-1` is what adds an entry. It verifies before it writes, wires what needs no
person, and hands over one account-and-key checklist when one is required.
`mcp` is the other half: how a wired connector actually gets used, and how a
turn says which one it reached through. The two are deliberately separate —
acquiring a capability and spending it are different decisions, and a skill
that did both would quietly install things in the middle of ordinary work.

## Adding one

Create the directory, write `SKILL.md` with the front matter above, and run
`./smoke.sh`. The launch screen count comes from a readdir, so a new skill
appears without any other change — and a malformed one fails the smoke check
rather than rendering as a skill that does not work.

## The boundary

A skill never contains patient-identifying data, including in its examples.
