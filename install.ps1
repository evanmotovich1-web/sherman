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

# Bumped on every change to this file. Printed at startup so a run can
# always be matched to the exact script that produced it -- GitHub's raw
# CDN caches downloads for a few minutes, and a stale copy that LOOKS
# current is exactly the confident-and-wrong this repo does not allow.
$Build = '2026-07-30.11'

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
Write-Host "Installing Sherman Abrams (Windows, WSL2 route) -- install.ps1 build $Build"
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

# ------------------------------------------------------ DNS inside Ubuntu --
# The classic WSL2 failure, seen on the very first real run of this script:
# Windows resolves names fine (or this script could not have been
# downloaded) while the distro cannot, and apt then prints a page of
# 'Temporary failure resolving' noise. The script's job is to do everything
# a script can, so the fixes are APPLIED here, not recited, in four
# escalating stages: restart WSL's networking; turn on DNS tunneling in
# .wslconfig; pin public resolvers inside the distro; and finally go around
# DNS entirely by letting Windows resolve the names and pinning the answers
# in /etc/hosts. The person is told to act only when even that fails — that
# residue is a genuinely down network, which no installer fixes.
function Test-DistroDns {
    & wsl.exe -d $Distro -- bash -lc "getent hosts archive.ubuntu.com >/dev/null 2>&1"
    return ($LASTEXITCODE -eq 0)
}

if (-not (Test-DistroDns)) {
    Say "$Distro cannot resolve archive.ubuntu.com (Windows itself can) --"
    Say "WSL2's known DNS failure. Restarting WSL to reset its networking."
    & wsl.exe --shutdown
    Start-Sleep -Seconds 3
}

if (-not (Test-DistroDns)) {
    $wslconfig = Join-Path $env:USERPROFILE '.wslconfig'
    $existing = ''
    if (Test-Path $wslconfig) { $existing = Get-Content -Raw $wslconfig }

    if ($existing -match 'dnsTunneling') {
        # The person (or another tool) already decided this setting. Fighting
        # it silently is worse than stopping honestly, so it is left alone --
        # but the value itself is diagnostic, so it is read out loud.
        $tunnelVal = 'set'
        if ($existing -match '(?m)dnsTunneling\s*=\s*([^\s#]+)') { $tunnelVal = "set to $($Matches[1])" }
        Say "dnsTunneling is already $tunnelVal in .wslconfig; leaving it untouched."
    } else {
        Say "still failing; enabling DNS tunneling in $wslconfig"
        if ($existing) {
            Copy-Item $wslconfig "$wslconfig.sherman-backup" -Force
            Say "backed up the existing file to .wslconfig.sherman-backup"
        }
        if ($existing -match '(?m)^\s*\[wsl2\]') {
            $updated = $existing -replace '(?m)^(\s*\[wsl2\]\s*)$', "`$1`r`ndnsTunneling=true"
        } else {
            $sep = ''
            if ($existing -and -not $existing.EndsWith("`n")) { $sep = "`r`n" }
            $updated = $existing + $sep + "[wsl2]`r`ndnsTunneling=true`r`n"
        }
        Set-Content -Path $wslconfig -Value $updated
        & wsl.exe --shutdown
        Start-Sleep -Seconds 3
    }
}

# Third stage, and the decisive one: is the network path itself alive?
# bash's /dev/tcp needs no tools installed, which matters on a distro that
# cannot apt-get anything yet. If raw TCP reaches the internet, only name
# resolution is broken and pinning public resolvers inside the distro fixes
# it regardless of what Windows-side DNS is doing. If raw TCP fails too,
# something outside WSL is blocking the network, and no installer fixes that.
$TcpAlive = $false
if (-not (Test-DistroDns)) {
    & wsl.exe -d $Distro -- bash -c "timeout 5 bash -c 'echo > /dev/tcp/1.1.1.1/443' 2>/dev/null"
    if ($LASTEXITCODE -eq 0) {
        $TcpAlive = $true
        Say "raw connections out of $Distro work; only name resolution is"
        Say "broken. Pinning public DNS resolvers (1.1.1.1, 8.8.8.8) inside"
        Say "the distro -- /etc/wsl.conf gets generateResolvConf=false so WSL"
        Say "stops overwriting them."
        & wsl.exe -d $Distro -u root -- bash -c "grep -q generateResolvConf /etc/wsl.conf 2>/dev/null || printf '\n[network]\ngenerateResolvConf=false\n' >> /etc/wsl.conf; rm -f /etc/resolv.conf; printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > /etc/resolv.conf"
    }
}

# Fourth stage: go around DNS entirely. Raw TCP works but even pinned public
# resolvers fail, so this machine blocks port-53 traffic itself, not just
# WSL's resolver plumbing. Windows demonstrably CAN resolve names -- it
# downloaded this script -- so Windows does the resolving, and the answers
# are pinned into the distro's /etc/hosts. glibc consults files before dns,
# so every name this install and Sherman's engine sign-in need then works
# with no port-53 packet ever sent.
$HostsPinned = $false
if (-not (Test-DistroDns) -and $TcpAlive) {
    Say "pinned resolvers are blocked too -- this machine filters DNS itself."
    Say "Going around DNS: Windows can resolve names (it downloaded this"
    Say "script), so Windows resolves every name the install needs and the"
    Say "answers are pinned into $Distro's /etc/hosts."

    $HostsNeeded = @(
        'archive.ubuntu.com', 'security.ubuntu.com',            # apt
        'github.com', 'codeload.github.com', 'api.github.com',  # clone
        'raw.githubusercontent.com', 'objects.githubusercontent.com',
        'nodejs.org',                                           # Node runtime
        'registry.npmjs.org',                                   # Codex CLI
        'auth.openai.com', 'api.openai.com',                    # engine sign-in
        'chatgpt.com', 'openai.com'
    )
    $pinLines = @()
    foreach ($h in $HostsNeeded) {
        try {
            $ip = ([System.Net.Dns]::GetHostAddresses($h) |
                Where-Object { $_.AddressFamily -eq 'InterNetwork' } |
                Select-Object -First 1).IPAddressToString
            if ($ip) { $pinLines += "$ip $h" }
        } catch {
            Say "    (Windows could not resolve $h; skipped)"
        }
    }
    if ($pinLines.Count -gt 0) {
        $block = @(
            '# sherman-install begin -- names pinned because DNS is blocked inside',
            '# WSL on this machine. Delete this block once DNS works; re-running',
            '# the installer refreshes it.'
        ) + $pinLines + @('# sherman-install end')
        # Piped through stdin so no quoting survives two shells; tr strips the
        # \r that PowerShell's pipe appends, which would corrupt hosts parsing.
        $block | & wsl.exe -d $Distro -u root -- bash -c "sed -i '/# sherman-install begin/,/# sherman-install end/d' /etc/hosts; tr -d '\r' >> /etc/hosts"
        if (Test-DistroDns) { $HostsPinned = $true }
    }
}

# Whatever filters DNS is worth naming: VPN-shaped adapters that are up, and
# running services known to own DNS (VPNs, security suites, DNS filters).
# Suspects, stated as suspects -- the script cannot see inside them.
function Get-DnsSuspects {
    $found = @()
    try {
        $found += @(Get-NetAdapter -ErrorAction Stop |
            Where-Object { $_.Status -eq 'Up' -and $_.InterfaceDescription -match 'VPN|TAP-|WireGuard|WARP|Tunnel|Nord|Express|Proton|Surfshark' } |
            ForEach-Object { "network adapter up: $($_.InterfaceDescription)" })
    } catch {}
    try {
        $found += @(Get-Service -ErrorAction Stop |
            Where-Object { $_.Status -eq 'Running' -and ($_.Name -match 'WARP|AdGuard|nordvpn|expressvpn|proton|surfshark|zscaler|umbrella' -or $_.DisplayName -match 'McAfee|Norton|Avast|AVG |Kaspersky|Bitdefender|Cloudflare WARP|AdGuard') } |
            ForEach-Object { "running service: $($_.DisplayName)" })
    } catch {}
    return $found
}

if (Test-DistroDns) {
    if ($HostsPinned) {
        Say "$Distro resolves archive.ubuntu.com via the pinned /etc/hosts"
        Say "entries (verified: getent, inside the distro). DNS in general is"
        Say "still blocked inside WSL on this machine -- the likely owner:"
        $suspects = @(Get-DnsSuspects)
        if ($suspects.Count -gt 0) {
            foreach ($s in $suspects) { Say "    $s" }
        } else {
            Say "    (nothing recognizable found -- a VPN or security suite is"
            Say "    the usual cause)"
        }
    } else {
        Say "$Distro resolves archive.ubuntu.com (verified: getent, inside the distro)"
    }
} else {
    if ($TcpAlive) {
        Note "$Distro still cannot resolve names -- pinned resolvers are"
        Say  "blocked and pinning addresses into /etc/hosts did not take."
        Say  "Something on this machine filters DNS. Turn off any VPN or"
        Say  "security suite, then re-run the paste; it continues from here."
    } else {
        Note "nothing gets out of $Distro at all -- raw connections fail, not"
        Say  "just DNS. Something outside WSL is blocking its network: a VPN,"
        Say  "an antivirus firewall, or the Hyper-V firewall. Turn off any"
        Say  "VPN, then re-run the paste; it continues from here."
    }
    $suspects = @(Get-DnsSuspects)
    if ($suspects.Count -gt 0) {
        Say ""
        Say "Found on this machine (the likely owner of the block):"
        foreach ($s in $suspects) { Say "    $s" }
    }
    Say  ""
    Say  "Nothing was installed."
    exit 1
}

# ------------------------------------------------- broken .profile repair --
# Seen on the first real Windows machine: a hand-added, unquoted
# `export PATH=...` line in ~/.profile carrying `Program Files (x86)` --
# bash rejects the whole file at that line, so every login shell prints a
# syntax error and no PATH line later in the file can ever apply.
# Objectively broken bash gets repaired, not tiptoed around: back the file
# up, comment out the offending line (WSL re-injects the Windows paths it
# listed automatically, so nothing is lost), and keep the repair only if
# bash -n then accepts the file -- otherwise the backup goes straight back.
& wsl.exe -d $Distro -- bash -c "test ! -f ~/.profile || bash -n ~/.profile 2>/dev/null"
if ($LASTEXITCODE -ne 0) {
    Say "~/.profile inside $Distro has a bash syntax error (an unquoted"
    Say "PATH line with parentheses). Backing it up to"
    Say "~/.profile.sherman-backup and commenting the broken line out."
    & wsl.exe -d $Distro -- bash -c "cp ~/.profile ~/.profile.sherman-backup && sed -i '/^export PATH=\/.*(/s|^|# sherman-install disabled (unquoted parentheses broke bash): |' ~/.profile; bash -n ~/.profile 2>/dev/null || cp ~/.profile.sherman-backup ~/.profile"
    & wsl.exe -d $Distro -- bash -c "bash -n ~/.profile 2>/dev/null"
    if ($LASTEXITCODE -eq 0) {
        Say "~/.profile parses again (verified: bash -n, inside the distro)"
    } else {
        Note "~/.profile still does not parse; the backup was restored."
        Say  "Not fatal here -- nothing below depends on it -- but login"
        Say  "shells in $Distro will keep printing that syntax error."
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

# install.sh links sherman into the first writable of ~/.local/bin, ~/bin,
# /usr/local/bin -- but no shell shape is guaranteed to have that directory
# on PATH. Seen on the real Windows runs: WSL's default user was root,
# install.sh linked into /root/bin, and root's stock .profile never adds
# ~/bin. Also seen there, twice: a for-loop probe with captured output
# reported the link missing while a plain ls in the same second showed it
# present -- root cause undetermined, and it does not matter, because this
# script's own rule is that EXIT CODES ARE THE ONLY CHANNEL IT TRUSTS.
# So: three boring per-path probes, the same test/tilde pattern every
# other check in this script has already proven on real hardware, and the
# launch below runs the launcher by its own path. The PATH lines written
# to .profile (login shells) and .bashrc (the non-login shells bare
# wsl.exe starts) are a convenience for the person typing `sherman`
# later, verified by grep, and not load-bearing.
$linkTilde = ''
$pathDir = ''
& wsl.exe -d $Distro -- bash -lc "test -x ~/.local/bin/sherman"
if ($LASTEXITCODE -eq 0) { $linkTilde = '~/.local/bin/sherman'; $pathDir = '$HOME/.local/bin' }
if (-not $linkTilde) {
    & wsl.exe -d $Distro -- bash -lc "test -x ~/bin/sherman"
    if ($LASTEXITCODE -eq 0) { $linkTilde = '~/bin/sherman'; $pathDir = '$HOME/bin' }
}
if (-not $linkTilde) {
    & wsl.exe -d $Distro -- bash -lc "test -x /usr/local/bin/sherman"
    # /usr/local/bin is on every default PATH already; no fence needed
    if ($LASTEXITCODE -eq 0) { $linkTilde = '/usr/local/bin/sherman' }
}
if (-not $linkTilde) {
    Note "install.sh finished (exit $installExit) but no sherman launcher"
    Say  "was found in ~/.local/bin, ~/bin or /usr/local/bin inside $Distro."
    Say  "What those directories actually hold:"
    & wsl.exe -d $Distro -- bash -lc "ls -l ~/.local/bin ~/bin /usr/local/bin 2>&1"
    Say  "Read install.sh's output above -- it says what failed -- and paste"
    Say  "all of this to whoever is helping; then re-run this script."
    exit 1
}
Say "sherman launcher present at $linkTilde (verified: test -x, inside the distro)"

if ($pathDir) {
    & wsl.exe -d $Distro -- bash -lc "grep -qs 'sherman-install PATH' ~/.profile || printf '\n# sherman-install PATH\nexport PATH=${pathDir}:`$PATH\n' >> ~/.profile"
    & wsl.exe -d $Distro -- bash -lc "grep -qs 'sherman-install PATH' ~/.bashrc || printf '\n# sherman-install PATH\nexport PATH=${pathDir}:`$PATH\n' >> ~/.bashrc"
    & wsl.exe -d $Distro -- bash -lc "grep -qs 'sherman-install PATH' ~/.profile && grep -qs 'sherman-install PATH' ~/.bashrc"
    if ($LASTEXITCODE -eq 0) {
        Say "PATH line present in ~/.profile and ~/.bashrc inside $Distro"
        Say "(verified: grep) -- so a plain 'sherman' works in future shells"
    } else {
        Note "could not confirm the PATH line landed in ~/.profile and"
        Say  "~/.bashrc. Not fatal: Sherman is launched by its own path"
        Say  "below. To run it later, use: $linkTilde"
    }
}

# ------------------------------------------------------------------- report --
Write-Host ""
Write-Host "Done installing. Two facts before Sherman starts:"
Write-Host ""
Write-Host "  - Signing in stays yours: the engine's own browser login runs on"
Write-Host "    first launch, on your account. No installer can do it for you."
Write-Host "  - Stated plainly: the vault write-boundary is UNVERIFIED under WSL."
Write-Host "    On macOS it is proven by an escape test; nobody has re-run that"
Write-Host "    test here. docs/WINDOWS.md carries the details. The no-PHI rule"
Write-Host "    is identical on every platform."
if ($HostsPinned) {
    Write-Host "  - DNS inside WSL is still blocked by something on this machine;"
    Write-Host "    this install went around it by pinning the names it needs in"
    Write-Host "    /etc/hosts. Sherman works, but anything else inside Ubuntu"
    Write-Host "    that resolves other names will fail until the DNS filter"
    Write-Host "    (VPN or security suite) is turned off."
}
Write-Host ""
Write-Host "Starting Sherman -- its own setup asks two questions (provider and"
Write-Host "your name), then the engine sign-in runs. Next time, open $Distro"
Write-Host "and type: sherman"
Write-Host ""

# The handoff itself, by the launcher's own path so no shell startup file
# can break it. The one thing the paste cannot do is BE the person: from
# here Sherman's first-run wizard owns the conversation.
& wsl.exe -d $Distro -- bash -lc "$linkTilde"
exit $LASTEXITCODE
