"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachments = exports.scheduledTasks = exports.installedPlugins = exports.installedAgents = exports.agentPlans = exports.autonomousModeConfig = exports.voiceProfiles = exports.syncConflicts = exports.syncState = exports.cloudSyncState = exports.userConfig = exports.toolExecutions = exports.memoryFacts = exports.messages = exports.conversations = void 0;
exports.getDb = getDb;
exports.closeDb = closeDb;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const electron_1 = require("electron");
const path_1 = require("path");
const fs_1 = require("fs");
const DB_NAME = 'kyclius.db';
const MIGRATIONS_DIR = (0, path_1.join)(__dirname, 'migrations');
let db = null;
function getDb() {
    if (db)
        return db;
    const userDataPath = electron_1.app.getPath('userData');
    if (!(0, fs_1.existsSync)(userDataPath)) {
        (0, fs_1.mkdirSync)(userDataPath, { recursive: true });
    }
    const dbPath = (0, path_1.join)(userDataPath, DB_NAME);
    db = new better_sqlite3_1.default(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    ensureAutonomousModeConfig(db);
    return db;
}
function runMigrations(database) {
    database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    const appliedMigrations = new Set(database.prepare('SELECT name FROM _migrations').all().map(r => r.name));
    const migrationFiles = (0, fs_1.readdirSync)(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();
    for (const file of migrationFiles) {
        if (!appliedMigrations.has(file)) {
            const sql = (0, fs_1.readFileSync)((0, path_1.join)(MIGRATIONS_DIR, file), 'utf-8');
            database.exec(sql);
            database.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
            console.log(`[DB] Applied migration: ${file}`);
        }
    }
}
function ensureAutonomousModeConfig(database) {
    const existing = database.prepare('SELECT * FROM autonomous_mode_config').get();
    if (!existing) {
        database
            .prepare(`
      INSERT INTO autonomous_mode_config (enabled, tool_overrides, max_plan_steps, max_plan_duration_seconds)
      VALUES (0, '{}', 10, 300)
    `)
            .run();
    }
}
// Conversations
exports.conversations = {
    create: (title) => {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        getDb()
            .prepare(`
      INSERT INTO conversations (id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `)
            .run(id, title, now, now);
        return { id, title, created_at: now, updated_at: now };
    },
    getAll: () => {
        return getDb()
            .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
            .all();
    },
    getById: (id) => {
        return getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    },
    updateTitle: (id, title) => {
        const now = new Date().toISOString();
        getDb()
            .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
            .run(title, now, id);
    },
    delete: (id) => {
        getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id);
    },
};
// Messages
exports.messages = {
    create: (msg) => {
        const now = new Date().toISOString();
        getDb()
            .prepare(`
      INSERT INTO messages (id, conversation_id, role, content, input_mode, output_mode, provider, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
            .run(msg.id, msg.conversation_id, msg.role, msg.content, msg.input_mode, msg.output_mode, msg.provider ?? null, msg.model ?? null, now);
        return { ...msg, created_at: now };
    },
    getByConversation: (conversationId) => {
        return getDb()
            .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
            .all(conversationId);
    },
    getRecent: (limit = 50) => {
        return getDb()
            .prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT ?')
            .all(limit);
    },
    deleteByConversation: (conversationId) => {
        getDb().prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
    },
    // T-22: real dashboard stats sourced straight from the local tables — no
    // fabricated numbers or trend badges that history can't back up.
    getStats: () => {
        const db = getDb();
        const conversations = db
            .prepare(`
          SELECT COUNT(*) AS c FROM conversations c
          WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
          `)
            .get().c ?? 0;
        const toolExecutions = db.prepare('SELECT COUNT(*) AS c FROM tool_executions').get().c ?? 0;
        const succeeded = db
            .prepare("SELECT COUNT(*) AS c FROM tool_executions WHERE status = 'success'")
            .get().c ?? 0;
        const last = db
            .prepare(`
        SELECT MAX(ts) AS ts FROM (
          SELECT created_at AS ts FROM messages
          UNION ALL
          SELECT created_at AS ts FROM tool_executions
        )
        `)
            .get();
        return {
            conversations,
            toolExecutions,
            toolSuccessRate: toolExecutions > 0 ? Math.round((succeeded / toolExecutions) * 1000) / 10 : 0,
            lastActivityAt: last?.ts ?? null,
        };
    },
    getConversationSummaries: (limit = 50, offset = 0) => {
        const rows = getDb()
            .prepare(`
        WITH latest_conversations AS (
          SELECT DISTINCT conversation_id
          FROM messages
          ORDER BY created_at DESC
        )
        SELECT
          c.id AS conversation_id,
          c.title AS conversation_title,
          q.content AS question,
          q.input_mode,
          a.content AS answer,
          MAX(m.created_at) AS last_message_at,
          GROUP_CONCAT(DISTINCT te.tool_name) AS tool_names
        FROM latest_conversations lc
        JOIN conversations c ON c.id = lc.conversation_id
        LEFT JOIN messages q ON q.conversation_id = c.id AND q.role = 'user'
          AND q.id = (
            SELECT m2.id FROM messages m2
            WHERE m2.conversation_id = c.id AND m2.role = 'user'
            ORDER BY m2.created_at ASC LIMIT 1
          )
        LEFT JOIN messages a ON a.conversation_id = c.id AND a.role = 'assistant'
          AND a.id = (
            SELECT m3.id FROM messages m3
            WHERE m3.conversation_id = c.id AND m3.role = 'assistant'
            ORDER BY m3.created_at DESC LIMIT 1
          )
        LEFT JOIN messages m ON m.conversation_id = c.id
        LEFT JOIN tool_executions te ON te.message_id = m.id
        GROUP BY c.id
        ORDER BY last_message_at DESC
        LIMIT ? OFFSET ?
        `)
            .all(limit, offset);
        return rows;
    },
    searchConversationSummaries: (query) => {
        const pattern = `%${query}%`;
        const rows = getDb()
            .prepare(`
        WITH latest_conversations AS (
          SELECT DISTINCT conversation_id
          FROM messages
          WHERE content LIKE ?
        )
        SELECT
          c.id AS conversation_id,
          c.title AS conversation_title,
          q.content AS question,
          q.input_mode,
          a.content AS answer,
          MAX(m.created_at) AS last_message_at,
          GROUP_CONCAT(DISTINCT te.tool_name) AS tool_names
        FROM latest_conversations lc
        JOIN conversations c ON c.id = lc.conversation_id
        LEFT JOIN messages q ON q.conversation_id = c.id AND q.role = 'user'
          AND q.id = (
            SELECT m2.id FROM messages m2
            WHERE m2.conversation_id = c.id AND m2.role = 'user'
            ORDER BY m2.created_at ASC LIMIT 1
          )
        LEFT JOIN messages a ON a.conversation_id = c.id AND a.role = 'assistant'
          AND a.id = (
            SELECT m3.id FROM messages m3
            WHERE m3.conversation_id = c.id AND m3.role = 'assistant'
            ORDER BY m3.created_at DESC LIMIT 1
          )
        LEFT JOIN messages m ON m.conversation_id = c.id
        LEFT JOIN tool_executions te ON te.message_id = m.id
        WHERE EXISTS (
          SELECT 1 FROM messages m4
          WHERE m4.conversation_id = c.id
            AND (m4.content LIKE ? OR m4.content LIKE ?)
        )
        GROUP BY c.id
        ORDER BY last_message_at DESC
        `)
            .all(pattern, pattern, pattern);
        return rows;
    },
};
// Memory Facts
exports.memoryFacts = {
    getAll: () => {
        return getDb().prepare('SELECT * FROM memory_facts ORDER BY key ASC').all();
    },
    getByKey: (key) => {
        return getDb().prepare('SELECT * FROM memory_facts WHERE key = ?').get(key);
    },
    set: (key, value, source = 'user_added') => {
        const now = new Date().toISOString();
        const existing = exports.memoryFacts.getByKey(key);
        if (existing) {
            getDb()
                .prepare('UPDATE memory_facts SET value = ?, source = ?, updated_at = ? WHERE key = ?')
                .run(value, source, now, key);
            return { ...existing, value, source, updated_at: now };
        }
        else {
            const id = crypto.randomUUID();
            getDb()
                .prepare(`
        INSERT INTO memory_facts (id, key, value, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
                .run(id, key, value, source, now, now);
            return { id, key, value, source, created_at: now, updated_at: now };
        }
    },
    delete: (id) => {
        getDb().prepare('DELETE FROM memory_facts WHERE id = ?').run(id);
    },
    deleteByKey: (key) => {
        getDb().prepare('DELETE FROM memory_facts WHERE key = ?').run(key);
    },
};
// Tool Executions
exports.toolExecutions = {
    create: (exec) => {
        const now = new Date().toISOString();
        getDb()
            .prepare(`
      INSERT INTO tool_executions (id, message_id, tool_name, parameters, permission_tier, status, result, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
            .run(exec.id, exec.message_id ?? null, exec.tool_name, JSON.stringify(exec.parameters), exec.permission_tier, exec.status, exec.result ?? null, now);
        return { ...exec, created_at: now };
    },
    updateStatus: (id, status, result) => {
        getDb()
            .prepare('UPDATE tool_executions SET status = ?, result = ? WHERE id = ?')
            .run(status, result ?? null, id);
    },
    getByMessageId: (messageId) => {
        const rows = getDb()
            .prepare('SELECT * FROM tool_executions WHERE message_id = ? ORDER BY created_at ASC')
            .all(messageId);
        return rows.map(r => ({ ...r, parameters: JSON.parse(r.parameters) }));
    },
    getAll: (limit = 100) => {
        const rows = getDb()
            .prepare('SELECT * FROM tool_executions ORDER BY created_at DESC LIMIT ?')
            .all(limit);
        return rows.map(r => ({ ...r, parameters: JSON.parse(r.parameters) }));
    },
    getByStatus: (status) => {
        const rows = getDb()
            .prepare('SELECT * FROM tool_executions WHERE status = ? ORDER BY created_at DESC')
            .all(status);
        return rows.map(r => ({ ...r, parameters: JSON.parse(r.parameters) }));
    },
};
// User Config (encrypted values stored as-is, encryption handled by caller)
exports.userConfig = {
    get: (key) => {
        const row = getDb().prepare('SELECT value FROM user_config WHERE key = ?').get(key);
        return row?.value;
    },
    set: (key, value) => {
        getDb()
            .prepare('INSERT OR REPLACE INTO user_config (key, value) VALUES (?, ?)')
            .run(key, value);
    },
    getAll: () => {
        const rows = getDb().prepare('SELECT key, value FROM user_config').all();
        return Object.fromEntries(rows.map(r => [r.key, r.value]));
    },
    delete: (key) => {
        getDb().prepare('DELETE FROM user_config WHERE key = ?').run(key);
    },
};
// Cloud Sync State
exports.cloudSyncState = {
    get: () => {
        return getDb().prepare('SELECT * FROM cloud_sync_state LIMIT 1').get();
    },
    set: (state) => {
        getDb()
            .prepare(`
      INSERT OR REPLACE INTO cloud_sync_state (supabase_user_id, last_synced_at, sync_enabled)
      VALUES (?, ?, ?)
    `)
            .run(state.supabase_user_id, state.last_synced_at ?? null, state.sync_enabled ? 1 : 0);
    },
};
exports.syncState = {
    upsert: (tableName, rowId, lastModified) => {
        const now = new Date().toISOString();
        getDb()
            .prepare(`
      INSERT INTO sync_state (table_name, row_id, last_modified, last_synced_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (table_name, row_id)
      DO UPDATE SET last_modified = ?, last_synced_at = ?
    `)
            .run(tableName, rowId, lastModified, now, lastModified, now);
    },
    getByTable: (tableName) => {
        return getDb()
            .prepare('SELECT * FROM sync_state WHERE table_name = ? ORDER BY last_modified ASC')
            .all(tableName);
    },
    /** Rows in this table that have never been successfully pushed. */
    getUnsynced: (tableName) => {
        return getDb()
            .prepare('SELECT * FROM sync_state WHERE table_name = ?')
            .all(tableName);
    },
    get: (tableName, rowId) => {
        return getDb()
            .prepare('SELECT * FROM sync_state WHERE table_name = ? AND row_id = ?')
            .get(tableName, rowId);
    },
    remove: (tableName, rowId) => {
        getDb()
            .prepare('DELETE FROM sync_state WHERE table_name = ? AND row_id = ?')
            .run(tableName, rowId);
    },
    clearTable: (tableName) => {
        getDb().prepare('DELETE FROM sync_state WHERE table_name = ?').run(tableName);
    },
};
exports.syncConflicts = {
    log: (tableName, rowId, direction, discardedJson) => {
        const now = new Date().toISOString();
        getDb()
            .prepare(`
      INSERT INTO sync_conflicts (table_name, row_id, direction, discarded_json, resolved_at)
      VALUES (?, ?, ?, ?, ?)
    `)
            .run(tableName, rowId, direction, discardedJson, now);
    },
    getAll: (limit = 100) => {
        return getDb()
            .prepare('SELECT * FROM sync_conflicts ORDER BY resolved_at DESC LIMIT ?')
            .all(limit);
    },
};
// Voice Profiles
exports.voiceProfiles = {
    create: (label, embedding) => {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        getDb()
            .prepare(`
      INSERT INTO voice_profiles (id, label, embedding, enrolled_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
            .run(id, label, embedding, now, now);
        return { id, label, embedding, enrolled_at: now, updated_at: now };
    },
    getAll: () => {
        return getDb()
            .prepare('SELECT * FROM voice_profiles ORDER BY enrolled_at DESC')
            .all();
    },
    getById: (id) => {
        return getDb().prepare('SELECT * FROM voice_profiles WHERE id = ?').get(id);
    },
    update: (id, embedding) => {
        const now = new Date().toISOString();
        getDb()
            .prepare('UPDATE voice_profiles SET embedding = ?, updated_at = ? WHERE id = ?')
            .run(embedding, now, id);
    },
    delete: (id) => {
        getDb().prepare('DELETE FROM voice_profiles WHERE id = ?').run(id);
    },
    deleteAll: () => {
        getDb().prepare('DELETE FROM voice_profiles').run();
    },
};
// Autonomous Mode Config
exports.autonomousModeConfig = {
    get: () => {
        const row = getDb().prepare('SELECT * FROM autonomous_mode_config LIMIT 1').get();
        if (!row) {
            return {
                enabled: false,
                tool_overrides: {},
                max_plan_steps: 10,
                max_plan_duration_seconds: 300,
            };
        }
        return { ...row, tool_overrides: JSON.parse(row.tool_overrides) };
    },
    set: (config) => {
        const current = exports.autonomousModeConfig.get();
        const merged = { ...current, ...config };
        getDb()
            .prepare(`
      UPDATE autonomous_mode_config
      SET enabled = ?, tool_overrides = ?, max_plan_steps = ?, max_plan_duration_seconds = ?
    `)
            .run(merged.enabled ? 1 : 0, JSON.stringify(merged.tool_overrides), merged.max_plan_steps, merged.max_plan_duration_seconds);
    },
};
// Agent Plans
exports.agentPlans = {
    create: (plan) => {
        const now = new Date().toISOString();
        getDb()
            .prepare(`
      INSERT INTO agent_plans (id, conversation_id, goal, steps, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
            .run(plan.id, plan.conversation_id, plan.goal, JSON.stringify(plan.steps), plan.status, now);
        return { ...plan, created_at: now };
    },
    updateStatus: (id, status, completedAt) => {
        getDb()
            .prepare('UPDATE agent_plans SET status = ?, completed_at = ? WHERE id = ?')
            .run(status, completedAt ?? null, id);
    },
    getByConversation: (conversationId) => {
        const rows = getDb()
            .prepare('SELECT * FROM agent_plans WHERE conversation_id = ? ORDER BY created_at DESC')
            .all(conversationId);
        return rows.map(r => ({ ...r, steps: JSON.parse(r.steps) }));
    },
    getById: (id) => {
        const row = getDb().prepare('SELECT * FROM agent_plans WHERE id = ?').get(id);
        return row ? { ...row, steps: JSON.parse(row.steps) } : undefined;
    },
    getActive: () => {
        const row = getDb()
            .prepare(`
      SELECT * FROM agent_plans
      WHERE status IN ('planning', 'in_progress')
      ORDER BY created_at DESC LIMIT 1
    `)
            .get();
        return row ? { ...row, steps: JSON.parse(row.steps) } : undefined;
    },
};
// N-02: installed community/shared agent bundles.
exports.installedAgents = {
    upsert: (agent) => {
        getDb()
            .prepare(`
      INSERT INTO installed_agents
        (id, name, description, version, author, system_prompt, manifest_json,
         tool_decisions_json, active, installed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      ON CONFLICT (id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        version = excluded.version,
        author = excluded.author,
        system_prompt = excluded.system_prompt,
        manifest_json = excluded.manifest_json,
        tool_decisions_json = excluded.tool_decisions_json
    `)
            .run(agent.id, agent.name, agent.description, agent.version, agent.author ?? null, agent.system_prompt, agent.manifest_json, agent.tool_decisions_json, agent.active ? 1 : 0, agent.installed_at);
    },
    getAll: () => {
        return getDb()
            .prepare('SELECT * FROM installed_agents ORDER BY name ASC')
            .all();
    },
    getById: (id) => {
        return getDb().prepare('SELECT * FROM installed_agents WHERE id = ?').get(id);
    },
    getActive: () => {
        return getDb().prepare('SELECT * FROM installed_agents WHERE active = 1').get();
    },
    setIsActive: (id, active) => {
        getDb().prepare('UPDATE installed_agents SET active = 0').run();
        if (active) {
            getDb().prepare('UPDATE installed_agents SET active = 1 WHERE id = ?').run(id);
        }
    },
    delete: (id) => {
        getDb().prepare('DELETE FROM installed_agents WHERE id = ?').run(id);
    },
};
// N-03: installed third-party plugins.
exports.installedPlugins = {
    upsert: (plugin) => {
        getDb()
            .prepare(`
      INSERT INTO installed_plugins
        (id, name, version, author, description, entry, plugin_dir,
         manifest_json, tool_decisions_json, active, installed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      ON CONFLICT (id) DO UPDATE SET
        name = excluded.name,
        version = excluded.version,
        author = excluded.author,
        description = excluded.description,
        entry = excluded.entry,
        plugin_dir = excluded.plugin_dir,
        manifest_json = excluded.manifest_json,
        tool_decisions_json = excluded.tool_decisions_json
    `)
            .run(plugin.id, plugin.name, plugin.version, plugin.author ?? null, plugin.description, plugin.entry, plugin.plugin_dir, plugin.manifest_json, plugin.tool_decisions_json, plugin.active ? 1 : 0, plugin.installed_at);
    },
    getAll: () => {
        return getDb()
            .prepare('SELECT * FROM installed_plugins ORDER BY name ASC')
            .all();
    },
    getById: (id) => {
        return getDb().prepare('SELECT * FROM installed_plugins WHERE id = ?').get(id);
    },
    setActive: (id, active) => {
        getDb().prepare('UPDATE installed_plugins SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    },
    delete: (id) => {
        getDb().prepare('DELETE FROM installed_plugins WHERE id = ?').run(id);
    },
};
function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}
// N-05: recurring scheduled commands.
const rowToScheduledTask = (row) => ({
    id: row.id,
    name: row.name,
    schedule: row.schedule,
    command: row.command,
    enabled: Boolean(row.enabled),
    conversation_id: row.conversation_id ?? undefined,
    last_run_at: row.last_run_at ?? undefined,
    last_status: row.last_status ?? undefined,
    last_error: row.last_error ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
});
exports.scheduledTasks = {
    create: (input) => {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        getDb()
            .prepare(`
      INSERT INTO scheduled_tasks (id, name, schedule, command, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
            .run(id, input.name, input.schedule, input.command, input.enabled ? 1 : 0, now, now);
        const row = getDb().prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id);
        return rowToScheduledTask(row);
    },
    getAll: () => {
        return getDb()
            .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at ASC')
            .all().map(rowToScheduledTask);
    },
    getById: (id) => {
        const row = getDb().prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id);
        return row ? rowToScheduledTask(row) : undefined;
    },
    update: (id, patch) => {
        const existing = exports.scheduledTasks.getById(id);
        if (!existing)
            return undefined;
        const nextName = patch.name ?? existing.name;
        const nextSchedule = patch.schedule ?? existing.schedule;
        const nextCommand = patch.command ?? existing.command;
        const nextEnabled = patch.enabled ?? existing.enabled;
        getDb()
            .prepare('UPDATE scheduled_tasks SET name = ?, schedule = ?, command = ?, enabled = ?, updated_at = ? WHERE id = ?')
            .run(nextName, nextSchedule, nextCommand, nextEnabled ? 1 : 0, new Date().toISOString(), id);
        return exports.scheduledTasks.getById(id);
    },
    setEnabled: (id, enabled) => {
        getDb()
            .prepare('UPDATE scheduled_tasks SET enabled = ?, updated_at = ? WHERE id = ?')
            .run(enabled ? 1 : 0, new Date().toISOString(), id);
    },
    setConversation: (id, conversationId) => {
        getDb()
            .prepare('UPDATE scheduled_tasks SET conversation_id = ? WHERE id = ?')
            .run(conversationId, id);
    },
    setLastRun: (id, outcome) => {
        getDb()
            .prepare('UPDATE scheduled_tasks SET last_run_at = ?, last_status = ?, last_error = ? WHERE id = ?')
            .run(new Date().toISOString(), outcome.status ?? null, outcome.error ?? null, id);
    },
    delete: (id) => {
        getDb().prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
    },
};
// Attachments
exports.attachments = {
    create: (attachment) => {
        const now = new Date().toISOString();
        getDb()
            .prepare(`
      INSERT INTO attachments (id, conversation_id, original_path, display_name, kind, size_bytes, ingested_content_summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
            .run(attachment.id, attachment.conversation_id, attachment.original_path, attachment.display_name, attachment.kind, attachment.size_bytes, attachment.ingested_content_summary ?? null, now);
        return { ...attachment, created_at: now };
    },
    getByConversation: (conversationId) => {
        return getDb()
            .prepare('SELECT * FROM attachments WHERE conversation_id = ? ORDER BY created_at ASC')
            .all(conversationId);
    },
    getById: (id) => {
        return getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(id);
    },
    delete: (id) => {
        getDb().prepare('DELETE FROM attachments WHERE id = ?').run(id);
    },
    deleteByConversation: (conversationId) => {
        getDb().prepare('DELETE FROM attachments WHERE conversation_id = ?').run(conversationId);
    },
};
