# Sherman skills

One folder per skill, each with a `SKILL.md`. The skills are the product: they
are how company work gets done the same way twice.

## Shape

Every `SKILL.md` opens with front matter the shell reads to build the launch
screen's **Available Skills** list:

```markdown
---
name: vault-search
category: vault
summary: search the vault before asserting any company-specific fact, and cite the file
---
```

- `name` must match the directory name. The launch screen groups by
  `category` and the loader treats a mismatch as a broken skill rather than
  silently trusting either value.
- `summary` is one lowercase phrase, no trailing period.

The body is instructions to Sherman, written as prose. Say when to use the
skill, when not to, and what "done" looks like.

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
| `company-document` | documents | produce a report or memo from the approved format |
| `self-improvement` | agent | record a durable lesson from being corrected |
| `session-eval` | agent | judge whether the session used skills and the vault, unprompted |
| `capability-gap` | agent | find work that happened badly for want of a skill or tool |

`session-eval` and `capability-gap` are driven by `/eval`, which also runs
automatically when a session that had turns ends. That turn is read-only by
construction: it judges and proposes, and a person decides what gets written.

## Adding one

Create the directory, write `SKILL.md` with the front matter above, and run
`./smoke.sh`. The launch screen count comes from a readdir, so a new skill
appears without any other change — and a malformed one fails the smoke check
rather than rendering as a skill that does not work.

## The boundary

A skill never contains patient-identifying data, including in its examples.
