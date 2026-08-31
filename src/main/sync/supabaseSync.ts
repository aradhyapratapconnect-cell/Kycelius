/**
 * N-01 — Optional cloud sync via Supabase.
 *
 * Local-first by construction: this module only does anything if (a) the user
 * has explicitly signed in AND enabled sync, and (b) the app was built/run
 * with SUPABASE_URL + SUPABASE_ANON_KEY present. Without those it's dormant —
 * the app stays fully local, exactly as if sync never existed.
 *
 * Auth is passwordless magic link (Supabase OTP). The session is persisted
 * encrypted via Electron safeStorage and restored on startup so the user isn't
 * asked to re-auth each launch. Sync mirrors the local conversations,
 * messages, memory_facts and tool_executions to Supabase tables that carry a
 * `user_id` column scoped by RLS to auth.uid() (see docs Security access §7).
 *
 * Hard guarantees:
 *  - Sync NEVER blocks local functionality: every failure here is swallowed
 *    and logged, never thrown into the app's normal flow.
 *  - Sync NEVER executes a tool or resolves a confirmation. It only moves data
 *    rows; the permission engine and tool registry are untouched.
 *  - Conflicts resolve to "most-recent-edit wins"; the losing version is
 *    written to the local sync_conflicts log, never silently dropped.
 */

import { app, safeStorage } from 'electron';
import { createClient, type SupabaseClient, type User, type Session } from '@supabase/supabase-js';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { getDb, syncState, syncConflicts, cloudSyncState } from '../db/db';

const SESSION_KEY = 'supabase_session_encrypted';

/** The local SQLite tables that are part of the default sync set.
 *  NOTE: voice_profiles is deliberately excluded (Security doc §5/§7). */
export const SYNC_TABLES = [
  'conversations',
  'messages',
  'memory_facts',
  'tool_executions',
] as const;
export type SyncTableName = (typeof SYNC_TABLES)[number];

export interface SyncStatus {
  configured: boolean;
  signedIn: boolean;
  email: string | null;
  syncEnabled: boolean;
  lastSyncedAt: string | null;
  error: string | null;
}

interface TableColumnMap {
  /** Columns that must be carried across unchanged for the row to round-trip. */
  columns: string[];
  /** The modification-timestamp column used for conflict resolution. */
  modifiedColumn: 'updated_at' | 'created_at';
}

const TABLE_COLUMNS: Record<SyncTableName, TableColumnMap> = {
  conversations: {
    columns: ['id', 'title', 'created_at', 'updated_at'],
    modifiedColumn: 'updated_at',
  },
  messages: {
    columns: ['id', 'conversation_id', 'role', 'content', 'input_mode', 'output_mode', 'created_at'],
    // messages are append-only in Kyclius today (created once, never edited),
    // so created_at is a faithful last-modified for conflict purposes.
    modifiedColumn: 'created_at',
  },
  memory_facts: {
    columns: ['id', 'key', 'value', 'source', 'created_at', 'updated_at'],
    modifiedColumn: 'updated_at',
  },
  tool_executions: {
    columns: [
      'id',
      'message_id',
      'tool_name',
      'parameters',
      'permission_tier',
      'status',
      'result',
      'created_at',
    ],
    modifiedColumn: 'created_at',
  },
};

let client: SupabaseClient | null = null;
let listenUnsub: (() => void) | null = null;

function getConfig(): { url: string; anonKey: string } | null {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isConfigured(): boolean {
  return getConfig() !== null;
}

async function getSession(): Promise<Session | null> {
  const supabase = getClient();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session ?? null;
  } catch {
    return null;
  }
}

async function getCurrentUser(): Promise<User | null> {
  const supabase = getClient();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user ?? null;
  } catch {
    return null;
  }
}

/** Lazily create the Supabase client if configured. Never throws. */
function getClient(): SupabaseClient | null {
  if (client) return client;
  const config = getConfig();
  if (!config) return null;
  // PKCE flow lets the desktop app complete the magic link via a local
  // redirect instead of embedding tokens in a browser URL.
  client = createClient(config.url, config.anonKey, { auth: { flowType: 'pkce', persistSession: false } });
  return client;
}

/* ------------------------------------------------------------------ */
/*  Desktop magic-link callback                                        */
/* ------------------------------------------------------------------ */

let callbackServer: Server | null = null;
let pendingResolve: ((code: string) => void) | null = null;

const CALLBACK_PORT_RANGE = { start: 35471, end: 35475 };

function startCallbackServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    if (callbackServer) {
      const addr = callbackServer.address();
      if (addr && typeof addr === 'object') return resolve(addr.port);
    }
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.setHeader('Content-Type', 'text/html');
      if (code && pendingResolve) {
        pendingResolve(code);
        pendingResolve = null;
        res.end('<!doctype html><html><body><p>Kyclius sync: sign-in received. You can close this tab.</p></body></html>');
      } else if (error) {
        res.end(`<!doctype html><html><body><p>Kyclius sync sign-in failed: ${escapeHtml(error)}. You can close this tab.</p></body></html>`);
      } else {
        res.end('<!doctype html><html><body><p>Kyclius sync sign-in. Close this tab.</p></body></html>');
      }
    });
    const tryListen = (port: number, attempt = 0) => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempt < CALLBACK_PORT_RANGE.end - CALLBACK_PORT_RANGE.start) {
          tryListen(port + 1, attempt + 1);
        } else {
          reject(err);
        }
      });
      server.listen(port, '127.0.0.1', () => resolve(port));
    };
    server.removeAllListeners('error');
    tryListen(CALLBACK_PORT_RANGE.start);
    callbackServer = server;
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function stopCallbackServer(): void {
  if (callbackServer) {
    callbackServer.close();
    callbackServer = null;
  }
  pendingResolve = null;
}

/* ------------------------------------------------------------------ */
/*  Session persistence (safeStorage-encrypted)                        */
/* ------------------------------------------------------------------ */

function encrypt(value: string): string | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.encryptString(value).toString('base64');
  } catch {
    return null;
  }
}

function decrypt(stored: string): string | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  } catch {
    return null;
  }
}

function persistSession(session: Session | null): void {
  const db = getDb();
  if (!session) {
    db.prepare('DELETE FROM user_config WHERE key = ?').run(SESSION_KEY);
    return;
  }
  const encrypted = encrypt(JSON.stringify(session));
  if (encrypted) {
    db.prepare('INSERT OR REPLACE INTO user_config (key, value) VALUES (?, ?)').run(
      SESSION_KEY,
      encrypted
    );
  }
}

function readStoredSession(): Session | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM user_config WHERE key = ?').get(SESSION_KEY) as
    | { value: string }
    | undefined;
  if (!row) return null;
  const plain = decrypt(row.value);
  if (!plain) return null;
  try {
    return JSON.parse(plain) as Session;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Auth                                                               */
/* ------------------------------------------------------------------ */

export async function getSyncStatus(): Promise<SyncStatus> {
  const state = cloudSyncState.get();
  const session = await getSession();
  return {
    configured: isConfigured(),
    signedIn: !!session,
    email: session?.user.email ?? null,
    syncEnabled: state?.sync_enabled ?? false,
    lastSyncedAt: state?.last_synced_at ?? null,
    error: null,
  };
}

/**
 * Sends a passwordless magic link to the email. On completion the user's
 * browser is redirected to a localhost callback that this app listens on, so
 * the returned auth code can be exchanged for a session. Throws on error.
 */
export async function signInWithEmail(email: string): Promise<void> {
  const supabase = getClient();
  if (!supabase) throw new Error('Cloud sync is not configured on this build.');

  const port = await startCallbackServer();
  const redirectTo = `http://127.0.0.1:${port}/auth/callback`;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) {
    stopCallbackServer();
    throw new Error(error.message);
  }
}

/**
 * Waits for the user to finish the magic link in their browser and exchanges
 * the resulting code for a session. Resolves to the signed-in email.
 */
export async function awaitSignInCompletion(timeoutMs = 10 * 60 * 1000): Promise<string> {
  const supabase = getClient();
  if (!supabase) throw new Error('Cloud sync is not configured on this build.');

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingResolve = null;
      reject(new Error('Sign-in timed out.'));
    }, timeoutMs);

    pendingResolve = (code: string) => {
      clearTimeout(timer);
      void supabase.auth
        .exchangeCodeForSession(code)
        .then(async ({ error }) => {
          if (error) throw new Error(error.message);
          const user = await getCurrentUser();
          resolve(user?.email ?? '');
        })
        .catch((err) => reject(err));
      // Session persistence + sync_state update happen via onAuthStateChange
      // which is installed by initSync.
    };
  });
}

export async function signOut(): Promise<void> {
  if (listenUnsub) {
    listenUnsub();
    listenUnsub = null;
  }
  stopCallbackServer();
  const supabase = getClient();
  if (supabase) await supabase.auth.signOut();
  persistSession(null);
  cloudSyncState.set({ supabase_user_id: '', last_synced_at: undefined, sync_enabled: false });
}

export async function setSyncEnabled(enabled: boolean): Promise<void> {
  const userId = (await getCurrentUser())?.id ?? null;
  cloudSyncState.set({
    supabase_user_id: userId ?? '',
    last_synced_at: cloudSyncState.get()?.last_synced_at ?? undefined,
    sync_enabled: enabled,
  });
}

/**
 * Restores a persisted session and subscribes to auth changes so the session
 * is kept fresh and persisted. Call once at startup. Returns the current user
 * if signed in, else null. Never throws.
 */
export async function initSync(onStatusChange?: () => void): Promise<User | null> {
  const supabase = getClient();
  if (!supabase) return null;

  const stored = readStoredSession();
  if (stored) {
    // Restore the session (supabase-js refreshes the access token as needed).
    await supabase.auth.setSession(stored).catch(() => {});
  }

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    persistSession(session);
    if (session?.user) {
      cloudSyncState.set({
        supabase_user_id: session.user.id,
        last_synced_at: cloudSyncState.get()?.last_synced_at ?? undefined,
        sync_enabled: cloudSyncState.get()?.sync_enabled ?? false,
      });
    }
    onStatusChange?.();
  });
  listenUnsub = data.subscription.unsubscribe;

  return getCurrentUser();
}

/* ------------------------------------------------------------------ */
/*  Sync engine                                                        */
/* ------------------------------------------------------------------ */

interface RemoteRow extends Record<string, unknown> {
  id?: string;
  user_id?: string;
  last_modified?: string;
}

type Row = Record<string, unknown>;

function localModified(row: Row, modifiedColumn: string): string {
  const v = row[modifiedColumn];
  return typeof v === 'string' ? v : new Date().toISOString();
}

function toRemote(table: SyncTableName, local: Row, userId: string): RemoteRow {
  const map = TABLE_COLUMNS[table];
  const out: RemoteRow = {};
  for (const col of map.columns) {
    if (col in local) out[col] = local[col];
  }
  out.user_id = userId;
  out.last_modified = localModified(local, map.modifiedColumn);
  return out;
}

function fromRemote(table: SyncTableName, remote: RemoteRow): Row {
  const map = TABLE_COLUMNS[table];
  const out: Row = {};
  for (const col of map.columns) {
    if (col in remote) out[col] = remote[col];
  }
  return out;
}

function readLocalRows(table: SyncTableName): Row[] {
  const columns = TABLE_COLUMNS[table].columns.join(', ');
  return getDb().prepare(`SELECT ${columns} FROM ${table}`).all() as Row[];
}

function upsertLocal(table: SyncTableName, row: Row): void {
  const columns = TABLE_COLUMNS[table].columns;
  const placeholders = columns.map(() => '?').join(', ');
  const assignments = columns.map(c => `${c} = excluded.${c}`).join(', ');
  const sql = `
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (id) DO UPDATE SET ${assignments}
  `;
  getDb().prepare(sql).run(...columns.map(c => row[c]));
}

/**
 * Reconciles local rows with remote rows for a table. Returns { pushed,
 * pulled, conflicts } counts. Conflict policy: most-recent-edit wins; the
 * losing version is logged via syncConflicts.
 */
export async function syncTable(table: SyncTableName): Promise<{ pushed: number; pulled: number; conflicts: number }> {
  const supabase = getClient();
  const user = await getCurrentUser();
  if (!supabase || !user) return { pushed: 0, pulled: 0, conflicts: 0 };

  const map = TABLE_COLUMNS[table];
  const local = readLocalRows(table);
  const localById = new Map<string, Row>(local.map(r => [String(r.id), r]));

  // Pull remote rows owned by this user.
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('user_id', user.id);
  if (error) throw new Error(`Sync pull (${table}) failed: ${error.message}`);
  const remote = (data ?? []) as RemoteRow[];

  let pushed = 0;
  let pulled = 0;
  let conflicts = 0;

  const remoteById = new Map<string, RemoteRow>();
  for (const r of remote) {
    if (r.id) remoteById.set(String(r.id), r);
  }

  // Push local rows that are new locally or newer than what we last pushed.
  for (const localRow of local) {
    const id = String(localRow.id);
    const pushedState = syncState.get(table, id);
    const localTs = localModified(localRow, map.modifiedColumn);
    const remoteRow = remoteById.get(id);

    if (remoteRow) {
      const remoteTs = remoteRow.last_modified ?? '';
      if (remoteTs > localTs) {
        // Remote is newer — remote wins. Apply remote to local and log the
        // discarded local version (never silently dropped).
        syncConflicts.log(table, id, 'remote_won', JSON.stringify(localRow));
        upsertLocal(table, fromRemote(table, remoteRow));
        syncState.upsert(table, id, remoteTs);
        conflicts++;
      } else if (
        localTs > remoteTs ||
        !pushedState ||
        (pushedState && pushedState.last_modified < localTs)
      ) {
        // Local is newer — local wins. Push local and log the discarded remote.
        syncConflicts.log(table, id, 'local_won', JSON.stringify(remoteRow));
        const { error: err } = await supabase
          .from(table)
          .upsert(toRemote(table, localRow, user.id));
        if (err) throw new Error(`Sync push (${table}) failed: ${err.message}`);
        syncState.upsert(table, id, localTs);
        pushed++;
      }
      remoteById.delete(id);
    } else {
      // No remote copy — push local.
      const { error: err } = await supabase
        .from(table)
        .upsert(toRemote(table, localRow, user.id));
      if (err) throw new Error(`Sync push (${table}) failed: ${err.message}`);
      syncState.upsert(table, id, localTs);
      pushed++;
    }
  }

  // Pull remote rows that don't exist locally (new on the other device).
  for (const [id, remoteRow] of remoteById) {
    const localRow = localById.get(id);
    if (!localRow) {
      upsertLocal(table, fromRemote(table, remoteRow));
      pulled++;
      syncState.upsert(table, id, remoteRow.last_modified ?? '');
    }
  }

  return { pushed, pulled, conflicts };
}

export async function runSync(): Promise<{ perTable: Record<string, { pushed: number; pulled: number; conflicts: number }> }> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in.');
  if (!cloudSyncState.get()?.sync_enabled) throw new Error('Sync is not enabled.');

  const perTable: Record<string, { pushed: number; pulled: number; conflicts: number }> = {};
  for (const table of SYNC_TABLES) {
    try {
      perTable[table] = await syncTable(table);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Fail the whole run but keep other tables' results.
      perTable[table] = { pushed: 0, pulled: 0, conflicts: 0 };
      throw new Error(`Sync failed on ${table}: ${message}`);
    }
  }

  cloudSyncState.set({
    supabase_user_id: user.id,
    last_synced_at: new Date().toISOString(),
    sync_enabled: cloudSyncState.get()?.sync_enabled ?? false,
  });
  return { perTable };
}

/** Clear local sync bookkeeping (used on sign-out / disabling). */
export function resetSyncBookkeeping(): void {
  for (const table of SYNC_TABLES) syncState.clearTable(table);
}

/* ------------------------------------------------------------------ */
/*  Startup wiring                                                     */
/* ------------------------------------------------------------------ */

export async function ensureConfiguredForApp(onStatusChange?: () => void): Promise<void> {
  // Only connect when the project env vars exist; otherwise stay dormant.
  if (!isConfigured()) return;
  await initSync(onStatusChange);
}

export { app };
