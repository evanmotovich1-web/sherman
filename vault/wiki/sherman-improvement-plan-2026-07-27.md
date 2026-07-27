# Sherman improvement plan

**Status:** Proposed  
**Date:** 2026-07-27  
**Scope:** Company operations only; no patient-identifying data or PHI

## Executive recommendation

Build Sherman into a trusted operations front door before turning it into an
autonomous agent.

The next milestone should not be more models, more connectors, WhatsApp, or a
fleet of specialized bots. It should be a controlled pilot in which Sherman:

1. answers a small set of common operations questions from approved sources;
2. cites the exact source for every company-specific answer;
3. creates standard, non-patient documents from approved templates;
4. refuses or escalates when the source is absent, stale, or outside scope; and
5. proves through repeatable tests that it does not persist raw conversation
   text, expose unauthorized knowledge, or take an unapproved action.

Actual patient billing automation is outside Sherman's current boundary because
claims, accounts, and payment posting generally require patient-identifying
data. Sherman can support the non-patient shape of billing work—SOP lookup,
training, payer-policy research, de-identified aggregate analysis, and
templates—but it must not process a named account or claim.

## What the market leaders get right

These are vendor-reported capabilities, used here as design patterns rather
than independent proof of outcomes.

| Product | Pattern worth copying | Relevance to Sherman |
| --- | --- | --- |
| [Glean](https://www.glean.com/enterprise-search) | Real-time, permissions-aware search across company tools; company context rather than generic model knowledge | Make approved company sources and source permissions the retrieval foundation |
| [Glean Agents](https://www.glean.com/resources/guides/agents) | A library of repeatable “golden” workflows, common query classes, and task-specific evaluation sets | Turn the first employee tasks into explicit, testable Sherman skills |
| [Moveworks](https://docs.moveworks.com/ai-assistant/enterprise-search/overview) | One retrieval foundation serves both search and conversational answers; permissions are mirrored continuously | Avoid separate, inconsistent search and chat knowledge paths |
| [Moveworks platform](https://www.moveworks.com/us/en/platform) | Search and workflow actions share one employee-facing assistant across existing work channels | Keep one Sherman identity and add bounded skills behind it |
| [Dust](https://docs.dust.tt/docs/user-documentation/admins/users-and-permissions-management/access-controls-and-permissions) | Connected knowledge is divided into open and restricted spaces; users and agents can only use data in their scope | Replace broad vault access with explicit roles, source scopes, and permission tests |
| [Microsoft Copilot Studio](https://learn.microsoft.com/en-us/agents/adoption-patterns/pattern-workplace-it-services) | Deterministic workflows, approval gates, human handoff, agent registry, auditability, and regression testing | Use the model for understanding and drafting; use code and approvals for consequential actions |
| [Microsoft agent evaluation](https://learn.microsoft.com/en-us/microsoft-copilot-studio/analytics-agent-evaluation-intro) | Reusable test sets compare actual answers with expected answers and can run in release pipelines | Ship a Sherman evaluation harness before an employee pilot |
| [NHS England rollout](https://news.microsoft.com/source/2026/06/08/nhs-england-accelerates-ai-adoption-with-microsoft-365-copilot-to-improve-service-delivery-reduce-costs-and-create-more-time-for-care/) | Administrative use cases such as templates, minutes, HR, finance, procurement, and management briefs are paired with adoption training | Begin with low-risk administration, not clinical or patient workflows |

## Current Sherman baseline

Sherman already has several good foundations:

- one clear company-operations identity;
- a strict no-PHI contract;
- a habit of searching and citing the vault rather than inventing company facts;
- a shell that separates the user experience from the model engine;
- an operating-system sandbox around the Codex process; and
- a planned server-scoped vault model for employees.

The principal gaps are:

- the shared vault contains guidance files but almost no company knowledge;
- the first three to five employee use cases are still undecided;
- the current shell writes raw user and Sherman messages to
  `~/.sherman/sessions/*.jsonl`;
- no technical pre-send PHI/identifier gate is present;
- model-thread retention has not been documented as part of the no-PHI posture;
- the Claude backend is still a stub;
- there is no answer-quality evaluation suite, correction loop, or production
  release gate;
- employee identity, source-level authorization, connector policy, and action
  approval are not implemented; and
- WhatsApp is planned before the production control plane and authenticated
  employee channel have been proven.

## Product principles

1. **One front door, several bounded skills.** Keep Sherman as the identity.
   Add narrowly defined skills rather than making employees choose among bots.
2. **Approved sources outrank fluent answers.** A company-specific answer
   without a current source is a failure, even when it sounds plausible.
3. **No connector is trusted by default.** Availability is not authorization.
   Connect only explicitly approved non-PHI folders, channels, databases, and
   fields.
4. **Progress from read to draft to act.** Start read-only, then let Sherman
   prepare a draft, then add a human approval gate, and only then permit a
   deterministic write.
5. **The model never owns a consequential side effect.** Code validates inputs,
   permissions, idempotency, and destination; a person approves sensitive
   changes.
6. **Every release must pass the same tests.** Prompt, model, source, connector,
   and skill changes all run against a versioned evaluation set.
7. **Do not retain raw chat for analytics.** Measure events and outcomes without
   keeping employee conversation text.

## Target architecture

```text
employee
   |
authenticated Sherman surface
   |
local pre-send identifier warning/block
   |
policy router
   +--> approved-source retrieval --> cited answer or named escalation
   |
   +--> bounded skill --> deterministic validator --> human approval --> write
   |
   +--> metadata-only audit and quality events

All source and tool access passes through a default-deny connector gateway.
Sources that may contain patient data remain disconnected.
```

The pre-send check is a defense layer, not a guarantee that software can
recognize every identifier. The product boundary, source allow-list, training,
and lack of raw-content retention remain necessary.

## 90-day roadmap

### Phase 0 — Close the compliance gap (weeks 1–2)

**Work**

- Disable raw transcript logging by default. Retain only metadata such as
  timestamp, latency, selected skill, result status, source identifiers, and
  token totals.
- Document where both engine backends retain thread content. Do not begin the
  employee pilot until retention and deletion behavior are compatible with the
  no-PHI boundary.
- Add a local, pre-send warning and block for obvious identifiers and risky
  content patterns. Do not send suspected content to a cloud classifier.
- Add a permanent composer warning: “No patient names, identifiers, results, or
  account details.”
- Create a connector register with owner, purpose, read/write mode, approved
  scope, data classification, credential owner, and revocation procedure.
- Default-deny every source and action. Any system or folder that can contain
  PHI stays disconnected.
- Write a no-PHI incident procedure covering stop, containment, deletion,
  reporting, and prevention.
- Add adversarial tests for prompt injection, path escape, network egress,
  identifier canaries, cross-user access, and unauthorized writes.

**Exit gate**

- no raw user or assistant message is written by Sherman;
- engine retention and deletion behavior is documented;
- all identifier-canary tests are blocked before model submission;
- the current sandbox tests still pass; and
- every enabled source appears in the connector register.

### Phase 1 — Build trusted knowledge (weeks 2–4)

**Work**

- Interview process owners using only non-patient examples.
- Seed the vault with the 25–50 most-used, approved operations documents.
- Give every source: title, owner, audience, approval status, effective date,
  review date, source system, superseded document, and escalation contact.
- Separate approved policy/SOP content from drafts and informal memory.
- Require citations for every company-specific statement.
- Add a “knowledge gap” event when Sherman cannot answer. Route it to a named
  owner instead of storing or inventing an answer.
- Add expiry checks and a review queue for stale sources.

**Exit gate**

- 100% of pilot sources have owners and review dates;
- 100% of company-specific pilot answers cite a source;
- a 50–100 question, de-identified evaluation set exists;
- source-selection accuracy is at least 95% on that set; and
- all unsupported questions refuse or escalate rather than guess.

### Phase 2 — Ship three employee skills (weeks 4–6)

Score candidate tasks on monthly volume, minutes saved, error cost, source
quality, data sensitivity, rule stability, and reversibility.

Recommended starting set:

1. **Operations answer:** answer an SOP, policy, ownership, or “how do I”
   question with the current source and escalation contact.
2. **Standard document:** create a non-patient memo, checklist, meeting brief,
   training aid, or approved form from a controlled template.
3. **Onboarding and internal support:** guide an employee through approved
   training, IT, facilities, supply, HR, or administrative procedures without
   exposing restricted information.

For each skill, define:

- allowed users and sources;
- required and prohibited inputs;
- output schema;
- deterministic validations;
- refusal and escalation rules;
- success metric; and
- evaluation cases, including abuse and missing-information cases.

Billing-specific work in this phase is limited to procedures, training,
templates, public payer research, and de-identified aggregate reporting.

**Exit gate**

- each skill passes its functional, permission, and no-PHI tests;
- pilot users complete at least 80% of in-scope tasks without re-prompting;
- no out-of-scope request produces an action; and
- every failed request has a useful escalation path.

### Phase 3 — Add governed actions and integrations (weeks 6–10)

**Work**

- Build one connector gateway shared by both engines.
- Begin with one or two read-only, explicitly non-PHI sources.
- Mirror source-system permissions instead of copying everything into a shared
  index.
- Add writes only as fixed workflows with typed inputs, destination checks,
  idempotency keys, previews, human approval, and append-only audit events.
- Show the user what Sherman plans to change before requesting approval.
- Add clean handoff to a human owner with the non-sensitive context already
  gathered.
- Prefer an authenticated desktop, web, Slack, or Teams surface already used by
  employees. Do not make WhatsApp the first production channel.

**Exit gate**

- permission tests show zero cross-role disclosures;
- 100% of write attempts are previewed, approved, and audited;
- duplicate submission tests create no duplicate side effects;
- revoking a user's access takes effect immediately; and
- connector failure produces a clear handoff rather than a guessed answer.

### Phase 4 — Operate Sherman as a product (weeks 10–12)

**Work**

- Build the Board around unanswered questions, stale sources, source owners,
  skill use, completion rate, escalations, identifier blocks, latency, cost,
  and user feedback.
- Add simple “helpful,” “incorrect,” “stale source,” and “missing source”
  feedback without retaining the full conversation.
- Create development, staging, and production configurations with gated
  promotion.
- Run the evaluation set automatically on prompt, model, skill, source-policy,
  and connector changes.
- Pilot first on the second admin device, then with 5–10 employees for four
  weeks.
- Train users on supported tasks, the no-PHI boundary, citations, feedback, and
  escalation.
- Implement Claude parity only after the same sandbox, logging, retention,
  permission, and evaluation controls can be proven on both engines.

**Exit gate**

- no critical safety or authorization incident during the pilot;
- at least 90% citation correctness on real sampled, de-identified tasks;
- correction requests reach a source owner within one business day;
- the top three skills show measured time savings; and
- Evan and the process owners approve employee rollout.

## Success scorecard

| Dimension | Initial target |
| --- | --- |
| Raw conversation retention | Zero in Sherman-owned logs |
| Identifier-canary submission | 100% blocked before the engine |
| Cross-role source leakage | Zero |
| Unapproved write actions | Zero |
| Citation coverage for company facts | 100% |
| Source-selection accuracy on evaluation set | At least 95% |
| Unsupported questions | 100% refusal or useful escalation |
| Pilot task completion | At least 80% without re-prompting |
| Source ownership | 100% of pilot sources |
| Stale source correction | Owner notified within one business day |
| Business value | Minutes saved and rework avoided per skill |

These are pilot gates, not proof of regulatory compliance.

## Priority backlog

### P0 — Must happen before employee use

1. Stop raw transcript persistence.
2. Verify model-thread retention and deletion.
3. Add the no-PHI pre-send control and incident procedure.
4. Create the connector register and default-deny policy.
5. Build the evaluation harness and abuse test set.

### P1 — Makes Sherman useful

1. Populate approved, owned, dated company knowledge.
2. Add strict citations, stale-source handling, and knowledge-gap routing.
3. Choose and implement the first three skills.
4. Add metadata-only feedback and outcome measurement.

### P2 — Makes Sherman operational

1. Build the connector gateway and source-permission mirroring.
2. Add deterministic, approval-gated actions.
3. Build the Board and release pipeline.
4. Complete the second-admin and small-employee pilots.

### P3 — Defer until the control plane works

- WhatsApp;
- broad Gmail, Drive, Slack, or other whole-account ingestion;
- autonomous background actions;
- multi-agent fleets;
- personal graphs and deep personalization;
- many specialized employee-created agents; and
- patient billing, claims, results, or any other PHI workflow.

## Decisions needed

1. Who is the accountable Sherman product owner?
2. Who owns and approves knowledge in each operational domain?
3. Which three non-PHI employee tasks have the highest current volume?
4. Which folders, channels, and systems are guaranteed to be non-PHI and can be
   placed on an explicit source allow-list?
5. Which authenticated employee channel is already standard internally?
6. What measured result will justify rollout: time saved, fewer interruptions,
   faster onboarding, fewer document errors, or another operational outcome?

## Local sources

- [Sherman design](../../DESIGN.md)
- [Sherman agent contract](../../agent/SYSTEM.md)
- [Current session logging](../../shell/src/sessionlog.js)
- [Shell submit path](../../shell/src/ui/app.js)
- [Claude backend status](../../shell/src/engine/claude.js)
- [Company wiki guidance](README.md)
- [Shared memory guidance](../memory/shared/README.md)
