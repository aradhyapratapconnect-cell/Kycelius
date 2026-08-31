"use strict";
/**
 * N-01 — Optional cloud sync IPC surface.
 *
 * Every handler is safe to call when sync is unconfigured/logged out: the
 * underlying service stays dormant and these just report that state. No
 * handler ever throws into the app's core flow in a way that blocks local
 * functionality (failures return an error string the UI can show).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSyncHandlers = registerSyncHandlers;
const electron_1 = require("electron");
const supabaseSync_1 = require("../sync/supabaseSync");
const db_1 = require("../db/db");
function registerSyncHandlers() {
    electron_1.ipcMain.handle('kyclius:get-sync-status', async () => {
        return (0, supabaseSync_1.getSyncStatus)();
    });
    electron_1.ipcMain.handle('kyclius:sign-in', async (_event, email) => {
        if (typeof email !== 'string' || email.trim().length === 0) {
            throw new Error('A valid email is required.');
        }
        await (0, supabaseSync_1.signInWithEmail)(email.trim().toLowerCase());
        return { sent: true };
    });
    electron_1.ipcMain.handle('kyclius:await-sign-in-complete', async () => {
        const email = await (0, supabaseSync_1.awaitSignInCompletion)();
        return { email };
    });
    electron_1.ipcMain.handle('kyclius:sign-out', async () => {
        await (0, supabaseSync_1.signOut)();
        (0, supabaseSync_1.resetSyncBookkeeping)();
        return { signedOut: true };
    });
    electron_1.ipcMain.handle('kyclius:set-sync-enabled', async (_event, enabled) => {
        if (typeof enabled !== 'boolean')
            throw new Error('Invalid argument.');
        if (enabled && !(0, supabaseSync_1.isConfigured)())
            throw new Error('Cloud sync is not configured on this build.');
        (0, supabaseSync_1.setSyncEnabled)(enabled);
        if (!enabled)
            (0, supabaseSync_1.resetSyncBookkeeping)();
        return (0, supabaseSync_1.getSyncStatus)();
    });
    electron_1.ipcMain.handle('kyclius:sync-now', async () => {
        try {
            const result = await (0, supabaseSync_1.runSync)();
            return { ok: true, ...result };
        }
        catch (err) {
            return {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    });
    electron_1.ipcMain.handle('kyclius:get-sync-conflicts', async () => {
        return db_1.syncConflicts.getAll();
    });
}
