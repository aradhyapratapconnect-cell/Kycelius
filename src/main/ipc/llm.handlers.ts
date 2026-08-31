import { ipcMain } from 'electron';
import { llmRouter } from '../llm/llmRouter';
import { isProviderId } from '../llm/providerConfig';

export function registerLLMHandlers() {
  ipcMain.handle('kyclius:get-llm-provider', async () => {
    await llmRouter.initialize();
    return llmRouter.getActiveProviderName();
  });

  ipcMain.handle('kyclius:set-llm-provider', async (_event, provider: string) => {
    llmRouter.setActiveProvider(provider);
  });

  ipcMain.handle('kyclius:get-llm-model', async (_event, provider: string) => {
    return llmRouter.getModel(provider);
  });

  ipcMain.handle('kyclius:set-llm-model', async (_event, provider: string, model: string) => {
    if (!isProviderId(provider)) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    if (typeof model !== 'string') {
      throw new Error('Model ID must be a string');
    }
    llmRouter.setModel(provider, model);
  });

  ipcMain.handle('kyclius:validate-llm-key', async (_event, provider: string, apiKey: string) => {
    try {
      return await llmRouter.validateProviderKey(provider, apiKey);
    } catch {
      return false;
    }
  });

  ipcMain.handle('kyclius:set-llm-api-key', async (_event, provider: string, apiKey: string) => {
    // Surface safeStorage/key-vault failures as actionable messages instead
    // of a generic IPC rejection.
    await llmRouter.setApiKey(provider, apiKey);
  });

  ipcMain.handle('kyclius:has-llm-api-key', async (_event, provider: string) => {
    return llmRouter.hasApiKey(provider);
  });

  // N-04: rule-based routing config (Settings > AI Providers > Model routing).
  ipcMain.handle('kyclius:get-llm-routing-config', async () => {
    return llmRouter.getRoutingConfig();
  });

  ipcMain.handle(
    'kyclius:set-llm-routing-config',
    async (_event, config: { enabled?: boolean; rules?: unknown[] }) => {
      const payload = config && typeof config === 'object' ? config : {};
      if (payload.enabled !== undefined) {
        llmRouter.setRoutingEnabled(Boolean(payload.enabled));
      }
      if (payload.rules !== undefined) {
        // Sanitize on the router side too, so bad renderer payloads can't
        // persist (e.g. rule regex that doesn't compile).
        llmRouter.setRoutingRules(payload.rules);
      }
      return llmRouter.getRoutingConfig();
    }
  );
}
