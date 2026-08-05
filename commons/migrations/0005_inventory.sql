PRAGMA foreign_keys = ON;

-- Inventory is deliberately scoped to the authenticated network/device tuple.
-- It stores approved discovery metadata only; source bytes and agent-authored
-- content have no column or persistence path here.
CREATE TABLE device_inventory_state (
  network_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  inventory_hash TEXT NOT NULL CHECK (length(inventory_hash) = 64),
  synced_at INTEGER NOT NULL,
  PRIMARY KEY (network_id, device_id),
  FOREIGN KEY (network_id, device_id) REFERENCES devices(network_id, id)
);

CREATE TABLE device_inventory_items (
  network_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('skill', 'connector')),
  item_name TEXT NOT NULL,
  item_hash TEXT NOT NULL CHECK (length(item_hash) = 64),
  metadata_json TEXT NOT NULL CHECK (length(metadata_json) <= 4096),
  available INTEGER NOT NULL CHECK (available IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (network_id, device_id, item_type, item_name),
  FOREIGN KEY (network_id, device_id) REFERENCES devices(network_id, id)
);
CREATE INDEX device_inventory_discovery
  ON device_inventory_items(network_id, item_type, available, item_name);

-- Disappearance is represented by an unavailable upsert retaining approved
-- metadata, never by destructive removal.
CREATE TRIGGER device_inventory_items_no_delete BEFORE DELETE ON device_inventory_items BEGIN
  SELECT RAISE(ABORT, 'device_inventory_tombstone_required');
END;
