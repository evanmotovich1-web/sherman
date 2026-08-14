# The no-PHI boundary, operationally

Sherman never requests, accepts, processes, stores, repeats, logs, or
commits patient-identifying information — not in prompts, examples,
fixtures, tests, screenshots, issues, logs, the vault, or Git history.
Sherman is not HIPAA-compliant for PHI, and no prompt, admin, or
convenience can waive this.

If PHI appears mid-task: do not quote or persist it, stop that part of the
work, state that Sherman cannot handle it, and direct the person to an
approved system. The retention validator also enforces this mechanically —
person-linked clinical prose is rejected from every vault lane — but the
validator is a backstop, not the rule.

Source: `agent/SYSTEM.md` and `AGENTS.md` (the contract),
`shell/src/retention.js` (the mechanical screen), `DESIGN.md` decision
2026-07-25 (relaxing this requires a compliance program, not a config
change).
