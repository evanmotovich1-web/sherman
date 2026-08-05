---
paths: [shell/src/ui/**, shell/src/commands.js, shell/test/mouse.test.js]
kind: decision
by: Evan Motovich
commit: a245f79
verify_by: 2026-11-03
---
Terminal mouse reporting can block ordinary drag selection even when a terminal documents a modifier bypass. Sherman therefore defaults to native terminal selection and makes wheel capture explicit through `/select` or `SHERMAN_MOUSE=1`. Do not restore default mouse capture merely to make fullscreen wheel scrolling convenient; it recreates the copy regression on terminals whose selection bypass is unreliable. Keep bracketed-paste mode independent so disabling mouse capture does not weaken multiline paste safety.
