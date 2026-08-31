"use strict";
/**
 * Per-provider configuration facade (N-07).
 *
 * v2.6.1 stored provider-specific config (keys, models, the active provider)
 * in provider-specific user_config entries. v2.7.1 centralizes that in the
 * `providers` table owned by providerRegistry.ts. This module keeps the old
 * import surface (`ProviderId`, `isProviderId`, key vault + model helpers)
 * so existing callers keep working while the source of truth moves.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROVIDER_IDS = exports.DEFAULT_MODELS = exports.setConfiguredModel = exports.getConfiguredModel = exports.removeApiKey = exports.encryptAndStoreApiKey = exports.getDecryptedApiKey = exports.hasApiKey = void 0;
exports.isProviderId = isProviderId;
const providerRegistry_1 = require("./providerRegistry");
/** Whether a value names a real LLM provider (a preset key or a configured row). */
function isProviderId(value) {
    return providerRegistry_1.providerRegistry.isKnownLlmProvider(value);
}
exports.hasApiKey = providerRegistry_1.providerRegistry.hasApiKey;
exports.getDecryptedApiKey = providerRegistry_1.providerRegistry.getDecryptedApiKey;
exports.encryptAndStoreApiKey = providerRegistry_1.providerRegistry.setApiKey;
exports.removeApiKey = providerRegistry_1.providerRegistry.removeApiKey;
exports.getConfiguredModel = providerRegistry_1.providerRegistry.getConfiguredModel;
exports.setConfiguredModel = providerRegistry_1.providerRegistry.setConfiguredModel;
// v2.6.1 results: models now live on provider rows; the static maps are gone.
// Keep the deprecated names exported as empty collections so any stale import
// doesn't blow up the build, then remove them once the UI is fully migrated.
exports.DEFAULT_MODELS = {};
exports.PROVIDER_IDS = [];
