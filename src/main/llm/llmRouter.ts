/**
 * Provider-agnostic LLM router (F-04, N-07, T-26).
 *
 * The registry owns provider DATA (rows, keys, models, defaults); this module
 * only decides which provider handles a call (rules + active default) and
 * exposes key/model management to Settings. Every configured provider gets
 * materialized into a schema-matched adapter by `materializeLlmProvider`.
 *
 * T-26: all completions stream. `streamChat` yields token/`tool_calls`/`done`
 * deltas; `chatCompletion` is a thin convenience wrapper that drains the same
 * generator for non-stream callers (planner, schedules).
 */

import { userConfig } from '../db/db';
import { providerRegistry } from './providerRegistry';
import { LLMProviderError } from './providerErrors';
import { OpenAICompatibleProvider } from './openAICompatibleClient';
import { AnthropicProvider } from './anthropicClient';
import { GeminiProvider } from './geminiClient';
import {
  resolveRoutingDecision,
  sanitizeRoutingRules,
  ROUTING_CONFIG_KEY,
  type LlmRoutingConfig,
  type RoutingDecision,
} from './llmRouting';
import type {
  LLMMessage,
  LLMProvider,
  LLMProviderConfig,
  LLMResponse,
  LLMToolCall,
  LLMToolDefinition,
  LLMRoute,
  LLMStreamDelta,
  ProviderId,
} from './llmTypes';

// Re-exported so existing imports keep working and renderer-facing code can
// pull provider types from one place.
export type {
  LLMMessage,
  LLMProvider,
  LLMResponse,
  LLMToolCall,
  LLMToolDefinition,
} from './llmTypes';
export type { ProviderId } from './llmTypes';
export { isProviderId } from './providerConfig';
export type {
  LlmRoutingConfig,
  RoutingRule,
  RoutingDecision,
} from './llmRouting';

/** Schema -> adapter. Custom / OpenAI-compatible rows all share one client. */
export function buildLlmProvider(config: LLMProviderConfig): LLMProvider {
  switch (config.schema) {
    case 'anthropic_native':
      return new AnthropicProvider(config);
    case 'gemini_native':
      return new GeminiProvider(config);
    case 'openai_compatible':
    default:
      return new OpenAICompatibleProvider(config);
  }
}

function llmProviderIds(): ProviderId[] {
  return providerRegistry
    .list('llm')
    .map(p => p.id);
}

class LLMRouter {
  // N-04: provider/model that served the most recent chatCompletion.
  private lastUsedRoute: LLMRoute | null = null;

  getProvider(name: ProviderId): LLMProvider {
    return providerRegistry.materializeLlmProvider(name, buildLlmProvider);
  }

  getAllProviders(): LLMProvider[] {
    return providerRegistry
      .list('llm')
      .map(p => providerRegistry.materializeLlmProvider(p.id, buildLlmProvider));
  }

  getActiveProvider(): LLMProvider {
    return this.getProvider(this.getActiveProviderName());
  }

  /** Switches take effect on the next request and persist immediately. */
  setActiveProvider(name: string): void {
    providerRegistry.setDefaultLlmProvider(name);
  }

  getActiveProviderName(): ProviderId {
    return providerRegistry.getDefaultLlmProviderId();
  }

  async initialize(): Promise<void> {
    await providerRegistry.init();
  }

  /**
   * T-26: stream one completion. Resolves the routing decision, materializes
   * the target provider, records the serving route (N-04), and forwards each
   * delta. Callers at any layer (chat rounds, planner, renderer preflight)
   * consume this generator.
   */
  async *streamChat(
    messages: LLMMessage[],
    tools: LLMToolDefinition[]
  ): AsyncGenerator<LLMStreamDelta> {
    const config = this.getRoutingConfig();
    const activeProvider = this.getActiveProviderName();
    const decision: RoutingDecision = resolveRoutingDecision({
      enabled: config.enabled,
      rules: config.rules,
      activeProvider,
      messages,
      isProviderConfigured: p => providerRegistry.hasApiKey(p),
      knownProviders: llmProviderIds(),
    });

    const provider = this.getProvider(decision.provider);
    const modelOverride = decision.model?.trim() || undefined;
    const model = modelOverride ?? providerRegistry.getConfiguredModel(decision.provider);
    this.lastUsedRoute = { provider: decision.provider, model };

    yield* provider.streamChat(messages, tools, modelOverride);
  }

  /** Non-stream convenience: drains streamChat into a single response. */
  async chatCompletion(
    messages: LLMMessage[],
    tools: LLMToolDefinition[]
  ): Promise<LLMResponse> {
    let content = '';
    let toolCalls: LLMToolCall[] | null = null;
    let finishReason = 'stop';
    for await (const delta of this.streamChat(messages, tools)) {
      if (delta.kind === 'text') {
        content += delta.delta;
      } else if (delta.kind === 'tool_calls') {
        toolCalls = toolCalls === null ? [...delta.calls] : toolCalls.concat(delta.calls);
      } else {
        finishReason = delta.finish_reason;
      }
    }
    return { content: content.length > 0 ? content : null, tool_calls: toolCalls, finish_reason: finishReason };
  }

  /** N-04: provider/model that served the last completed request, if any. */
  getLastUsedRoute(): LLMRoute | null {
    return this.lastUsedRoute;
  }

  /** N-04: rule-based routing config, defaulting to a single-provider setup. */
  getRoutingConfig(): LlmRoutingConfig {
    const raw = userConfig.get(ROUTING_CONFIG_KEY);
    if (!raw) return { enabled: false, rules: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<LlmRoutingConfig>;
      return {
        enabled: parsed.enabled === true,
        rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      };
    } catch {
      return { enabled: false, rules: [] };
    }
  }

  /** N-04: turn rule-based routing on or off. */
  setRoutingEnabled(enabled: boolean): void {
    const config = this.getRoutingConfig();
    userConfig.set(ROUTING_CONFIG_KEY, JSON.stringify({ ...config, enabled: Boolean(enabled) }));
  }

  /**
   * N-04: replace the routing rule list (sanitized against the LIVE provider
   * set: malformed rules are dropped, targets that don't name a configured
   * provider row are rejected, stable ids preserved or assigned). Defaults
   * stay disabled until the user turns routing on.
   */
  setRoutingRules(rawRules: unknown): void {
    const rules = sanitizeRoutingRules(rawRules, llmProviderIds());
    const config = this.getRoutingConfig();
    userConfig.set(ROUTING_CONFIG_KEY, JSON.stringify({ ...config, rules }));
  }

  async validateProviderKey(providerName: string, apiKey: string): Promise<boolean> {
    if (!providerRegistry.isKnownLlmProvider(providerName)) {
      throw new Error(`Unknown provider: ${providerName}`);
    }
    return this.getProvider(providerName).validateKey(apiKey);
  }

  async setApiKey(providerName: string, apiKey: string): Promise<void> {
    if (!providerRegistry.isKnownLlmProvider(providerName)) {
      throw new Error(`Unknown provider: ${providerName}`);
    }
    providerRegistry.setApiKey(providerName, apiKey);
  }

  removeApiKey(providerName: string): void {
    if (!providerRegistry.isKnownLlmProvider(providerName)) {
      throw new Error(`Unknown provider: ${providerName}`);
    }
    providerRegistry.removeApiKey(providerName);
  }

  hasApiKey(providerName: string): boolean {
    if (!providerRegistry.isKnownLlmProvider(providerName)) {
      return false;
    }
    return providerRegistry.hasApiKey(providerName);
  }

  getModel(providerName: string): string {
    if (!providerRegistry.isKnownLlmProvider(providerName)) {
      throw new Error(`Unknown provider: ${providerName}`);
    }
    return providerRegistry.getConfiguredModel(providerName);
  }

  setModel(providerName: string, model: string): void {
    if (!providerRegistry.isKnownLlmProvider(providerName)) {
      throw new Error(`Unknown provider: ${providerName}`);
    }
    providerRegistry.setConfiguredModel(providerName, model);
  }

  /**
   * Human-readable description of why an LLM error happened, for IPC callers
   * that just want a message to show. LLMProviderError messages are already
   * actionable; anything else gets wrapped so no raw stack traces leak.
   */
  describeError(err: unknown): string {
    if (err instanceof LLMProviderError) return err.message;
    if (err instanceof Error) return err.message;
    return String(err);
  }
}

export const llmRouter = new LLMRouter();