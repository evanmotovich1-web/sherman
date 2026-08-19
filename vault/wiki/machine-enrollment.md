# Setting up Sherman on a new machine

One paste does everything: the installer (`install.sh`, or the Windows
installer per `docs/WINDOWS.md`) self-heals its prerequisites; the person
only signs in to their engine provider and connects channels. The wizard
then asks which provider they use — that answer selects the engine, and
for DeepSeek or Grok also which model — and
assembles the workspace persona on first launch. Provider roster and
auth shape: [[available-engines]]. DeepSeek keys follow
[[key-handover-procedure]]; Grok is SuperGrok OAuth, not a pasted key.

After enrollment, the machine stays current with `sherman update` (pulls
`main`). If a machine misbehaves after an update, `./smoke.sh` from the repo
root names what is broken; a corrupt `~/.sherman/config.json` is repaired by
deleting it and running `sherman` again (the wizard rewrites it).

Source: `install.sh`, `docs/WINDOWS.md`, `bin/sherman`.
