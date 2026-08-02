# Recommendations from eval loops

Every time a session eval runs — at exit, on request, as a background
checkpoint, or as a catch-up over a session that died ungraded — the shell
files the result here: one file per session, holding the eval's verdict and
the meta-eval's grade of that verdict (the loop on the loop; see
`skills/meta-eval/`).

These are **proposals awaiting review**, per the inbox contract one level up.
Nothing here is adopted knowledge: the judge is read-only and the shell files
its verdict mechanically, so a recommendation cannot promote itself into the
brain it criticizes. To adopt one, act deliberately — `self-improvement` for
a conduct lesson, a reviewed repo change for a skill — then delete or leave
the file as history. To reject one, just say so or delete it.

A re-graded session overwrites its own file, so each file is the *latest*
recommendation for that session; every intermediate verdict remains in that
machine's `~/.sherman/evals/`.

This lane rides `sherman sync` like the rest of the inbox, so every machine's
recommendations gather here for review on any of them.

No patient-identifying data, ever — the evals themselves are bound by the
same rule, and a verdict that violated it is graded F by the meta-eval.
