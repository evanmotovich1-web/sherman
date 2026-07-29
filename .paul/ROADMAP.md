# ROADMAP

Derived from design doc §6 (Phases). Bootstrapped 2026-07-26.

## Milestone v0.1 — Evan-only local prototype 🟡 In progress (4 of 6 phases)

Proves the whole contract end to end on one Mac: *type `sherman`, the agent
appears, it knows the business.*

Design-doc Phase 1 splits into three tracks. Phase 4 was added 2026-07-26 after
Evan's first live run; Phase 5 the same day, after seeing the launch screen.

**Status:** *type `sherman`, the agent appears — as Sherman* is done and verified.
Phases 1 and 4 delivered the command, the branded screen, the headless engine and
the vault boundary.

**What remains is the sentence's last clause: "it knows the business."** The vault
holds READMEs. Sherman will correctly say it does not know rather than invent, but
until knowledge and skills land the product is a very good shell around an empty
brain — and that is now the only thing between Sherman and being useful.

That gap is Phase 2 (vault seed, parallel Codex track) and Phase 3 (skills,
blocked on §7 Q1).

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

### Phase 4 — Sherman Shell ✅ Complete (2026-07-26, 2/2 plans)

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
- `04-02` ✅ **Shell UI + wire-up** (2026-07-26, commit `fcd2b82`). Ink 7 app:
  banner header in house colours, chat pane over the terminal's own scrollback,
  status bar (engine · model · user · vault · tokens), two-stage Ctrl+C,
  `bin/sherman`'s final `exec` swapped to the shell, `sherman --raw` for debugging,
  `smoke.sh` extended to 6 checks. 9/9 ACs Pass, human-verify approved.
  **Includes the activity indicator with elapsed time** — Evan made this
  non-deferrable, and it was measured rather than eyeballed: a captured pty session
  shows the timer advancing 0.0s→4.5s in 0.1s steps from the moment of submit, all
  ten spinner glyphs cycling, and the label switching to the live tool line.

Exit condition: typing `sherman` lands in a branded Sherman screen — no OpenAI
or Anthropic chrome — holding a real conversation with the engine sealed inside
the vault. **Met**, verified in a pty across launch, a two-turn conversation,
interrupt-and-recover, clean exit, `--raw`, and four broken-environment paths.

Note on "streaming": there are no token deltas on this transport (D8), so output
is item-level. The activity indicator carries the wait instead. If that ever
grates, the fix is the app-server transport, not more UI.

**Board view was explicitly NOT in this phase** (§3c: "comes right after the chat
loop is solid, not in the same diff"). The chat loop is now solid, so it is
unblocked — it slots into `app.js` as another region against the same event
contract.

Key decisions: `codex exec --json` over the `[experimental]` app-server protocol
(D8), and the vault boundary enforced by the OS sandbox rather than by removing
Codex's shell tool (D9). Both in `04-01-PLAN.md`.

### Phase 5 — Launch screen v2 ✅ Complete (2026-07-26, 1/1 plan)

Phase 4 made Sherman own the screen. It does not yet own the **first frame**.
Added 2026-07-26 after Evan compared Sherman's opener against a reference agent
launch screen — same pattern that produced Phase 4: a live run showed the gap.

The opener today is a flat red wordmark and a mark, carrying no information. The
reference screen's value is not its colours; it is that the first frame answers
*what is this and what does it know* before you type a character.

Owns `shell/src/ui/` launch-time rendering plus one new non-UI reader:

- a layered SHERMAN wordmark (lit top edge, body darkening downward, shadow) in
  the red family, with the existing 41-column mark as the narrow fallback
- a bordered two-column info panel — mark and identity left, live vault counts
  and real key bindings right, engine · model · exit in the footer
- `shell/src/vault.js`, a vault stats reader
- one welcome line, and two new smoke checks (80 and 200 columns)

**Governing rule: only true content, nothing invented.** That rule is why the
panel is worth having, and it is also why it will read `0` everywhere until R8
lands — the numbers are real, and today the real number is zero.

Exit condition: typing `sherman` opens on a screen that states what Sherman is,
what it can reach, and how to drive it — every value on it traceable to config,
`session.info`, or a filesystem read. **Met** — verified mechanically by render at
60/80/100/200 columns and by the full App tree mounting against the real vault;
approved by Evan at the plan's human-verify checkpoint.

Plans: `05-01` ✅ (wordmark, panel, vault reader, wire-up) — 4/4 tasks, 8/8 ACs

Two things worth carrying forward:

- **D17 binds the board view.** `useWindowSize()` is blind to `renderToString`'s
  width, so any width-branching component takes an injectable `columns` prop or it
  cannot be tested off a TTY — and worse, its tests pass while proving nothing.
- **The panel is a live report, so it will fill itself in.** Counts come from a
  readdir at mount. Nothing about this screen needs revisiting when Phase 2 lands;
  the numbers simply stop being zero.

### Phase 6 — Session identity & the live turn UI ✅ Complete (2026-07-26, 2/2 plans)

Added 2026-07-26 after Evan compared Sherman against Hermes mid-conversation —
the third phase born from a live-run comparison (same pattern as Phases 4 and 5).
Scope: `shell/` and `bin/sherman`. Structure copied from the Hermes reference,
palette Sherman's own (red 196 family; mark pink/purple/blue), under 05-01's
governing rule: every value true, nothing invented.

- `06-01` ✅ **Session identity, lifecycle & the first frame v3** (commit
  `99331f3`). Session id `YYYYMMDD_HHMMSS_<6 hex>` minted by `bin/sherman` and
  identical everywhere it was promised: the launch panel, the adapter's new
  memory-attribution rule ("— user · session · date"), both handoffs, and the
  JSONL turn log at `~/.sherman/sessions/` (operational data — never the
  vault; may quietly die, may never crash a turn). Build stamped into the
  panel's top border, segments omitted cleanly without git. `sherman update`
  honest in all three repo states, recursion-guarded against smoke. Launch
  screen v3: SHERMAN AGENT two-deck wordmark, identity block, full-height
  opener on the primary screen (D12 held). 4/4 tasks, AC 1–6 Pass, checkpoint
  approved.
- `06-02` ✅ **The live turn UI** (commit `f4b7518`). `● user` bullets,
  dim-italic activity trace sourced ONLY from real engine events, replies in a
  bordered box signed `●●● Sherman` (the mark at one-character scale), and the
  red segmented bar: engine · model | tokens | session minutes | live turn
  timer / last duration. NO ctx-percent — the transport reports no context
  figure. Smoke check 11 drives the REAL App through a fake backend over
  PassThrough stdio and asserts the trace line exists only because the fake
  emitted it. 4/4 tasks, AC 1–5 Pass, checkpoint approved.

Exit condition — **met and approved at both checkpoints**: a session is
identifiable (screen, adapter, log), updatable (`sherman update`), and staged
like the reference: opener fills the viewport, turns render as bullet → live
trace → signed box, the bar carries true segments in red. Eleven smoke checks
green.

### Phase 7 — Public-repo readiness ✅ Complete (2026-07-29, 1/1 plan)

Evan intends to flip the repo public. Before that is sane: a full-history
secret audit (ran clean — 57 commits, no credentials, no PHI, no captured
state; details in `07-01-PLAN.md`), a README that exists and tells only the
truth, a first-run wizard that cannot offer the stubbed Claude backend as a
selectable option, and an installer whose success lines follow checks rather
than attempts. The honesty laws that govern the shell apply to the README and
installer identically.

Plans: `07-01` ✅ (README + gitignore hygiene, provider-registry wizard,
verify-then-claim installer) — commits `1b07221`, `a7e87f3`, `8d66fb2`,
`8899d45`. Smoke 18 → 21, all green; shell tests 128/128 held. Exit
condition met: nothing in the README, wizard, or installer advertises a
capability that is not wired. Flipping visibility remains Evan's action.

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
