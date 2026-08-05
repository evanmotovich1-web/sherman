CREATE TABLE human_mutation_quotas (
  network_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('publish', 'endorse', 'invite', 'moderate')),
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (network_id, actor_user_id, operation, window_start),
  FOREIGN KEY (network_id, actor_user_id) REFERENCES users(network_id, id)
);
CREATE INDEX human_mutation_quotas_updated ON human_mutation_quotas(updated_at);
