# Granting Sherman extra writable directories

By default Sherman's engine runs restricted: it may write inside its own
disposable workspace (and the memory stores), and nothing else. That is the
right default — it means a stray command cannot touch the rest of your disk —
but it is why Sherman hands you a paste-block when a task needs to write to a
project that lives *outside* the workspace (say, an offline research checkout
you keep under `~/projects`).

If you want Sherman to work in such a directory itself, grant it explicitly.

## How

Create `~/.sherman/sandbox.json`:

```json
{
  "writable_roots": [
    "~/projects/offline-lab",
    "~/.sherman/workspace/local-mlx-research"
  ]
}
```

Each entry is a directory Sherman's engine may read and write. Relaunch
Sherman and the grant is live on both engines (Claude Code / Codex and the
OpenCode-hosted models alike).

Remove the file — or drop an entry — and the grant is gone on the next launch.
It is opt-in and reversible by design.

## What it does not do

- **It does not open the network.** Network egress stays blocked at the kernel.
  A task that needs to download something (a model, a package) still hands you
  a paste-block to run in your own shell — that is deliberate, not a bug.
- **It cannot grant the vault.** The vault, any directory containing it, and
  anything inside it are always refused; authoritative vault writes go only
  through `/learn` and `/wiki`. The home directory itself and the filesystem
  root are refused too — a grant that broad is a mistake, not a narrow one, so
  it is dropped with no effect.
- **It is not a command allowlist.** The grant widens *where* Sherman may
  write, not *what* it may run. Sherman's operating contract still governs the
  commands themselves.

## Rules of thumb

- Grant the **narrowest** directory that covers the work — a single project
  root, not `~`.
- A path that does not exist yet is ignored; create the directory first.
- Paths must be absolute (or start with `~/`).
