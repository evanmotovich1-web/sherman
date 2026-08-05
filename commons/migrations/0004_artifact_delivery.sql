PRAGMA foreign_keys = ON;

-- Trusted publisher keys are provisioned by the deployment control plane. There
-- is deliberately no human or agent endpoint that can self-assert trust.
CREATE TABLE artifact_publisher_keys (
  id TEXT NOT NULL,
  network_id TEXT NOT NULL,
  organization_id TEXT,
  owner_user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (network_id, id),
  UNIQUE (network_id, id, device_id),
  FOREIGN KEY (network_id, organization_id) REFERENCES organizations(network_id, id),
  FOREIGN KEY (network_id, owner_user_id) REFERENCES users(network_id, id),
  FOREIGN KEY (network_id, agent_id, owner_user_id) REFERENCES agents(network_id, id, owner_user_id),
  FOREIGN KEY (network_id, device_id, owner_user_id, agent_id) REFERENCES devices(network_id, id, owner_user_id, agent_id)
);

CREATE TABLE artifact_publications (
  id TEXT NOT NULL,
  network_id TEXT NOT NULL,
  organization_id TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('network', 'organization', 'private')),
  publisher_key_id TEXT NOT NULL,
  publisher_device_id TEXT NOT NULL,
  schema_name TEXT NOT NULL CHECK (schema_name = 'SHERMAN-COMMONS-SKILL-V1'),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  digest_sha256 TEXT NOT NULL,
  publisher_signature TEXT NOT NULL,
  compatibility_json TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 1500000),
  content_type TEXT NOT NULL CHECK (content_type = 'application/vnd.sherman.commons-artifact+json'),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (network_id, id),
  UNIQUE (network_id, publisher_key_id, name, version),
  UNIQUE (network_id, publisher_key_id, name, digest_sha256),
  FOREIGN KEY (network_id, organization_id) REFERENCES organizations(network_id, id),
  FOREIGN KEY (network_id, publisher_key_id, publisher_device_id) REFERENCES artifact_publisher_keys(network_id, id, device_id)
);
CREATE INDEX artifact_publications_inventory ON artifact_publications(network_id, visibility, created_at DESC);

CREATE TABLE artifact_quarantine_bytes (
  network_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  digest_sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 1500000),
  bundle_bytes BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (network_id, publication_id),
  FOREIGN KEY (network_id, publication_id) REFERENCES artifact_publications(network_id, id)
);

CREATE TABLE artifact_scan_results (
  id TEXT NOT NULL,
  network_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  artifact_digest TEXT NOT NULL,
  artifact_version TEXT NOT NULL,
  scanner_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'rejected')),
  scanned_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > scanned_at),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (network_id, id),
  FOREIGN KEY (network_id, publication_id) REFERENCES artifact_publications(network_id, id)
);
CREATE INDEX artifact_scan_current ON artifact_scan_results(network_id, publication_id, status, expires_at);
CREATE UNIQUE INDEX artifact_scan_exact_result
  ON artifact_scan_results(network_id, publication_id, artifact_digest, scanner_version, scanned_at);

CREATE TABLE post_artifact_publications (
  network_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (network_id, post_id),
  FOREIGN KEY (network_id, post_id) REFERENCES posts(network_id, id),
  FOREIGN KEY (network_id, publication_id) REFERENCES artifact_publications(network_id, id)
);
CREATE INDEX post_artifact_publications_by_publication
  ON post_artifact_publications(network_id, publication_id, created_at DESC);

CREATE TRIGGER artifact_publications_no_update BEFORE UPDATE ON artifact_publications BEGIN
  SELECT RAISE(ABORT, 'artifact_publication_immutable');
END;
CREATE TRIGGER artifact_publications_no_delete BEFORE DELETE ON artifact_publications BEGIN
  SELECT RAISE(ABORT, 'artifact_publication_immutable');
END;
CREATE TRIGGER artifact_quarantine_bytes_no_update BEFORE UPDATE ON artifact_quarantine_bytes BEGIN
  SELECT RAISE(ABORT, 'artifact_quarantine_immutable');
END;
CREATE TRIGGER artifact_quarantine_bytes_no_delete BEFORE DELETE ON artifact_quarantine_bytes BEGIN
  SELECT RAISE(ABORT, 'artifact_quarantine_immutable');
END;
CREATE TRIGGER artifact_scan_results_no_update BEFORE UPDATE ON artifact_scan_results BEGIN
  SELECT RAISE(ABORT, 'artifact_scan_immutable');
END;
CREATE TRIGGER artifact_scan_results_no_delete BEFORE DELETE ON artifact_scan_results BEGIN
  SELECT RAISE(ABORT, 'artifact_scan_immutable');
END;
