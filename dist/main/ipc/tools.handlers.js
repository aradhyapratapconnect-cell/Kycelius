"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerToolsHandlers = registerToolsHandlers;
const electron_1 = require("electron");
const toolRegistry_1 = require("../tools/toolRegistry");
const permissionEngine_1 = require("../permissions/permissionEngine");
const db_1 = require("../db/db");
const settingsKeys_1 = require("../config/settingsKeys");
function notifyRenderer(confirmation) {
    // The dialog speaks the prompt itself only when voice confirmation is
    // disabled (click-only mode); otherwise the voice window owns the TTS read.
    const payload = {
        ...confirmation,
        voiceConfirmationEnabled: (0, settingsKeys_1.isVoiceConfirmationEnabled)(),
    };
    for (const win of electron_1.BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            win.webContents.send('kyclius:confirmation-required', payload);
        }
    }
}
function registerToolsHandlers() {
    (0, permissionEngine_1.installPermissionEngine)({ notify: notifyRenderer });
    // F-11: actually install the gate so confirm_required tools (and Autonomous
    // Mode's per-tool overrides) are enforced in production, not just in tests.
    (0, toolRegistry_1.setExecutionGate)(permissionEngine_1.permissionGate);
    // T-14: push every tool-execution status change to the renderer so the
    // history view updates in near-real-time without polling.
    (0, toolRegistry_1.setToolExecutionNotifier)(notice => {
        for (const win of electron_1.BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
                win.webContents.send('kyclius:tool-execution-update', notice);
            }
        }
    });
    electron_1.ipcMain.handle('kyclius:get-tool-history', async () => {
        return db_1.toolExecutions.getAll(100);
    });
    electron_1.ipcMain.handle('kyclius:get-available-tools', async () => {
        return (0, toolRegistry_1.getToolSchemas)();
    });
    electron_1.ipcMain.handle('kyclius:execute-tool', async (_event, toolCall) => {
        if (!toolCall || typeof toolCall.name !== 'string') {
            return { success: false, error: 'Malformed tool call: missing tool name' };
        }
        const result = await (0, toolRegistry_1.executeToolCall)(toolCall.name, toolCall.arguments);
        return result;
    });
    electron_1.ipcMain.handle('kyclius:respond-to-confirmation', async (_event, response) => {
        if (!response || typeof response.id !== 'string') {
            return false;
        }
        const { id, action, editedParams, reason } = response;
        return (0, permissionEngine_1.respondToConfirmation)(id, {
            action,
            editedParams,
            reason,
        });
    });
}
