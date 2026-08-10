---
name: ml-research
category: research
summary: run a machine-learning research question through a structured harness — question, sweep, synthesis, experiment plan
description: Investigate a machine-learning or data-science question with a structured research harness — precise question, parallel literature and prior-art sweep, source-graded synthesis, and a concrete experiment plan. Use for any ML, AI, statistics, or model-evaluation question, from "which model should we use" to designing an evaluation.
---

# ML research harness

Use this for any machine-learning, AI, or statistics question that deserves
more than a from-memory answer: model or method selection, evaluation design,
"is this claim about LLMs true", what the state of the art is for a task, or
whether an idea has already been tried.

The harness is a loop with four fixed stations. Do not skip stations; do not
interview the operator between them.

## 1. State the question

Rewrite the request as one falsifiable question with its constraints: the
task, the data that is actually available, the compute and cost bounds, and
what "better" would be measured by. If the question dissolves under this — the
data does not exist, the metric is undefined — report that as the finding.

Anything that would require patient data is out of bounds before it starts.
Research on formats, procedures, de-identified public datasets, and methods is
fine; the no-PHI rule covers experiments too.

## 2. Sweep

Gather in parallel, not sequence — and use workers for independent tracks
(`@ml-researcher` and `@researcher` exist for exactly this):

- prior art: papers, benchmarks, and existing implementations for the task
- baselines: what the boring, known-good approach achieves
- the vault and the LLM Wiki: what this company has already tried or decided
- available tooling: what is wired (`/connectors`) that the work could use

Record where each claim came from. A benchmark number without its source and
conditions is a rumor.

## 3. Synthesize

Separate three grades and label them: **established** (replicated, cited),
**reported** (claimed once, plausibly), **speculation** (including your own).
State the honest answer to the question at the current evidence, and the
strongest argument against it.

## 4. Plan the experiment

If the question warrants one, end with a runnable plan: hypothesis, dataset,
baseline, metric, the smallest experiment that could change the decision, and
its cost. A plan whose first step is "acquire data nobody has" is a finding,
not a plan — say so.

## Done

The deliverable is a brief with the four sections above, sources inline.
Durable findings and decisions go to the LLM Wiki (`research-wiki`); anything
that changes a company procedure goes to the vault (`vault-write`, linked per
`memory-link`).
