<purpose>
Create HANDOFF.md file and update STATE.md when pausing work mid-session. Enables seamless resumption in fresh session with full context restoration.
</purpose>

<when_to_use>
- Before ending a session (planned or context limit approaching)
- Switching to different project
- Context window at DEEP or CRITICAL bracket
- User explicitly pauses work
</when_to_use>

<loop_context>
Any position in PLAN/APPLY/UNIFY loop. Captures state regardless of where loop is.
</loop_context>

<required_reading>
.evan/STATE.md
.evan/PROJECT.md
</required_reading>

<references>
references/context-management.md
templates/HANDOFF.md
</references>

<process>

<step name="detect_position" priority="first">
1. Read `.evan/STATE.md` to get:
   - Current phase and plan
   - Loop position (PLAN/APPLY/UNIFY markers)
   - Last activity
2. Identify current working directory:
   ```bash
   ls -t .evan/phases/*/PLAN*.md 2>/dev/null | head -1
   ```
</step>

<step name="gather_session_context">
**Collect complete state for handoff:**

Ask user (or infer from conversation):
1. **Work completed this session** - What got done?
2. **Work in progress** - What's partially done?
3. **Decisions made** - Key choices and rationale
4. **Blockers/issues** - Anything stuck?
5. **Mental context** - The approach, what you were thinking

If user doesn't provide, summarize from:
- Recent file modifications (`git status`)
- Conversation history
- STATE.md changes
</step>

<step name="create_handoff">
**Create HANDOFF file:**

```bash
# Generate filename
TIMESTAMP=$(date +%Y-%m-%d)
HANDOFF_FILE=".evan/HANDOFF-${TIMESTAMP}.md"
```

**Write content (NOT from template, populate directly):**

```markdown
# EVAN Handoff

**Date:** [current timestamp]
**Status:** [paused/blocked/context-limit]

---

## READ THIS FIRST

You have no prior context. This document tells you everything.

**Project:** [from PROJECT.md]
**Core value:** [from PROJECT.md]

---

## Current State

**Version:** [from STATE.md]
**Phase:** [N] of [total] — [phase name]
**Plan:** [plan-id] — [status]

**Loop Position:**
```
PLAN ──▶ APPLY ──▶ UNIFY
  [✓/○]    [✓/○]    [✓/○]
```

---

## What Was Done

- [Accomplishment 1]
- [Accomplishment 2]
- [Accomplishment 3]

---

## What's In Progress

- [In-progress item with status]

---

## What's Next

**Immediate:** [specific next action]

**After that:** [following action]

---

## Key Files

| File | Purpose |
|------|---------|
| `.evan/STATE.md` | Live project state |
| `.evan/ROADMAP.md` | Phase overview |
| [current plan path] | [plan purpose] |

---

## Resume Instructions

1. Read `.evan/STATE.md` for latest position
2. Check loop position
3. Run `/evan resume` or `/evan progress`

---

*Handoff created: [timestamp]*
```

Be specific enough for a fresh Claude to understand immediately.
</step>

<step name="update_state">
**Update `.evan/STATE.md` Session Continuity section:**

```markdown
## Session Continuity

Last session: [timestamp]
Stopped at: [what was happening]
Next action: [clear directive]
Resume file: .evan/HANDOFF-[date].md
Resume context:
- [bullet 1 - key context]
- [bullet 2 - key context]
- [bullet 3 - key context]
```
</step>

<step name="optional_commit">
**If git repo, offer WIP commit with explicit two-question flow:**

**Question 1 — Commit WIP?**
```
────────────────────────────────────────
Would you like to commit your work-in-progress?

This saves a checkpoint you can return to.
────────────────────────────────────────
[yes] / [no]
```

**If no:** Skip to confirm step.

**If yes — Question 2 — Branch choice:**
```
────────────────────────────────────────
Where should this WIP commit go?

[1] main — Commit directly to main branch
[2] feature branch — Create feature/{phase-name} branch first

Note: Feature branch is useful if work isn't ready for main.
────────────────────────────────────────
```

**If main (option 1):**
```bash
git add .evan/ src/
git commit -m "wip({phase}): paused at {plan}

Co-Authored-By: Claude <noreply@anthropic.com>"
```

**If feature branch (option 2):**
```bash
# Create and switch to feature branch
git checkout -b feature/{phase-name}

# Commit to feature branch
git add .evan/ src/
git commit -m "wip({phase}): paused at {plan}

Co-Authored-By: Claude <noreply@anthropic.com>"

# Record branch strategy in STATE.md for transition-phase
```

**Update STATE.md Session Continuity with branch info:**
```markdown
Git strategy: {main|feature/{phase-name}}
```

This enables transition-phase.md to know the branch strategy when reconciling.
</step>

<step name="confirm">
**Display confirmation:**

```
════════════════════════════════════════
EVAN SESSION PAUSED
════════════════════════════════════════

Handoff created: .evan/HANDOFF-[date].md

Current State:
  Phase: [N] of [M]
  Plan: [status]
  Loop: [PLAN/APPLY/UNIFY position]

To resume later:
  /evan resume

════════════════════════════════════════
```
</step>

</process>

<output>
- HANDOFF-{date}.md created in .evan/
- STATE.md updated with session continuity
- Optional WIP commit with branch choice (main or feature/{phase})
- Git strategy recorded in STATE.md for transition-phase
- User knows how to resume
</output>

<error_handling>
**No .evan/ directory:**
- "No EVAN project found. Nothing to pause."

**STATE.md missing or corrupted:**
- Create minimal handoff from available context
- Note the gap in handoff file

**Git not available:**
- Skip commit step, still create handoff
</error_handling>
