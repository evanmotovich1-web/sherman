# install.ps1 -- Sherman on Windows, via WSL2.
#
# Native Windows is not supported, and this script does not pretend otherwise:
# the launcher is bash, and Sherman's vault write-boundary has no verified
# native-Windows enforcement. What this script does is automate the one honest
# route -- WSL2 + Ubuntu -- and then hand off to the repo's own install.sh
# inside the distro, where the existing installer does what it already knows
# how to do.
#
# Idempotent: safe to re-run at every stage; each stage checks before it acts.
# Every success line follows a CHECK, never an attempt -- the same honesty
# rule as install.sh. What this script cannot verify (the sandbox boundary
# under WSL, the engine sign-in), it says plainly instead of claiming.
#
# Run from PowerShell:
#
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# Target: Windows PowerShell 5.1 and PowerShell 7+. No modules, no admin
# rights -- except the one case where WSL itself must be enabled, which is
# stated when it happens rather than demanded up front.

$ErrorActionPreference = 'Stop'
$Distro  = 'Ubuntu'
$RepoUrl = 'https://github.com/evanmotovich1-web/sherman.git'

function Say([string]$msg)  { Write-Host "  $msg" }
function Note([string]$msg) { Write-Host "  NOTE: $msg" }

# wsl.exe talks UTF-16 to pipes; exit codes are the only channel this script
# trusts. Output parsing of `wsl -l` is deliberately avoided everywhere --
# probing a distro with `wsl -d <name> -e true` asks the real question.
function Test-Distro {
    & wsl.exe -d $Distro -e true 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

Write-Host ""
Write-Host "Installing Sherman Abrams (Windows, WSL2 route)"
Write-Host ""

# ------------------------------------------------------------- Windows only --
if ($env:OS -ne 'Windows_NT') {
    Write-Host "This is the Windows bootstrap. On macOS or Linux, run ./install.sh instead."
    exit 1
}

# ---------------------------------------------------------- wsl.exe present --
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    Note "wsl.exe was not found on this machine."
    Say  "This Windows build predates bundled WSL. Update Windows, or install"
    Say  "WSL by hand (https://learn.microsoft.com/windows/wsl/install), then"
    Say  "re-run this script."
    exit 1
}
Say "wsl.exe found"

# --------------------------------------------------------------- WSL usable --
# `wsl --status` exits non-zero when the WSL feature itself is not enabled.
# Enabling it changes Windows features and can require a reboot, so it is the
# one step that may need an elevated shell -- attempted only when we already
# are elevated, stated plainly when we are not.
& wsl.exe --status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    $principal = New-Object Security.Principal.WindowsPrincipal(
        [Security.Principal.WindowsIdentity]::GetCurrent())
    $elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

    if (-not $elevated) {
        Note "WSL is not enabled yet, and enabling it needs an administrator shell."
        Say  "In an administrator PowerShell, run:"
        Say  ""
        Say  "    wsl --install -d $Distro"
        Say  ""
        Say  "Reboot if asked, open $Distro once to create your Linux user,"
        Say  "then re-run this script. Nothing was changed."
        exit 1
    }

    Say "enabling WSL (wsl --install -d $Distro) -- a reboot may be required"
    & wsl.exe --install -d $Distro
    if (-not (Test-Distro)) {
        Note "WSL was installed but $Distro does not answer yet."
        Say  "Reboot if Windows asked for one, open $Distro once to create"
        Say  "your Linux user, then re-run this script."
        exit 1
    }
}

# ------------------------------------------------------------ Ubuntu distro --
if (Test-Distro) {
    Say "$Distro answers (verified: wsl -d $Distro -e true)"
} else {
    Say "the $Distro distro is not installed; installing it now"
    & wsl.exe --install -d $Distro
    if (Test-Distro) {
        Say "$Distro installed (verified: wsl -d $Distro -e true)"
    } else {
        Note "$Distro still does not answer after the install attempt."
        Say  "If a window opened asking you to create a Linux user, finish"
        Say  "that, then re-run this script. If Windows asked for a reboot,"
        Say  "reboot first."
        exit 1
    }
}

# ------------------------------------------------- prerequisites in Ubuntu --
# git, curl and jq -- the same floor docs/WINDOWS.md names. sudo may prompt
# for the Linux user's password; that prompt is Ubuntu's own and passes
# through this console.
Say "installing git, curl and jq inside $Distro (sudo may ask for your Linux password)"
& wsl.exe -d $Distro -- bash -lc "sudo apt-get update -qq && sudo apt-get install -y -qq git curl jq"
& wsl.exe -d $Distro -- bash -lc "command -v git >/dev/null && command -v curl >/dev/null && command -v jq >/dev/null"
if ($LASTEXITCODE -eq 0) {
    Say "git, curl and jq present in $Distro (verified: command -v, inside the distro)"
} else {
    Note "git, curl and jq are still not all present inside $Distro."
    Say  "Open $Distro and install them by hand:"
    Say  "    sudo apt-get update && sudo apt-get install -y git curl jq"
    Say  "Then re-run this script."
    exit 1
}

# ------------------------------------------------------------------- clone --
# Into the Linux filesystem on purpose -- /mnt/c has the wrong permissions
# and the wrong speed for a working tree. An existing clone is left exactly
# as it is: this script never touches a tree that might hold someone's work.
& wsl.exe -d $Distro -- bash -lc "test -d ~/sherman/.git"
if ($LASTEXITCODE -eq 0) {
    Say "existing clone found at ~/sherman inside $Distro (left untouched)"
} else {
    Say "cloning $RepoUrl into ~/sherman inside $Distro"
    & wsl.exe -d $Distro -- bash -lc "git clone $RepoUrl ~/sherman"
    & wsl.exe -d $Distro -- bash -lc "test -d ~/sherman/.git"
    if ($LASTEXITCODE -eq 0) {
        Say "clone verified (~/sherman/.git exists)"
    } else {
        Note "the clone did not land. Check the network and re-run this script."
        exit 1
    }
}

# -------------------------------------------------- hand off to install.sh --
# From here the repo's own installer owns the work: Node 22+, the Codex CLI,
# shell dependencies, and the PATH link, each with its own verification.
Say "running ./install.sh inside $Distro"
Write-Host ""
& wsl.exe -d $Distro -- bash -lc "cd ~/sherman && ./install.sh"
$installExit = $LASTEXITCODE

& wsl.exe -d $Distro -- bash -lc "command -v sherman >/dev/null 2>&1 || test -x ~/.local/bin/sherman"
if ($LASTEXITCODE -eq 0) {
    Say "the sherman command exists inside $Distro (verified after install.sh)"
} else {
    Note "install.sh finished (exit $installExit) but no sherman command was"
    Say  "found inside $Distro. Read its output above -- it says what failed"
    Say  "and what to do; then re-run this script."
    exit 1
}

# ------------------------------------------------------------------- report --
Write-Host ""
Write-Host "Done. To run Sherman, open $Distro (use Windows Terminal) and type:"
Write-Host ""
Write-Host "    sherman"
Write-Host ""
Write-Host "  Or from PowerShell:  wsl -d $Distro -- bash -lc sherman"
Write-Host ""
Write-Host "  Still yours to do, because no installer can:"
Write-Host "    - Sign in to Codex: its own browser login runs on first launch."
Write-Host "    - Run ~/sherman/smoke.sh inside $Distro and believe what it prints:"
Write-Host "      the suite has never executed on this platform before you."
Write-Host ""
Write-Host "  Stated plainly: the vault write-boundary is UNVERIFIED under WSL."
Write-Host "  On macOS it is proven by an escape test; nobody has re-run that"
Write-Host "  test here. docs/WINDOWS.md carries the details. The no-PHI rule"
Write-Host "  is identical on every platform."
Write-Host ""
exit 0
