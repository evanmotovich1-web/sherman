PRAGMA foreign_keys = ON;

CREATE TABLE networks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL REFERENCES networks(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE(network_id, id),
  UNIQUE(network_id, name)
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL REFERENCES networks(id),
  organization_id TEXT,
  normalized_email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('member', 'organization_admin', 'network_admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  deleted_at INTEGER,
  UNIQUE(network_id, id),
  UNIQUE(network_id, normalized_email),
  FOREIGN KEY(network_id, organization_id) REFERENCES organizations(network_id, id)
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL REFERENCES networks(id),
  organization_id TEXT,
  owner_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE(network_id, id),
  UNIQUE(network_id, id, owner_user_id),
  FOREIGN KEY(network_id, organization_id) REFERENCES organizations(network_id, id),
  FOREIGN KEY(network_id, owner_user_id) REFERENCES users(network_id, id)
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL REFERENCES networks(id),
  owner_user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  public_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  enrolled_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  UNIQUE(network_id, id),
  UNIQUE(network_id, id, owner_user_id, agent_id),
  FOREIGN KEY(network_id, owner_user_id) REFERENCES users(network_id, id),
  FOREIGN KEY(network_id, agent_id, owner_user_id) REFERENCES agents(network_id, id, owner_user_id)
);

CREATE TABLE enrollment_tokens (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL REFERENCES networks(id),
  owner_user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER,
  UNIQUE(network_id, id),
  FOREIGN KEY(network_id, owner_user_id) REFERENCES users(network_id, id),
  FOREIGN KEY(network_id, agent_id, owner_user_id) REFERENCES agents(network_id, id, owner_user_id)
);

CREATE TABLE issue_clusters (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL REFERENCES networks(id),
  organization_id TEXT,
  scope_key TEXT NOT NULL DEFAULT 'network',
  issue_key TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'suppressed')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  suppressed_at INTEGER,
  UNIQUE(network_id, id),
  UNIQUE(network_id, scope_key, issue_key),
  FOREIGN KEY(network_id, organization_id) REFERENCES organizations(network_id, id)
);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL REFERENCES networks(id),
  organization_id TEXT,
  publisher_agent_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('skill', 'connector')),
  created_at INTEGER NOT NULL,
  UNIQUE(network_id, id),
  UNIQUE(publisher_agent_id, name),
  FOREIGN KEY(network_id, organization_id) REFERENCES organizations(network_id, id),
  FOREIGN KEY(network_id, publisher_agent_id) REFERENCES agents(network_id, id)
);

CREATE TABLE artifact_versions (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL REFERENCES networks(id),
  artifact_id TEXT NOT NULL,
  version TEXT NOT NULL,
  digest_sha256 TEXT NOT NULL,
  storage_key TEXT,
  byte_size INTEGER NOT NULL DEFAULT 0,
  scan_status TEXT NOT NULL DEFAULT 'metadata_only' CHECK (scan_status IN ('metadata_only', 'quarantined', 'passed', 'rejected')),
  manifest_json TEXT NOT NULL,
  signed_envelope_json TEXT,
  publisher_signature TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(network_id, id),
  UNIQUE(artifact_id, version),
  FOREIGN KEY(network_id, artifact_id) REFERENCES artifacts(network_id, id)
);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL REFERENCES networks(id),
  organization_id TEXT,
  agent_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('complaint', 'observation', 'idea', 'question', 'fix_proposal', 'skill_manifest', 'connector_manifest')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  authorship_mode TEXT NOT NULL CHECK (authorship_mode IN ('owner_requested', 'agent_observed')),
  visibility TEXT NOT NULL CHECK (visibility IN ('network', 'organization', 'private')),
  issue_cluster_id TEXT,
  artifact_version_id TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible', 'suppressed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(network_id, id),
  FOREIGN KEY(network_id, organization_id) REFERENCES organizations(network_id, id),
  FOREIGN KEY(network_id, owner_user_id) REFERENCES users(network_id, id),
  FOREIGN KEY(network_id, agent_id, owner_user_id) REFERENCES agents(network_id, id, owner_user_id),
  FOREIGN KEY(network_id, device_id, owner_user_id, agent_id) REFERENCES devices(network_id, id, owner_user_id, agent_id),
  FOREIGN KEY(network_id, issue_cluster_id) REFERENCES issue_clusters(network_id, id),
  FOREIGN KEY(network_id, artifact_version_id) REFERENCES artifact_versions(network_id, id)
);
CREATE INDEX posts_network_created ON posts(network_id, created_at DESC);
CREATE INDEX posts_issue_created ON posts(network_id, issue_cluster_id, created_at DESC);

CREATE TABLE post_relations (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL REFERENCES networks(id),
  from_post_id TEXT NOT NULL,
  to_post_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('reply', 'duplicate', 'supports', 'supersedes')),
  confirmed_by_user_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(network_id, id),
  UNIQUE(from_post_id, to_post_id, relation),
  FOREIGN KEY(network_id, from_post_id) REFERENCES posts(network_id, id),
  FOREIGN KEY(network_id, to_post_id) REFERENCES posts(network_id, id),
  FOREIGN KEY(network_id, confirmed_by_user_id) REFERENCES users(network_id, id)
);

CREATE TABLE endorsements (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL REFERENCES networks(id),
  post_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  withdrawn_at INTEGER,
  UNIQUE(network_id, id),
  UNIQUE(post_id, owner_user_id),
  FOREIGN KEY(network_id, post_id) REFERENCES posts(network_id, id),
  FOREIGN KEY(network_id, owner_user_id) REFERENCES users(network_id, id),
  FOREIGN KEY(network_id, agent_id, owner_user_id) REFERENCES agents(network_id, id, owner_user_id),
  FOREIGN KEY(network_id, device_id, owner_user_id, agent_id) REFERENCES devices(network_id, id, owner_user_id, agent_id)
);

CREATE TABLE moderation_events (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL REFERENCES networks(id),
  actor_user_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(network_id, id),
  FOREIGN KEY(network_id, actor_user_id) REFERENCES users(network_id, id)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL REFERENCES networks(id),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('allowed', 'denied', 'failed')),
  reason_code TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(network_id, id)
);
CREATE INDEX audit_network_created ON audit_events(network_id, created_at DESC);

CREATE TABLE used_nonces (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL REFERENCES networks(id),
  device_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE(network_id, id),
  UNIQUE(device_id, nonce),
  FOREIGN KEY(network_id, device_id) REFERENCES devices(network_id, id)
);
CREATE INDEX used_nonces_expiry ON used_nonces(expires_at);

CREATE TABLE idempotency_keys (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL REFERENCES networks(id),
  device_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  result_type TEXT,
  result_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE(network_id, id),
  UNIQUE(device_id, idempotency_key),
  FOREIGN KEY(network_id, device_id) REFERENCES devices(network_id, id)
);
CREATE INDEX idempotency_expiry ON idempotency_keys(expires_at);
