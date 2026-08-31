-- N-02: Shared/Community Agents.
--
-- Installed agent bundles. An agent is a declarative manifest of a system
-- prompt plus references to existing registry tools with per-agent permission
-- decisions. Storing the manifest lets us re-export an agent (AC: bundle can
-- be exported from one install and imported into another) and store the
-- per-tool decision the user made at install review time.

CREATE TABLE IF NOT EXISTS installed_agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    version TEXT NOT NULL,
    author TEXT,
    system_prompt TEXT NOT NULL,
    manifest_json TEXT NOT NULL,            -- the original validated bundle manifest
    tool_decisions_json TEXT NOT NULL,      -- {"toolName": "auto"|"confirm_required", ...}
    active INTEGER NOT NULL DEFAULT 0,      -- only one active agent at a time
    installed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
