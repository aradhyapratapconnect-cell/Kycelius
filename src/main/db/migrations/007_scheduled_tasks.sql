-- N-05: Scheduled/Triggered Tasks.
--
-- Recurring commands the user defines ("every morning at 9am, summarize
-- unread GitHub notifications"). Each task fires through the normal agent
-- pipeline into its own dedicated conversation (so automated output never
-- pollutes the user's active thread), and any confirm_required action goes
-- through the standard permission engine just like an interactive request.

CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL,            -- 5-field cron expression (local time)
    command TEXT NOT NULL,             -- the command text run on each fire
    enabled INTEGER NOT NULL DEFAULT 1,
    conversation_id TEXT,              -- dedicated conversation for this task
    last_run_at TEXT,
    last_status TEXT,                  -- running | success | failed
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);