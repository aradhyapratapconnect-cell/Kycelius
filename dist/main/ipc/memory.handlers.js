"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMemoryHandlers = registerMemoryHandlers;
const electron_1 = require("electron");
const memoryService_1 = require("../memory/memoryService");
function registerMemoryHandlers() {
    electron_1.ipcMain.handle('kyclius:get-memory', async () => {
        return (0, memoryService_1.listFacts)();
    });
    // Upsert by key. Editing an existing fact keeps its original source
    // (an auto_learned fact stays auto_learned); only brand-new keys are
    // tagged user_added, so manual adds and corrections stay distinguishable.
    electron_1.ipcMain.handle('kyclius:set-memory-fact', (_event, key, value) => {
        try {
            if (typeof key !== 'string' || typeof value !== 'string') {
                return { success: false, error: 'Both a key and a value are required.' };
            }
            const existing = (0, memoryService_1.getFact)(key);
            const fact = (0, memoryService_1.setFact)(key, value, existing ? existing.source : 'user_added');
            if (!fact) {
                return {
                    success: false,
                    error: 'Could not save that fact — keys must be under 60 characters and values under 200.',
                };
            }
            return { success: true, fact };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: `Could not save the fact: ${message}` };
        }
    });
    electron_1.ipcMain.handle('kyclius:delete-memory-fact', (_event, id) => {
        try {
            if (typeof id !== 'string' || id.trim().length === 0) {
                return { success: false, error: 'A fact id is required to delete it.' };
            }
            (0, memoryService_1.deleteFact)(id);
            return { success: true };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: `Could not delete the fact: ${message}` };
        }
    });
}
