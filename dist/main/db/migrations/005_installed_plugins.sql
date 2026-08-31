-- N-03: Plugin System for Third-Party Tools.
--
-- Installed third-party plugins. Each plugin registers tools into the main
-- tool registry through a sandboxed child-process harness; this table records
-- what's installed, where it lives (its folder is copied under userData on
-- install), the original manifest, and the per-tool permission decisions the
-- user approved at install review time.

CREATE TABLE IF NOT EXISTS installed_plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    author TEXT,
    description TEXT NOT NULL,
    entry TEXT NOT NULL,             -- entry filename inside the plugin folder
    plugin_dir TEXT NOT NULL,        -- absolute path to the installed plugin folder
    manifest_json TEXT NOT NULL,     -- the validated plugin.json manifest
    tool_decisions_json TEXT NOT NULL, -- {"toolName": "auto"|"confirm_required", ...}
    active INTEGER NOT NULL DEFAULT 1,
    installed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);