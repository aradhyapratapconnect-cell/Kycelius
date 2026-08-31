/**
 * N-01 — Optional cloud sync IPC surface.
 *
 * Every handler is safe to call when sync is unconfigured/logged out: the
 * underlying service stays dormant and these just report that state. No
 * handler ever throws into the app's core flow in a way that blocks local
 * functionality (failures return an error string the UI can show).
 */

import { ipcMain } from 'electron';
import {
  getSyncStatus,
  signInWithEmail,
  awaitSignInCompletion,
  signOut,
  setSyncEnabled,
  runSync,
  resetSyncBookkeeping,
  isConfigured,
} from '../sync/supabaseSync';
import { syncConflicts } from '../db/db';

export function registerSyncHandlers() {
  ipcMain.handle('kyclius:get-sync-status', async () => {
    return getSyncStatus();
  });

  ipcMain.handle('kyclius:sign-in', async (_event, email: string) => {
    if (typeof email !== 'string' || email.trim().length === 0) {
      throw new Error('A valid email is required.');
    }
    await signInWithEmail(email.trim().toLowerCase());
    return { sent: true };
  });

  ipcMain.handle('kyclius:await-sign-in-complete', async () => {
    const email = await awaitSignInCompletion();
    return { email };
  });

  ipcMain.handle('kyclius:sign-out', async () => {
    await signOut();
    resetSyncBookkeeping();
    return { signedOut: true };
  });

  ipcMain.handle('kyclius:set-sync-enabled', async (_event, enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid argument.');
    if (enabled && !isConfigured()) throw new Error('Cloud sync is not configured on this build.');
    setSyncEnabled(enabled);
    if (!enabled) resetSyncBookkeeping();
    return getSyncStatus();
  });

  ipcMain.handle('kyclius:sync-now', async () => {
    try {
      const result = await runSync();
      return { ok: true, ...result };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle('kyclius:get-sync-conflicts', async () => {
    return syncConflicts.getAll();
  });
}
