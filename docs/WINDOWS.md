# Sherman on Windows — WSL2 route, untested

Sherman has never been run on Windows. This document is the honest best
route, not a supported platform: whoever follows it first is the first test.
If you do, please report what you find — this page should carry facts, not
guesses, and today it carries a plan and a script, not a test result.

**Native Windows (PowerShell / cmd) is not supported.** Two reasons, one of
which has weakened since this page was first written:

1. The launcher (`bin/sherman`) and installer are bash. Nothing Sherman
   ships runs natively in PowerShell except the bootstrap below, which
   exists to reach WSL2.
2. Sherman's safety model leans on an OS sandbox confining the engine's
   writes to the vault, proven by an escape test on macOS only. Codex
   itself now ships a native Windows sandbox — restricted tokens plus
   ACLs, honoring the same `writable_roots` Sherman configures — so the
   OS-level mechanism exists where it once did not
   (openai.com/index/building-codex-windows-sandbox). But Sherman has not
   wired it, nobody has re-run the escape test against it, and OpenAI's
   own account says its unelevated mode's network suppression is advisory
   rather than enforced. An unwired, unverified boundary is still a
   boundary Sherman does not ship. If a native route is ever built, it
   starts from this fact, not from zero.

What exists for Windows is a bootstrap, `install.ps1`, that automates the
WSL2 route below and then hands off to the repo's own `install.sh` inside
the distro. It is exactly as untested as the route it automates.

## The automated route: install.ps1

In PowerShell:

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/evanmotovich1-web/sherman/main/install.ps1 -OutFile install.ps1
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The script enables WSL2 if needed (that one step wants an administrator
shell and possibly a reboot — it says so and stops rather than half-doing
it), installs Ubuntu, installs git/curl/jq inside it, clones this repo into
the Linux filesystem, and runs `./install.sh` there. It is idempotent: at
whatever stage a previous run stopped — reboot, Linux user creation — run
it again and it continues from what already exists. Every "verified" line
it prints follows a real check, and what it cannot verify it names.

The manual steps below are the same route, for reading or for doing by hand.

## The manual route: WSL2 + Ubuntu

Everything below happens once, and everything Sherman-related lives inside
the Linux filesystem (your WSL home, not `/mnt/c` — permissions and speed
are both wrong on the Windows mount).

1. **Install WSL2** — in an administrator PowerShell:

   ```powershell
   wsl --install -d Ubuntu
   ```

   Reboot if asked, open Ubuntu, create your Linux user.

2. **Inside Ubuntu — the basics** (git, curl and jq; Ubuntu images vary):

   ```sh
   sudo apt-get update && sudo apt-get install -y git curl jq
   ```

3. **Sherman** — the installer provisions the rest itself:

   ```sh
   git clone https://github.com/evanmotovich1-web/sherman.git
   cd sherman
   ./install.sh
   sherman
   ```

   If Node 22+ or the Codex CLI are missing, `install.sh` installs them
   (Node from nodejs.org into `~/.sherman/runtime`, codex via
   `npm install -g` — no sudo). Each "installed" line it prints follows a
   verification; a failed download says so.

4. **Sign in** — on first launch, Codex runs its own login. WSL2 forwards
   localhost to Windows, so the browser step normally opens in Windows' own
   browser; if nothing opens, Codex prints the URL to open by hand.

   Use Windows Terminal — the banner and the shell are 256-colour ANSI.

## If Ubuntu cannot reach the network

The most common WSL2 failure is DNS: Windows resolves names while the
distro cannot (`Temporary failure resolving 'archive.ubuntu.com'`).
`install.ps1` probes for this before touching apt and prints the fix; the
short version is `wsl --shutdown` and retry, and if it recurs, put
`dnsTunneling=true` under `[wsl2]` in `%UserProfile%\.wslconfig`, shut down
WSL again, and re-run. Seen on the first real Windows run of this script.

## What is different under WSL, stated plainly

- **The vault write-boundary is unproven here.** On macOS the engine is
  sealed by the seatbelt sandbox and that was verified by a test that tried
  to escape. On Linux, Codex enforces its sandbox with Landlock/seccomp and
  Sherman passes it the same configuration — but nobody has re-run the
  escape test under WSL. Until someone does, treat the boundary as
  unverified. The test lives in `shell/README.md`.
- **`smoke.sh` was written on macOS.** Its bash-3.2 floor makes Ubuntu's
  bash fine and `apt`'s jq lands at the `/usr/bin/jq` path it expects, but
  the suite has never executed on Linux. Run `./smoke.sh` after installing
  and believe what it prints over what this page hopes.
- **The UI has never rendered in Windows Terminal.** It is a standard Ink 7
  app, which is the reason to expect it to work, not evidence that it does.

## Unchanged everywhere

The no-PHI rule is identical on every platform: no patient-identifying
information enters Sherman, ever, and WSL changes nothing about that.

If the shell will not start, `sherman --raw` runs the engine directly, and
`node shell/bin/sherman-shell.js --probe "who are you?"` prints normalized
engine events with no UI.
