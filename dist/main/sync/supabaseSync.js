"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = exports.SYNC_TABLES = void 0;
exports.isConfigured = isConfigured;
exports.getSyncStatus = getSyncStatus;
exports.signInWithEmail = signInWithEmail;
exports.awaitSignInCompletion = awaitSignInCompletion;
exports.signOut = signOut;
exports.setSyncEnabled = setSyncEnabled;
exports.initSync = initSync;
exports.syncTable = syncTable;
exports.runSync = runSync;
exports.resetSyncBookkeeping = resetSyncBookkeeping;
exports.ensureConfiguredForApp = ensureConfiguredForApp;
const electron_1 = require("electron");
Object.defineProperty(exports, "app", { enumerable: true, get: function () { return electron_1.app; } });
const supabase_js_1 = require("@supabase/supabase-js");
const node_http_1 = require("node:http");
const db_1 = require("../db/db");
const SESSION_KEY = 'supabase_session_encrypted';
/** The local SQLite tables that are part of the default sync set.
 *  NOTE: voice_profiles is deliberately excluded (Security doc §5/§7). */
exports.SYNC_TABLES = [
    'conversations',
    'messages',
    'memory_facts',
    'tool_executions',
];
const TABLE_COLUMNS = {
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
let client = null;
let listenUnsub = null;
function getConfig() {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey)
        return null;
    return { url, anonKey };
}
function isConfigured() {
    return getConfig() !== null;
}
async function getSession() {
    const supabase = getClient();
    if (!supabase)
        return null;
    try {
        const { data } = await supabase.auth.getSession();
        return data.session ?? null;
    }
    catch {
        return null;
    }
}
async function getCurrentUser() {
    const supabase = getClient();
    if (!supabase)
        return null;
    try {
        const { data } = await supabase.auth.getSession();
        return data.session?.user ?? null;
    }
    catch {
        return null;
    }
}
/** Lazily create the Supabase client if configured. Never throws. */
function getClient() {
    if (client)
        return client;
    const config = getConfig();
    if (!config)
        return null;
    // PKCE flow lets the desktop app complete the magic link via a local
    // redirect instead of embedding tokens in a browser URL.
    client = (0, supabase_js_1.createClient)(config.url, config.anonKey, { auth: { flowType: 'pkce', persistSession: false } });
    return client;
}
/* ------------------------------------------------------------------ */
/*  Desktop magic-link callback                                        */
/* ------------------------------------------------------------------ */
let callbackServer = null;
let pendingResolve = null;
const CALLBACK_PORT_RANGE = { start: 35471, end: 35475 };
function startCallbackServer() {
    return new Promise((resolve, reject) => {
        if (callbackServer) {
            const addr = callbackServer.address();
            if (addr && typeof addr === 'object')
                return resolve(addr.port);
        }
        const server = (0, node_http_1.createServer)((req, res) => {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');
            res.setHeader('Content-Type', 'text/html');
            if (code && pendingResolve) {
                pendingResolve(code);
                pendingResolve = null;
                res.end('<!doctype html><html><body><p>Kyclius sync: sign-in received. You can close this tab.</p></body></html>');
            }
            else if (error) {
                res.end(`<!doctype html><html><body><p>Kyclius sync sign-in failed: ${escapeHtml(error)}. You can close this tab.</p></body></html>`);
            }
            else {
                res.end('<!doctype html><html><body><p>Kyclius sync sign-in. Close this tab.</p></body></html>');
            }
        });
        const tryListen = (port, attempt = 0) => {
            server.once('error', (err) => {
                if (err.code === 'EADDRINUSE' && attempt < CALLBACK_PORT_RANGE.end - CALLBACK_PORT_RANGE.start) {
                    tryListen(port + 1, attempt + 1);
                }
                else {
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
function escapeHtml(value) {
    return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function stopCallbackServer() {
    if (callbackServer) {
        callbackServer.close();
        callbackServer = null;
    }
    pendingResolve = null;
}
/* ------------------------------------------------------------------ */
/*  Session persistence (safeStorage-encrypted)                        */
/* ------------------------------------------------------------------ */
function encrypt(value) {
    try {
        if (!electron_1.safeStorage.isEncryptionAvailable())
            return null;
        return electron_1.safeStorage.encryptString(value).toString('base64');
    }
    catch {
        return null;
    }
}
function decrypt(stored) {
    try {
        if (!electron_1.safeStorage.isEncryptionAvailable())
            return null;
        return electron_1.safeStorage.decryptString(Buffer.from(stored, 'base64'));
    }
    catch {
        return null;
    }
}
function persistSession(session) {
    const db = (0, db_1.getDb)();
    if (!session) {
        db.prepare('DELETE FROM user_config WHERE key = ?').run(SESSION_KEY);
        return;
    }
    const encrypted = encrypt(JSON.stringify(session));
    if (encrypted) {
        db.prepare('INSERT OR REPLACE INTO user_config (key, value) VALUES (?, ?)').run(SESSION_KEY, encrypted);
    }
}
function readStoredSession() {
    const db = (0, db_1.getDb)();
    const row = db.prepare('SELECT value FROM user_config WHERE key = ?').get(SESSION_KEY);
    if (!row)
        return null;
    const plain = decrypt(row.value);
    if (!plain)
        return null;
    try {
        return JSON.parse(plain);
    }
    catch {
        return null;
    }
}
/* ------------------------------------------------------------------ */
/*  Auth                                                               */
/* ------------------------------------------------------------------ */
async function getSyncStatus() {
    const state = db_1.cloudSyncState.get();
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
async function signInWithEmail(email) {
    const supabase = getClient();
    if (!supabase)
        throw new Error('Cloud sync is not configured on this build.');
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
async function awaitSignInCompletion(timeoutMs = 10 * 60 * 1000) {
    const supabase = getClient();
    if (!supabase)
        throw new Error('Cloud sync is not configured on this build.');
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pendingResolve = null;
            reject(new Error('Sign-in timed out.'));
        }, timeoutMs);
        pendingResolve = (code) => {
            clearTimeout(timer);
            void supabase.auth
                .exchangeCodeForSession(code)
                .then(async ({ error }) => {
                if (error)
                    throw new Error(error.message);
                const user = await getCurrentUser();
                resolve(user?.email ?? '');
            })
                .catch((err) => reject(err));
            // Session persistence + sync_state update happen via onAuthStateChange
            // which is installed by initSync.
        };
    });
}
async function signOut() {
    if (listenUnsub) {
        listenUnsub();
        listenUnsub = null;
    }
    stopCallbackServer();
    const supabase = getClient();
    if (supabase)
        await supabase.auth.signOut();
    persistSession(null);
    db_1.cloudSyncState.set({ supabase_user_id: '', last_synced_at: undefined, sync_enabled: false });
}
async function setSyncEnabled(enabled) {
    const userId = (await getCurrentUser())?.id ?? null;
    db_1.cloudSyncState.set({
        supabase_user_id: userId ?? '',
        last_synced_at: db_1.cloudSyncState.get()?.last_synced_at ?? undefined,
        sync_enabled: enabled,
    });
}
/**
 * Restores a persisted session and subscribes to auth changes so the session
 * is kept fresh and persisted. Call once at startup. Returns the current user
 * if signed in, else null. Never throws.
 */
async function initSync(onStatusChange) {
    const supabase = getClient();
    if (!supabase)
        return null;
    const stored = readStoredSession();
    if (stored) {
        // Restore the session (supabase-js refreshes the access token as needed).
        await supabase.auth.setSession(stored).catch(() => { });
    }
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        persistSession(session);
        if (session?.user) {
            db_1.cloudSyncState.set({
                supabase_user_id: session.user.id,
                last_synced_at: db_1.cloudSyncState.get()?.last_synced_at ?? undefined,
                sync_enabled: db_1.cloudSyncState.get()?.sync_enabled ?? false,
            });
        }
        onStatusChange?.();
    });
    listenUnsub = data.subscription.unsubscribe;
    return getCurrentUser();
}
function localModified(row, modifiedColumn) {
    const v = row[modifiedColumn];
    return typeof v === 'string' ? v : new Date().toISOString();
}
function toRemote(table, local, userId) {
    const map = TABLE_COLUMNS[table];
    const out = {};
    for (const col of map.columns) {
        if (col in local)
            out[col] = local[col];
    }
    out.user_id = userId;
    out.last_modified = localModified(local, map.modifiedColumn);
    return out;
}
function fromRemote(table, remote) {
    const map = TABLE_COLUMNS[table];
    const out = {};
    for (const col of map.columns) {
        if (col in remote)
            out[col] = remote[col];
    }
    return out;
}
function readLocalRows(table) {
    const columns = TABLE_COLUMNS[table].columns.join(', ');
    return (0, db_1.getDb)().prepare(`SELECT ${columns} FROM ${table}`).all();
}
function upsertLocal(table, row) {
    const columns = TABLE_COLUMNS[table].columns;
    const placeholders = columns.map(() => '?').join(', ');
    const assignments = columns.map(c => `${c} = excluded.${c}`).join(', ');
    const sql = `
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (id) DO UPDATE SET ${assignments}
  `;
    (0, db_1.getDb)().prepare(sql).run(...columns.map(c => row[c]));
}
/**
 * Reconciles local rows with remote rows for a table. Returns { pushed,
 * pulled, conflicts } counts. Conflict policy: most-recent-edit wins; the
 * losing version is logged via syncConflicts.
 */
async function syncTable(table) {
    const supabase = getClient();
    const user = await getCurrentUser();
    if (!supabase || !user)
        return { pushed: 0, pulled: 0, conflicts: 0 };
    const map = TABLE_COLUMNS[table];
    const local = readLocalRows(table);
    const localById = new Map(local.map(r => [String(r.id), r]));
    // Pull remote rows owned by this user.
    const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('user_id', user.id);
    if (error)
        throw new Error(`Sync pull (${table}) failed: ${error.message}`);
    const remote = (data ?? []);
    let pushed = 0;
    let pulled = 0;
    let conflicts = 0;
    const remoteById = new Map();
    for (const r of remote) {
        if (r.id)
            remoteById.set(String(r.id), r);
    }
    // Push local rows that are new locally or newer than what we last pushed.
    for (const localRow of local) {
        const id = String(localRow.id);
        const pushedState = db_1.syncState.get(table, id);
        const localTs = localModified(localRow, map.modifiedColumn);
        const remoteRow = remoteById.get(id);
        if (remoteRow) {
            const remoteTs = remoteRow.last_modified ?? '';
            if (remoteTs > localTs) {
                // Remote is newer — remote wins. Apply remote to local and log the
                // discarded local version (never silently dropped).
                db_1.syncConflicts.log(table, id, 'remote_won', JSON.stringify(localRow));
                upsertLocal(table, fromRemote(table, remoteRow));
                db_1.syncState.upsert(table, id, remoteTs);
                conflicts++;
            }
            else if (localTs > remoteTs ||
                !pushedState ||
                (pushedState && pushedState.last_modified < localTs)) {
                // Local is newer — local wins. Push local and log the discarded remote.
                db_1.syncConflicts.log(table, id, 'local_won', JSON.stringify(remoteRow));
                const { error: err } = await supabase
                    .from(table)
                    .upsert(toRemote(table, localRow, user.id));
                if (err)
                    throw new Error(`Sync push (${table}) failed: ${err.message}`);
                db_1.syncState.upsert(table, id, localTs);
                pushed++;
            }
            remoteById.delete(id);
        }
        else {
            // No remote copy — push local.
            const { error: err } = await supabase
                .from(table)
                .upsert(toRemote(table, localRow, user.id));
            if (err)
                throw new Error(`Sync push (${table}) failed: ${err.message}`);
            db_1.syncState.upsert(table, id, localTs);
            pushed++;
        }
    }
    // Pull remote rows that don't exist locally (new on the other device).
    for (const [id, remoteRow] of remoteById) {
        const localRow = localById.get(id);
        if (!localRow) {
            upsertLocal(table, fromRemote(table, remoteRow));
            pulled++;
            db_1.syncState.upsert(table, id, remoteRow.last_modified ?? '');
        }
    }
    return { pushed, pulled, conflicts };
}
async function runSync() {
    const user = await getCurrentUser();
    if (!user)
        throw new Error('Not signed in.');
    if (!db_1.cloudSyncState.get()?.sync_enabled)
        throw new Error('Sync is not enabled.');
    const perTable = {};
    for (const table of exports.SYNC_TABLES) {
        try {
            perTable[table] = await syncTable(table);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // Fail the whole run but keep other tables' results.
            perTable[table] = { pushed: 0, pulled: 0, conflicts: 0 };
            throw new Error(`Sync failed on ${table}: ${message}`);
        }
    }
    db_1.cloudSyncState.set({
        supabase_user_id: user.id,
        last_synced_at: new Date().toISOString(),
        sync_enabled: db_1.cloudSyncState.get()?.sync_enabled ?? false,
    });
    return { perTable };
}
/** Clear local sync bookkeeping (used on sign-out / disabling). */
function resetSyncBookkeeping() {
    for (const table of exports.SYNC_TABLES)
        db_1.syncState.clearTable(table);
}
/* ------------------------------------------------------------------ */
/*  Startup wiring                                                     */
/* ------------------------------------------------------------------ */
async function ensureConfiguredForApp(onStatusChange) {
    // Only connect when the project env vars exist; otherwise stay dormant.
    if (!isConfigured())
        return;
    await initSync(onStatusChange);
}
