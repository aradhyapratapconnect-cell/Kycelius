/**
 * N-03 — Plugin IPC surface.
 *
 * Install is a two-step, main-process-driven flow like agent import:
 *   1. preview-install-plugin — native folder picker; the selected source dir
 *      is remembered IN THE MAIN PROCESS (never trusted from the renderer),
 *      then plugin.json is validated and a sandboxed "inspect" child reports
 *      the self-declared tool defs for the review screen.
 *   2. confirm-install-plugin — the source dir is re-read from main memory,
 *      the folder is copied under userData and its tools registered.
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import {
  previewPluginFolder,
  installPluginFromFolder,
  uninstallPlugin,
  setPluginActive,
  listPlugins,
} from '../plugins/pluginManager';
import type { PluginInstallPreview } from '../plugins/manifest';

// Source dirs selected but not yet confirmed, keyed by webContents id.
const pendingInstalls = new Map<number, { sourceDir: string; preview: PluginInstallPreview }>();

export function registerPluginHandlers() {
  ipcMain.handle('kyclius:list-plugins', async () => {
    return listPlugins();
  });

  // Step 1: pick a folder and get a disclosure preview.
  ipcMain.handle('kyclius:preview-install-plugin', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const openOptions: Electron.OpenDialogOptions = {
      title: 'Select a plugin folder',
      properties: ['openDirectory'],
    };
    const result = win
      ? await dialog.showOpenDialog(win, openOptions)
      : await dialog.showOpenDialog(openOptions);
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true } as const;
    }
    const sourceDir = result.filePaths[0];
    const { preview } = await previewPluginFolder(sourceDir);
    pendingInstalls.set(event.sender.id, { sourceDir, preview });
    return { canceled: false as const, preview, sourceName: sourceDir };
  });

  // Step 2: user reviewed the disclosures — confirm the install.
  ipcMain.handle('kyclius:confirm-install-plugin', async (event, payload) => {
    const pending = pendingInstalls.get(event.sender.id);
    if (!pending) {
      throw new Error('No pending plugin install. Select a plugin folder first.');
    }
    const approvedAuto = Array.isArray(payload?.approvedAuto)
      ? payload.approvedAuto.map(String)
      : [];
    try {
      const plugin = await installPluginFromFolder(pending.sourceDir, approvedAuto);
      return { installed: true, pluginId: plugin.id };
    } finally {
      pendingInstalls.delete(event.sender.id);
    }
  });

  ipcMain.handle('kyclius:uninstall-plugin', async (_event, id: string) => {
    await uninstallPlugin(String(id));
    return { removed: true };
  });

  ipcMain.handle('kyclius:set-plugin-active', async (_event, id: string, active: boolean) => {
    await setPluginActive(String(id), Boolean(active));
  });
}