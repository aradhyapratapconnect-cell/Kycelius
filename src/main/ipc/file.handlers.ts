import { ipcMain, dialog } from 'electron';
import { ingestAttachment } from '../tools/attachFile';
import { getOrCreateActiveConversationId } from './chat.handlers';

export function registerFileHandlers() {
  ipcMain.handle('kyclius:show-open-dialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) {
      return undefined;
    }
    return result.filePaths;
  });

  /**
   * EF-11: direct attachment ingestion shared by the "+" picker and
   * drag-and-drop. Both renderer paths call this same handler (no LLM round
   * trip), so a Windows path that works in one works in the other, and
   * failures surface a specific error at attach time (Step 2).
   */
  ipcMain.handle('kyclius:attach-file', async (_event, rawPath: unknown) => {
    try {
      const conversationId = getOrCreateActiveConversationId(
        typeof rawPath === 'string' ? rawPath : 'New conversation'
      );
      const outcome = await ingestAttachment(rawPath, conversationId);
      if (!outcome.success) {
        return { ok: false as const, error: (outcome as { success: false; error: string }).error };
      }
      const attachment = (outcome as { success: true; attachment: import('../tools/attachFile').IngestedAttachment }).attachment;
      return {
        ok: true as const,
        attachment: {
          id: attachment.attachmentId,
          name: attachment.displayName,
          kind: attachment.kind,
          size: attachment.sizeBytes,
          path: attachment.path,
          summary: attachment.summary,
        },
      };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
