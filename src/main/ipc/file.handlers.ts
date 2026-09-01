import { ipcMain, dialog } from 'electron';

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
}
