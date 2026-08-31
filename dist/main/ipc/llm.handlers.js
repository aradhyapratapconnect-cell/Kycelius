"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLLMHandlers = registerLLMHandlers;
const electron_1 = require("electron");
const llmRouter_1 = require("../llm/llmRouter");
const providerConfig_1 = require("../llm/providerConfig");
function registerLLMHandlers() {
    electron_1.ipcMain.handle('kyclius:get-llm-provider', async () => {
        await llmRouter_1.llmRouter.initialize();
        return llmRouter_1.llmRouter.getActiveProviderName();
    });
    electron_1.ipcMain.handle('kyclius:set-llm-provider', async (_event, provider) => {
        llmRouter_1.llmRouter.setActiveProvider(provider);
    });
    electron_1.ipcMain.handle('kyclius:get-llm-model', async (_event, provider) => {
        return llmRouter_1.llmRouter.getModel(provider);
    });
    electron_1.ipcMain.handle('kyclius:set-llm-model', async (_event, provider, model) => {
        if (!(0, providerConfig_1.isProviderId)(provider)) {
            throw new Error(`Unknown provider: ${provider}`);
        }
        if (typeof model !== 'string') {
            throw new Error('Model ID must be a string');
        }
        llmRouter_1.llmRouter.setModel(provider, model);
    });
    electron_1.ipcMain.handle('kyclius:validate-llm-key', async (_event, provider, apiKey) => {
        try {
            return await llmRouter_1.llmRouter.validateProviderKey(provider, apiKey);
        }
        catch {
            return false;
        }
    });
    electron_1.ipcMain.handle('kyclius:set-llm-api-key', async (_event, provider, apiKey) => {
        // Surface safeStorage/key-vault failures as actionable messages instead
        // of a generic IPC rejection.
        await llmRouter_1.llmRouter.setApiKey(provider, apiKey);
    });
    electron_1.ipcMain.handle('kyclius:has-llm-api-key', async (_event, provider) => {
        return llmRouter_1.llmRouter.hasApiKey(provider);
    });
    // N-04: rule-based routing config (Settings > AI Providers > Model routing).
    electron_1.ipcMain.handle('kyclius:get-llm-routing-config', async () => {
        return llmRouter_1.llmRouter.getRoutingConfig();
    });
    electron_1.ipcMain.handle('kyclius:set-llm-routing-config', async (_event, config) => {
        const payload = config && typeof config === 'object' ? config : {};
        if (payload.enabled !== undefined) {
            llmRouter_1.llmRouter.setRoutingEnabled(Boolean(payload.enabled));
        }
        if (payload.rules !== undefined) {
            // Sanitize on the router side too, so bad renderer payloads can't
            // persist (e.g. rule regex that doesn't compile).
            llmRouter_1.llmRouter.setRoutingRules(payload.rules);
        }
        return llmRouter_1.llmRouter.getRoutingConfig();
    });
}
