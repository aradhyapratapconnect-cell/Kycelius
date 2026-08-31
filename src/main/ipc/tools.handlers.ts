import { ipcMain, BrowserWindow } from 'electron';
import {
  getToolSchemas,
  executeToolCall,
  setExecutionGate,
  setToolExecutionNotifier,
  type ToolCall,
} from '../tools/toolRegistry';
import {
  installPermissionEngine,
  permissionGate,
  respondToConfirmation,
  type PendingConfirmationNotice,
} from '../permissions/permissionEngine';
import type { ConfirmationResponse } from '../permissions/confirmationQueue';
import { toolExecutions } from '../db/db';
import { isVoiceConfirmationEnabled } from '../config/settingsKeys';

function notifyRenderer(confirmation: PendingConfirmationNotice): void {
  // The dialog speaks the prompt itself only when voice confirmation is
  // disabled (click-only mode); otherwise the voice window owns the TTS read.
  const payload = {
    ...confirmation,
    voiceConfirmationEnabled: isVoiceConfirmationEnabled(),
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('kyclius:confirmation-required', payload);
    }
  }
}

export function registerToolsHandlers() {
  installPermissionEngine({ notify: notifyRenderer });
  // F-11: actually install the gate so confirm_required tools (and Autonomous
  // Mode's per-tool overrides) are enforced in production, not just in tests.
  setExecutionGate(permissionGate);
  // T-14: push every tool-execution status change to the renderer so the
  // history view updates in near-real-time without polling.
  setToolExecutionNotifier(notice => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('kyclius:tool-execution-update', notice);
      }
    }
  });

  ipcMain.handle('kyclius:get-tool-history', async () => {
    return toolExecutions.getAll(100);
  });

  ipcMain.handle('kyclius:get-available-tools', async () => {
    return getToolSchemas();
  });

  ipcMain.handle('kyclius:execute-tool', async (_event, toolCall: ToolCall) => {
    if (!toolCall || typeof toolCall.name !== 'string') {
      return { success: false, error: 'Malformed tool call: missing tool name' };
    }
    const result = await executeToolCall(toolCall.name, toolCall.arguments);
    return result;
  });

  ipcMain.handle(
    'kyclius:respond-to-confirmation',
    async (_event, response: ConfirmationResponse & { id?: string }) => {
      if (!response || typeof response.id !== 'string') {
        return false;
      }
      const { id, action, editedParams, reason } = response;
      return respondToConfirmation(id, {
        action,
        editedParams,
        reason,
      });
    }
  );
}
