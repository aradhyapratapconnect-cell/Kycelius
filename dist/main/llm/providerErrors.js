"use strict";
/**
 * Typed error mapping for LLM provider HTTP/network failures.
 *
 * Per the Security & Access Document error handling guide: every failure must
 * produce a specific, actionable message ("check your key in Settings" vs
 * "provider is down" vs "rate limited") — never a generic "something went
 * wrong", and never a silent fallback to a different provider.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMProviderError = void 0;
exports.providerLabel = providerLabel;
exports.mapHttpError = mapHttpError;
exports.mapNetworkError = mapNetworkError;
const providerRegistry_1 = require("./providerRegistry");
class LLMProviderError extends Error {
    kind;
    constructor(kind, message) {
        super(message);
        this.name = 'LLMProviderError';
        this.kind = kind;
    }
}
exports.LLMProviderError = LLMProviderError;
const PROVIDER_LABELS = {
    groq: 'Groq',
    openrouter: 'OpenRouter',
};
/** Human label for a provider row id; falls back to the fixed map for the
 *  legacy preset ids and the raw id otherwise. Resolves configured custom
 *  providers lazily (never a DB hit for the known presets). */
function providerLabel(providerName) {
    const known = PROVIDER_LABELS[providerName];
    if (known)
        return known;
    if (!providerRegistry_1.providerRegistry || typeof providerRegistry_1.providerRegistry.displayName !== 'function')
        return providerName;
    try {
        const stored = providerRegistry_1.providerRegistry.displayName(providerName);
        return stored || providerName;
    }
    catch {
        return providerName;
    }
}
/** Patterns in an API error body that indicate the configured model is gone. */
const MODEL_GONE_PATTERN = /decommission|\bretired\b|\bterminated\b|model[ _-]?(not[ _]found|does not exist)|no longer (available|supported)/i;
/**
 * Map a non-OK chat-completion HTTP response to an actionable error.
 * `apiMessage` is the provider's own error text (never includes the API key).
 */
function mapHttpError(providerName, status, apiMessage, configuredModel) {
    const label = providerLabel(providerName);
    const detail = apiMessage ? ` (${apiMessage})` : '';
    if (status === 401 || status === 403) {
        return new LLMProviderError('invalid_key', `Your ${label} API key was rejected. Open Settings and check that the saved key is correct.`);
    }
    if (status === 429 || status === 402) {
        return new LLMProviderError('rate_limited', `${label} rate limit or quota reached${detail}. Wait a moment and try again, or check your ${label} account.`);
    }
    if (status === 404 || (apiMessage && MODEL_GONE_PATTERN.test(apiMessage))) {
        return new LLMProviderError('model_unavailable', `The selected model "${configuredModel}" isn't available on ${label}${detail}. Pick another model in Settings — free-tier model lists rotate over time.`);
    }
    if (status >= 500) {
        return new LLMProviderError('provider_outage', `${label} is having problems right now (HTTP ${status}). Try again shortly.`);
    }
    return new LLMProviderError('unknown', `${label} request failed (HTTP ${status})${detail}.`);
}
/** Wrap a thrown fetch/network failure into an actionable error. */
function mapNetworkError(providerName) {
    const label = providerLabel(providerName);
    return new LLMProviderError('network_unreachable', `Couldn't reach ${label}. Check your internet connection and try again.`);
}
