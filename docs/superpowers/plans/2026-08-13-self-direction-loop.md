# Self-Direction Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `sherman loop [n]` — Sherman reads `vault/direction/`, picks its own next task, executes it in-sandbox, writes direction updates back through the validated retention path, and iterates without per-iteration checkpoints; all four gates (merge/money/external/sandbox) inherited unchanged.

**Architecture:** The loop is a scheduler over existing machinery, adding zero new privilege. Direction files are a new retention *lane* (`vault/direction/`), so every model-proposed write passes the existing PHI/secret/injection screens and the hardened atomic writer. Each iteration is two engine sends on one session: a PICK turn (logged before execution) and an EXECUTE turn.

**Tech Stack:** Node 22 ESM, `node:test`, existing `EngineSession` API (`selectBackend(config)` → `async *send({text, mode, source})` yielding `ev.*` events), existing `retention.js` validation + `retention-writer.js`.

## Global Constraints

- Never add `--dangerously-bypass-approvals-and-sandbox` or any engine bypass flag; engine posture args are untouched by this feature.
- No loop code path may invoke `gh pr merge`, `git push` to main, `sherman money approve`, or any external send.
- Vault writes go ONLY through `applyRetentionResult`; no raw `writeFileSync` into the vault from loop code.
- Direction filenames must match retention's `SAFE_NAME` (`/^[a-z0-9][a-z0-9-]{0,79}\.md$/`), flat in `vault/direction/` — threads are `thread-<slug>.md`, no subdirectory (retention-writer forbids `/` in paths). This flattening supersedes the spec's `threads/` subtree.
- Operator-marked lines (`[operator]` anywhere in the line) in existing direction files must survive any model-proposed rewrite of that file, else the operation is rejected.
- macOS system Bash 3.2 compatibility in `bin/sherman`.
- `./smoke.sh` green before every commit; commit each task.

---

### Task 1: `direction` retention lane

**Files:**
- Modify: `shell/src/retention.js:87-91` (`laneFor`)
- Test: `shell/test/retention.test.js` (append)

**Interfaces:**
- Produces: `applyRetentionResult({ vaultPath, source: 'direction', text })` writes one validated file into `<vault>/direction/`. Later tasks rely on exactly this call.

- [ ] **Step 1: Write the failing test** (append to `shell/test/retention.test.js`, matching its existing temp-vault helpers):

```js
test('the direction lane confines validated writes to vault/direction', () => {
    const vaultPath = mkdtempSync(join(tmpdir(), 'sherman-vault-'));
    try {
        mkdirSync(join(vaultPath, 'direction'), { recursive: true });
        const text = JSON.stringify({ operations: [{ path: 'goals.md', content: '- improve smoke coverage\n' }] });
        const written = applyRetentionResult({ vaultPath, source: 'direction', text });
        assert.deepEqual(written, ['goals.md']);
        assert.equal(readFileSync(join(vaultPath, 'direction', 'goals.md'), 'utf8'), '- improve smoke coverage\n');
        assert.throws(() => applyRetentionResult({
            vaultPath, source: 'direction',
            text: JSON.stringify({ operations: [{ path: 'goals.md', content: 'patient John Smith has diabetes' }] }),
        }), /possible_phi/);
    } finally {
        rmSync(vaultPath, { recursive: true, force: true });
    }
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test shell/test/retention.test.js` → FAIL (`Retention vault lane is unavailable`).
- [ ] **Step 3: Implement** — in `laneFor` add: `if (source === 'direction') return join(vaultPath, 'direction');`
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** `feat: direction retention lane`.

### Task 2: direction module — read, operator immunity, apply, log

**Files:**
- Create: `shell/src/loop/direction.js`
- Test: `shell/test/loop-direction.test.js`

**Interfaces:**
- Consumes: `applyRetentionResult` (Task 1).
- Produces:
  - `readDirection(vaultPath)` → `{ goals: string|null, threads: Array<{name, content}>, log: string|null }` (missing dir → all empty, never throws).
  - `operatorLinesSurvive(existing, proposed)` → boolean.
  - `applyDirectionOperations({ vaultPath, operations })` → `{ applied: string[], rejected: Array<{path, reason}> }` — per-op: rejects `log.md`, rejects goals rewrites that drop `[operator]` lines, else routes through `applyRetentionResult`; a validator throw becomes a `rejected` entry, never a loop crash.
  - `appendLoopLog({ vaultPath, line })` → boolean — shell-composed one-liner; strips control chars, truncates to 200 chars, keeps last 30 lines, writes via `applyRetentionResult` as full-content `log.md`.

- [ ] **Step 1: Write the failing tests** (temp vault per test; core cases):

```js
test('readDirection returns empties for a missing layer', () => { /* no direction dir → {goals:null,threads:[],log:null} */ });
test('operator lines are immune to model rewrites', () => {
    const existing = '- [operator] never drop PHI rule\n- old goal\n';
    assert.equal(operatorLinesSurvive(existing, '- new goal\n'), false);
    assert.equal(operatorLinesSurvive(existing, '- [operator] never drop PHI rule\n- new goal\n'), true);
});
test('applyDirectionOperations rejects log.md and protects operator lines, applies the rest', () => { /* three ops: log.md → rejected; goals dropping [operator] → rejected; thread-x.md → applied and on disk */ });
test('appendLoopLog rotates at 30 lines and sanitizes', () => { /* 35 appends → 30 lines; ESC bytes stripped */ });
```

- [ ] **Step 2: Run to verify FAIL** (module not found).
- [ ] **Step 3: Implement `direction.js`** (~90 lines): `readDirection` via `readdirSync`/`readFileSync` in try/catch; immunity = every existing line containing `[operator]` appears verbatim (trimmed) in proposed; apply loop try/catches per op; log append reads current `log.md`, composes `[...last29, line].join('\n')`, routes through `applyRetentionResult` (content stays under the 4000-byte cap by the 200×30 bound).
- [ ] **Step 4: Run to verify PASS.**
- [ ] **Step 5: Commit** `feat: direction layer module`.

### Task 3: loop core — pick/execute iterations, STOP, failure halt

**Files:**
- Create: `shell/src/loop/run.js`
- Test: `shell/test/loop-run.test.js`

**Interfaces:**
- Consumes: `readDirection`, `applyDirectionOperations`, `appendLoopLog` (Task 2).
- Produces: `runLoop({ config, iterations, makeSession, home, now })` → `{ completed, halted: null|'stop'|'failures', results: [{pick, ok}] }`. `makeSession(config)` injectable (defaults to `selectBackend`); `home` for the STOP file (`<home>/.sherman/loop/STOP`).
- Iteration protocol: PICK send (`source: 'loop-pick'`, prompt = direction layer + "reply ONLY with JSON {\"pick\":…,\"why\":…}"; bootstrap instruction when goals are empty) → parse trailing JSON object from the final `message` event → `appendLoopLog` the pick → check STOP → EXECUTE send (`source: 'loop-exec'`, prompt = "Execute exactly this pick… End with JSON {\"outcome\":…,\"direction\":{\"operations\":[…]}}"; publishing contract restated: smoke-green branch + PR, never main, no merges/spends/sends) → apply direction ops → log outcome. Both sends run mode `'normal'` — the standard posture, nothing loosened.
- Failure = send throws, no parsable JSON, or `outcome` missing; two consecutive → `halted:'failures'`.

- [ ] **Step 1: Write the failing tests** with a scripted fake session (`async *send(req)` yielding `ev.message(...)` from a queue, recording every request):

```js
test('an iteration picks, logs the pick before executing, executes, and applies direction ops', () => { /* queue: pick JSON, then exec JSON with one thread op; assert log line about the pick exists before exec request was consumed (fake session asserts log content at exec time), thread file on disk, completed:1 */ });
test('a STOP file halts between pick and execute and between iterations', () => { /* create STOP inside fake session's first exec; halted:'stop' */ });
test('two consecutive failures halt the loop', () => { /* queue garbage twice; halted:'failures', completed:0 */ });
test('iteration count is bounded 1..10 and defaults to 3', () => { /* runLoop with iterations:99 clamps to 10 (fake instant sessions) */ });
```

- [ ] **Step 2: FAIL** (module not found).
- [ ] **Step 3: Implement `run.js`** (~140 lines). Parse trailing JSON with the same last-`{`…`}` scan retention uses. Wall-clock cap: `Promise.race` per send with `session.interrupt?.()` on 20-min timeout, iteration marked failed (tests inject `now`/instant fakes, no real timers).
- [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit** `feat: self-direction loop core`.

### Task 4: CLI + `bin/sherman` dispatch + seed + docs

**Files:**
- Create: `shell/src/loop/cli.js`; `vault/direction/goals.md` (seed); Modify: `bin/sherman` (dispatch, after the `money` block), `docs/superpowers/specs/2026-08-13-self-direction-loop-design.md` (threads-flattening note)

**Interfaces:**
- Consumes: `runLoop` (Task 3), `loadConfig()`.
- Produces: `sherman loop [n]` and `sherman loop stop`. `cli.js` mirrors `money/cli.js`: `main(argv)` guarded by the `process.argv[1]` check; `loop stop` writes the STOP file and reports; plain `loop [n]` clears a stale STOP (a fresh invocation is operator intent), `mkdirSync`s `<vault>/direction`, prints each iteration's pick/outcome lines as they land, exits 0 unless halted by failures.
- Seed `vault/direction/goals.md`:

```markdown
- [operator] Direction for the self-direction loop. Edit freely; lines marked [operator] cannot be rewritten by agents.
- [operator] Standing rule: reversible work only — branch + PR, never merge; no spends outside the money engine; no external sends; no PHI.
```

- `bin/sherman` dispatch (Bash 3.2, mirroring `run_money`):

```bash
if [ "${1:-}" = "loop" ]; then
    shift
    run_loop "$@"
fi
```

with `run_loop()` exec-ing `node "$ROOT/shell/src/loop/cli.js" "$@"` behind the same Node-presence check.

- [ ] **Step 1: Write the failing test** (append to `shell/test/loop-run.test.js`): `loop stop` writes STOP; a fresh `loop` clears it (drive `cli.js` exports directly, not a subprocess).
- [ ] **Step 2: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit** `feat: sherman loop verb`.

### Task 5: smoke check 40 — the loop keeps its gates

**Files:**
- Modify: `smoke.sh` (new check after 39), `AGENTS.md` is NOT touched.

Check contents (same node-heredoc pattern as neighboring checks):
1. `bin/sherman` contains a `loop` dispatch line (`grep -q 'run_loop'`).
2. `node --test shell/test/loop-direction.test.js shell/test/loop-run.test.js` passes.
3. Gate honesty greps over `shell/src/loop/*.js`: zero matches for `pr merge`, `push.*main`, `money approve`, `dangerously`, `writeFileSync` with a vault path outside `applyRetentionResult` (assert the string `writeFileSync` absent from `direction.js`/`run.js`/`cli.js` except none — all writes go through retention or `~/.sherman/loop/STOP`, which uses `writeFileSync` on a non-vault path; so the grep asserts `writeFileSync` appears ONLY in `cli.js` STOP handling: `grep -c` per file).
4. The seed `vault/direction/goals.md` exists and carries two `[operator]` lines.

- [ ] **Step 1: Add the check; run `./smoke.sh`** → all green (40 checks).
- [ ] **Step 2: Commit** `feat: smoke check 40 — loop gate honesty`.

### Task 6: live proof + PR

- [ ] **Step 1:** One supervised `sherman loop 1` run on this machine (engine available). Acceptable outcomes: a logged pick + a direction update, or an honest failure line. No merge/spend/send possible by construction.
- [ ] **Step 2:** `./smoke.sh` green → push branch `self-direction-loop`, open PR citing the spec; merge stays with the operator.

## Self-Review Notes

- Spec coverage: direction layer (T2, flattened per Global Constraints), loop verb + bounds + STOP + failure halt (T3/T4), gates-inherited (no new posture code anywhere; T5 pins it), bootstrap (T3 pick-prompt branch), log-before-execute audit (T3 test 1), validated-writer-only vault writes (T1/T2), live proof (T6). Phase-2 items (launchd, multi-agent lanes) intentionally absent.
- Types consistent: `applyDirectionOperations` returns `{applied, rejected}` everywhere; `runLoop` result shape used by cli.js matches T3.
