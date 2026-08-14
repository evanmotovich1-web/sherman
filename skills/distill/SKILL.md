---
name: distill
category: agent
summary: compress accumulated knowledge into tighter reusable facts, lessons, and skills
description: Run knowledge distillation over Sherman's own accumulated material — session logs, eval verdicts, the vault, and mnemosyne — and compress the durable signal into reviewable /wiki facts, /learn lessons, and new or tightened skills. Use at consolidation checkpoints, when the same lesson keeps resurfacing, or whenever the operator asks to distill or tighten what Sherman knows.
---

# Distill what you have learned into less

Knowledge distillation is the move from a large, diffuse teacher to a small,
sharp student. The teacher is everything Sherman has accumulated — session
logs, eval verdicts, vault files, mnemosyne memories — and the student is the
fraction of it worth keeping, in a form the next session will actually reuse.
Most of the teacher is noise: what someone asked on a Tuesday, a session that
happened, a fact a fresh Sherman already knows. Distillation is the discipline
of keeping only the signal.

## When to use it

- At a consolidation checkpoint — session close, or the end of a long
  multi-task day — when raw material has piled up and nobody has compressed it.
- When the operator asks to "distill", "consolidate", or "tighten" what Sherman
  knows.
- When the same lesson keeps resurfacing across sessions: that is the teacher
  saying a skill or a wiki fact is missing, and this is the loop that writes it.

## The loop

1. **Collect the teacher.** Read the sources wide and read-only: recent session
   logs (`~/.sherman/sessions/`), persisted eval verdicts (`~/.sherman/evals/`),
   the vault, and `recall` mnemosyne. Never pull PHI, keys, or secrets out of
   any of them — describe the shape of a lesson and say the specifics were
   withheld.
2. **Compress to the student.** For each candidate, run the distillation test:
   would a fresh Sherman, reading only this distilled fact, DO something
   different — and do it better? If the answer is no, it is noise and it stays
   out. One durable idea per output, named for the behavior it changes, never
   for the session it came from.
3. **Choose the student form.** A company procedure or decision is a `/wiki`
   fact. A correction to Sherman's own conduct is a `/learn` lesson. A method
   that keeps being improvised is a new or tightened skill (via `self-extend`,
   forged first into `~/.sherman/skills/`, shipped as a branch through
   `self-evolve` once it proves out). A weakness in Sherman itself is a
   `self-evolve` change.
4. **Propose, never persist.** Output complete operator-reviewable commands and
   skill drafts, with `[[wikilinks]]` where they belong. Models never write the
   vault or authoritative memory directly — the operator-gate is the safety,
   not an excuse to skip the proposal.

## The boundaries

- No PHI, keys, or secrets enter a distilled fact, in any form, including as an
  illustrative example.
- One fact per file; name it the way a human would search for it.
- Cite the source session id or file for every distilled claim — an uncited
  distillation is an opinion, and the operator cannot act on it.
- Do not distill the operating contract back into the vault. A fact a fresh
  Sherman already has from `SYSTEM.md` is not new signal; restating it dilutes
  the brain instead of tightening it.

## Done means

A bounded set of complete, reviewable proposals — the `/wiki` and `/learn`
commands and the skill drafts — each with its source cited, plus a short list
of the material you examined and the candidates you rejected as noise. Never
claim a proposal was saved.
