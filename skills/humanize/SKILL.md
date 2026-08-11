---
name: humanize
category: documents
summary: rewrite outbound text so it reads like the person who will sign it, without touching the facts
description: Rewrite a draft — email, message, announcement — into the sender's own plain voice, stripping machine tells while preserving every fact and every stated limit. Use when a person will send text under their own name, or asks to make a draft sound like them.
---

# Make it sound like the person sending it

Sherman drafts well, but a draft that reads machine-written costs the sender
something: the reader hears the tool, not the person. This skill rewrites
outbound text — an `/email` draft, a message, an announcement — into the
voice of the person who will sign it. The scope is voice. The facts, the
commitments, and the stated limits are not the rewriter's to move.

## When it applies

Text a person will send under their own name. It fires on request ("make it
sound like me", "humanize this") and belongs unprompted at the end of any
`/email` draft — apply it rather than asking whether to. It does **not** apply to SOPs,
company documents, or anything with a required format: those have owners
(`sop-draft`, `company-document`) and their stiffness is often the standard.

## The tells to remove

Machine writing has an accent, and stripping it is mostly deletion:

- **Openers and closers nobody says.** "I hope this message finds you
  well", "Please do not hesitate to reach out". Start where the point
  starts; end where it ends.
- **Hedge stacks.** One qualifier is a judgment; three is a tell. "I think
  we could potentially consider" is "we could".
- **Symmetry.** Three bullets of three items with parallel phrasing reads
  generated. Real people write lists with ragged edges, or none.
- **Inflation.** "Utilize", "leverage", "delve", "robust", "streamline" —
  the plain verb was available the whole time.
- **Unearned enthusiasm.** Exclamation marks and "great question" energy
  the sender did not express. Warmth is the sender's to add, not the
  tool's to fake.

## The voice to match

Deletion gets to neutral; matching gets to *them*.

- If the user's private scope holds a voice note —
  `vault/memory/private/<user>/voice.md` — follow it: their greetings,
  sign-offs, sentence length, formality, the words they would never use.
- If it does not, work from evidence in front of you: how they typed their
  request is a sample of them. After explicit feedback that a rewrite lands
  ("that's it, that's how I sound"), apply the preference in the current
  response but do not persist it directly. Sherman has no shell-validated
  private-memory retention command yet.
- Never read another user's voice note. Never invent one from a draft alone;
  explicit voice feedback is what authorizes recording that preference.

## What must survive the rewrite

- **Every fact, number, date, and name.** A rewrite that improves the tone
  and shifts a date is a failure of the only kind that matters.
- **Every stated limit.** If the draft says the vault does not cover
  something, or that an answer is unverified, that survives verbatim in
  spirit — honesty is not a tell, and polishing it out would let a smooth
  voice make an unearned claim.
- **The sender's actual position.** Softening a no into a maybe, or a maybe
  into a yes, is not humanizing; it is putting words in their mouth. When
  the requested tone and the draft's substance conflict, say so instead of
  quietly resolving it.

## The boundary

No PHI in drafts, rewrites, or voice notes, ever — a warmer sentence is
still a sentence Sherman may not hold patient data in. See `phi-boundary`.
