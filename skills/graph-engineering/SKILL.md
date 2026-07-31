---
name: graph-engineering
category: agent
summary: shape multi-step work as a graph — fan out what is independent, verify what matters, converge on one answer
description: Shape multi-agent work as a graph of bounded jobs and data edges — fan-out, fan-in, verifier edges, convergent loops, model tiering. Use when work spans many independent files, sources, or checks, when findings need adversarial verification, or when the operator wants a workflow practice of their own.
---

# Engineer the work as a graph

Most multi-step agent work gets written as a line: step one, step two, step
three, each waiting politely for the last. Half those steps never needed to
wait. The shape of real work — what feeds what, what can run at once, what
must see everything before it speaks — is a graph. Nodes do the thinking;
edges carry the results. This skill is how Sherman draws that graph instead
of queueing that line.

## When to reach for this

- The work sweeps many independent things: files to audit, sources to check,
  documents to review, routes to test. Breadth one context cannot hold.
- A finding needs to be *trusted*, not just found — it should survive someone
  trying to kill it before it reaches the operator.
- The job's size is unknown until you are inside it: finding one issue
  reveals three more.

Do **not** reach for it when one careful pass answers the question. A single
company question is `vault-search`, not a fleet. A graph whose nodes are one
node is a line wearing a costume — and every worker spent is the operator's
money, so the fleet has to earn its size.

## Nodes are jobs; edges are data

A node is one bounded job: one worker, one input in, one output out. An edge
exists only when data actually moves — the next step *reads* the last step's
output. "And then" is not an edge. "Summarize the intake SOP and then list
this week's inbox items" has no edge between its halves; they are two
independent nodes a lazy plan needlessly chains.

The first act of graph engineering is cutting false edges. For every "and
then" in the plan, ask: does the next step consume the last step's output?
If no variable crosses, the arrow is imaginary, and the wait it imposes is
pure cost. Most linear plans lose two or three arrows this way and collapse
into something wider and faster.

## Give every node a contract

A node you cannot reason about is a node you cannot parallelize. Bound its
input (passed explicitly, never assumed from shared context), bound its
output (a defined shape the next node can consume without guessing), and
give it exactly one job. Where the engine supports schema-validated worker
output, use it — a validated shape beats free text that has to be parsed
and prayed over. A worker told "your reply is the return value" returns
data; a worker told nothing returns an essay.

## Edges are code, not workers

The step between fan-out and synthesis — flatten, dedupe, filter, count —
is plumbing. Do it directly: it is deterministic, instant, and free. Do not
spawn a worker to "combine the results" when combining means concatenation
and a duplicate check. Save workers for judgment. A graph where every edge
is a worker is a graph paying rent on its own wiring.

## Fan out, then fan in at a barrier — sparingly

When N jobs are independent, run them at once; that is the move that pays
for everything else. Expect stragglers and casualties: one failed worker
must cost one node's output, never the batch — design every fan-in to
tolerate missing inputs.

Fan back in — wait for *everything* — only where the next step genuinely
needs the whole set at once: a dedupe across sources, an early exit when the
total is zero, a ranking that compares findings against each other. "The
stages feel separate" is not a reason to synchronize them; a barrier makes
every fast worker idle behind the slowest one, and that idle time is real,
measurable waste. When items can stream through stages independently, let
them.

## The diamond, and the router

The workhorse shape: one node splits the job, many work it in parallel, one
merges. Fan out → reduce (plain code) → synthesize (one worker that writes
the answer from the reduced set). A vault audit, a document sweep, a
research brief — same skeleton, different prompts.

When the path depends on what a node found, let a worker classify and let
*code* branch on the classification. Judgment at the node, determinism at
the edge: the same input routes the same way every time, and no step can be
silently skipped because a model felt like it.

## Put a verifier on the edge

The leverage of a graph is not more workers — it is the structure wrapped
around them to produce confidence. Before a finding reaches the answer, a
verifier node tries to kill it:

- **Adversarial**: independent skeptics prompted to *refute* the finding;
  it survives only if most fail.
- **Perspective-diverse**: each verifier gets a different lens —
  correctness, compliance, does-it-reproduce — because diversity catches
  failure modes that identical duplicate checks never will.
- **Judge panel**: several independent attempts from different angles,
  scored, synthesized from the winner with the runners-up's best ideas.

An unverified finding is an opinion with formatting. This is the same rule
`session-eval` applies to grades — a claim with no check on it does not get
presented as fact.

## Cycles must converge

Unknown-size discovery needs a loop: keep sending finders until the well is
dry. The rule that makes it converge: stop after K consecutive empty
rounds, and dedupe each round against **everything ever seen — not just
what was confirmed**. Dedupe against confirmed only, and every rejected
finding reappears each round, the loop never dries, and the graph pays to
rediscover its own dead ends forever.

## Tier the models; the topology is the bill

Not every node deserves the best model. Extraction, classification, and
formatting nodes run fine on a cheaper tier; the synthesis and adjudication
nodes are where judgment lives and where the expensive tokens belong. And
the graph's *shape* is its biggest cost lever before any model choice:
every needless barrier is wall-clock, every false edge is latency, every
worker doing an edge's job is tokens. State the fleet size and the rough
cost before launching a large graph — the operator approves fleets, not
surprises.

## What the engine gives you

The graph is the design; the engine is the runtime, and they differ:

- **Claude Code** has dynamic workflows: a plain-code orchestration script
  that spawns coordinated subagent fleets, with parallel and pipelined
  stages, schema-validated worker output, and per-node model overrides.
  Good runs can be saved and re-run by name — that is the operator's
  library forming.
- **Codex** has no workflow runtime. The graph still applies: decompose the
  same way, run the independent nodes as separate worker conversations, and
  do the edges yourself in the main thread.
- **The Sherman shell** has `/subagent` — one isolated read-only worker per
  turn. That is a one-node fan-out: use it for any side-quest that would
  bury the main thread, and treat several across a session as a slow, honest
  fleet.

Never promise an orchestration feature the running engine does not have —
say which of these worlds the session is in and shape the plan to it.

## The operator's own practice

The end state is not one good run; it is the operator owning a library of
graphs. When a shape works, help them keep it: name it for the job it does,
save it where their engine can re-run it (versioned with the repo, so it
survives machines), and note what it costs to run. Recurring work — an
ecosystem scan, a document audit, a weekly sweep — earns a saved graph;
one-off work earns a disposable one. Teach the two questions that build the
instinct: *where does this job split, and where must it merge?* An operator
who asks those unprompted has stopped queueing steps and started running
fleets.

## The boundaries

- **No PHI anywhere in a graph.** A fan-out multiplies exposure: one
  careless prompt becomes N worker prompts. The no-PHI contract binds every
  node, every edge, every saved workflow, without exception.
- **Workers are read-only unless the operator granted writes.** A fleet
  that writes in parallel needs isolation the engine must actually provide;
  absent that, findings come back and the main thread applies them.
- **Never silently cap coverage.** If the graph bounds itself — top-N,
  sampling, skipped failures — say what was dropped. "Covered everything"
  when it did not is the confident gap this whole system exists to prevent.
