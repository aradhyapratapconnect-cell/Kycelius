-- Migration 002: allow tool_executions.message_id to be NULL
-- Tool executions can be attempted without a triggering message row
-- (e.g., validation failures or direct IPC invocation), and every attempt
-- must still produce an audit row. SQLite cannot alter column nullability,
-- so the table is rebuilt.

CREATE TABLE IF NOT EXISTS tool_executions_new (
    id TEXT PRIMARY KEY,
    message_id TEXT,
    tool_name TEXT NOT NULL,
    parameters TEXT NOT NULL,
    permission_tier TEXT NOT NULL CHECK (permission_tier IN ('auto', 'confirm_required')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'denied', 'success', 'failed')),
    result TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

INSERT INTO tool_executions_new (id, message_id, tool_name, parameters, permission_tier, status, result, created_at)
SELECT id, message_id, tool_name, parameters, permission_tier, status, result, created_at
FROM tool_executions;

DROP TABLE tool_executions;
ALTER TABLE tool_executions_new RENAME TO tool_executions;

CREATE INDEX IF NOT EXISTS idx_tool_executions_message_id ON tool_executions(message_id);
CREATE INDEX IF NOT EXISTS idx_tool_executions_created_at ON tool_executions(created_at);
