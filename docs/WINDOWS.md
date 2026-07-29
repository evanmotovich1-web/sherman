# Sherman on Windows — WSL2 route, untested

Sherman has never been run on Windows. This document is the honest best
route, not a supported platform: whoever follows it first is the first test.
If you do, please report what you find — this page should carry facts, not
guesses, and today it carries a plan.

**Native Windows (PowerShell / cmd) is not supported and no installer for it
exists.** Two hard reasons, not packaging laziness:

1. The launcher (`bin/sherman`) and installer are bash.
2. Sherman's safety model leans on an OS sandbox confining the engine's
   writes to the vault. That boundary has been proven by an escape test on
   macOS only. There is no native-Windows equivalent wired, and Sherman does
   not ship boundaries it cannot enforce.

## The route: WSL2 + Ubuntu

Everything below happens once, and everything Sherman-related lives inside
the Linux filesystem (your WSL home, not `/mnt/c` — permissions and speed
are both wrong on the Windows mount).

1. **Install WSL2** — in an administrator PowerShell:

   ```powershell
   wsl --install -d Ubuntu
   ```

   Reboot if asked, open Ubuntu, create your Linux user.

2. **Inside Ubuntu — Node 22+** (Ubuntu's default `nodejs` is too old):

   ```sh
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   exec bash
   nvm install 22
   ```

3. **The Codex CLI, with its own sign-in:**

   ```sh
   npm install -g @openai/codex
   codex
   ```

   Complete Codex's native login. WSL2 forwards localhost to Windows, so the
   browser step normally works from Windows' own browser; if nothing opens,
   Codex prints the URL to open by hand.

4. **Sherman:**

   ```sh
   sudo apt-get install -y jq git
   git clone https://github.com/evanmotovich1-web/sherman.git
   cd sherman
   ./install.sh
   sherman
   ```

   Use Windows Terminal — the banner and the shell are 256-colour ANSI.

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
