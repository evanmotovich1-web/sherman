// Opening a URL in the operator's browser, and being honest about whether it
// launched.
//
// Same contract as clipboard.js: the module reports which mechanism ran and
// what its exit code proved, and the CALLER chooses words that match. An
// opener that exited 0 handed the URL to the operating system's launcher —
// that is real evidence a window is coming, and it is also ALL the evidence
// there is: nothing here can see whether the browser signed into the right
// account or rendered the page.
//
// The platform ladder:
//
//   darwin   `open <url>` — LaunchServices routes to the default browser.
//   WSL      the Windows browser is the operator's browser, reached through
//            interop. `wslview` (wslu) translates and launches; where it is
//            absent, `powershell.exe Start-Process` does the same. Note the
//            contrast with install.sh's codex rule: there, /mnt interop is
//            the TRAP (Windows node cannot run in Ubuntu); here it is the
//            point — the browser we want IS the Windows one.
//   linux    `xdg-open <url>` on a desktop; a headless box has no browser
//            and says so rather than pretending.
//
// URLs passed to powershell ride inside single quotes, so composeUrl()
// percent-encodes apostrophes — an encoding every browser accepts anyway.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Gmail's compose endpoint, with the draft riding in the query string. */
export function composeUrl({ to = '', subject = '', body = '' }) {
    const q = (value) => encodeURIComponent(value ?? '');
    return (
        'https://mail.google.com/mail/?view=cm&fs=1'
        + (to ? `&to=${q(to)}` : '')
        + `&su=${q(subject)}&body=${q(body)}`
    ).replace(/'/g, '%27');
}

/** WSL is Linux with a Windows host attached; /proc/version says so. */
export function isWsl({ platform = process.platform, env = process.env, readProc = () => readFileSync('/proc/version', 'utf8') } = {}) {
    if (platform !== 'linux') return false;
    if (env.WSL_DISTRO_NAME) return true;
    try {
        return /microsoft/i.test(readProc());
    } catch {
        return false;
    }
}

/**
 * Open `url` in the operator's browser.
 *
 * @returns {{ok: boolean, method: string|null, reason: string|null}}
 *
 * `ok` means a launcher process accepted the URL and exited 0 — evidence a
 * window is opening, and nothing stronger. Injectable seams (`run`,
 * `platform`, `wsl`) let tests drive every branch without opening anything.
 */
export function openUrl(url, {
    run = spawnSync,
    platform = process.platform,
    wsl = null,
} = {}) {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
        return { ok: false, method: null, reason: 'not an http(s) URL' };
    }

    // The opt-out for tests, CI, and headless runs: nothing should launch a
    // browser from an environment that set this, and the refusal says why.
    if (process.env.SHERMAN_NO_BROWSER) {
        return { ok: false, method: null, reason: 'browser opening disabled (SHERMAN_NO_BROWSER)' };
    }

    const attempts =
        platform === 'darwin' ? [['open', [url]]]
        : (wsl ?? isWsl({ platform })) ? [
              ['wslview', [url]],
              ['powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url}'`]],
          ]
        : platform === 'linux' ? [['xdg-open', [url]]]
        : [];

    return attempt(attempts, platform, run);
}

/**
 * Open a local file (a generated report page) in the operator's browser.
 *
 * A separate entry from openUrl on purpose: a Linux path is NOT a URL the
 * Windows browser can read — `file:///root/...` means nothing to Chrome on
 * the host — so WSL rides `wslview`, which translates the path itself, with
 * the `\\wsl.localhost\<distro>` UNC spelling as the powershell fallback.
 * Same contract otherwise: `ok` means a launcher exited 0.
 */
export function openPath(path, {
    run = spawnSync,
    platform = process.platform,
    wsl = null,
    env = process.env,
} = {}) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
        return { ok: false, method: null, reason: 'not an absolute path' };
    }
    if (process.env.SHERMAN_NO_BROWSER) {
        return { ok: false, method: null, reason: 'browser opening disabled (SHERMAN_NO_BROWSER)' };
    }

    const onWsl = wsl ?? isWsl({ platform });
    const unc = env.WSL_DISTRO_NAME
        ? `\\\\wsl.localhost\\${env.WSL_DISTRO_NAME}${path.replace(/\//g, '\\')}`
        : null;
    const attempts =
        platform === 'darwin' ? [['open', [path]]]
        : onWsl ? [
              ['wslview', [path]],
              ...(unc ? [['powershell.exe', ['-NoProfile', '-Command', `Start-Process '${unc.replace(/'/g, "''")}'`]]] : []),
          ]
        : platform === 'linux' ? [['xdg-open', [path]]]
        : [];

    return attempt(attempts, platform, run);
}

/** The shared ladder-walker: first launcher to exit 0 wins; failures name themselves. */
function attempt(attempts, platform, run) {
    if (attempts.length === 0) {
        return { ok: false, method: null, reason: `no browser launcher for platform ${platform}` };
    }

    const failures = [];
    for (const [command, args] of attempts) {
        try {
            const result = run(command, args, { stdio: 'ignore', timeout: 15000 });
            if (result && !result.error && result.status === 0) {
                return { ok: true, method: command, reason: null };
            }
            failures.push(
                result?.error
                    ? `${command} ${result.error.code ?? 'failed'}`
                    : `${command} exited ${result?.status ?? 'abnormally'}`
            );
        } catch (error) {
            failures.push(`${command} ${error?.code ?? 'failed'}`);
        }
    }
    return { ok: false, method: null, reason: failures.join(', ') };
}

/**
 * The line the shell prints for an open result — the honesty contract in one
 * place, like copyNotice. "Opened" is only ever said about a launcher that
 * exited 0, and the sending stays the operator's: Sherman never claims to
 * have sent mail, because it cannot and must not.
 */
export function openNotice(result) {
    if (result.ok) {
        return 'compose window opening in your browser · review it and press Send — Sherman does not send mail';
    }
    return `Could not open a browser here (${result.reason ?? 'no mechanism available'}). The draft is above — /copy puts it on the clipboard.`;
}
