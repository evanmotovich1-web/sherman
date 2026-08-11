# Changes

Newest entries appear first. “Building” means active work that is not yet a
shipped, verified release.

## 2026-08-10 — Added: exec and delegate trace registers; unpublished-vault count

- The trace gains the reference's two remaining registers: `🐍 exec` for
  shell commands that run a language runtime (python, node, swift, ruby,
  deno, bun — same reported fact as `$`, more precise tag), and `🔀
  delegate` for every worker the shell hands a task to — /subagent,
  @-agents, and the automatic deep-work verifier commit a delegate row
  carrying the task instead of a prose notice, and the engine's own
  subagent activity now wears the same tag and glyph.
- The launch panel's Vault line now counts unpublished shared-lane changes
  (`… · 3 unpublished — sherman sync`), measured by git against wiki,
  memory/shared, and inbox only. Two machines disagreeing about the wiki
  count IS this number on one of them; now it shows instead of being
  discovered as confusion.

## 2026-08-10 — Added: navigate rides every turn as the blue globe; pet claims verified

- Every ordinary prompt turn now carries the standing navigate reminder,
  appended after the operator's words: begin with the navigate skill unless
  the request is trivial or purely conversational. Skill and research turns
  pass through untouched — they already carry their own routing. In the
  trace, navigate wears its own mark: 🌐, the blue globe, on both automatic
  loads and slash invocations.
- Seen live: a sandboxed session claimed "the desktop pet is hidden" while
  it stood on screen — the sandbox had blocked `sherman pet stop` and the
  verification checked the wrong thing. The pet skill now states the
  contract: stopping the pet is an operator action, a blocked stop is a
  failed stop, and the only evidence of absence is `pgrep -f sherman-pet-`
  coming back empty; anything less answers with the exact command the
  operator can run. Smoke's paste check now asserts the pasted lines as the
  request's front rather than its entirety, since standing routing rides
  after them.

## 2026-08-10 — Fixed: a failed background checkpoint names its cause and retries

- Seen live: "checkpoint eval failed: The engine reported an error." — a
  transient engine failure in the background judge's own worker, with no
  detail and, worse, the graded-turns marker already booked, so the failed
  stretch would never be re-graded. Both halves fixed: an engine error item
  with no message now carries the codex stderr tail (or names itself a
  transient failure plainly), and a failed background judge restores the
  grading debt — the next checkpoint retries, the exit eval covers it
  regardless, and the shell says so.

## 2026-08-10 — Added: 13 social-research skills; "research …" auto-runs the stack

- Vendored all 13 skills from ScrapeCreators/social-media-research-skills
  (per-skill MIT) after a full-file audit: scrapecreators-api (the routing
  backbone — 27+ platforms behind one REST API and an env-var key) plus
  outlier-post-finder, transcript-intelligence, comment-mining,
  competitor-social-research, ad-library-teardown, trend-discovery,
  influencer-prospecting, audience-research, social-listening-brief,
  product-demand-research, creator-profile-teardown, and
  content-repurposing, under a new `social-research` category. The audit
  found no injection and a clean network surface (the documented API and
  docs domains only, key sent solely as a header); the backbone skill
  carries Sherman's secret-handling boundary — the key's value never
  prints, logs, or enters the vault, and /0-1 owns wiring it.
- Typing "research X" (or "deep research on X") now routes like "write X an
  email" does: the shell wraps it in a research turn that runs the whole
  stack together — deep-research, fact-checking, and every domain research
  skill the subject matches — with research-wiki capture. The operating
  contract carries the same trigger for the word "research" anywhere in a
  request, so phrasing does not decide whether the stack runs.

## 2026-08-10 — Added: automatic skill loads show in the trace; /agents lists the roster

- Every automatic skill use is now visible: when the engine reads any file
  under a skill's directory, the trace re-tags that read as the `📚 skill`
  row it factually is — `📚 skill  navigate`, `📚 skill  document-reading →
  scripts/pdf_text.py` — several per turn when skills stack, exactly like a
  slash invocation's row. The operating contract now tells Sherman to load
  every matching skill together up front, so the stack shows at the top of
  the turn.
- `/agents` lists the whole roster locally — each @name with its specialty,
  personal agents marked — and names its sources and the agent-forge path
  to new ones. Declared in the capability registry under session.

## 2026-08-10 — Fixed: the pet's click finds Sherman across terminals

- A click aimed at the recorded terminal app, and an empty recording fell
  back to Terminal.app — which raised whatever sibling window was frontmost
  (seen live: a Codex session). The pet now searches every RUNNING terminal
  for the window titled "Sherman Abrams" — Terminal and iTerm2 by
  AppleScript, Ghostty/WezTerm/kitty/Alacritty through System Events (one
  automation consent on first click) — and only then falls back to app
  activation, preferring the recorded terminal.
- Terminal detection got backup signals: when TERM_PROGRAM is stripped (a
  multiplexer, a launcher), GHOSTTY_RESOURCES_DIR, WEZTERM_EXECUTABLE,
  KITTY_PID, ALACRITTY_WINDOW_ID, and ITERM_SESSION_ID name the host —
  in the shell's state writes and in `sherman pet`'s seed alike, and a
  seeded state whose terminal is empty is re-seeded rather than trusted.
- Every click logs its attempts to ~/.sherman/pet/click.log (bounded), so a
  click that lands wrong is diagnosable from the file.

## 2026-08-10 — Added: delegation chip, auto work verification, document reading, navigate

- The status rule gains a live delegation chip: 🔌 while an MCP connector
  call is in flight, 🤖 while an isolated worker, @-agent, or engine
  subagent runs — reported facts from app state, dropped under width
  pressure like any other chip. Every submitted prompt now shows
  `initializing agent` in the activity slot until the engine's first event
  replaces it.
- Deep work verifies itself: a prompt turn with four or more mutating steps
  (file changes, creations, commands, diffs) automatically runs a fresh
  isolated read-only worker that checks the finished work's claims against
  the actual files and reports VERIFIED / CONCERNS / CANNOT VERIFY before
  the operator builds on it. Interruptible like any turn.
- New `document-reading` skill: routes any named document through a working
  extractor — PDFs via bundled `pdf_text.swift` (macOS PDFKit) or
  `pdf_text.py` (pypdf, anywhere Python runs), docx/rtf/html via textutil,
  spreadsheets via spreadsheet-analysis — both PDF extractors verified
  against a real PDF at adoption, with honest errors for locked, scanned,
  and dependency-missing cases. No-PHI boundary stated.
- New `navigate` skill, named in the operating contract as the standing
  first move of every substantive task: place the request, sweep before
  diving, and pick EVERY skill the task touches — skills are expected to
  stack. The contract also now says skills fire on match, not on mention.
- The Sherman shell titles its terminal window "Sherman Abrams", and the pet
  raises that specific window on click (Terminal and iTerm2; other
  terminals fall back to app activation) — a click no longer lands on
  whichever sibling window, such as a Codex session, was frontmost. First
  click asks macOS automation consent once.

## 2026-08-10 — Improved: install.sh compiles the pet; /pet routes to /customize

- On macOS, install.sh now compiles the desktop pet during install (same
  source-hash binary contract as `sherman pet`), so a brand-new machine gets
  an instantly startable pet; a Mac without the Xcode Command Line Tools
  gets the exact install command as a NOTE instead of a failure.
- The /pet skill now names `/customize` as the owner of the desktop pet's
  size and color, so asking the skill about the pet's design points at the
  command instead of dead-ending.

## 2026-08-10 — Added: /customize, pet legs, and coat colors

- `/customize` in the shell styles the desktop pet and verifies by read-back:
  `/customize size <small|medium|large|huge>` and
  `/customize color <pink|blue|green|purple|gray>` (a bare value works; no
  arguments reports current settings). A running pet applies changes live
  within a second — prefs are re-read on the animation clock, size and color
  only, position stays owned by dragging. Declared in the capability
  registry under a new `pet` toolset; the same choices live in the pet's
  right-click menu.
- The pet has legs now — two stubby feet under the torso, the reference
  stance — and its chest mark sits on a small dark screen panel like the
  reference's, drawn in the eye mint.

## 2026-08-10 — Improved: the desktop pet is alive

- The pet now animates: a slow breathing bob, a blink every few seconds (the
  failed × never blinks away), and — every fifteen seconds — it pulls out a
  little amber medicine bottle, tips it at its face for a pretend sip with a
  glug wobble and rising bubbles, and puts it back. All motion derives from
  the wall clock at ~12 fps; there is exactly one timer in the program.
- `sherman pet` now seeds the state file with the terminal it was launched
  from, so the very first click brings the right app forward before any
  shell session has reported in.

## 2026-08-10 — Added: 21 audited skills vendored from awesome-ai-agent-skills

- Adopted 21 of the 103 skills in github.com/seb1n/awesome-ai-agent-skills
  (MIT), chosen for Sherman's charter and audited file-by-file — three
  parallel reviewers read every SKILL.md, reference, script, and asset for
  injection, exfiltration, network access, and unsafe execution before
  anything was copied. All bundled Python is local-only validation/profiling;
  the unused `agents/openai.yaml` files were dropped.
- Agent infrastructure: multi-agent-orchestration, agent-evaluation,
  tool-schema-design, mcp-server-building (with a caution note on its
  unverified protocol-revision claims), human-in-the-loop,
  prompt-injection-defense, and skill-supply-chain-audit — the last is now
  Sherman's own procedure for vetting future third-party skills.
- Company ops: spreadsheet-analysis, pdf-processing, presentation-creation,
  invoice-processing, budget-planning, compliance-checklist-generation,
  contract-review, onboarding-playbook-creation — the document- and
  data-facing ones carry an explicit Sherman no-PHI boundary note.
- Comms and knowledge: proofreading, translation, data-analysis,
  data-visualization, fact-checking, deep-research.
- Every vendored skill's front matter was normalized to Sherman's loader
  contract (name/category/summary/description; new categories: security,
  finance, data), each carries its source attribution, and smoke's
  self-containment and registry checks pass over the full 59-skill set.

## 2026-08-10 — Added: /update, named @-agents, MCP and Agents launch sections, harness upgrade

- `/update` runs the launcher's full update flow from inside the shell — pull,
  dependency reconcile, provisioner repairs, and the smoke suite — in a
  background child, so the shell stays usable and prints the verified result;
  restarting sherman runs the updated code.
- Named agents: `@name <task>` routes to an isolated read-only worker carrying
  that agent's harness. The bundled roster lives in `agent/agents.json`
  (researcher, reviewer, scout, ml-researcher) and Sherman can forge personal
  agents into `~/.sherman/agents/` via the new `agent-forge` skill; smoke
  check 17 verifies the roster the way it verifies capabilities.
- The launch panel gains an MCP Servers section (between Available Tools and
  Available Skills — wired vs. catalogued, from the workspace's rendered
  `.mcp.json`) and an Agents section listing the @-roster; the closing tally
  carries all four counts. Constrained frames drop the new sections whole and
  keep their prior geometry.
- The operating contract gains an explicit harness section: finish the task,
  batch independent tool calls, fan work out to parallel workers and sequence
  dependent stages, learn across sessions, and link memory as it is written.
- Five new skills: `ml-research` (structured ML research harness), `agent-eval`
  (runs inside the end-of-session eval; proposes at most one new agent from
  recurring-work evidence), `agent-forge`, `memory-link` (`[[wikilinks]]`
  between vault facts, both ways, scope-respecting; `vault-write` now invokes
  it), and `pet` (a persistent private-memory companion on `/pet`, in the
  Codex/Hermes pets lineage — cosmetic by contract).
- install.sh now provisions the OpenCode CLI alongside Codex, so both engines
  are launchable from a fresh install; verified by `opencode --version` and
  degraded to an honest NOTE where it cannot install.
- The committed tool trace now reads as the reference's table: a wider tag
  column with the detail column starting at one fixed offset, the tag inked to
  recede and the engine's label carrying the light, durations muted and
  failure marks red. Slash-invoked skills commit a `📚 skill` trace row of
  their own instead of a prose notice. Plain-text content of every row is
  unchanged.
- The MCP Servers section now appears at every frame size, not only the full
  panel: the abridged mid frame renders it as a dense line naming the servers
  themselves (with Agents following when two more rows exist), and the compact
  card gains matching `mcp` and `agents` rows as its height budget allows.
  Each frame's tally counts exactly the sections it shows.
- `sherman pet` (macOS) launches a floating always-on-top desktop companion in
  the Codex-pets lineage: it mirrors the live session — working with the last
  tool's label, done, failed, waiting, offline — from
  `~/.sherman/pet/state.json`, which the shell now writes at each transition;
  clicking it brings the terminal Sherman runs in forward, dragging moves it
  (the spot is remembered), and a right-click menu sizes it small → huge.
  Compiled locally from `pet/sherman-pet.swift` with the system Swift
  toolchain — no downloads, nothing runs that this machine did not build.
  State writes are gated on adopting the pet, so nothing changes for machines
  that never run `sherman pet`; `sherman pet stop` ends it.

## 2026-08-04 — Building: Sherman Commons trust boundary documented

- Recorded the proposed Commons architecture as a distinct, invitation-only
  Cloudflare pilot: a separately deployable Hono Worker and D1 service, a
  private React/Vite dashboard behind Cloudflare Access, and a local signed
  client/stdio MCP server. The foundation now includes local enrollment and
  request security; revocation operations, employee identity, deployment, and
  the server-scoped vault are not complete.
- Defined the product guarantees and threat-model acceptance checklist: PHI is
  prohibited with layered risk-reduction gates, no
  impersonation, no raw chat or secret sync,
  unique-owner consensus, replay- and tenant-safe signed devices, and no
  auto-install. Peer artifacts stay quarantined, validated, diffed, and subject
  to explicit owner approval.
- Began the local Worker/D1 foundation behind that gate: a liveness-only health
  route, composite tenant-bound schema, bounded replay/idempotency records,
  layered content checks, owner-distinct trend scoring, strict post contracts,
  and a deployment/audience-bound Ed25519 request-signing contract. This is
  build evidence only, not deployment or operational delivery.

## 2026-08-04 — Fixed: terminal selection can coexist with wheel scrolling

- Added `/select` as a runtime selection mode for terminals where Shift+drag
  cannot bypass mouse reporting. It temporarily releases mouse capture for
  ordinary drag selection and Cmd+C; running `/select` again restores Sherman's
  internal wheel/trackpad scrolling.
- Preserved default wheel capture, `SHERMAN_MOUSE=0`, `/copy`, and Ctrl+Y. The
  shell release is v0.2.6.

## 2026-08-04 — Fixed: wheel and trackpad scrolling work in the fullscreen CLI

- Sherman again captures mouse-wheel reports by default, so wheel and trackpad
  gestures browse the shell's real in-session history. The alternate screen has
  no native terminal scrollback; leaving capture off made those gestures do
  nothing even though PageUp and Shift+Up still worked.
- Shift+drag bypasses capture for terminal text selection. Operators whose
  terminal lacks that standard bypass can launch with `SHERMAN_MOUSE=0`; PageUp,
  PageDown, Shift+Up, and Shift+Down continue to browse history in that mode.
- The shell release is now v0.2.5, so `sherman update` reports and installs this
  hotfix rather than showing a same-version update.

## 2026-08-04 — Added: update delivers Chrome/computer use, design craft, evidence-first email, and selectable text

- Normal Codex turns now force on the stable in-app browser, external Google
  Chrome, and computer-use feature gates; isolated read-only workers still
  force them off. Browser openings prefer Google Chrome on macOS and fall back
  to the system default only when Chrome cannot open the target.
- Eleven bundled skills add motion vocabulary, Apple and design-engineering
  principles, animation discovery/improvement/review, UI-library selection,
  popular web-design patterns, computer use, evidence-first email writing, and
  disciplined tool execution. Because update replaces the repo and the launcher
  copies every bundled skill into the engine workspace, one `sherman update`
  makes the whole set discoverable on the next launch.
- “Write Alex an email” now enters the same first-party flow as `/email`: after
  a no-PHI preflight, inspect safe non-PHI Sent mail for the operator's voice,
  inspect safe correspondence with the recipient, and draft from that evidence.
  Ordinary read-only turns keep host browser/desktop tools disabled. A
  recipient with no prior thread produces one bounded tone question in an
  arrow-key multiple-choice box, then resumes the draft. Gmail compose is
  opened in Chrome but never sent.
- Terminal mouse capture is now opt-in with `SHERMAN_MOUSE=1`, so ordinary drag
  selection and terminal copy work by default. `/copy` and ctrl+y remain the
  one-step way to copy the last reply.

## 2026-08-03 — Changed: a corrupt config self-heals; `sherman update` repairs it too

- The launch flow no longer tells a person to delete a file the script can
  move itself. A config that does not parse is quarantined beside itself
  (`config.json.bad.<timestamp>` — kept, never deleted: it is evidence of a
  writer this repo believes cannot exist), setup asks its questions again,
  and the launch completes. One press of `sherman` fixes the machine.
- `sherman update` runs the same quarantine in its repair pass, alongside the
  LLM Wiki repair and Agent Reach provisioning — update is the button people
  press when something is wrong, and now it moves a corrupt config out of the
  way too, so the next launch asks setup instead of failing.
- Paths that cannot re-run setup (a scheduler saving a Telegram token, say)
  keep the earlier named remedy. Smoke check 28 now drives the full
  self-heal — corrupt config in, quarantined intact byte-for-byte, fresh
  valid config out, launch exits 0 — plus the both-call-sites assertion and
  the backstop remedy.

## 2026-08-03 — Fixed: a corrupt config gets its remedy on screen, and the Windows paste does its own admin step

- A corrupt `~/.sherman/config.json` used to kill the launcher inside its
  first jq read: under `set -e` the person saw a bare
  `parse error: Invalid escape` and a Sherman that would not start, while the
  "delete it and run sherman again" remedy the script always contained never
  printed. Seen on a real Windows machine. Both config accessors now refuse
  an unparseable config with the named file and the remedy — worded
  identically to the shell's own message — and exit clean.
- The wizard now reads back the config it just wrote, as JSON and as the
  engine value. Answers that produce a config that does not parse are refused
  at write time and the file deleted, with setup named as the fix — not kept
  for the next launch to trip over. Smoke check 28 drives a corrupt config
  through the launcher and asserts the remedy prints, the exit is nonzero,
  and no raw jq noise reaches the screen.
- `install.ps1` no longer stops to dictate the one administrator command for
  the person to retype. When WSL is not enabled and the shell is not
  elevated, the script asks Windows for elevation itself — a standard
  permission prompt on exactly `wsl --install -d Ubuntu` — and verifies the
  distro answers afterwards. Declining the prompt still gets the manual
  instructions, and nothing is changed. That command, done by hand, was the
  only part of the first real install the paste did not do.

## 2026-08-02 — Added: pressing update grows the capability, not just the catalog

- `sherman update` now provisions Agent Reach, so a machine installed before
  it existed gets internet access by pressing update rather than by reading a
  changelog and running a command. Catalogued is not installed: the previous
  state of this was a PC that pulled a connector entry pointing at a tool it
  did not have, and `/mcp` correctly reporting it missing forever.
- One provisioner, `bin/provision-agent-reach.sh`, called from both
  `install.sh` and `sherman update`. The LLM Wiki's arrangement — provisioned
  in one file, repaired in another — is two copies of one idea that have
  already drifted, and this does not repeat it. It installs `uv` first when
  that is missing, is silent when Agent Reach already answers, and degrades to
  a named NOTE on a machine that cannot have it.
- What it installs is deliberately the CLI, not only the MCP server. Agent
  Reach's server exposes one tool, `get_status`; the fetching is its
  command-line tool, so the install has to land something on the operator's
  PATH — which `uv tool install` does and a private venv would not.
- Pinned to a commit, with the MCP dependency held below 2.0. Both are
  load-bearing: this is third-party software whose newest release already
  broke against the 2.0 server API, and an install that follows someone
  else's main branch is a capability that stops working on a day nobody chose.
  Smoke check 27 asserts both, that both entry points still call the one
  script, and that a fetch-disabled run stays offline, claims nothing, and
  leaves no half-built tool directory behind.
- Verified end to end against a sandbox HOME: a fresh install lands the CLI
  shim and passes the same import probe the connector uses, and a second run
  prints nothing. The update path reaches this on the FIRST press, because
  update already re-execs into the launcher its own pull delivered.

## 2026-08-02 — Added: Sherman can reach the public internet, through a connector it names

- New skill `mcp`. It is the other half of `0-1`: that one acquires a
  capability, this one spends it. Check what is actually wired before claiming
  a capability, name the connector and platform an answer came through, and
  separate what was reached from what was dark. Routed from `agent/SYSTEM.md`,
  so it is reached from the operating contract rather than only when a
  description happens to match.
- Two connectors catalogued, both verified against a live server first.
  `agent-reach` — Agent Reach 1.5.0 as a user-global uv tool, fifteen platforms
  behind one router. Its MCP server exposes exactly one tool, `get_status`; the
  fetching is its command-line tool, and the skill says so plainly rather than
  letting a turn be wasted looking for tools that are not there. `exa` —
  keyless semantic web search over live pages, HTTP transport, and therefore
  Claude Code only, which `/connectors` and the launcher both state.
- Connector catalog entries may now declare `env`, the environment their server
  process runs under, with one new expansion variable: `${PATH}`, the
  launcher's own. This exists because a server that shells out to its own
  helper binaries and is handed a truncated PATH reports its own capabilities
  as missing — a wrong answer that looks exactly like a right one. Agent Reach
  read 4 of 15 channels under a bare PATH and 5 of 15 under the rendered one.
  A committed catalog cannot know an operator's PATH, so an entry writes
  `${HOME}/.local/bin:${PATH}`; duplicates are collapsed on render because the
  result lands in a person's codex config. The probe runs under the same
  environment, so what is tested is what the engine is handed, and a value that
  does not resolve blocks the connector instead of half-building it.
- Verified end to end: the rendered `.mcp.json` and codex `[mcp_servers.*.env]`
  block both parse, Claude Code lists all three servers from the workspace, and
  `get_status` answers when spawned from exactly the rendered command and
  environment. A sandbox HOME without Agent Reach installed degrades to the
  named repair command rather than a broken server, and that repair command was
  itself run in a throwaway tool directory before being written down.

## 2026-07-31 — Changed: skills act first, and failed updates keep their evidence

- Sherman now works autonomously by default: inspect the vault and available
  files, infer routine choices, use reversible defaults, and finish the task
  instead of turning a skill into a questionnaire. Interactive interviews,
  menus, and approval checkpoints are opt-in through the current request; one
  focused question remains for a genuinely unknowable, material blocker. The
  shared operating contract governs every turn, `/skill` envelopes reinforce
  it, and SEED explicitly converts its imported wait points into an internal
  decision checklist. The automatic session eval now grades avoidable questions
  and pauses, while durable corrections are recorded without asking whether to
  remember them. The no-PHI boundary is unchanged.
- `sherman update` now treats dependency-install or smoke failure as a failed
  verification, never a healthy update; it also reinstalls dependencies when
  either package manifest changes. Smoke repeats every failure in a final
  recap, and its Node-test check prints the actual failing TAP blocks instead
  of discarding them and showing only a count. A PC result such as "39 passed,
  5 failed" now ends with the five diagnostics needed to repair that platform.
  The update check itself now uses an offline fake checkout for both pass and
  fail paths instead of contacting the real remote during every smoke run.

## 2026-07-30 — Changed: old configs get the new questions; the installer grows the window

- A config written before the model and Telegram questions existed now gets
  exactly those questions asked once, on the next interactive launch, then
  the config version bumps to 2 so it never repeats. "It didn't ask me" was
  the real experience of the first Windows machine — its config predated the
  questions — and silently never asking is the wrong kind of quiet.
  Non-interactive runs skip: a pipe cannot answer. Verified end-to-end with
  an expect-driven pty: model lands in codex's own config, version bumps.
- install.ps1 (build 2026-07-30.14) grows the console to 120×45 best-effort
  before starting Sherman: the full launch screen needs 29+ rows and the
  wide banner 40+, and the person should not have to know that. Where the
  terminal ignores console resize APIs, the compact card itself now names
  the fix on screen.

## 2026-07-30 — Added: model choice, Telegram bridge, and one vault on every machine

- Driven by the first real Windows install (issue #9, ten runs on real
  hardware): setup gained an optional **model** question — written into
  codex's own config, the one place codex reads it, backed up and verified
  by read-back — and an optional **Telegram** token question. The connect
  flow may exist because the bridge now does: `bridge/telegram.js`, zero
  dependencies, long-polling the Bot API, one engine session per chat over
  the same assembled adapter as the shell, default-deny to every chat but
  the one paired with `sherman telegram --allow`. Verified to the edge of
  what a machine without a bot token can verify: a fake token reaches
  Telegram's own Unauthorized and exits loud. WhatsApp remains unbuilt and
  is stated as such, not menued.
- **`sherman sync`** shares the vault across machines through the repo:
  pull --ff-only, commit only the shared lanes (wiki, shared memory,
  inbox), push when the machine has write access, and say plainly when it
  only pulled. Private memory never travels; sync refuses to commit over
  another session's staged work. The new **llm-wiki** skill (tenth) teaches
  the habit: write the fact, sync, report what actually happened. The vault
  is plain Markdown, so it doubles as an Obsidian vault as-is.
- The compact launch card now says it is the small-window view and that a
  larger window shows the full screen — on the first Windows run it read as
  "an old Sherman" next to a maximized Mac, and a view that cannot explain
  itself invites exactly that misreading.

## 2026-07-30 — Changed: skills reach the engine, speak the standard, and gain a ninth

- Until now the skills reached the launch screen and nothing else — no
  ordinary engine turn ever saw them. The launcher now copies `skills/` into
  the workspace on every launch, at `.agents/skills` (the Agent Skills
  convention Codex discovers natively) and `.claude/skills` (Claude Code's),
  and the assembled body tells the engine they are there. Copies, not
  symlinks: the workspace is disposable, and a link would aim engine writes
  back at the repo. Smoke check 3 counts what landed against what the repo
  defines, per convention.
- Every `SKILL.md` now carries the Agent Skills standard's second mandatory
  field, `description` — the line an engine reads to decide when a skill
  applies. The registry treats a skill without one as malformed, because a
  skill the engine will never reach for is not a working skill.
  `skills/README.md` documents the contract.
- New skill `sop-review` (documents): report which vault SOPs are overdue,
  coming due, or have never been reviewed, from a review line each SOP
  carries — the one PHI-free document-control habit every serious lab
  document system sells. It never marks anything reviewed; that stays a
  human act. `sop-draft` now ends SOPs with the review line under the same
  rule. Grounding: `docs/research/market-2026-07.md`.

## 2026-07-30 — Added: install.ps1, a Windows bootstrap for the WSL2 route

- `install.ps1` automates docs/WINDOWS.md end to end from PowerShell: enable
  WSL2 (the one step that may need an admin shell and a reboot — it stops
  and says so instead of half-doing it), install Ubuntu, install git/curl/jq
  inside it, clone into the Linux filesystem, and hand off to `./install.sh`
  in the distro. Idempotent at every stage; every "verified" line follows a
  real check (`wsl -d Ubuntu -e true`, `command -v` inside the distro), and
  distro detection never parses `wsl -l`'s UTF-16 output — exit codes only.
- The platform remains untested and both the doc and the script keep saying
  so: the WSL write-boundary is stated as UNVERIFIED until someone re-runs
  the escape test there. New smoke check 23 pins the routing (doc ↔ script),
  the unverified-boundary admission, and — only where a `pwsh` exists to do
  it — the script's syntax, with the pass line naming exactly what was
  checked.

## 2026-07-29 — Changed: install.sh provisions missing prerequisites itself

- A machine without Node 22+ gets the official build downloaded from
  nodejs.org into `~/.sherman/runtime` (pinned v22.23.2, all four
  darwin/linux × arm64/x64 tarballs verified to exist) and linked next to
  `sherman` — no sudo, nothing outside Sherman's own directories. A machine
  without the codex CLI gets `npm install -g @openai/codex`. Both claims
  follow verification (`node --version`, `codex --version`); failed
  downloads say so. Signing in remains the engine's own first-launch login —
  the one thing no installer can do.
- `SHERMAN_INSTALL_NO_FETCH=1` disables all network fetches and says so
  plainly; smoke uses it to stay offline. Check 21 asserts the guard's
  honesty; new check 22 exercises the real download → extract → link →
  verify chain against a stub curl serving a fake tarball, and proves an npm
  that produced no codex is refused an "installed" line.
- README and docs/WINDOWS.md updated: prerequisites shrank to what genuinely
  stays yours (macOS or WSL2, the sign-in, git+curl).

## 2026-07-29 — Added: a Windows install route, stated as untested

- `docs/WINDOWS.md` documents the WSL2 route end to end — Node 22 via nvm,
  the Codex CLI and its own sign-in, clone + `./install.sh` — and states
  plainly what is unproven there: the vault write-boundary escape test has
  only ever run on macOS, smoke has never executed on Linux, and the UI has
  never rendered in Windows Terminal. No native installer exists, and the
  doc says why instead of omitting it.
- The README's Windows sentence now routes to that doc; smoke check 19
  additionally fails if the README points at a Windows route that is missing
  or does not admit it is untested.

## 2026-07-29 — Changed: install.sh claims only what it verified

- Every success line now follows a check, not an attempt: "executable" after
  `[ -x ]`, "dependencies installed" only after `node_modules/ink` and
  `node_modules/react` exist (npm exiting 0 is an attempt's report), and the
  "linked" line only after `readlink` confirms the symlink points at the
  launcher. The npm-missing graceful path is unchanged.
- A truthful still-needed report closes the run: Node found/too-old/missing
  and codex CLI found/missing — reported, never installed, because install.sh
  does not provide either.
- Smoke check 21 drives install.sh in a sandboxed fake repo with an npm stub
  that exits 0 while producing nothing, and fails the suite if any claim
  outruns its verification.

## 2026-07-29 — Changed: the wizard renders from a provider registry

- The first-run provider menu now renders from a registry in `bin/sherman`
  (one `id|label|binary|status|reason` line per provider). Codex is the only
  available provider; Anthropic is listed as visibly unavailable and refuses
  selection with the reason, instead of proceeding into a shell whose Claude
  backend is a stub that errors on every turn.
- Adding or enabling a provider later is one registry line, not new wizard
  flow. The seam — including why messaging channels are absent from setup —
  is recorded in `DESIGN.md`.
- Smoke checks 2/3/5/6 repaired for the codex-first reality; new check 20
  proves the unavailable provider is shown, refused with its reason, and that
  the run still completes on the available one. A hand-written
  `engine: claude` config still selects the stub exactly as before.

## 2026-07-29 — Added: README, ahead of going public

- Audited all 57 commits of history for secrets before anything else: clean.
  No credentials in any commit; the committed `.mcp.json` carries only env-var
  placeholders; no `.env`, captured config, or session logs ever landed.
- Added `.env`, `.env.*`, and `*.local` to `.gitignore` as standing hygiene.
- Wrote the first `README.md` under the same honesty laws as the shell: the
  install section says what `install.sh` actually does, prerequisites name
  what it does not provide (Node 22+, the Codex CLI and its login), Windows is
  stated plainly as never-run, and unbuilt integrations appear only under a
  marked "Not built yet" heading. The safety section describes the real
  boundary — the default-deny macOS sandbox and the no-PHI floor — and does
  not claim approval-gated writes, because `approval_policy="never"` is the
  wired truth.
- Smoke check 19 now guards the README's honesty mechanically.

## 2026-07-28 — Building: launch and chrome rewrite

- Reversed the v6.1 tall launch panel introduced in `45ae8b9`. Launch cards now
  use truthful compact/full modes and hug their content at every terminal
  height, leaving spare rows to the transcript instead of stretching the card.
- The launch layout matrix now enforces the compact/full boundaries and forbids
  height-dependent panel stretching.
- Preserved alternate-screen viewport history while reducing persistent chrome
  to one truthful status rule and one borderless composer row.
- Added `/compact`, plus automatic compaction at 90% of the model's context
  window. Compaction is a read-only summarization turn followed by a new engine
  thread; the summary rides the next request as a handoff and is spent once. The
  thread reset is an `EngineSession.startNewThread()` capability that defaults to
  a truthful `false`, so a backend that cannot reset says so instead of claiming
  a reduction it did not get.
- Added first-party `/help`, `/goal`, `/plan`, and `/subagent`; read-only plan and
  worker turns are fresh, ephemeral, transcript-independent, and explicitly
  disable inherited MCP servers and host tools.
- Expanded Codex event mapping into factual reasoning, tool, command, patch,
  collaboration, plan, usage, and outcome activity without exposing hidden
  chain-of-thought.
- Reworked launch identity, live vault counts, transcript signatures, activity,
  status timing/context, palette budgeting, narrow layouts, and reduced motion.
- Added terminal-output sanitization for OSC, CSI, and unsafe controls plus
  terminal-cell-aware CJK, emoji, and combining-character layout.
- Added live App command/isolation tests and responsive matrices spanning target,
  short, narrow, hostile, and pathological terminal sizes.

## 2026-07-26 — Building: Sherman Shell

- A parallel PAUL-mode session is building the Node terminal UI that will own
  Sherman's chat surface and drive Claude Code or Codex headlessly.
- Planned first slice: branded header, streaming chat, engine/model/user/vault
  status, and a shared `EngineSession` seam. The Board follows the stable chat
  loop.

## 2026-07-26 — Fixed: company logo mark

- Replaced the generic three-block header mark with the stacked Sherman Abrams
  Labs mark in the plain and ANSI banners.
- The owning parallel session still controls and commits the banner files.

## 2026-07-26 — Added: banner and starter vault

- Added plain and ANSI terminal banners.
- Seeded `vault/wiki/`, `vault/inbox/`, shared memory guidance, and the private
  memory boundary.
- Commit: `6e52b3b` (`banner + starter vault (codex)`).

## 2026-07-26 — Added: Phase 1 launcher chassis

- Added the idempotent installer, `sherman` launcher and first-run wizard,
  canonical persona, Claude/Codex wrapper templates, and smoke suite.
- The launcher assembles a fresh runtime adapter, records engine/user/vault
  configuration, and delegates login to the selected engine's native OAuth.
- Phase implementation: `2f59775`; PAUL summary/state completion:
  `a1c10a4`, `0f40325`.
