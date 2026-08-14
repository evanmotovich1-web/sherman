# Every session is graded, and knowledge is captured explicitly

At session end (and as a background checkpoint every 10 minutes while a
session is live), a read-only judge turn reads the session log and reports
where skills, workers, and the vault were used or missed, and what durable
knowledge should be kept. Verdicts persist under `~/.sherman/evals/` so
trends survive the session.

Capture is explicit-only: each complete `/learn` or `/wiki` fact the verdict
proposes is offered in a choice box — Enter files it through the same shell
validation as a hand-typed command, Esc skips it. Nothing enters the vault
without that keypress or an explicit command. The validation screens every
fact for PHI, secrets, and prompt injection, and confines the write
atomically to its lane (`/wiki` → `vault/wiki/`, `/learn` →
`vault/memory/shared/`).

Source: `shell/src/commands.js` (eval and wiki command contracts),
`shell/src/retention.js` (validation), `shell/src/evalstore.js`.
