---
phase: 07-public-readiness
plan: 01
status: complete
completed: 2026-07-29
commits:
  - 1b07221  # readme + gitignore hygiene + smoke 19
  - a7e87f3  # provider-registry wizard + smoke 2/3/5/6 repair + smoke 20
  - 8d66fb2  # installer verify-then-claim + smoke 21
  - 8899d45  # readme clone URL → real origin
type: Summary
about: "sherman"
---

# 07-01 SUMMARY — public-repo readiness

## STEP 0 — secret audit (hard gate, ran first)

All 57 commits of history scanned before anything else. **Clean.**

- Credential-shape grep (`sk-`, `ghp_`, `github_pat`, PATs, JWTs, AWS keys,
  private-key headers, bearer/password/api-key): every hit is token-usage UI
  code or docs prose. Zero credentials in any commit.
- `.mcp.json` is committed but has only ever carried the
  `${SHERMAN_OBSIDIAN_API_KEY}` env-var placeholder — never a value.
- Every path ever committed reviewed: no `.env`, no captured
  `~/.sherman/config.json`, no session `.jsonl` logs, no vault personal data.
- Personal data: Evan's author email on all commits (inherent to git) and in
  one line of `docs/HANDOFF-2026-07-28.md`. Not secrets. Flagged for
  awareness; going public exposes author emails, which is normal.
- **No history rewrite needed. Repo visibility untouched — Evan's action.**
- `.gitignore` gained `.env`, `.env.*`, `*.local` regardless (commit 1b07221).

## Task results

| Task | Status | Qualify | Commit |
|---|---|---|---|
| 1 README + gitignore | DONE | PASS | `1b07221` |
| 2 provider-registry wizard | DONE | PASS | `a7e87f3` |
| 3 installer verify-then-claim | DONE | PASS | `8d66fb2` |
| — README URL follow-up | DONE | PASS | `8899d45` |

ACs: **5/5 Pass.** Smoke grew 18 → **21 checks, all green**, run before every
commit. Shell tests **128/128** throughout.

## What shipped

- **README.md** (first ever): what Sherman is, an example turn in the real
  turn grammar (`❯` prompt line, `│` trace rules, `Sherman` signature), the
  real install steps, plain-sentence Windows/Linux status, honest
  prerequisites (Node 22+, codex CLI + its own login — what install.sh does
  NOT provide), the safety model as wired, and unbuilt work only under a
  marked "Not built yet" heading. Smoke 19 guards this mechanically.
- **Wizard provider registry** in `bin/sherman`: one
  `id|label|binary|status|reason` line per provider; menu renders from it.
  Codex selectable; Anthropic listed "— not available yet" and selection
  refused with the reason + re-prompt. `engine_binary()` reads the registry.
  Adding/enabling a provider is one line (AC-3). Channel seam documented in
  DESIGN.md "Registries" — nothing offered until the v0.3 bridge exists.
  Smoke 2/3/5/6 repaired to codex-first (required repair); smoke 20 proves
  the refusal path end to end. A hand-written `engine: claude` config still
  selects the shell's stub politely (kept as an explicit check-5 assertion).
- **install.sh**: every success line follows a check — `[ -x ]` before
  "executable", `node_modules/ink` + `react` before "installed", `readlink`
  match before "linked" — plus a report-only "still needed" block for Node
  and codex. npm-missing degradation preserved. Smoke 21 drives a sandboxed
  fake repo with an npm that exits 0 producing nothing and fails any claim
  that outruns its verification.

## Deviations from plan

1. **"Approval-gated writes" was not claimed.** Evan's brief listed it in the
   safety model, but the wired truth is `approval_policy="never"` with the
   kernel sandbox as the boundary (`shell/src/engine/codex.js:336`). The
   honesty laws the brief itself imposes outrank the phrase; the README
   describes the sandbox as it is.
2. **The clone URL became real mid-phase.** Discovered during Task 3 that
   `origin` exists (`github.com/evanmotovich1-web/sherman.git` — STATE's "no
   remotes" was stale; Evan has pushed privately). The README placeholder was
   replaced with the real URL in a fourth, one-line commit (`8899d45`).
3. **Baselines were ahead of the brief** (smoke 18 not 15; tests 128 not 64).
   Actual baselines held and grew; nothing shrank.

## Discovered along the way

- A remote now exists and `sherman update` therefore does a REAL
  `git pull --ff-only` + nested smoke run inside check 10. A failing check
  anywhere now fails check 10 too (observed during Task 3 development —
  useful cascade, worth knowing when reading smoke output).
- macOS mktemp paths live under the `/var → /private/var` symlink; any test
  comparing against paths an installer resolved with `cd -P` must resolve
  its own expectation the same way (now noted in smoke check 21).
