-- Kyclius Database Schema
-- Version: 2.6.1
-- All tables for local-first SQLite storage

-- Migration tracking table
CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- conversations: Each chat/workspace session
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- messages: Individual messages within conversations
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    content TEXT NOT NULL,
    input_mode TEXT CHECK (input_mode IN ('voice', 'text')),
    output_mode TEXT CHECK (output_mode IN ('voice', 'text', 'both')),
    provider_id TEXT, -- FK to providers table
    attachment_ids TEXT, -- JSON array of attachment IDs
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- memory_facts: Durable facts Kyclius remembers about the user
CREATE TABLE IF NOT EXISTS memory_facts (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('auto_learned', 'user_added')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- tool_executions: Audit log of every tool action attempted
CREATE TABLE IF NOT EXISTS tool_executions (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    parameters TEXT NOT NULL, -- JSON
    permission_tier TEXT NOT NULL CHECK (permission_tier IN ('auto', 'confirm_required')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'denied', 'success', 'failed')),
    result TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- user_config: Settings and API keys (encrypted at rest)
CREATE TABLE IF NOT EXISTS user_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- cloud_sync_state: Optional Supabase sync tracking
CREATE TABLE IF NOT EXISTS cloud_sync_state (
    supabase_user_id TEXT PRIMARY KEY,
    last_synced_at DATETIME,
    sync_enabled BOOLEAN DEFAULT 0
);

-- voice_profiles: Voice biometric embeddings (encrypted)
CREATE TABLE IF NOT EXISTS voice_profiles (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    embedding BLOB NOT NULL, -- Encrypted voiceprint
    enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- autonomous_mode_config: Per-tool risk tolerance for Autonomous Mode
CREATE TABLE IF NOT EXISTS autonomous_mode_config (
    enabled BOOLEAN DEFAULT 0,
    tool_overrides TEXT NOT NULL DEFAULT '{}', -- JSON map: toolName -> 'auto' | 'confirm_required' | 'never'
    max_plan_steps INTEGER DEFAULT 10,
    max_plan_duration_seconds INTEGER DEFAULT 300
);

-- agent_plans: Multi-step autonomous plans
CREATE TABLE IF NOT EXISTS agent_plans (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    goal TEXT NOT NULL,
    steps TEXT NOT NULL, -- JSON array of planned tool calls
    status TEXT NOT NULL CHECK (status IN ('planning', 'in_progress', 'completed', 'stopped_by_limit', 'stopped_by_user', 'failed')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- attachments: File/folder references attached to conversations
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

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_tool_executions_message_id ON tool_executions(message_id);
CREATE INDEX IF NOT EXISTS idx_tool_executions_created_at ON tool_executions(created_at);
CREATE INDEX IF NOT EXISTS idx_memory_facts_key ON memory_facts(key);
CREATE INDEX IF NOT EXISTS idx_agent_plans_conversation_id ON agent_plans(conversation_id);
CREATE INDEX IF NOT EXISTS idx_agent_plans_status ON agent_plans(status);
CREATE INDEX IF NOT EXISTS idx_attachments_conversation_id ON attachments(conversation_id);