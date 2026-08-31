import { ipcMain } from 'electron';
import {
  encryptAndStoreGithubToken,
  hasGithubToken,
  removeGithubToken,
} from '../tools/github';

export function registerGithubHandlers() {
  ipcMain.handle('kyclius:set-github-token', async (_event, token: string) => {
    if (typeof token !== 'string' || token.trim().length === 0) {
      throw new Error('GitHub token must be a non-empty string');
    }
    // Surface safeStorage/key-vault failures as actionable messages instead
    // of a generic IPC rejection.
    encryptAndStoreGithubToken(token.trim());
  });

  ipcMain.handle('kyclius:has-github-token', async () => hasGithubToken());

  ipcMain.handle('kyclius:remove-github-token', async () => removeGithubToken());
}
