"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerFileHandlers = registerFileHandlers;
const electron_1 = require("electron");
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
}
