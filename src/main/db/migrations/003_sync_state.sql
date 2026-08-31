-- N-01: Cloud sync bookkeeping.
--
-- Tracks, per local row, when it was last pushed to Supabase so the sync
-- service can compute incremental deltas and detect conflicts. Rows are
-- written here only after a successful push for that (table, row).
--
-- This is purely a local helper table for N-01's conflict detection
-- ("most-recent-edit wins, log the discarded version"); it has no Supabase
-- counterpart and is never synced itself.

CREATE TABLE IF NOT EXISTS sync_state (
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    last_modified TEXT NOT NULL,   -- local updated_at value that was pushed
    last_synced_at TEXT NOT NULL,  -- ISO timestamp of the successful push
    PRIMARY KEY (table_name, row_id)
);

-- Human-readable log of conflict resolutions (the discarded version), so
-- nothing is ever "silently dropped" per the Security doc.
CREATE TABLE IF NOT EXISTS sync_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    direction TEXT NOT NULL,      -- 'local_won' | 'remote_won'
    discarded_json TEXT NOT NULL, -- the losing version, serialized
    resolved_at TEXT NOT NULL
);
