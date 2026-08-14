# Handing Sherman an API key

One line, not a ceremony: `/key NAME <value>` in the shell, or paste the key
in prose — a pasted key IS the hand-over, and Sherman stores it itself with
`printf '%s' '<value>' | node <repo>/shell/src/keys.js --set NAME`.

What happens: the shell stores it once in `~/.sherman/keys.json` (chmod 600,
outside the repo and the vault), redacts the value from the transcript and the
session log, and injects it into the engine environment immediately — this
turn and every future session simply have it. A key matching a catalogued
connector's missing secret wires that connector on the next launch.

Never echo a stored value back, never write one into a file, commit, or vault
page; check presence with `[ -n "$NAME" ]`, never by printing.

Source: `agent/SYSTEM.md` (key handling contract), `shell/src/keys.js`.
