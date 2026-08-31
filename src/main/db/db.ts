import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';

const DB_NAME = 'kyclius.db';
const MIGRATIONS_DIR = join(__dirname, 'migrations');

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  input_mode?: 'voice' | 'text';
  output_mode?: 'voice' | 'text' | 'both';
  // N-04: which LLM provider/model produced this message (assistant rows).
  provider?: string;
  model?: string;
  provider_id?: string;
  attachment_ids?: string; // JSON array
  created_at: string;
}

export interface DashboardEntry {
  conversation_id: string;
  conversation_title: string;
  question: string;
  input_mode: 'voice' | 'text' | null;
  answer: string | null;
  last_message_at: string;
  tool_names: string | null;
}

export interface DashboardStats {
  conversations: number;
  toolExecutions: number;
  toolSuccessRate: number;
  lastActivityAt: string | null;
}

export interface MemoryFact {
  id: string;
  key: string;
  value: string;
  source: 'auto_learned' | 'user_added';
  created_at: string;
  updated_at: string;
}

export interface ToolExecution {
  id: string;
  message_id?: string | null;
  tool_name: string;
  parameters: Record<string, unknown>;
  permission_tier: 'auto' | 'confirm_required';
  status: 'pending' | 'confirmed' | 'denied' | 'success' | 'failed';
  result?: string;
  created_at: string;
}

export interface UserConfig {
  key: string;
  value: string;
}

export interface CloudSyncState {
  supabase_user_id: string;
  last_synced_at?: string;
  sync_enabled: boolean;
}

export interface VoiceProfile {
  id: string;
  label: string;
  embedding: Buffer;
  enrolled_at: string;
  updated_at: string;
}

export interface AutonomousModeConfig {
  enabled: boolean;
  tool_overrides: Record<string, 'auto' | 'confirm_required' | 'never'>;
  max_plan_steps: number;
  max_plan_duration_seconds: number;
}

export interface AgentPlan {
  id: string;
  conversation_id: string;
  goal: string;
  steps: unknown[];
  status:
    'planning' | 'in_progress' | 'completed' | 'stopped_by_limit' | 'stopped_by_user' | 'failed';
  created_at: string;
  completed_at?: string;
}

// Attachments
export interface Attachment {
  id: string;
  conversation_id: string;
  original_path: string;
  display_name: string;
  kind: 'file' | 'folder';
  size_bytes: number;
  ingested_content_summary?: string;
  created_at: string;
}

// N-02: installed community/shared agent bundle.
export interface InstalledAgent {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string | null;
  system_prompt: string;
  manifest_json: string;
  tool_decisions_json: string;
  active: boolean;
  installed_at: string;
}

// N-03: installed third-party plugin.
export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  author?: string | null;
  description: string;
  entry: string;
  plugin_dir: string;
  manifest_json: string;
  tool_decisions_json: string;
  active: boolean;
  installed_at: string;
}

// N-05: recurring scheduled commands.
export interface ScheduledTask {
  id: string;
  name: string;
  schedule: string;
  command: string;
  enabled: boolean;
  conversation_id?: string | null;
  last_run_at?: string | null;
  last_status?: 'running' | 'success' | 'failed' | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduledTaskInput {
  name: string;
  schedule: string;
  command: string;
  enabled: boolean;
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const userDataPath = app.getPath('userData');
  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true });
  }

  const dbPath = join(userDataPath, DB_NAME);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  ensureAutonomousModeConfig(db);

  return db;
}

function runMigrations(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const appliedMigrations = new Set(
    (database.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map(r => r.name)
  );

  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    if (!appliedMigrations.has(file)) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
      database.exec(sql);
      database.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
      console.log(`[DB] Applied migration: ${file}`);
    }
  }
}

function ensureAutonomousModeConfig(database: Database.Database) {
  const existing = database.prepare('SELECT * FROM autonomous_mode_config').get();
  if (!existing) {
    database
      .prepare(
        `
      INSERT INTO autonomous_mode_config (enabled, tool_overrides, max_plan_steps, max_plan_duration_seconds)
      VALUES (0, '{}', 10, 300)
    `
      )
      .run();
  }
}

// Conversations
export const conversations = {
  create: (title: string) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `
      INSERT INTO conversations (id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `
      )
      .run(id, title, now, now);
    return { id, title, created_at: now, updated_at: now };
  },

  getAll: (): Conversation[] => {
    return getDb()
      .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
      .all() as Conversation[];
  },

  getById: (id: string): Conversation | undefined => {
    return getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
      Conversation | undefined;
  },

  updateTitle: (id: string, title: string) => {
    const now = new Date().toISOString();
    getDb()
      .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, now, id);
  },

  delete: (id: string) => {
    getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id);
  },
};

// Messages
export const messages = {
  create: (msg: Omit<Message, 'created_at'>) => {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `
      INSERT INTO messages (id, conversation_id, role, content, input_mode, output_mode, provider, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        msg.id,
        msg.conversation_id,
        msg.role,
        msg.content,
        msg.input_mode,
        msg.output_mode,
        msg.provider ?? null,
        msg.model ?? null,
        now
      );
    return { ...msg, created_at: now };
  },

  getByConversation: (conversationId: string): Message[] => {
    return getDb()
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(conversationId) as Message[];
  },

  getRecent: (limit = 50): Message[] => {
    return getDb()
      .prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Message[];
  },

  deleteByConversation: (conversationId: string) => {
    getDb().prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
  },

  // T-22: real dashboard stats sourced straight from the local tables — no
  // fabricated numbers or trend badges that history can't back up.
  getStats: (): DashboardStats => {
    const db = getDb();
    const conversations =
      (db
        .prepare(
          `
          SELECT COUNT(*) AS c FROM conversations c
          WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
          `
        )
        .get() as { c: number }).c ?? 0;
    const toolExecutions =
      (db.prepare('SELECT COUNT(*) AS c FROM tool_executions').get() as { c: number }).c ?? 0;
    const succeeded =
      (db
        .prepare("SELECT COUNT(*) AS c FROM tool_executions WHERE status = 'success'")
        .get() as { c: number }).c ?? 0;
    const last = db
      .prepare(
        `
        SELECT MAX(ts) AS ts FROM (
          SELECT created_at AS ts FROM messages
          UNION ALL
          SELECT created_at AS ts FROM tool_executions
        )
        `
      )
      .get() as { ts: string | null };

    return {
      conversations,
      toolExecutions,
      toolSuccessRate:
        toolExecutions > 0 ? Math.round((succeeded / toolExecutions) * 1000) / 10 : 0,
      lastActivityAt: last?.ts ?? null,
    };
  },

  getConversationSummaries: (limit = 50, offset = 0): DashboardEntry[] => {
    const rows = getDb()
      .prepare(
        `
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
        `
      )
      .all(limit, offset) as DashboardEntry[];
    return rows;
  },

  searchConversationSummaries: (query: string): DashboardEntry[] => {
    const pattern = `%${query}%`;
    const rows = getDb()
      .prepare(
        `
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
        `
      )
      .all(pattern, pattern, pattern) as DashboardEntry[];
    return rows;
  },
};

// Memory Facts
export const memoryFacts = {
  getAll: (): MemoryFact[] => {
    return getDb().prepare('SELECT * FROM memory_facts ORDER BY key ASC').all() as MemoryFact[];
  },

  getByKey: (key: string): MemoryFact | undefined => {
    return getDb().prepare('SELECT * FROM memory_facts WHERE key = ?').get(key) as
      MemoryFact | undefined;
  },

  set: (key: string, value: string, source: 'auto_learned' | 'user_added' = 'user_added') => {
    const now = new Date().toISOString();
    const existing = memoryFacts.getByKey(key);
    if (existing) {
      getDb()
        .prepare('UPDATE memory_facts SET value = ?, source = ?, updated_at = ? WHERE key = ?')
        .run(value, source, now, key);
      return { ...existing, value, source, updated_at: now };
    } else {
      const id = crypto.randomUUID();
      getDb()
        .prepare(
          `
        INSERT INTO memory_facts (id, key, value, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
        )
        .run(id, key, value, source, now, now);
      return { id, key, value, source, created_at: now, updated_at: now };
    }
  },

  delete: (id: string) => {
    getDb().prepare('DELETE FROM memory_facts WHERE id = ?').run(id);
  },

  deleteByKey: (key: string) => {
    getDb().prepare('DELETE FROM memory_facts WHERE key = ?').run(key);
  },
};

// Tool Executions
export const toolExecutions = {
  create: (exec: Omit<ToolExecution, 'created_at'>) => {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `
      INSERT INTO tool_executions (id, message_id, tool_name, parameters, permission_tier, status, result, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        exec.id,
        exec.message_id ?? null,
        exec.tool_name,
        JSON.stringify(exec.parameters),
        exec.permission_tier,
        exec.status,
        exec.result ?? null,
        now
      );
    return { ...exec, created_at: now };
  },

  updateStatus: (id: string, status: ToolExecution['status'], result?: string) => {
    getDb()
      .prepare('UPDATE tool_executions SET status = ?, result = ? WHERE id = ?')
      .run(status, result ?? null, id);
  },

  getByMessageId: (messageId: string): ToolExecution[] => {
    const rows = getDb()
      .prepare('SELECT * FROM tool_executions WHERE message_id = ? ORDER BY created_at ASC')
      .all(messageId) as (ToolExecution & { parameters: string })[];
    return rows.map(r => ({ ...r, parameters: JSON.parse(r.parameters) }));
  },

  getAll: (limit = 100): ToolExecution[] => {
    const rows = getDb()
      .prepare('SELECT * FROM tool_executions ORDER BY created_at DESC LIMIT ?')
      .all(limit) as (ToolExecution & { parameters: string })[];
    return rows.map(r => ({ ...r, parameters: JSON.parse(r.parameters) }));
  },

  getByStatus: (status: ToolExecution['status']): ToolExecution[] => {
    const rows = getDb()
      .prepare('SELECT * FROM tool_executions WHERE status = ? ORDER BY created_at DESC')
      .all(status) as (ToolExecution & { parameters: string })[];
    return rows.map(r => ({ ...r, parameters: JSON.parse(r.parameters) }));
  },
};

// User Config (encrypted values stored as-is, encryption handled by caller)
export const userConfig = {
  get: (key: string): string | undefined => {
    const row = getDb().prepare('SELECT value FROM user_config WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value;
  },

  set: (key: string, value: string) => {
    getDb()
      .prepare('INSERT OR REPLACE INTO user_config (key, value) VALUES (?, ?)')
      .run(key, value);
  },

  getAll: (): Record<string, string> => {
    const rows = getDb().prepare('SELECT key, value FROM user_config').all() as {
      key: string;
      value: string;
    }[];
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  },

  delete: (key: string) => {
    getDb().prepare('DELETE FROM user_config WHERE key = ?').run(key);
  },
};

// Cloud Sync State
export const cloudSyncState = {
  get: (): CloudSyncState | undefined => {
    return getDb().prepare('SELECT * FROM cloud_sync_state LIMIT 1').get() as
      CloudSyncState | undefined;
  },

  set: (state: CloudSyncState) => {
    getDb()
      .prepare(
        `
      INSERT OR REPLACE INTO cloud_sync_state (supabase_user_id, last_synced_at, sync_enabled)
      VALUES (?, ?, ?)
    `
      )
      .run(state.supabase_user_id, state.last_synced_at ?? null, state.sync_enabled ? 1 : 0);
  },
};

// N-01: sync bookkeeping. Records which local rows have been pushed and when,
// plus a log of conflict resolutions (the discarded version is never dropped
// silently). Both are local-only helpers for cloud sync.
export interface SyncStateRow {
  table_name: string;
  row_id: string;
  last_modified: string;
  last_synced_at: string;
}

export interface SyncConflictRow {
  id: number;
  table_name: string;
  row_id: string;
  direction: 'local_won' | 'remote_won';
  discarded_json: string;
  resolved_at: string;
}

export const syncState = {
  upsert: (tableName: string, rowId: string, lastModified: string) => {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `
      INSERT INTO sync_state (table_name, row_id, last_modified, last_synced_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (table_name, row_id)
      DO UPDATE SET last_modified = ?, last_synced_at = ?
    `
      )
      .run(tableName, rowId, lastModified, now, lastModified, now);
  },

  getByTable: (tableName: string): SyncStateRow[] => {
    return getDb()
      .prepare(
        'SELECT * FROM sync_state WHERE table_name = ? ORDER BY last_modified ASC'
      )
      .all(tableName) as SyncStateRow[];
  },

  /** Rows in this table that have never been successfully pushed. */
  getUnsynced: (tableName: string): SyncStateRow[] => {
    return getDb()
      .prepare(
        'SELECT * FROM sync_state WHERE table_name = ?'
      )
      .all(tableName) as SyncStateRow[];
  },

  get: (tableName: string, rowId: string): SyncStateRow | undefined => {
    return getDb()
      .prepare('SELECT * FROM sync_state WHERE table_name = ? AND row_id = ?')
      .get(tableName, rowId) as SyncStateRow | undefined;
  },

  remove: (tableName: string, rowId: string) => {
    getDb()
      .prepare('DELETE FROM sync_state WHERE table_name = ? AND row_id = ?')
      .run(tableName, rowId);
  },

  clearTable: (tableName: string) => {
    getDb().prepare('DELETE FROM sync_state WHERE table_name = ?').run(tableName);
  },
};

export const syncConflicts = {
  log: (
    tableName: string,
    rowId: string,
    direction: 'local_won' | 'remote_won',
    discardedJson: string
  ) => {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `
      INSERT INTO sync_conflicts (table_name, row_id, direction, discarded_json, resolved_at)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(tableName, rowId, direction, discardedJson, now);
  },

  getAll: (limit = 100): SyncConflictRow[] => {
    return getDb()
      .prepare(
        'SELECT * FROM sync_conflicts ORDER BY resolved_at DESC LIMIT ?'
      )
      .all(limit) as SyncConflictRow[];
  },
};

// Voice Profiles
export const voiceProfiles = {
  create: (label: string, embedding: Buffer) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `
      INSERT INTO voice_profiles (id, label, embedding, enrolled_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(id, label, embedding, now, now);
    return { id, label, embedding, enrolled_at: now, updated_at: now };
  },

  getAll: (): VoiceProfile[] => {
    return getDb()
      .prepare('SELECT * FROM voice_profiles ORDER BY enrolled_at DESC')
      .all() as VoiceProfile[];
  },

  getById: (id: string): VoiceProfile | undefined => {
    return getDb().prepare('SELECT * FROM voice_profiles WHERE id = ?').get(id) as
      VoiceProfile | undefined;
  },

  update: (id: string, embedding: Buffer) => {
    const now = new Date().toISOString();
    getDb()
      .prepare('UPDATE voice_profiles SET embedding = ?, updated_at = ? WHERE id = ?')
      .run(embedding, now, id);
  },

  delete: (id: string) => {
    getDb().prepare('DELETE FROM voice_profiles WHERE id = ?').run(id);
  },

  deleteAll: () => {
    getDb().prepare('DELETE FROM voice_profiles').run();
  },
};

// Autonomous Mode Config
export const autonomousModeConfig = {
  get: (): AutonomousModeConfig => {
    const row = getDb().prepare('SELECT * FROM autonomous_mode_config LIMIT 1').get() as
      (AutonomousModeConfig & { tool_overrides: string }) | undefined;
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

  set: (config: Partial<AutonomousModeConfig>) => {
    const current = autonomousModeConfig.get();
    const merged = { ...current, ...config };
    getDb()
      .prepare(
        `
      UPDATE autonomous_mode_config
      SET enabled = ?, tool_overrides = ?, max_plan_steps = ?, max_plan_duration_seconds = ?
    `
      )
      .run(
        merged.enabled ? 1 : 0,
        JSON.stringify(merged.tool_overrides),
        merged.max_plan_steps,
        merged.max_plan_duration_seconds
      );
  },
};

// Agent Plans
export const agentPlans = {
  create: (plan: Omit<AgentPlan, 'created_at'>) => {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `
      INSERT INTO agent_plans (id, conversation_id, goal, steps, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(plan.id, plan.conversation_id, plan.goal, JSON.stringify(plan.steps), plan.status, now);
    return { ...plan, created_at: now };
  },

  updateStatus: (id: string, status: AgentPlan['status'], completedAt?: string) => {
    getDb()
      .prepare('UPDATE agent_plans SET status = ?, completed_at = ? WHERE id = ?')
      .run(status, completedAt ?? null, id);
  },

  getByConversation: (conversationId: string): AgentPlan[] => {
    const rows = getDb()
      .prepare('SELECT * FROM agent_plans WHERE conversation_id = ? ORDER BY created_at DESC')
      .all(conversationId) as (AgentPlan & { steps: string })[];
    return rows.map(r => ({ ...r, steps: JSON.parse(r.steps) }));
  },

  getById: (id: string): AgentPlan | undefined => {
    const row = getDb().prepare('SELECT * FROM agent_plans WHERE id = ?').get(id) as
      (AgentPlan & { steps: string }) | undefined;
    return row ? { ...row, steps: JSON.parse(row.steps) } : undefined;
  },

  getActive: (): AgentPlan | undefined => {
    const row = getDb()
      .prepare(
        `
      SELECT * FROM agent_plans
      WHERE status IN ('planning', 'in_progress')
      ORDER BY created_at DESC LIMIT 1
    `
      )
      .get() as (AgentPlan & { steps: string }) | undefined;
    return row ? { ...row, steps: JSON.parse(row.steps) } : undefined;
  },
};

// N-02: installed community/shared agent bundles.
export const installedAgents = {
  upsert: (agent: InstalledAgent) => {
    getDb()
      .prepare(
        `
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
    `
      )
      .run(
        agent.id,
        agent.name,
        agent.description,
        agent.version,
        agent.author ?? null,
        agent.system_prompt,
        agent.manifest_json,
        agent.tool_decisions_json,
        agent.active ? 1 : 0,
        agent.installed_at
      );
  },

  getAll: (): InstalledAgent[] => {
    return getDb()
      .prepare('SELECT * FROM installed_agents ORDER BY name ASC')
      .all() as InstalledAgent[];
  },

  getById: (id: string): InstalledAgent | undefined => {
    return getDb().prepare('SELECT * FROM installed_agents WHERE id = ?').get(id) as
      | InstalledAgent
      | undefined;
  },

  getActive: (): InstalledAgent | undefined => {
    return getDb().prepare('SELECT * FROM installed_agents WHERE active = 1').get() as
      | InstalledAgent
      | undefined;
  },

  setIsActive: (id: string, active: boolean) => {
    getDb().prepare('UPDATE installed_agents SET active = 0').run();
    if (active) {
      getDb().prepare('UPDATE installed_agents SET active = 1 WHERE id = ?').run(id);
    }
  },

  delete: (id: string) => {
    getDb().prepare('DELETE FROM installed_agents WHERE id = ?').run(id);
  },
};

// N-03: installed third-party plugins.
export const installedPlugins = {
  upsert: (plugin: InstalledPlugin) => {
    getDb()
      .prepare(
        `
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
    `
      )
      .run(
        plugin.id,
        plugin.name,
        plugin.version,
        plugin.author ?? null,
        plugin.description,
        plugin.entry,
        plugin.plugin_dir,
        plugin.manifest_json,
        plugin.tool_decisions_json,
        plugin.active ? 1 : 0,
        plugin.installed_at
      );
  },

  getAll: (): InstalledPlugin[] => {
    return getDb()
      .prepare('SELECT * FROM installed_plugins ORDER BY name ASC')
      .all() as InstalledPlugin[];
  },

  getById: (id: string): InstalledPlugin | undefined => {
    return getDb().prepare('SELECT * FROM installed_plugins WHERE id = ?').get(id) as
      | InstalledPlugin
      | undefined;
  },

  setActive: (id: string, active: boolean) => {
    getDb().prepare('UPDATE installed_plugins SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  },

  delete: (id: string) => {
    getDb().prepare('DELETE FROM installed_plugins WHERE id = ?').run(id);
  },
};

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// N-05: recurring scheduled commands.
const rowToScheduledTask = (row: Record<string, unknown>): ScheduledTask => ({
  id: row.id as string,
  name: row.name as string,
  schedule: row.schedule as string,
  command: row.command as string,
  enabled: Boolean(row.enabled),
  conversation_id: (row.conversation_id as string | null) ?? undefined,
  last_run_at: (row.last_run_at as string | null) ?? undefined,
  last_status: (row.last_status as ScheduledTask['last_status']) ?? undefined,
  last_error: (row.last_error as string | null) ?? undefined,
  created_at: row.created_at as string,
  updated_at: row.updated_at as string,
});

export const scheduledTasks = {
  create: (input: ScheduledTaskInput): ScheduledTask => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `
      INSERT INTO scheduled_tasks (id, name, schedule, command, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(id, input.name, input.schedule, input.command, input.enabled ? 1 : 0, now, now);
    const row = getDb().prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id);
    return rowToScheduledTask(row as Record<string, unknown>);
  },

  getAll: (): ScheduledTask[] => {
    return (
      getDb()
        .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at ASC')
        .all() as Record<string, unknown>[]
    ).map(rowToScheduledTask);
  },

  getById: (id: string): ScheduledTask | undefined => {
    const row = getDb().prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id);
    return row ? rowToScheduledTask(row as Record<string, unknown>) : undefined;
  },

  update: (id: string, patch: Partial<ScheduledTaskInput>): ScheduledTask | undefined => {
    const existing = scheduledTasks.getById(id);
    if (!existing) return undefined;
    const nextName = patch.name ?? existing.name;
    const nextSchedule = patch.schedule ?? existing.schedule;
    const nextCommand = patch.command ?? existing.command;
    const nextEnabled = patch.enabled ?? existing.enabled;
    getDb()
      .prepare(
        'UPDATE scheduled_tasks SET name = ?, schedule = ?, command = ?, enabled = ?, updated_at = ? WHERE id = ?'
      )
      .run(nextName, nextSchedule, nextCommand, nextEnabled ? 1 : 0, new Date().toISOString(), id);
    return scheduledTasks.getById(id);
  },

  setEnabled: (id: string, enabled: boolean): void => {
    getDb()
      .prepare('UPDATE scheduled_tasks SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, new Date().toISOString(), id);
  },

  setConversation: (id: string, conversationId: string): void => {
    getDb()
      .prepare('UPDATE scheduled_tasks SET conversation_id = ? WHERE id = ?')
      .run(conversationId, id);
  },

  setLastRun: (id: string, outcome: { status: ScheduledTask['last_status']; error?: string }): void => {
    getDb()
      .prepare(
        'UPDATE scheduled_tasks SET last_run_at = ?, last_status = ?, last_error = ? WHERE id = ?'
      )
      .run(new Date().toISOString(), outcome.status ?? null, outcome.error ?? null, id);
  },

  delete: (id: string): void => {
    getDb().prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
  },
};

// Attachments
export const attachments = {
  create: (attachment: Omit<Attachment, 'created_at'>) => {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `
      INSERT INTO attachments (id, conversation_id, original_path, display_name, kind, size_bytes, ingested_content_summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        attachment.id,
        attachment.conversation_id,
        attachment.original_path,
        attachment.display_name,
        attachment.kind,
        attachment.size_bytes,
        attachment.ingested_content_summary ?? null,
        now
      );
    return { ...attachment, created_at: now };
  },

  getByConversation: (conversationId: string): Attachment[] => {
    return getDb()
      .prepare('SELECT * FROM attachments WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(conversationId) as Attachment[];
  },

  getById: (id: string): Attachment | undefined => {
    return getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Attachment | undefined;
  },

  delete: (id: string) => {
    getDb().prepare('DELETE FROM attachments WHERE id = ?').run(id);
  },

  deleteByConversation: (conversationId: string) => {
    getDb().prepare('DELETE FROM attachments WHERE conversation_id = ?').run(conversationId);
  },
};
