/**
 * N-07 — provider registry IPC.
 *
 * Exposes the `providers` table (list/add/update/remove) plus key management
 * and model discovery. Keys never cross the bridge: the UI only ever sees
 * `hasKey` / `isDefault` flags and can write a key (write-only) or clear it.
 */

import { ipcMain } from 'electron';
import { providerRegistry } from '../llm/providerRegistry';
import { buildLlmProvider } from '../llm/llmRouter';

function assertKnownProvider(id: string): void {
  if (!providerRegistry.isKnownProvider(id)) {
    throw new Error(`Unknown provider id: ${id}`);
  }
}

/** Shared URL guard: only http(s) endpoints may be wired up as a base URL. */
function assertValidBaseUrl(baseUrl?: string): void {
  if (!baseUrl || baseUrl.trim().length === 0) return;
  if (!/^https?:\/\/.+/i.test(baseUrl.trim())) {
    throw new Error('Base URL must start with https:// (or http://).');
  }
}

export function registerProviderHandlers(): void {
  ipcMain.handle('kyclius:list-providers', (_event, capability?: 'llm' | 'stt' | 'tts') => {
    providerRegistry.init();
    const rows = capability === 'llm' || capability === 'stt' || capability === 'tts'
      ? providerRegistry.list(capability)
      : providerRegistry.list();
    return rows;
  });

  ipcMain.handle('kyclius:list-provider-presets', (_event, capability?: 'llm' | 'stt' | 'tts') => {
    return providerRegistry.listPresets(capability);
  });

  ipcMain.handle('kyclius:add-provider', (_event, input) => {
    providerRegistry.init();
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid provider payload.');
    }
    assertValidBaseUrl(input.baseUrl);
    return providerRegistry.add(input);
  });

  ipcMain.handle('kyclius:update-provider', (_event, id: string, patch) => {
    providerRegistry.init();
    assertKnownProvider(id);
    if (patch?.baseUrl !== undefined) assertValidBaseUrl(patch.baseUrl);
    return providerRegistry.update(id, patch ?? {});
  });

  ipcMain.handle('kyclius:remove-provider', (_event, id: string) => {
    providerRegistry.init();
    assertKnownProvider(id);
    providerRegistry.remove(id);
    return { removed: true };
  });

  ipcMain.handle('kyclius:delete-provider-api-key', (_event, id: string) => {
    providerRegistry.init();
    assertKnownProvider(id);
    providerRegistry.removeApiKey(id);
  });

  ipcMain.handle('kyclius:list-provider-models', async (_event, id: string) => {
    providerRegistry.init();
    assertKnownProvider(id);
    // Model discovery is an LLM-only concept; voice providers have no /models
    // listing (the picker falls back to a manual text field).
    if (providerRegistry.get(id)?.capability !== 'llm') {
      return [];
    }
    const llm = providerRegistry.materializeLlmProvider(id, buildLlmProvider);
    if (typeof (llm as { listModels?: () => Promise<string[]> }).listModels !== 'function') {
      return [];
    }
    return (llm as { listModels: () => Promise<string[]> }).listModels();
  });

  // N-08: capability-aware active default. The LLM surface reuses this too;
  // rows keep their legacy getLLMProvider alias so older callers stay stable.
  ipcMain.handle('kyclius:get-active-provider', (_event, capability: 'llm' | 'stt' | 'tts') => {
    providerRegistry.init();
    const cap = capability === 'stt' || capability === 'tts' ? capability : 'llm';
    return providerRegistry.getDefaultProviderId(cap);
  });

  ipcMain.handle('kyclius:set-active-provider', (_event, capability, id: string) => {
    providerRegistry.init();
    const cap = capability === 'stt' || capability === 'tts' ? capability : 'llm';
    if (!providerRegistry.isKnownProvider(id, cap)) {
      throw new Error(`Unknown ${cap} provider: ${id}`);
    }
    providerRegistry.setDefaultProvider(id);
  });

  // N-08: write-only key save that works for ANY provider row (LLM, cloud STT,
  // cloud TTS). Only ever touches the encrypted vault; the plaintext key never
  // crosses back to the renderer and never reaches a log.
  ipcMain.handle('kyclius:set-provider-api-key', (_event, id: string, apiKey: string) => {
    providerRegistry.init();
    assertKnownProvider(id);
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new Error('API key must not be empty.');
    }
    providerRegistry.setApiKey(id, apiKey);
  });
}