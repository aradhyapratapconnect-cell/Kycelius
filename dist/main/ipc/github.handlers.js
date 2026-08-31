"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGithubHandlers = registerGithubHandlers;
const electron_1 = require("electron");
const github_1 = require("../tools/github");
function registerGithubHandlers() {
    electron_1.ipcMain.handle('kyclius:set-github-token', async (_event, token) => {
        if (typeof token !== 'string' || token.trim().length === 0) {
            throw new Error('GitHub token must be a non-empty string');
        }
        // Surface safeStorage/key-vault failures as actionable messages instead
        // of a generic IPC rejection.
        (0, github_1.encryptAndStoreGithubToken)(token.trim());
    });
    electron_1.ipcMain.handle('kyclius:has-github-token', async () => (0, github_1.hasGithubToken)());
    electron_1.ipcMain.handle('kyclius:remove-github-token', async () => (0, github_1.removeGithubToken)());
}
