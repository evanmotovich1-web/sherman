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

One paste, in PowerShell:

```powershell
irm "https://raw.githubusercontent.com/evanmotovich1-web/sherman/main/install.ps1?$(Get-Random)" -OutFile "$env:TEMP\sherman-install.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP\sherman-install.ps1"
```

(The random number defeats the raw CDN's few-minute cache; the script's
first line prints a build stamp so a run can always be matched to the
script that produced it.)

The script enables WSL2 if needed (that one step wants an administrator
shell and possibly a reboot — it says so and stops rather than half-doing
it), installs Ubuntu, installs git/curl/jq inside it, clones this repo into
the Linux filesystem, runs `./install.sh` there — putting the launcher's
directory on the login shell's PATH itself when the distro's profile lacks
it, as root's stock `.profile` does — drops a `sherman` shim into
WindowsApps so the command also works from any PowerShell or cmd window —
and then starts Sherman —
whose own first-run setup asks its questions (provider, name, optional
model and Telegram) and runs the engine's sign-in. It is idempotent: at
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
`install.ps1` probes for this before touching apt and fixes it itself, in
four escalating stages: restart WSL's networking (`wsl --shutdown`); enable
`dnsTunneling=true` under `[wsl2]` in `%UserProfile%\.wslconfig` (backing up
an existing file, and never overriding a `dnsTunneling` value a person
already set); if raw TCP out of the distro works, proving only name
resolution is broken, pin public resolvers (1.1.1.1, 8.8.8.8) in the
distro's `/etc/resolv.conf` with `generateResolvConf=false` so WSL stops
overwriting them; and — when even those are blocked, meaning the machine
filters port-53 traffic itself — go around DNS entirely: Windows resolves
every name the install and the engine sign-in need (Windows demonstrably
can — it downloaded the script) and the answers are pinned into the
distro's `/etc/hosts`, marked with removable `sherman-install` comment
fences. The script also names what it can see of the likely culprit —
VPN-shaped network adapters that are up, running VPN/security-suite
services. Only when even raw TCP fails does it stop, because nothing gets
out of WSL at all and no installer fixes that. Learned from the real
Windows runs of this script.

## What is different under WSL, stated plainly

- **Windows' PATH shines through interop, and its codex cannot run here.**
  With interop on, `codex` inside Ubuntu can resolve to the Windows npm's
  shim under `/mnt/c/...`, which dies on its first import ("Missing
  optional dependency @openai/codex-linux-x64") because the package behind
  it is the Windows build. Seen on the first real Windows machine.
  `install.sh` refuses to count anything under `/mnt` as an install, and
  the launcher heals machines installed before that fix by installing the
  Linux codex with its own runtime npm.
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
