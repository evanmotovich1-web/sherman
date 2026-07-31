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

`install.sh` is idempotent and handles the prerequisites itself: it makes
the launcher executable, symlinks `sherman` into the first writable
directory of `~/.local/bin`, `~/bin`, `/usr/local/bin`, installs the
shell's npm dependencies — and if Node 22+ or the Codex CLI are missing, it
installs those too (Node from nodejs.org into `~/.sherman/runtime`, codex
via `npm install -g`; no sudo, nothing outside Sherman's own directories).
Every "installed" line it prints follows a verification, and a failed
download says so instead.

## Install (Windows)

One paste, in PowerShell:

```powershell
irm "https://raw.githubusercontent.com/evanmotovich1-web/sherman/main/install.ps1?$(Get-Random)" -OutFile "$env:TEMP\sherman-install.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP\sherman-install.ps1"
```

(The random number defeats the raw CDN's cache, so the paste always runs
the current script — its first line prints a build stamp saying which.)

Native Windows is not supported; `install.ps1` automates the one honest
route — WSL2 + Ubuntu — end to end: it enables WSL2 (stopping with plain
instructions where an administrator shell or a reboot is needed), installs
Ubuntu, clones this repo into the Linux filesystem, and runs `./install.sh`
there, then hands you straight to Sherman's own first-run setup. It is
idempotent — re-run it after any stage it stopped at. Stated plainly:
Sherman has never been run on Windows, so whoever tries this first is the
first test; [docs/WINDOWS.md](docs/WINDOWS.md) carries what is and is not
verified there.

**Linux:** untested too — macOS is the only platform Sherman has run on.

### What stays yours (install.sh cannot do these)

- **macOS** — the vault write-boundary is enforced by the macOS sandbox.
  (Windows only via WSL2, untested: [docs/WINDOWS.md](docs/WINDOWS.md).)
- **Signing in to Codex** — the engine's own browser login runs on first
  launch, on your OpenAI account. Sherman performs no OAuth of its own and
  no installer can do this for you.
- **Claude Code is not required.** It works only through `sherman --raw`; the
  Claude backend for the Sherman Shell is not built yet.

## First run

With no `~/.sherman/config.json`, `sherman` runs setup:

1. **Provider.** Codex (OpenAI) is the only working backend today, and the
   only selectable one. Anthropic is listed as not yet available.
2. **Your name.** It becomes your private-memory directory in the vault.
3. **Model** (optional). Enter keeps the codex default; a name you type is
   written to codex's own config — the one place codex actually reads it —
   with a backup, and verified by reading it back.
4. **Telegram** (optional). Paste a bot token from @BotFather to use Sherman
   from your phone, or skip and connect later.

Setup writes `~/.sherman/config.json` and confirms what landed where. A
machine set up before newer questions existed is asked just the new ones,
once, on its next interactive launch. Every launch rebuilds the engine
adapter fresh in `~/.sherman/workspace/` from the repo's persona, so the
repo stays the single source of truth.

```
sherman           the Sherman Shell — Sherman's own interface
sherman --raw     the engine directly, its own chrome, for debugging
sherman update    fast-forward this checkout when an update source exists
sherman sync      pull + publish the shared vault, so every machine shares one brain
sherman telegram  run the Telegram bridge; it shows a pairing code, and the chat that texts it back is the one it answers
```

## One vault, every machine

The vault is plain Markdown living in this repo — which also makes it an
Obsidian vault: open the `vault/` folder in Obsidian and every page is there.
`sherman sync` is what makes it the **same** vault everywhere: it pulls what
other machines published, commits only the shared lanes (wiki, shared
memory, inbox — private memory never travels), and pushes when the machine
has write access. A machine without push access still pulls; it says so
plainly instead of claiming it published. The `llm-wiki` skill teaches
Sherman the habit: write the fact, sync, and report what actually happened.

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
- **A vault service with per-user scopes**, so employees reach knowledge
  through Sherman without holding vault files
- **A WhatsApp bridge** — Telegram shipped first (`sherman telegram`);
  WhatsApp needs Meta's Business API and has no honest overnight path
- **An always-on hosted bridge** — today `sherman telegram` runs only while
  the machine runs it

## Repository map

See `AGENTS.md` for the full map and development rules. The short version:
`bin/sherman` launches, `agent/SYSTEM.md` is the persona, `adapters/` wraps it
per engine, `shell/` is the UI, `skills/` is the company skill set, `vault/`
is the company brain, and `smoke.sh` is the no-framework check suite run
before every commit.
