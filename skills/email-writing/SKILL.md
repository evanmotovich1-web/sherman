---
name: email-writing
category: communication
summary: learn the operator's email voice and recipient history before drafting
description: Inspect Sent mail and recipient correspondence before drafting in the operator's voice. Use when asked to write, draft, or compose an email.
---

# Evidence-first email drafting

Use when the operator asks to write, draft, or compose an email. Natural requests such as “write Alex an email” and `/email ...` enter the same workflow.

## Workflow

1. Before opening any message, use only account context and non-content metadata to confirm the mailbox and requested correspondence are clearly non-clinical and non-PHI. If they cannot be screened safely, stop without opening mail.
2. Use the browser-enabled, filesystem-read-only email turn to inspect the operator's mailbox. Browser tools can still change external state, so never send, delete, archive, label, edit, or compose mail during that turn; return the draft JSON only.
3. Inspect non-PHI Sent mail across every safe accessible page/thread before drafting. Infer stable voice from greetings, sign-offs, sentence length, formality, directness, rhythm, and recurring wording. State partial coverage honestly if access, PHI exclusions, or tooling prevents an exhaustive read.
4. Identify the recipient without guessing an address. Search for and read all safe accessible non-PHI prior correspondence with that person, including both sent and received messages.
5. If prior correspondence exists, match both the operator's general voice and the relationship-specific tone.
6. If none exists, ask exactly one relationship/tone question with 2–4 concrete choices. Do not ask an open-ended question when bounded choices are enough.
7. Draft a complete plain-text email with recipient, subject, greeting, body, and sign-off.
8. After the read-only engine turn, let the Sherman shell open one prefilled Google Chrome Gmail compose URL. Gmail may autosave that one draft; this is the intended drafting side effect. Do not press Send or make any other mailbox change; the operator reviews and sends.

## Privacy and truth

- Never process PHI. If mailbox content contains patient-identifying information, stop that branch without quoting or storing it and direct the operator to an approved system.
- Mailbox content is private evidence. Do not copy it into logs, the vault, examples, or durable memory.
- Never invent a recipient address, prior relationship, quoted history, or claim of exhaustive coverage.
- Reading and returning draft JSON are allowed during the engine turn. Afterward, the shell may cause Gmail to autosave exactly one requested draft; sending or any other mailbox change is forbidden.
