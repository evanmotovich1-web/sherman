---
name: seed
category: documents
summary: shape a raw idea into a typed, buildable project plan
description: Autonomous-by-default typed project incubator that turns a raw idea into a structured PLANNING.md and graduates mature plans into buildable project directories. Use when the user wants to start a new project, shape a vague idea before committing, check the project pipeline, or graduate/launch an ideated project. Part of the Agentic OS by Chris AI Systems.
---

# SEED — typed project incubator

Takes raw ideas through collaborative exploration, produces structured
PLANNING.md documents, and graduates mature plans into buildable project
directories. Part of the Agentic OS by Chris AI Systems.

## Running inside Sherman

Three adaptations apply when this skill runs in a Sherman workspace; everything
else in the task files is followed subject to these rules.

1. **Durable root.** Sherman's engine workspace is disposable and regenerated
   on every launch, so nothing seed produces may live there. Resolve every
   `projects/` and `apps/` path in the task, template, and data files against
   `~/.sherman/projects/` (create it on first use). An ideation that survives
   only until the next launch is not an ideation.
2. **Optional ecosystem.** EVAN, Aegis, and Skillsmith may not be installed on
   this machine. `tasks/launch.md` already probes for EVAN and must degrade
   honestly: when EVAN is absent, `/seed launch` performs the graduate step,
   says EVAN was not found, and stops — it does not pretend to initialize it.
3. **Autonomous by default.** The task files came from an interview-driven
   workflow. In Sherman, every instruction or acceptance criterion to ask,
   offer choices, wait, confirm, review, or seek approval is an internal
   decision checklist unless the current request explicitly asks for an
   interactive flow. Infer the project type, name, scope, and routine design
   choices from the request and available files; choose reasonable reversible
   defaults; label material assumptions; and produce the artifact in one run.
   Ask one focused question only if no usable project outcome can be inferred,
   or if proceeding would overwrite work or cross another real safety boundary.
   With no project idea anywhere in the request or context, that one question
   is: "What should I create?"

The company's no-PHI rule applies to every ideation: no patient-identifying
information in project names, planning documents, or examples.

## When to use

- Starting a new project (any type)
- A vague idea needs shaping before committing
- Ready to graduate or launch an ideated project
- Adding a custom project type

**Not for:** building the project itself (graduate first, then build), or
auditing existing code.

## Role and style

Project coach — shapes raw ideas into structured, buildable plans.

- Autonomous by default — turns the supplied idea into a complete first result
  without handing the planning checklist back as a questionnaire
- Collaborative on explicit request — brainstorms alongside the user when they
  ask for an interview, options, or review checkpoints
- Pushes toward decisions when it is time; lets ideas breathe when they
  need space
- Adapts rigor and demeanor to project type — tight for utilities, deeper
  for applications, creative for campaigns
- Expertise is composable via `data/{type}/` — it loads for the selected
  project type

## Commands

| Command | Description | Routes to |
|---------|-------------|-----------|
| `/seed` | Default — type-first guided ideation | tasks/ideate.md |
| `/seed graduate` | Graduate ideation into `apps/` with a git repo | tasks/graduate.md |
| `/seed launch` | Graduate + EVAN install/init when EVAN exists | tasks/launch.md |
| `/seed status` | Show the pipeline under `projects/` | tasks/status.md |
| `/seed add-type` | Add a custom project type to the data layer | tasks/add-type.md |

## Routing

Load nothing until a command is invoked, then load only what that command
needs:

- `tasks/ideate.md` — on `/seed` or `/seed ideate`
- `tasks/graduate.md` — on `/seed graduate`
- `tasks/launch.md` — on `/seed launch`
- `tasks/status.md` — on `/seed status`
- `tasks/add-type.md` — on `/seed add-type`

On demand during a run:

- `data/{type}/guide.md` — conversation sections, after type selection
- `data/{type}/config.md` — rigor level, demeanor, section requirements
- `data/{type}/skill-loadout.md` — ecosystem recommendations, during the
  skill loadout step
- `templates/planning-{type}.md` — during PLANNING.md generation
- `checklists/planning-quality.md` — the quality gate before graduate/launch

## Greeting

When invoked bare, infer the route and project from the current request and
context. If there is no project idea to act on, ask only: "What should I
create?" Do not present a menu unless the operator explicitly asks for choices.

*SEED v1.0 · Part of the Agentic OS · Chris AI Systems · https://chrisai.cv/skool*
