import test from 'node:test';
import assert from 'node:assert/strict';

import { composeUrl, isWsl, openNotice, openPath, openUrl } from '../src/browser.js';

// The URL is the draft's vehicle: every field percent-encoded, the recipient
// omitted entirely when empty (a bare `to=` in a Gmail compose URL renders an
// empty chip), and apostrophes encoded so the WSL powershell path can carry
// the URL inside single quotes.
test('composeUrl encodes the draft and survives the powershell quoting path', () => {
    const url = composeUrl({
        to: 'lab@example.com',
        subject: 'Analyzers & QC',
        body: "It's back up.\nSecond line.",
    });
    assert.match(url, /^https:\/\/mail\.google\.com\/mail\/\?view=cm&fs=1/);
    assert.match(url, /&to=lab%40example\.com/);
    assert.match(url, /&su=Analyzers%20%26%20QC/);
    assert.match(url, /&body=It%27s%20back%20up\.%0ASecond%20line\./);
    assert.doesNotMatch(url, /'/, 'an apostrophe survived into the URL');

    assert.doesNotMatch(composeUrl({ subject: 'S', body: 'B' }), /&to=/);
});

test('isWsl reads the platform and the kernel banner, not a guess', () => {
    assert.equal(isWsl({ platform: 'darwin', env: {} }), false);
    assert.equal(isWsl({ platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu' } }), true);
    assert.equal(
        isWsl({ platform: 'linux', env: {}, readProc: () => 'Linux version 6.6.87.2-microsoft-standard-WSL2' }),
        true
    );
    assert.equal(
        isWsl({ platform: 'linux', env: {}, readProc: () => 'Linux version 6.8.0-generic' }),
        false
    );
    // A /proc that cannot be read is a "no", never a crash.
    assert.equal(
        isWsl({ platform: 'linux', env: {}, readProc: () => { throw new Error('nope'); } }),
        false
    );
});

// openUrl's ladder, driven through the injected runner so no test opens a
// real browser. `ok` must mean exactly "a launcher exited 0".
test('openUrl walks the platform ladder and reports what actually ran', () => {
    const calls = [];
    const runner = (outcomes) => (command, args) => {
        calls.push([command, ...args.slice(0, 1)]);
        const next = outcomes.shift();
        if (next instanceof Error) return { error: next };
        return { status: next };
    };

    // macOS: `open` exits 0 and that is the whole story.
    calls.length = 0;
    const mac = openUrl('https://mail.google.com/x', { run: runner([0]), platform: 'darwin' });
    assert.deepEqual(mac, { ok: true, method: 'open', reason: null });

    // WSL: wslview is absent, powershell.exe carries it.
    calls.length = 0;
    const err = new Error('spawn wslview ENOENT');
    err.code = 'ENOENT';
    const wsl = openUrl('https://mail.google.com/x', {
        run: runner([err, 0]), platform: 'linux', wsl: true,
    });
    assert.deepEqual(wsl, { ok: true, method: 'powershell.exe', reason: null });
    assert.equal(calls[0][0], 'wslview');
    assert.equal(calls[1][0], 'powershell.exe');

    // Headless linux: the failure names what was tried.
    const headless = openUrl('https://mail.google.com/x', {
        run: runner([1]), platform: 'linux', wsl: false,
    });
    assert.equal(headless.ok, false);
    assert.match(headless.reason, /xdg-open exited 1/);

    // Not a web URL: refused before anything runs.
    const refused = openUrl('file:///etc/passwd', { run: runner([0]), platform: 'darwin' });
    assert.equal(refused.ok, false);
    assert.match(refused.reason, /not an http/);

    // The headless/CI opt-out refuses with its reason.
    process.env.SHERMAN_NO_BROWSER = '1';
    try {
        const disabled = openUrl('https://mail.google.com/x', { run: runner([0]), platform: 'darwin' });
        assert.equal(disabled.ok, false);
        assert.match(disabled.reason, /SHERMAN_NO_BROWSER/);
    } finally {
        delete process.env.SHERMAN_NO_BROWSER;
    }
});

test('openNotice never claims a send and never claims an open it cannot prove', () => {
    const opened = openNotice({ ok: true, method: 'open', reason: null });
    assert.match(opened, /review it and press Send/);
    assert.match(opened, /Sherman does not send mail/);

    const failed = openNotice({ ok: false, method: null, reason: 'xdg-open exited 1' });
    assert.match(failed, /Could not open a browser/);
    assert.match(failed, /xdg-open exited 1/);
    assert.doesNotMatch(failed, /opening in your browser/);
});

// openPath: same ladder, but a PATH, because a Linux file:// URL means
// nothing to the Windows browser — wslview translates, and the powershell
// fallback spells the path the way Windows can actually reach it.
test('openPath translates for WSL and refuses non-paths', () => {
    const calls = [];
    const runner = (outcomes) => (command, args) => {
        calls.push([command, args]);
        const next = outcomes.shift();
        if (next instanceof Error) return { error: next };
        return { status: next };
    };

    const mac = openPath('/Users/e/.sherman/win/win-1.html', { run: runner([0]), platform: 'darwin' });
    assert.deepEqual(mac, { ok: true, method: 'open', reason: null });

    calls.length = 0;
    const err = new Error('spawn wslview ENOENT');
    err.code = 'ENOENT';
    const wsl = openPath('/root/.sherman/win/win-1.html', {
        run: runner([err, 0]), platform: 'linux', wsl: true,
        env: { WSL_DISTRO_NAME: 'Ubuntu' },
    });
    assert.equal(wsl.ok, true);
    assert.equal(wsl.method, 'powershell.exe');
    const psArg = calls[1][1].join(' ');
    assert.match(psArg, /\\\\wsl\.localhost\\Ubuntu\\root\\\.sherman\\win\\win-1\.html/);

    const refused = openPath('not/absolute', { run: runner([0]), platform: 'darwin' });
    assert.equal(refused.ok, false);
    assert.match(refused.reason, /not an absolute path/);

    process.env.SHERMAN_NO_BROWSER = '1';
    try {
        const disabled = openPath('/tmp/x.html', { run: runner([0]), platform: 'darwin' });
        assert.equal(disabled.ok, false);
        assert.match(disabled.reason, /SHERMAN_NO_BROWSER/);
    } finally {
        delete process.env.SHERMAN_NO_BROWSER;
    }
});
