# Sherman Abrams

Sherman Abrams is the operations agent for **Sherman Abrams Labs**, a family
medical diagnostics company. Type `sherman` in a terminal and the company
agent appears: a branded shell, a set of company-work skills, and a shared
company knowledge base (the vault), all layered over a coding CLI you already
have. Sherman is not its own model or engine — today it runs on the OpenAI
**Codex** CLI, driven headlessly underneath Sherman's own interface.

The skills and the vault are the product. The launcher, shell, and engine
adapter are the chassis.

## What a turn looks like

```text
❯ draft an SOP for specimen rejection callbacks and file it in the vault

  │ searched vault/wiki for existing rejection procedures
  │ wrote vault/wiki/specimen-rejection-callback-sop.md

  Sherman
  │ Drafted the callback SOP in the company shape and filed it at
  │ wiki/specimen-rejection-callback-sop.md. It ends with the standard
  │ attribution line, so the fact is traceable to this session. Two
  │ steps still need a human decision: the escalation cutoff time and
  │ who owns weekend callbacks.
```

The dim trace lines come from real engine events — Sherman never invents
activity, counts, or status. When the vault doesn't know something, Sherman
says so instead of guessing.

## Install (macOS)

```sh
git clone https://github.com/evanmotovich1-web/sherman.git
cd sherman
./install.sh
```

`install.sh` is idempotent and does three things: makes the launcher
executable, runs `npm install` for the shell's dependencies, and symlinks
`sherman` into the first writable directory of `~/.local/bin`, `~/bin`,
`/usr/local/bin`. That is all it installs — see prerequisites for what it
expects you to bring.

**Windows:** Sherman has never been run on Windows.
**Linux:** untested there too — macOS is the only platform Sherman has run on.

### Prerequisites (install.sh does not provide these)

- **macOS.** The vault write-boundary is enforced by the macOS sandbox.
- **Node.js 22+** — the Sherman Shell is a Node (Ink) app. Without Node, only
  `sherman --raw` works.
- **The Codex CLI, signed in** — `npm install -g @openai/codex`, then its own
  native login with your OpenAI account. Sherman performs no OAuth of its own.
- **Claude Code is not required.** It works only through `sherman --raw`; the
  Claude backend for the Sherman Shell is not built yet.

## First run

With no `~/.sherman/config.json`, `sherman` asks two questions:

1. **Provider.** Codex (OpenAI) is the only working backend today, and the
   only selectable one. Anthropic is listed as not yet available.
2. **Your name.** It becomes your private-memory directory in the vault.

Setup writes `~/.sherman/config.json` and confirms what landed where. Every
launch after that rebuilds the engine adapter fresh in `~/.sherman/workspace/`
from the repo's persona, so the repo stays the single source of truth.

```
sherman           the Sherman Shell — Sherman's own interface
sherman --raw     the engine directly, its own chrome, for debugging
sherman update    fast-forward this checkout when an update source exists
```

## The safety model

- **Default-deny sandbox.** The engine runs inside the macOS seatbelt
  sandbox: file writes are confined to the vault and its workspace, and
  network egress from the engine is denied. This was proven by a test that
  tried to escape, not assumed.
- **No PHI, ever.** Sherman never requests, accepts, stores, or repeats
  patient-identifying information, and the rule is restated verbatim in the
  assembled adapter on every launch. This is a hard compliance floor, not a
  setting.
- **Nothing on screen is invented.** Vault counts come from real directory
  reads, activity lines from real engine events, token figures from the
  engine's own reports. An empty vault honestly reads `0`.
- **Every fact is attributable.** Each session has one id, and every fact
  written to the vault ends with a `user · session · date` attribution line.

## Not built yet

Planned, in rough order — none of this works today:

- **Claude Code backend for the shell** (Claude Code currently runs only via
  `sherman --raw`)
- **`curl | bash` one-line installer** (today: clone + `./install.sh`)
- **Second-device onboarding and vault sync** for additional admins
- **A vault service with per-user scopes**, so employees reach knowledge
  through Sherman without holding vault files
- **A WhatsApp bridge** for asking Sherman questions from a phone

## Repository map

See `AGENTS.md` for the full map and development rules. The short version:
`bin/sherman` launches, `agent/SYSTEM.md` is the persona, `adapters/` wraps it
per engine, `shell/` is the UI, `skills/` is the company skill set, `vault/`
is the company brain, and `smoke.sh` is the no-framework check suite run
before every commit.
