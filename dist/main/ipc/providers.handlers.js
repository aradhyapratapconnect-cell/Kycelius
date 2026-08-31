"use strict";
/**
 * N-07 — provider registry IPC.
 *
 * Exposes the `providers` table (list/add/update/remove) plus key management
 * and model discovery. Keys never cross the bridge: the UI only ever sees
 * `hasKey` / `isDefault` flags and can write a key (write-only) or clear it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerProviderHandlers = registerProviderHandlers;
const electron_1 = require("electron");
const providerRegistry_1 = require("../llm/providerRegistry");
const llmRouter_1 = require("../llm/llmRouter");
function assertKnownProvider(id) {
    if (!providerRegistry_1.providerRegistry.isKnownProvider(id)) {
        throw new Error(`Unknown provider id: ${id}`);
    }
}
/** Shared URL guard: only http(s) endpoints may be wired up as a base URL. */
function assertValidBaseUrl(baseUrl) {
    if (!baseUrl || baseUrl.trim().length === 0)
        return;
    if (!/^https?:\/\/.+/i.test(baseUrl.trim())) {
        throw new Error('Base URL must start with https:// (or http://).');
    }
}
function registerProviderHandlers() {
    electron_1.ipcMain.handle('kyclius:list-providers', (_event, capability) => {
        providerRegistry_1.providerRegistry.init();
        const rows = capability === 'llm' || capability === 'stt' || capability === 'tts'
            ? providerRegistry_1.providerRegistry.list(capability)
            : providerRegistry_1.providerRegistry.list();
        return rows;
    });
    electron_1.ipcMain.handle('kyclius:list-provider-presets', (_event, capability) => {
        return providerRegistry_1.providerRegistry.listPresets(capability);
    });
    electron_1.ipcMain.handle('kyclius:add-provider', (_event, input) => {
        providerRegistry_1.providerRegistry.init();
        if (!input || typeof input !== 'object') {
            throw new Error('Invalid provider payload.');
        }
        assertValidBaseUrl(input.baseUrl);
        return providerRegistry_1.providerRegistry.add(input);
    });
    electron_1.ipcMain.handle('kyclius:update-provider', (_event, id, patch) => {
        providerRegistry_1.providerRegistry.init();
        assertKnownProvider(id);
        if (patch?.baseUrl !== undefined)
            assertValidBaseUrl(patch.baseUrl);
        return providerRegistry_1.providerRegistry.update(id, patch ?? {});
    });
    electron_1.ipcMain.handle('kyclius:remove-provider', (_event, id) => {
        providerRegistry_1.providerRegistry.init();
        assertKnownProvider(id);
        providerRegistry_1.providerRegistry.remove(id);
        return { removed: true };
    });
    electron_1.ipcMain.handle('kyclius:delete-provider-api-key', (_event, id) => {
        providerRegistry_1.providerRegistry.init();
        assertKnownProvider(id);
        providerRegistry_1.providerRegistry.removeApiKey(id);
    });
    electron_1.ipcMain.handle('kyclius:list-provider-models', async (_event, id) => {
        providerRegistry_1.providerRegistry.init();
        assertKnownProvider(id);
        // Model discovery is an LLM-only concept; voice providers have no /models
        // listing (the picker falls back to a manual text field).
        if (providerRegistry_1.providerRegistry.get(id)?.capability !== 'llm') {
            return [];
        }
        const llm = providerRegistry_1.providerRegistry.materializeLlmProvider(id, llmRouter_1.buildLlmProvider);
        if (typeof llm.listModels !== 'function') {
            return [];
        }
        return llm.listModels();
    });
    // N-08: capability-aware active default. The LLM surface reuses this too;
    // rows keep their legacy getLLMProvider alias so older callers stay stable.
    electron_1.ipcMain.handle('kyclius:get-active-provider', (_event, capability) => {
        providerRegistry_1.providerRegistry.init();
        const cap = capability === 'stt' || capability === 'tts' ? capability : 'llm';
        return providerRegistry_1.providerRegistry.getDefaultProviderId(cap);
    });
    electron_1.ipcMain.handle('kyclius:set-active-provider', (_event, capability, id) => {
        providerRegistry_1.providerRegistry.init();
        const cap = capability === 'stt' || capability === 'tts' ? capability : 'llm';
        if (!providerRegistry_1.providerRegistry.isKnownProvider(id, cap)) {
            throw new Error(`Unknown ${cap} provider: ${id}`);
        }
        providerRegistry_1.providerRegistry.setDefaultProvider(id);
    });
    // N-08: write-only key save that works for ANY provider row (LLM, cloud STT,
    // cloud TTS). Only ever touches the encrypted vault; the plaintext key never
    // crosses back to the renderer and never reaches a log.
    electron_1.ipcMain.handle('kyclius:set-provider-api-key', (_event, id, apiKey) => {
        providerRegistry_1.providerRegistry.init();
        assertKnownProvider(id);
        if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
            throw new Error('API key must not be empty.');
        }
        providerRegistry_1.providerRegistry.setApiKey(id, apiKey);
    });
}
