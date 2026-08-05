ALTER TABLE users ADD COLUMN access_subject TEXT;
CREATE UNIQUE INDEX users_network_access_subject
  ON users(network_id, access_subject)
  WHERE access_subject IS NOT NULL;

ALTER TABLE audit_events ADD COLUMN organization_id TEXT;
CREATE INDEX audit_network_organization_created
  ON audit_events(network_id, organization_id, created_at DESC);

ALTER TABLE endorsements ADD COLUMN issue_cluster_id TEXT;
UPDATE endorsements
SET issue_cluster_id = (
  SELECT issue_cluster_id FROM posts
  WHERE posts.network_id = endorsements.network_id AND posts.id = endorsements.post_id
);
UPDATE endorsements
SET withdrawn_at = created_at
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY network_id, issue_cluster_id, owner_user_id
      ORDER BY created_at DESC, id DESC
    ) AS duplicate_rank
    FROM endorsements
    WHERE withdrawn_at IS NULL AND issue_cluster_id IS NOT NULL
  ) WHERE duplicate_rank > 1
);
CREATE TRIGGER endorsements_issue_insert_guard
BEFORE INSERT ON endorsements
WHEN NOT EXISTS (
  SELECT 1 FROM posts
  WHERE posts.network_id = NEW.network_id
    AND posts.id = NEW.post_id
    AND posts.issue_cluster_id IS NEW.issue_cluster_id
)
BEGIN
  SELECT RAISE(ABORT, 'endorsement_issue_mismatch');
END;
CREATE TRIGGER endorsements_issue_update_guard
BEFORE UPDATE OF network_id, post_id, issue_cluster_id ON endorsements
WHEN NOT EXISTS (
  SELECT 1 FROM posts
  WHERE posts.network_id = NEW.network_id
    AND posts.id = NEW.post_id
    AND posts.issue_cluster_id IS NEW.issue_cluster_id
)
BEGIN
  SELECT RAISE(ABORT, 'endorsement_issue_mismatch');
END;
CREATE TRIGGER posts_endorsement_issue_update_guard
BEFORE UPDATE OF network_id, id, issue_cluster_id ON posts
WHEN EXISTS (
  SELECT 1 FROM endorsements
  WHERE endorsements.network_id = OLD.network_id
    AND endorsements.post_id = OLD.id
    AND endorsements.issue_cluster_id IS NOT NEW.issue_cluster_id
)
BEGIN
  SELECT RAISE(ABORT, 'endorsement_issue_mismatch');
END;
CREATE UNIQUE INDEX endorsements_active_owner_issue
  ON endorsements(network_id, issue_cluster_id, owner_user_id)
  WHERE withdrawn_at IS NULL AND issue_cluster_id IS NOT NULL;
