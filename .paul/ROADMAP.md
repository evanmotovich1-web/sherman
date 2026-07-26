# ROADMAP

Derived from design doc §6 (Phases). Bootstrapped 2026-07-26.

## Milestone v0.1 — Evan-only local prototype 🟡 In progress (1 of 4 phases)

Proves the whole contract end to end on one Mac: *type `sherman`, the agent
appears, it knows the business.*

Design-doc Phase 1 splits into three tracks. Two run in parallel right now.
Phase 4 was added 2026-07-26 after Evan's first live run.

**Status:** the "type `sherman`, the agent appears" half is done and verified.
The "knows the business" half is not — that needs Phase 2's vault contents and
Phase 3's skills. And *`sherman` appears as Sherman* needs Phase 4 — right now
the launcher hands the screen to OpenAI's chrome.

### Phase 1 — Launcher chassis ✅ Complete (2026-07-26, 1/1 plan)

The thing that makes `sherman` a command. Owns:

- `install.sh` — PATH symlink, chmod, idempotent, detect-and-report
- `bin/sherman` — banner, first-run wizard, config, adapter assembly, exec
- `agent/SYSTEM.md` — the persona
- `adapters/claude-code/CLAUDE.md`, `adapters/codex/AGENTS.md` — engine wrappers
- `smoke.sh` — 3 checks

Exit condition: `sherman` launches a real Claude Code session whose CLAUDE.md
carries the persona, both vault paths, the user's name, and the no-PHI rule.
**Met** — verified across first run, second run, engine switch, missing binary,
both banner branches, and symlink invocation from outside the repo.

Plans: `01-01` ✅ (chassis, all of the above) — commit `2f59775`

### Phase 2 — Logo + vault seed ⚪ Parallel track (Codex session)

Owns `logo/` (ANSI company logo + red pixel-block SHERMAN wordmark) and
`vault/` (starter `wiki/`, `memory/shared/`, `memory/private/`).

**Not planned here.** Phase 1 must not create or edit files in either
directory — only `mkdir -p` of empty dirs so paths resolve.

Integration point: `bin/sherman` reads `logo/banner.ans` if it exists and falls
back to plain text if it does not. Neither track blocks the other.

### Phase 3 — First skills ⚪ Not started

2–3 company skills, one folder + SKILL.md each. Blocked on the one answer that
matters most (design doc §7 Q1): the 3–5 tasks employees burn the most hours
on. Candidate shapes: SOP answerer, intake/report drafting, customer comms
drafts, daily digest.

### Phase 4 — Sherman Shell 🟡 In progress, 1 of 2 plans (added 2026-07-26)

Sherman owns the screen. Design doc §3c, added after Evan's first live run:
launching into raw Codex chrome is not Sherman. Our UI on top, the engine
headless underneath — the Hermes posture.

A Node + Ink TUI (`shell/`) driving the chosen engine in headless mode, with one
`EngineSession` interface and two backends. This moves the §3 either-engine
promise from the chrome seam to the UI seam.

Split into two plans, risk front-loaded:

- `04-01` ✅ **Engine layer, no UI** (2026-07-26, commit `1f75e0a`).
  `EngineSession` contract, real Codex backend over `codex exec --json` +
  `exec resume`, Claude stub, vault-confined permissions posture, transport
  decision documented. Zero npm dependencies. 8/8 ACs Pass.
  Verified against real Codex: multi-turn recall on one thread, interrupt with
  thread retention and no orphan, and an escape test showing writes outside the
  vault and all network egress denied. Answers as Sherman Abrams through the
  headless path, confirming the Phase 1 adapter loads.
- `04-02` ⚪ **Shell UI + wire-up.** Ink app (banner header, chat pane with
  scrollback, status bar: engine · model · user · vault · tokens), Ctrl+C
  interrupt semantics, `bin/sherman`'s final `exec` swapped to the shell,
  `sherman --raw` for debugging, `smoke.sh` +3 checks.

Exit condition: typing `sherman` lands in a branded Sherman screen — no OpenAI
or Anthropic chrome — holding a real streaming conversation with the engine
sealed inside the vault.

**Board view is explicitly NOT in this phase** (§3c: "comes right after the chat
loop is solid, not in the same diff").

Key decision: `codex exec --json` over the app-server protocol. See D8 in
`04-01-PLAN.md` — app-server has true token deltas but is `[experimental]`;
stability won for v1, and `EngineSession` keeps the swap cheap.

## Milestone v0.2 — Installer + second admin device + Codex adapter ⚪ Not started

Full `curl | bash` wizard, `docs/ONBOARDING.md`, admin vault sync (pull on
launch, push on exit), and the Codex adapter proven by a machine that does not
have Claude Code. Second onboarder is a family **admin** (vault clone allowed).

Employee onboarding waits for v0.3 — the hidden-vault rule means a non-admin
device has nothing to read knowledge from until the vault service exists.

## Milestone v0.3 — Always-on box + vault service + WhatsApp + employees ⚪ Not started

Sherman parked on a machine or the droplet, active all day. That box hosts the
vault, runs the scoped vault service employee devices query (per-user
credentials, private-memory enforcement — the hard-privacy point), and runs the
WhatsApp bridge. Bridge decision (OpenClaw vs Twilio) deferred to then.

## Open questions (design doc §7)

1. **The 3–5 tasks employees spend the most time on** — seeds the first skills. Blocks Phase 3. *The one answer that matters most.*
2. Command confirmed as `sherman`. Logo: Codex track is generating it.
3. WhatsApp bridge: OpenClaw or Twilio? Not needed until v0.3.
4. Vault repo account: same private GitHub as second-brain, or company-owned? Matters once family members onboard.
