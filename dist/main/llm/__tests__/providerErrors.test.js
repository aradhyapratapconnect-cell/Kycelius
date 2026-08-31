"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const providerErrors_1 = require("../providerErrors");
(0, vitest_1.describe)('providerLabel', () => {
    (0, vitest_1.it)('maps known providers to display labels', () => {
        (0, vitest_1.expect)((0, providerErrors_1.providerLabel)('groq')).toBe('Groq');
        (0, vitest_1.expect)((0, providerErrors_1.providerLabel)('openrouter')).toBe('OpenRouter');
    });
    (0, vitest_1.it)('falls back to the raw name for unknown providers', () => {
        (0, vitest_1.expect)((0, providerErrors_1.providerLabel)('mystery')).toBe('mystery');
    });
});
(0, vitest_1.describe)('mapHttpError', () => {
    (0, vitest_1.it)('maps 401/403 to an actionable invalid-key error', () => {
        for (const status of [401, 403]) {
            const err = (0, providerErrors_1.mapHttpError)('groq', status, 'invalid api key', 'llama-3.3-70b-versatile');
            (0, vitest_1.expect)(err.kind).toBe('invalid_key');
            (0, vitest_1.expect)(err.message).toMatch(/API key was rejected/i);
            (0, vitest_1.expect)(err.message).toMatch(/Settings/i);
        }
    });
    (0, vitest_1.it)('maps 429 to a rate-limit error', () => {
        const err = (0, providerErrors_1.mapHttpError)('openrouter', 429, undefined, 'openrouter/free');
        (0, vitest_1.expect)(err.kind).toBe('rate_limited');
        (0, vitest_1.expect)(err.message).toMatch(/rate limit/i);
    });
    (0, vitest_1.it)('maps 402 to quota/rate messaging', () => {
        const err = (0, providerErrors_1.mapHttpError)('openrouter', 402, 'insufficient credits', 'openrouter/free');
        (0, vitest_1.expect)(err.kind).toBe('rate_limited');
    });
    (0, vitest_1.it)('maps 404 to a model-unavailable error naming the model', () => {
        const err = (0, providerErrors_1.mapHttpError)('groq', 404, 'model not found', 'llama-3.1-70b-versatile');
        (0, vitest_1.expect)(err.kind).toBe('model_unavailable');
        (0, vitest_1.expect)(err.message).toContain('llama-3.1-70b-versatile');
        (0, vitest_1.expect)(err.message).toMatch(/Settings/i);
    });
    (0, vitest_1.it)('detects decommissioned-model errors even on other statuses', () => {
        const err = (0, providerErrors_1.mapHttpError)('groq', 400, 'The model `llama-3.1-70b-versatile` has been decommissioned', 'llama-3.1-70b-versatile');
        (0, vitest_1.expect)(err.kind).toBe('model_unavailable');
    });
    (0, vitest_1.it)('maps 5xx to an outage error', () => {
        const err = (0, providerErrors_1.mapHttpError)('groq', 503, undefined, 'llama-3.3-70b-versatile');
        (0, vitest_1.expect)(err.kind).toBe('provider_outage');
        (0, vitest_1.expect)(err.message).toMatch(/having problems/i);
    });
    (0, vitest_1.it)('falls back to a generic-but-specific message for other statuses', () => {
        const err = (0, providerErrors_1.mapHttpError)('groq', 418, "I'm a teapot", 'llama-3.3-70b-versatile');
        (0, vitest_1.expect)(err.kind).toBe('unknown');
        (0, vitest_1.expect)(err.message).toContain('418');
        (0, vitest_1.expect)(err.message).toContain("I'm a teapot");
    });
    (0, vitest_1.it)('never includes credential material in messages', () => {
        const err = (0, providerErrors_1.mapHttpError)('groq', 401, 'bad key', 'm');
        (0, vitest_1.expect)(err.message).not.toMatch(/Bearer/i);
    });
});
(0, vitest_1.describe)('mapNetworkError', () => {
    (0, vitest_1.it)('produces a network-unreachable error', () => {
        const err = (0, providerErrors_1.mapNetworkError)('openrouter');
        (0, vitest_1.expect)(err).toBeInstanceOf(providerErrors_1.LLMProviderError);
        (0, vitest_1.expect)(err.kind).toBe('network_unreachable');
        (0, vitest_1.expect)(err.message).toMatch(/OpenRouter/i);
        (0, vitest_1.expect)(err.message).toMatch(/internet connection/i);
    });
});
