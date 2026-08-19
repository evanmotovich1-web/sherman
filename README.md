# Sherman Abrams

Sherman Abrams is the operations agent for **Sherman Abrams Labs**, a family
medical diagnostics company. Type `sherman` in a terminal and the company
agent appears: a branded shell, a set of company-work skills, and a shared
company knowledge base (the vault), all layered over a coding CLI. Sherman is
not its own model or engine — today it runs either OpenAI **Codex** or Z.AI
**GLM-5.2** through OpenCode, driven headlessly underneath Sherman's interface.

The skills and the vault are the product. The launcher, shell, and engine
adapter are the chassis.

## What a turn looks like

```text
❯ /learn ops-summaries-open-with-exceptions | Weekly operations summaries open
  with the exception list; totals follow because they are already visible on
  the dashboard.

  │ validated one operator-authored behavioral fact
  │ wrote vault/memory/shared/ops-summaries-open-with-exceptions.md

  Sherman
  │ Stored the complete lesson you submitted at
  │ memory/shared/ops-summaries-open-with-exceptions.md. No model-generated
  │ text or attribution was added.
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

On a **brand-new Mac** the first `git` command triggers macOS's one built-in
prerequisite: the Xcode Command Line Tools install prompt (accept it; a few
minutes, one time). Those tools carry git, python3, and the Swift compiler —
everything else Sherman needs, the installer provisions itself.

`install.sh` is idempotent and handles the prerequisites itself: it makes
the launcher executable, symlinks `sherman` into the first writable
directory of `~/.local/bin`, `~/bin`, `/usr/local/bin`, installs the
shell's npm dependencies — and if Node 22+, the Codex CLI, or the OpenCode
CLI (the Z.AI GLM engine) are missing, it installs those too (Node from
nodejs.org into `~/.sherman/runtime`, the CLIs via `npm install -g`; no
sudo, nothing outside Sherman's own directories). It also provisions the
capabilities Sherman reaches outward with — the LLM Wiki, and Agent Reach
(internet access for `/mcp`, pinned to a known commit and installed as a
`uv` tool, uv itself installed first if missing) — and compiles the desktop
pet (`sherman pet` starts it). Every "installed" line it prints follows a
verification, and a failed download says so instead. If the chosen bin
directory is not on your PATH, the installer adds the PATH line to your
shell profile itself (verified by read-back; idempotent on re-runs) — new
terminals just work, and it prints the one command that fixes the current
terminal too.

The one thing the installer cannot do is sign you in: the engine's own login
runs in your browser on first launch.

`sherman update` runs the same provisioning, so a machine installed before a
capability existed grows it on the next update rather than only new installs
getting it.

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
- **Signing in to Z.AI** — choosing Z.AI in Sherman opens a Z.AI-only API-key
  prompt through OpenCode, the local coding runtime. Paste your standard Z.AI
  key—not an OpenRouter or Coding Plan key. The credential stays outside this
  repo. The direct command is `opencode auth login --pure --provider zai`;
  never put the key in Sherman's config or vault.
- **Claude Code is not required.** It works only through `sherman --raw`; the
  Claude backend for the Sherman Shell is not built yet.

## First run

With no `~/.sherman/config.json`, `sherman` runs setup:

1. **Provider.** Choose Codex (OpenAI), Z.AI (GLM-5.2), DeepSeek, or xAI Grok
   (SuperGrok OAuth). Sherman installs OpenCode on demand for the OpenCode
   engines and opens that provider's own sign-in: Z.AI key paste, DeepSeek
   key paste into Sherman's store, or xAI SuperGrok OAuth. Anthropic remains
   listed as not yet available.
2. **Your name.** It becomes your private-memory directory in the vault.
3. **Model** (optional for Codex, DeepSeek, and Grok). Enter keeps the default;
   a name you type is written and verified by reading it back. Z.AI stays
   pinned to the verified `glm-5.2` model catalogue entry.
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
sherman model     pick provider, sign-in, and model from menus; or set one directly (verified by read-back)
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
Sherman to offer an operator-reviewed `/wiki` or `/learn` command first, then
sync only after the operator enters it, and report what actually happened.

## The safety model

- **Default-deny engine boundary.** Codex runs inside its macOS seatbelt
  sandbox. The Z.AI path disables OpenCode plugins, sharing, and arbitrary
  shell execution; its path-aware tools may access only the disposable
  workspace and the named vault, while validated Sherman connectors are
  translated into a launch-digest-bound OpenCode MCP configuration. User/project
  OpenCode configuration is isolated, vault symlinks are refused, and read-only
  turns deny edits and do not start connector processes. This boundary is not
  Codex's kernel sandbox.
- **No PHI, ever.** Sherman never requests, accepts, stores, or repeats
  patient-identifying information, and the rule is restated verbatim in the
  assembled adapter on every launch. This is a hard compliance floor, not a
  setting.
- **Nothing on screen is invented.** Vault counts come from real directory
  reads, activity lines from real engine events, token figures from the
  engine's own reports. An empty vault honestly reads `0`.
- **Every retained fact is explicit.** `/learn` and `/wiki` store only the
  complete operator-reviewed text submitted to that command; they do not append
  model-authored content or hidden metadata.

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
