BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY,
  transaction_id TEXT,
  suggestion TEXT,
  source TEXT,
  source_id TEXT,
  confidence REAL,
  group_id TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT,
  tombstone INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_suggestions_transaction ON suggestions (transaction_id, status);
CREATE INDEX IF NOT EXISTS idx_suggestions_group ON suggestions (group_id);

COMMIT;
