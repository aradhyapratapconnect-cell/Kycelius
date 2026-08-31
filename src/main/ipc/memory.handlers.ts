import { ipcMain } from 'electron';
import type { MemoryFact } from '../db/db';
import { deleteFact, getFact, listFacts, setFact } from '../memory/memoryService';

// Mirrors `MemoryMutationResult` from @shared/types/ipc.ts. Kept structural
// because tsconfig.main.json's rootDir forbids importing across trees; the
// shapes must stay in sync.
export interface MemoryMutationResult {
  success: boolean;
  fact?: MemoryFact;
  error?: string;
}

export function registerMemoryHandlers() {
  ipcMain.handle('kyclius:get-memory', async () => {
    return listFacts();
  });

  // Upsert by key. Editing an existing fact keeps its original source
  // (an auto_learned fact stays auto_learned); only brand-new keys are
  // tagged user_added, so manual adds and corrections stay distinguishable.
  ipcMain.handle(
    'kyclius:set-memory-fact',
    (_event, key: unknown, value: unknown): MemoryMutationResult => {
      try {
        if (typeof key !== 'string' || typeof value !== 'string') {
          return { success: false, error: 'Both a key and a value are required.' };
        }
        const existing = getFact(key);
        const fact = setFact(key, value, existing ? existing.source : 'user_added');
        if (!fact) {
          return {
            success: false,
            error: 'Could not save that fact — keys must be under 60 characters and values under 200.',
          };
        }
        return { success: true, fact };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: `Could not save the fact: ${message}` };
      }
    }
  );

  ipcMain.handle('kyclius:delete-memory-fact', (_event, id: unknown): MemoryMutationResult => {
    try {
      if (typeof id !== 'string' || id.trim().length === 0) {
        return { success: false, error: 'A fact id is required to delete it.' };
      }
      deleteFact(id);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Could not delete the fact: ${message}` };
    }
  });
}
