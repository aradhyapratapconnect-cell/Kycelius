"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPluginHandlers = registerPluginHandlers;
const electron_1 = require("electron");
const pluginManager_1 = require("../plugins/pluginManager");
// Source dirs selected but not yet confirmed, keyed by webContents id.
const pendingInstalls = new Map();
function registerPluginHandlers() {
    electron_1.ipcMain.handle('kyclius:list-plugins', async () => {
        return (0, pluginManager_1.listPlugins)();
    });
    // Step 1: pick a folder and get a disclosure preview.
    electron_1.ipcMain.handle('kyclius:preview-install-plugin', async (event) => {
        const win = electron_1.BrowserWindow.fromWebContents(event.sender);
        const openOptions = {
            title: 'Select a plugin folder',
            properties: ['openDirectory'],
        };
        const result = win
            ? await electron_1.dialog.showOpenDialog(win, openOptions)
            : await electron_1.dialog.showOpenDialog(openOptions);
        if (result.canceled || result.filePaths.length === 0) {
            return { canceled: true };
        }
        const sourceDir = result.filePaths[0];
        const { preview } = await (0, pluginManager_1.previewPluginFolder)(sourceDir);
        pendingInstalls.set(event.sender.id, { sourceDir, preview });
        return { canceled: false, preview, sourceName: sourceDir };
    });
    // Step 2: user reviewed the disclosures — confirm the install.
    electron_1.ipcMain.handle('kyclius:confirm-install-plugin', async (event, payload) => {
        const pending = pendingInstalls.get(event.sender.id);
        if (!pending) {
            throw new Error('No pending plugin install. Select a plugin folder first.');
        }
        const approvedAuto = Array.isArray(payload?.approvedAuto)
            ? payload.approvedAuto.map(String)
            : [];
        try {
            const plugin = await (0, pluginManager_1.installPluginFromFolder)(pending.sourceDir, approvedAuto);
            return { installed: true, pluginId: plugin.id };
        }
        finally {
            pendingInstalls.delete(event.sender.id);
        }
    });
    electron_1.ipcMain.handle('kyclius:uninstall-plugin', async (_event, id) => {
        await (0, pluginManager_1.uninstallPlugin)(String(id));
        return { removed: true };
    });
    electron_1.ipcMain.handle('kyclius:set-plugin-active', async (_event, id, active) => {
        await (0, pluginManager_1.setPluginActive)(String(id), Boolean(active));
    });
}
