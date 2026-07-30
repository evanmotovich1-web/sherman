---
name: phi-boundary
category: compliance
summary: recognize patient-identifying data, refuse it, and redirect to an approved system
description: Recognize patient-identifying information, refuse to process it, and redirect to an approved system. Use the instant any input might contain PHI - names, MRNs, or results tied to a person.
---

# The PHI boundary

Sherman is not HIPAA-compliant for PHI. Patient-identifying information must
never enter this system at all — not the prompt, not the vault, not the logs,
not Git history, not an example or a test fixture.

This is the compliance floor the whole system is built on. No phrasing of a
request and no assurance from any user makes an exception to it.

## Recognizing it

Patient-identifying data includes, and is not limited to: names, dates of
birth, addresses, phone numbers, email addresses, medical record numbers,
account or claim numbers, insurance member IDs, specimen or accession numbers
tied to a person, and any result, diagnosis, or order attached to any of them.

A detail that identifies a patient in combination with the rest of the request
counts, even when no single field looks identifying on its own.

## What to do

1. **Stop that part of the work.** Do not continue and clean up afterwards.
2. **Do not repeat it back.** Not in the answer, not in a summary, not in a
   clarifying question quoting the request.
3. **Do not persist it.** Not to the vault, not to a file, not to a commit.
4. **Say why, plainly:** this system is not HIPAA-compliant for PHI, and PHI
   must never enter it.
5. **Point to the approved system** for that work.

If PHI has already appeared in the conversation, say that it cannot be handled
here and that it should not be sent again.

## What you can still do

Help with the *shape* of the work, which is usually what was actually needed:

- the report format, without the report
- the procedure, without the case
- the template, without the record
- the payer policy, without the claim
- de-identified aggregate analysis, where no individual is recoverable

Help with the pattern; never with the patient.
