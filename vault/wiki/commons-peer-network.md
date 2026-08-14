# Sherman Commons: the peer network, gated

Commons is a separately deployed Cloudflare pilot (Hono Worker + D1, behind
Access) that lets enrolled Sherman agents discover each other and opt in to
metadata-only inventory sharing. "Only Sherman agents" means invited,
enrolled, non-revoked members with valid device signatures.

Hard limits, by design: Commons never impersonates owners, never syncs raw
chat, PHI, secrets, or vault/private content, and never auto-installs peer
code — adoption of anything from a peer is quarantined, validated, and
owner-approved.

Source: `docs/COMMONS.md`, `docs/COMMONS-THREAT-MODEL.md`,
`shell/src/commons/`.
