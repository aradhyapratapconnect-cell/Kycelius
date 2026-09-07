"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerFileHandlers = registerFileHandlers;
const electron_1 = require("electron");
const attachFile_1 = require("../tools/attachFile");
const chat_handlers_1 = require("./chat.handlers");
function registerFileHandlers() {
    electron_1.ipcMain.handle('kyclius:show-open-dialog', async () => {
        const result = await electron_1.dialog.showOpenDialog({
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
    electron_1.ipcMain.handle('kyclius:attach-file', async (_event, rawPath) => {
        try {
            const conversationId = (0, chat_handlers_1.getOrCreateActiveConversationId)(typeof rawPath === 'string' ? rawPath : 'New conversation');
            const outcome = await (0, attachFile_1.ingestAttachment)(rawPath, conversationId);
            if (!outcome.success) {
                return { ok: false, error: outcome.error };
            }
            const attachment = outcome.attachment;
            return {
                ok: true,
                attachment: {
                    id: attachment.attachmentId,
                    name: attachment.displayName,
                    kind: attachment.kind,
                    size: attachment.sizeBytes,
                    path: attachment.path,
                    summary: attachment.summary,
                },
            };
        }
        catch (err) {
            return {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    });
}
