-- Attachments table for file/folder references in conversations
-- Supports drag-and-drop path input and "+" attachment feature

CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    original_path TEXT NOT NULL,
    display_name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('file', 'folder')),
    size_bytes INTEGER NOT NULL DEFAULT 0,
    ingested_content_summary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachments_conversation_id ON attachments(conversation_id);