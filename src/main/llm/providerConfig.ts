/**
 * Per-provider configuration facade (N-07).
 *
 * v2.6.1 stored provider-specific config (keys, models, the active provider)
 * in provider-specific user_config entries. v2.7.1 centralizes that in the
 * `providers` table owned by providerRegistry.ts. This module keeps the old
 * import surface (`ProviderId`, `isProviderId`, key vault + model helpers)
 * so existing callers keep working while the source of truth moves.
 */

import { providerRegistry } from './providerRegistry';

export type { ProviderId } from './llmTypes';

/** Whether a value names a real LLM provider (a preset key or a configured row). */
export function isProviderId(value: unknown): value is string {
  return providerRegistry.isKnownLlmProvider(value);
}

export const hasApiKey = providerRegistry.hasApiKey;
export const getDecryptedApiKey = providerRegistry.getDecryptedApiKey;
export const encryptAndStoreApiKey = providerRegistry.setApiKey;
export const removeApiKey = providerRegistry.removeApiKey;
export const getConfiguredModel = providerRegistry.getConfiguredModel;
export const setConfiguredModel = providerRegistry.setConfiguredModel;

// v2.6.1 results: models now live on provider rows; the static maps are gone.
// Keep the deprecated names exported as empty collections so any stale import
// doesn't blow up the build, then remove them once the UI is fully migrated.
export const DEFAULT_MODELS: Record<string, string> = {};
export const PROVIDER_IDS: string[] = [];