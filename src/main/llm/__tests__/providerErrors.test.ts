import { describe, expect, it } from 'vitest';
import {
  LLMProviderError,
  mapHttpError,
  mapNetworkError,
  providerLabel,
} from '../providerErrors';

describe('providerLabel', () => {
  it('maps known providers to display labels', () => {
    expect(providerLabel('groq')).toBe('Groq');
    expect(providerLabel('openrouter')).toBe('OpenRouter');
  });

  it('falls back to the raw name for unknown providers', () => {
    expect(providerLabel('mystery')).toBe('mystery');
  });
});

describe('mapHttpError', () => {
  it('maps 401/403 to an actionable invalid-key error', () => {
    for (const status of [401, 403]) {
      const err = mapHttpError('groq', status, 'invalid api key', 'llama-3.3-70b-versatile');
      expect(err.kind).toBe('invalid_key');
      expect(err.message).toMatch(/API key was rejected/i);
      expect(err.message).toMatch(/Settings/i);
    }
  });

  it('maps 429 to a rate-limit error', () => {
    const err = mapHttpError('openrouter', 429, undefined, 'openrouter/free');
    expect(err.kind).toBe('rate_limited');
    expect(err.message).toMatch(/rate limit/i);
  });

  it('maps 402 to quota/rate messaging', () => {
    const err = mapHttpError('openrouter', 402, 'insufficient credits', 'openrouter/free');
    expect(err.kind).toBe('rate_limited');
  });

  it('maps 404 to a model-unavailable error naming the model', () => {
    const err = mapHttpError('groq', 404, 'model not found', 'llama-3.1-70b-versatile');
    expect(err.kind).toBe('model_unavailable');
    expect(err.message).toContain('llama-3.1-70b-versatile');
    expect(err.message).toMatch(/Settings/i);
  });

  it('detects decommissioned-model errors even on other statuses', () => {
    const err = mapHttpError(
      'groq',
      400,
      'The model `llama-3.1-70b-versatile` has been decommissioned',
      'llama-3.1-70b-versatile'
    );
    expect(err.kind).toBe('model_unavailable');
  });

  it('maps 5xx to an outage error', () => {
    const err = mapHttpError('groq', 503, undefined, 'llama-3.3-70b-versatile');
    expect(err.kind).toBe('provider_outage');
    expect(err.message).toMatch(/having problems/i);
  });

  it('falls back to a generic-but-specific message for other statuses', () => {
    const err = mapHttpError('groq', 418, "I'm a teapot", 'llama-3.3-70b-versatile');
    expect(err.kind).toBe('unknown');
    expect(err.message).toContain('418');
    expect(err.message).toContain("I'm a teapot");
  });

  it('never includes credential material in messages', () => {
    const err = mapHttpError('groq', 401, 'bad key', 'm');
    expect(err.message).not.toMatch(/Bearer/i);
  });
});

describe('mapNetworkError', () => {
  it('produces a network-unreachable error', () => {
    const err = mapNetworkError('openrouter');
    expect(err).toBeInstanceOf(LLMProviderError);
    expect(err.kind).toBe('network_unreachable');
    expect(err.message).toMatch(/OpenRouter/i);
    expect(err.message).toMatch(/internet connection/i);
  });
});
