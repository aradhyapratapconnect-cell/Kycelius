"use strict";
/**
 * N-07/N-08 — Open provider registry.
 *
 * Providers are DATA, not code. This module owns the `providers` table: the
 * built-in presets (Architecture §2.1), seeding + migration of the legacy
 * provider-specific `user_config` keys, CRUD, the safeStorage key vault, and
 * the default-provider selection. The LLM router consumes this via
 * `materializeLlmProvider()`; the voice layer reads the same table for cloud
 * STT/TTS later (N-08).
 *
 * Design guarantees (Security doc):
 * - Keys are encrypted (safeStorage) at rest inside `api_key_encrypted`, and
 *   only ever decrypted in-memory at call time.
 * - A stored key that can't be decrypted surfaces a re-entry prompt, never a
 *   crash or a silent disable.
 * - Presets that ship with the app are dormant (enabled=0) until the user
 *   configures a key — no forced account, no built-in/paid key.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.providerRegistry = exports.VOICE_PRESETS = exports.LLM_PRESETS = void 0;
exports.getPreset = getPreset;
exports.listProviders = listProviders;
exports.listPresets = listPresets;
exports.getProvider = getProvider;
exports.isKnownProvider = isKnownProvider;
exports.isKnownLlmProvider = isKnownLlmProvider;
exports.getDefaultProviderId = getDefaultProviderId;
exports.getDefaultLlmProviderId = getDefaultLlmProviderId;
exports.setDefaultProvider = setDefaultProvider;
exports.setDefaultLlmProvider = setDefaultLlmProvider;
exports.setProviderEnabled = setProviderEnabled;
exports.addProvider = addProvider;
exports.updateProvider = updateProvider;
exports.removeProvider = removeProvider;
exports.hasApiKey = hasApiKey;
exports.removeApiKey = removeApiKey;
exports.getDecryptedApiKey = getDecryptedApiKey;
exports.setApiKey = setApiKey;
exports.getConfiguredModel = getConfiguredModel;
exports.setConfiguredModel = setConfiguredModel;
exports.initProviderRegistry = initProviderRegistry;
exports.materializeLlmProvider = materializeLlmProvider;
exports.providerDisplayName = providerDisplayName;
const electron_1 = require("electron");
const db_1 = require("../db/db");
const db_2 = require("../db/db");
const providerErrors_1 = require("./providerErrors");
/** The built-in LLM presets (Architecture §2.1). Base URLs are the stable
 *  public OpenAI-compatible / native endpoints; model ids are fallback
 *  defaults that the user edits in Settings when they rotate. */
exports.LLM_PRESETS = [
    {
        presetKey: 'groq',
        displayName: 'Groq',
        capability: 'llm',
        schema: 'openai_compatible',
        baseUrl: 'https://api.groq.com/openai/v1',
        defaultModel: 'llama-3.3-70b-versatile',
        defaultEnabled: true,
    },
    {
        presetKey: 'openrouter',
        displayName: 'OpenRouter',
        capability: 'llm',
        schema: 'openai_compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
        defaultModel: 'openrouter/free',
        defaultEnabled: true,
    },
    {
        presetKey: 'openai',
        displayName: 'OpenAI',
        capability: 'llm',
        schema: 'openai_compatible',
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o-mini',
    },
    {
        presetKey: 'anthropic',
        displayName: 'Anthropic',
        capability: 'llm',
        schema: 'anthropic_native',
        baseUrl: 'https://api.anthropic.com',
        defaultModel: 'claude-3-5-haiku-latest',
    },
    {
        presetKey: 'gemini',
        displayName: 'Google Gemini',
        capability: 'llm',
        schema: 'gemini_native',
        baseUrl: 'https://generativelanguage.googleapis.com',
        defaultModel: 'gemini-2.0-flash',
    },
    {
        presetKey: 'nvidia_nim',
        displayName: 'NVIDIA NIM',
        capability: 'llm',
        schema: 'openai_compatible',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        defaultModel: 'meta/llama-3.3-70b-instruct',
    },
    {
        presetKey: 'together',
        displayName: 'Together AI',
        capability: 'llm',
        schema: 'openai_compatible',
        baseUrl: 'https://api.together.xyz/v1',
        defaultModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    },
    {
        presetKey: 'fireworks',
        displayName: 'Fireworks AI',
        capability: 'llm',
        schema: 'openai_compatible',
        baseUrl: 'https://api.fireworks.ai/inference/v1',
        defaultModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    },
    {
        presetKey: 'mistral',
        displayName: 'Mistral',
        capability: 'llm',
        schema: 'openai_compatible',
        baseUrl: 'https://api.mistral.ai/v1',
        defaultModel: 'mistral-small-latest',
    },
    {
        presetKey: 'deepseek',
        displayName: 'DeepSeek',
        capability: 'llm',
        schema: 'openai_compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        defaultModel: 'deepseek-chat',
    },
    {
        presetKey: 'custom',
        displayName: 'Custom / OpenAI-Compatible',
        capability: 'llm',
        schema: 'openai_compatible',
        defaultModel: '',
    },
];
/** Cloud voice (N-08) is custom-only for now: the same "+ Add Provider" UI
 *  pattern with general OpenAI-compatible transcription/speech endpoints.
 *  ElevenLabs and Fish Audio are first-class BYOK TTS presets on the same
 *  `cloud_tts` schema — the TTS engine factory branches on `presetKey`, so no
 *  schema migration is needed and STT is untouched. All ship dormant
 *  (enabled=0, no key) until the user adds their own key. */
exports.VOICE_PRESETS = [
    {
        presetKey: 'custom_stt',
        displayName: 'Custom Cloud STT',
        capability: 'stt',
        schema: 'cloud_stt',
        defaultModel: '',
    },
    {
        presetKey: 'custom_tts',
        displayName: 'Custom Cloud TTS',
        capability: 'tts',
        schema: 'cloud_tts',
        defaultModel: '',
    },
    {
        presetKey: 'elevenlabs_tts',
        displayName: 'ElevenLabs',
        capability: 'tts',
        schema: 'cloud_tts',
        baseUrl: 'https://api.elevenlabs.io/v1',
        defaultModel: '21m00Tcm4TlvDq8ikWAM',
    },
    {
        presetKey: 'fishaudio_tts',
        displayName: 'Fish Audio',
        capability: 'tts',
        schema: 'cloud_tts',
        baseUrl: 'https://api.fish.audio',
        defaultModel: '',
    },
];
/** Legacy provider-specific user_config keys, migrated into the table once. */
const LEGACY_KEY_CONFIG = {
    groq: 'groq_api_key',
    openrouter: 'openrouter_api_key',
};
const LEGACY_MODEL_CONFIG = {
    groq: 'groq_model',
    openrouter: 'openrouter_model',
};
const LEGACY_DEFAULT_KEY = 'llm_provider';
function getPreset(presetKey, capability) {
    return [...exports.LLM_PRESETS, ...exports.VOICE_PRESETS].find(p => p.presetKey === presetKey && p.capability === capability);
}
function rowToProvider(row) {
    return {
        id: row.id,
        capability: row.capability,
        presetKey: row.preset_key,
        displayName: row.display_name,
        schema: row.schema,
        baseUrl: row.base_url,
        defaultModel: row.default_model,
        enabled: row.enabled === 1,
        isDefault: row.is_default === 1,
        hasKey: !!row.api_key_encrypted,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function getProviderRowById(id) {
    return (0, db_2.getDb)().prepare('SELECT * FROM providers WHERE id = ?').get(id);
}
function getProviderRowByPreset(presetKey, capability) {
    return (0, db_2.getDb)()
        .prepare('SELECT * FROM providers WHERE preset_key = ? AND capability = ? ORDER BY created_at ASC LIMIT 1')
        .get(presetKey, capability);
}
function setProviderTimestamps(id) {
    (0, db_2.getDb)()
        .prepare('UPDATE providers SET updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), id);
}
function listProviders(capability) {
    const rows = capability
        ? (0, db_2.getDb)().prepare('SELECT * FROM providers WHERE capability = ? ORDER BY created_at ASC').all(capability)
        : (0, db_2.getDb)().prepare('SELECT * FROM providers ORDER BY capability ASC, created_at ASC').all();
    return rows.map(rowToProvider);
}
function listPresets(capability) {
    const all = [...exports.LLM_PRESETS, ...exports.VOICE_PRESETS];
    return capability ? all.filter(p => p.capability === capability) : all;
}
function getProvider(id) {
    const row = getProviderRowById(id);
    return row ? rowToProvider(row) : undefined;
}
/** Whether a value names a provider the registry knows about. With no
 *  capability filter, any preset key or configured row passes (N-08: cloud
 *  STT/TTS rows are real providers and must be addressable the same way). */
function isKnownProvider(id, capability) {
    if (typeof id !== 'string' || id.length === 0)
        return false;
    const row = getProvider(id);
    if (row)
        return capability === undefined || row.capability === capability;
    const preset = [...exports.LLM_PRESETS, ...exports.VOICE_PRESETS].find(p => p.presetKey === id);
    return !!preset && (capability === undefined || preset.capability === capability);
}
function isKnownLlmProvider(id) {
    return isKnownProvider(id, 'llm');
}
/** Public id of the default provider for a capability: the `is_default` row,
 *  else the first enabled one, else the first seeded row (its preset key for
 *  LLM). Voice capabilities return '' when no row exists yet. */
function getDefaultProviderId(capability) {
    const rows = listProviders(capability);
    if (rows.length === 0) {
        return capability === 'llm' ? 'groq' : '';
    }
    for (const row of rows)
        if (row.isDefault)
            return row.id;
    for (const row of rows)
        if (row.enabled)
            return row.id;
    return rows[0].id;
}
function getDefaultLlmProviderId() {
    return getDefaultProviderId('llm');
}
/** Marks `id` as the default for its own capability and clears the others. */
function setDefaultProvider(id) {
    const row = getProviderRowById(id);
    if (!row) {
        throw new Error(`Unknown provider row: ${id}`);
    }
    const capability = row.capability;
    (0, db_2.getDb)()
        .prepare('UPDATE providers SET is_default = 0, updated_at = ? WHERE capability = ?')
        .run(new Date().toISOString(), capability);
    (0, db_2.getDb)()
        .prepare('UPDATE providers SET is_default = 1, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), id);
    // Keep the legacy key in sync so the v2.6.1 settings surface still reflects
    // the active LLM provider; it is no longer the source of truth.
    if (capability === 'llm') {
        db_1.userConfig.set(LEGACY_DEFAULT_KEY, id);
    }
}
function setDefaultLlmProvider(id) {
    if (!isKnownLlmProvider(id)) {
        throw new Error(`Unknown LLM provider: ${id}`);
    }
    setDefaultProvider(id);
}
function setProviderEnabled(id, enabled) {
    (0, db_2.getDb)().prepare('UPDATE providers SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, new Date().toISOString(), id);
}
/** Creates a provider row. For built-in presets the row id is the preset key
 *  (creating the same preset twice edits the existing row); `custom` rows are
 *  always new so any number of OpenAI-compatible endpoints can coexist. */
function addProvider(input) {
    const preset = getPreset(input.presetKey, input.capability);
    if (!preset) {
        throw new Error(`Unknown provider preset: ${input.presetKey}`);
    }
    const existing = getProviderRowByPreset(input.presetKey, input.capability);
    const id = input.presetKey === 'custom' || input.presetKey === 'custom_stt' || input.presetKey === 'custom_tts'
        ? crypto.randomUUID()
        : (existing ? existing.id : input.presetKey);
    const displayName = (input.displayName && input.displayName.trim().length > 0 ? input.displayName.trim() : null) ??
        (existing?.display_name || preset.displayName);
    const baseUrl = existing
        ? input.baseUrl?.trim() || existing.base_url || preset.baseUrl || null
        : input.baseUrl?.trim() || preset.baseUrl || null;
    const defaultModel = (input.defaultModel && input.defaultModel.trim().length > 0 ? input.defaultModel.trim() : null) ??
        (existing?.default_model || preset.defaultModel || null);
    const now = new Date().toISOString();
    if (existing) {
        // Reuse the existing preset row, preserving stored key + flags.
        (0, db_2.getDb)()
            .prepare('UPDATE providers SET display_name = ?, base_url = ?, default_model = ?, updated_at = ? WHERE id = ?')
            .run(displayName, baseUrl, defaultModel, now, existing.id);
    }
    else {
        (0, db_2.getDb)()
            .prepare(`INSERT INTO providers (id, capability, preset_key, display_name, schema, base_url, api_key_encrypted, default_model, enabled, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, ?)`)
            .run(id, input.capability, input.presetKey, displayName, preset.schema, baseUrl, defaultModel, input.enabled ? 1 : 0, now, now);
    }
    if (input.apiKey) {
        setApiKey(id, input.apiKey);
    }
    else if (input.enabled) {
        setProviderEnabled(id, true);
    }
    const row = getProviderRowById(id);
    if (!row)
        throw new Error(`Failed to create provider ${id}`);
    return rowToProvider(row);
}
function updateProvider(id, patch) {
    const row = getProviderRowById(id);
    if (!row)
        throw new Error(`Unknown provider row: ${id}`);
    const nextDisplay = patch.displayName !== undefined
        ? patch.displayName.trim().length > 0
            ? patch.displayName.trim()
            : row.display_name
        : row.display_name;
    const nextBase = patch.baseUrl !== undefined ? patch.baseUrl.trim() || null : row.base_url;
    const nextModel = patch.defaultModel !== undefined ? patch.defaultModel.trim() || null : row.default_model;
    (0, db_2.getDb)()
        .prepare('UPDATE providers SET display_name = ?, base_url = ?, default_model = ?, enabled = ?, updated_at = ? WHERE id = ?')
        .run(nextDisplay, nextBase, nextModel, patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : row.enabled, new Date().toISOString(), id);
    setProviderTimestamps(id);
    return rowToProvider(getProviderRowById(id));
}
function removeProvider(id) {
    const row = getProviderRowById(id);
    if (!row)
        return;
    // Security: removing a provider must also clear its encrypted key from the
    // table (and any legacy mirror), not just hide the card.
    removeApiKey(id);
    const legacyKey = LEGACY_KEY_CONFIG[row.preset_key];
    if (legacyKey)
        db_1.userConfig.delete(legacyKey);
    const legacyModel = LEGACY_MODEL_CONFIG[row.preset_key];
    if (legacyModel)
        db_1.userConfig.delete(legacyModel);
    (0, db_2.getDb)().prepare('DELETE FROM providers WHERE id = ?').run(id);
    if (row.is_default === 1) {
        // Promote a new default for the capability so the app never ends up
        // without one.
        const fallback = getDefaultProviderId(row.capability);
        if (fallback !== id && fallback.length > 0) {
            (0, db_2.getDb)()
                .prepare('UPDATE providers SET is_default = 1, updated_at = ? WHERE id = ?')
                .run(new Date().toISOString(), fallback);
        }
    }
}
// ---------------------------------------------------------------------------
// Key vault (safeStorage). Only ever decrypts in-memory; plain text never
// touches SQLite.
// ---------------------------------------------------------------------------
function assertEncryptionAvailable() {
    let available = false;
    try {
        available = electron_1.safeStorage.isEncryptionAvailable();
    }
    catch {
        available = false;
    }
    if (!available) {
        throw new providerErrors_1.LLMProviderError('key_unreadable', "Your operating system's secure storage isn't available, so Kyclius can't save an API key safely. Start your system keyring service (e.g. Windows Credential Manager, macOS Keychain, or kwallet/libsecret on Linux) and try again.");
    }
}
function getApiKeyBlob(id, presetKey) {
    const row = getProviderRowById(id);
    if (row?.api_key_encrypted)
        return row.api_key_encrypted;
    // Pre-migration installs: fall back to the legacy user_config mirror.
    const legacy = LEGACY_KEY_CONFIG[presetKey];
    return legacy ? db_1.userConfig.get(legacy) : undefined;
}
function hasApiKey(id) {
    const row = getProviderRowById(id);
    if (row?.api_key_encrypted)
        return true;
    const legacy = LEGACY_KEY_CONFIG[row?.preset_key ?? ''];
    return legacy ? !!db_1.userConfig.get(legacy) : false;
}
function removeApiKey(id) {
    (0, db_2.getDb)().prepare("UPDATE providers SET api_key_encrypted = NULL, enabled = 0, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    const row = getProviderRowById(id);
    const legacy = row ? LEGACY_KEY_CONFIG[row.preset_key] : undefined;
    if (legacy)
        db_1.userConfig.delete(legacy);
}
/**
 * Decrypts a provider's stored key in-memory. Throws a typed error (never
 * returns plaintext of a corrupted blob) prompting re-entry per Security §8.
 */
function getDecryptedApiKey(id) {
    const row = getProviderRowById(id);
    const label = row?.display_name ?? id;
    const blob = getApiKeyBlob(id, row?.preset_key ?? '');
    if (!blob) {
        throw new providerErrors_1.LLMProviderError('key_not_set', `No API key is set for ${label}. Add one in Settings to start using Kyclius.`);
    }
    try {
        return electron_1.safeStorage.decryptString(Buffer.from(blob, 'base64'));
    }
    catch {
        throw new providerErrors_1.LLMProviderError('key_unreadable', `Your saved ${label} API key couldn't be decrypted. Re-enter it in Settings.`);
    }
}
/** Encrypts via safeStorage before writing; plain text never touches SQLite. */
function setApiKey(id, apiKey) {
    assertEncryptionAvailable();
    const encrypted = electron_1.safeStorage.encryptString(apiKey).toString('base64');
    (0, db_2.getDb)()
        .prepare("UPDATE providers SET api_key_encrypted = ?, enabled = 1, updated_at = ? WHERE id = ?")
        .run(encrypted, new Date().toISOString(), id);
    const row = getProviderRowById(id);
    const legacy = row ? LEGACY_KEY_CONFIG[row.preset_key] : undefined;
    if (legacy)
        db_1.userConfig.set(legacy, encrypted);
}
// ---------------------------------------------------------------------------
// Model selection
// ---------------------------------------------------------------------------
function getConfiguredModel(id) {
    const row = getProviderRowById(id);
    if (row?.default_model)
        return row.default_model;
    const preset = row ? getPreset(row.preset_key, row.capability) : undefined;
    return preset?.defaultModel ?? '';
}
function setConfiguredModel(id, model) {
    const trimmed = model.trim();
    if (trimmed.length === 0) {
        throw new Error('Model ID must not be empty');
    }
    if (trimmed.length > 200) {
        throw new Error('Model ID is too long');
    }
    if (!getProviderRowById(id)) {
        throw new Error(`Unknown provider row: ${id}`);
    }
    (0, db_2.getDb)().prepare('UPDATE providers SET default_model = ?, updated_at = ? WHERE id = ?').run(trimmed, new Date().toISOString(), id);
    const row = getProviderRowById(id);
    const legacy = row ? LEGACY_MODEL_CONFIG[row.preset_key] : undefined;
    if (legacy)
        db_1.userConfig.set(legacy, trimmed);
}
// ---------------------------------------------------------------------------
// Seeding + legacy migration
// ---------------------------------------------------------------------------
function seedPresetRows() {
    const db = (0, db_2.getDb)();
    for (const preset of [...exports.LLM_PRESETS, ...exports.VOICE_PRESETS]) {
        const existing = getProviderRowByPreset(preset.presetKey, preset.capability);
        if (existing)
            continue;
        const id = preset.presetKey === 'custom' ||
            preset.presetKey === 'custom_stt' ||
            preset.presetKey === 'custom_tts'
            ? crypto.randomUUID()
            : preset.presetKey;
        const now = new Date().toISOString();
        db.prepare(`INSERT INTO providers (id, capability, preset_key, display_name, schema, base_url, api_key_encrypted, default_model, enabled, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, ?)`).run(id, preset.capability, preset.presetKey, preset.displayName, preset.schema, preset.baseUrl ?? null, preset.defaultModel || null, preset.defaultEnabled ? 1 : 0, now, now);
    }
}
/**
 * Migrates the v2.6.1 provider-specific user_config keys (groq_api_key,
 * openrouter_api_key, groq_model, openrouter_model, llm_provider) into
 * `providers` rows. Idempotent — safe to run on every startup.
 */
function migrateLegacyConfig() {
    const db = (0, db_2.getDb)();
    for (const [presetKey, configKey] of Object.entries(LEGACY_KEY_CONFIG)) {
        const legacyKey = db_1.userConfig.get(configKey);
        if (!legacyKey)
            continue;
        const row = getProviderRowByPreset(presetKey, 'llm');
        if (!row)
            continue;
        if (!row.api_key_encrypted) {
            db.prepare('UPDATE providers SET api_key_encrypted = ?, enabled = 1, updated_at = ? WHERE id = ?')
                .run(legacyKey, new Date().toISOString(), row.id);
        }
    }
    for (const [presetKey, configKey] of Object.entries(LEGACY_MODEL_CONFIG)) {
        const legacyModel = db_1.userConfig.get(configKey);
        if (!legacyModel)
            continue;
        const row = getProviderRowByPreset(presetKey, 'llm');
        // Legacy wins over the preset default: the v2.6.1 value is user intent.
        if (row) {
            db.prepare('UPDATE providers SET default_model = ?, updated_at = ? WHERE id = ?')
                .run(legacyModel, new Date().toISOString(), row.id);
        }
    }
    const legacyProvider = db_1.userConfig.get(LEGACY_DEFAULT_KEY);
    if (legacyProvider && isKnownLlmProvider(legacyProvider)) {
        (0, db_2.getDb)().prepare("UPDATE providers SET is_default = 0, updated_at = ? WHERE capability = 'llm'")
            .run(new Date().toISOString());
        (0, db_2.getDb)().prepare('UPDATE providers SET is_default = 1, updated_at = ? WHERE id = ?')
            .run(new Date().toISOString(), legacyProvider);
    }
    // Guarantee exactly one default; prefer the legacy choice else groq.
    const llmRows = (0, db_2.getDb)().prepare("SELECT * FROM providers WHERE capability = 'llm'").all();
    const hasDefault = llmRows.some(r => r.is_default === 1);
    if (!hasDefault) {
        const target = llmRows.find(r => r.enabled === 1) ?? llmRows.find(r => r.preset_key === 'groq') ?? llmRows[0];
        if (target) {
            (0, db_2.getDb)().prepare('UPDATE providers SET is_default = 1, updated_at = ? WHERE id = ?')
                .run(new Date().toISOString(), target.id);
        }
    }
}
let initialized = false;
/** Seeds presets and migrates legacy config once. Idempotent. */
function initProviderRegistry() {
    if (initialized)
        return;
    seedPresetRows();
    migrateLegacyConfig();
    initialized = true;
}
/** Makes a concrete LLM provider (adapter) from a configured row. */
function materializeLlmProvider(id, build) {
    const row = getProviderRowById(id);
    if (!row || row.capability !== 'llm') {
        throw new Error(`LLM provider ${id} is not configured.`);
    }
    const preset = getPreset(row.preset_key, 'llm');
    return build({
        name: row.id,
        displayName: row.display_name,
        schema: row.schema,
        baseUrl: row.base_url ?? preset?.baseUrl,
        defaultModel: getConfiguredModel(row.id),
    });
}
/** Display label for a provider id, for error messages / UI fallbacks. */
function providerDisplayName(id) {
    const row = getProviderRowById(id);
    if (row)
        return row.display_name;
    const preset = [...exports.LLM_PRESETS, ...exports.VOICE_PRESETS].find(p => p.presetKey === id);
    return preset?.displayName ?? id;
}
exports.providerRegistry = {
    init: initProviderRegistry,
    list: listProviders,
    listPresets,
    get: getProvider,
    getDefaultProviderId,
    getDefaultLlmProviderId,
    setDefaultLlmProvider,
    setDefaultProvider,
    setEnabled: setProviderEnabled,
    add: addProvider,
    update: updateProvider,
    remove: removeProvider,
    hasApiKey,
    setApiKey,
    removeApiKey,
    getDecryptedApiKey,
    getConfiguredModel,
    setConfiguredModel,
    isKnownLlmProvider,
    isKnownProvider,
    displayName: providerDisplayName,
    materializeLlmProvider,
};
