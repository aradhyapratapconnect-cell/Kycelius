"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.llmRouter = exports.isProviderId = void 0;
exports.buildLlmProvider = buildLlmProvider;
const db_1 = require("../db/db");
const providerRegistry_1 = require("./providerRegistry");
const providerErrors_1 = require("./providerErrors");
const openAICompatibleClient_1 = require("./openAICompatibleClient");
const anthropicClient_1 = require("./anthropicClient");
const geminiClient_1 = require("./geminiClient");
const llmRouting_1 = require("./llmRouting");
var providerConfig_1 = require("./providerConfig");
Object.defineProperty(exports, "isProviderId", { enumerable: true, get: function () { return providerConfig_1.isProviderId; } });
/** Schema -> adapter. Custom / OpenAI-compatible rows all share one client. */
function buildLlmProvider(config) {
    switch (config.schema) {
        case 'anthropic_native':
            return new anthropicClient_1.AnthropicProvider(config);
        case 'gemini_native':
            return new geminiClient_1.GeminiProvider(config);
        case 'openai_compatible':
        default:
            return new openAICompatibleClient_1.OpenAICompatibleProvider(config);
    }
}
function llmProviderIds() {
    return providerRegistry_1.providerRegistry
        .list('llm')
        .map(p => p.id);
}
class LLMRouter {
    // N-04: provider/model that served the most recent chatCompletion.
    lastUsedRoute = null;
    getProvider(name) {
        return providerRegistry_1.providerRegistry.materializeLlmProvider(name, buildLlmProvider);
    }
    getAllProviders() {
        return providerRegistry_1.providerRegistry
            .list('llm')
            .map(p => providerRegistry_1.providerRegistry.materializeLlmProvider(p.id, buildLlmProvider));
    }
    getActiveProvider() {
        return this.getProvider(this.getActiveProviderName());
    }
    /** Switches take effect on the next request and persist immediately. */
    setActiveProvider(name) {
        providerRegistry_1.providerRegistry.setDefaultLlmProvider(name);
    }
    getActiveProviderName() {
        return providerRegistry_1.providerRegistry.getDefaultLlmProviderId();
    }
    async initialize() {
        await providerRegistry_1.providerRegistry.init();
    }
    /**
     * T-26: stream one completion. Resolves the routing decision, materializes
     * the target provider, records the serving route (N-04), and forwards each
     * delta. Callers at any layer (chat rounds, planner, renderer preflight)
     * consume this generator.
     */
    async *streamChat(messages, tools) {
        const config = this.getRoutingConfig();
        const activeProvider = this.getActiveProviderName();
        const decision = (0, llmRouting_1.resolveRoutingDecision)({
            enabled: config.enabled,
            rules: config.rules,
            activeProvider,
            messages,
            isProviderConfigured: p => providerRegistry_1.providerRegistry.hasApiKey(p),
            knownProviders: llmProviderIds(),
        });
        const provider = this.getProvider(decision.provider);
        const modelOverride = decision.model?.trim() || undefined;
        const model = modelOverride ?? providerRegistry_1.providerRegistry.getConfiguredModel(decision.provider);
        this.lastUsedRoute = { provider: decision.provider, model };
        yield* provider.streamChat(messages, tools, modelOverride);
    }
    /** Non-stream convenience: drains streamChat into a single response. */
    async chatCompletion(messages, tools) {
        let content = '';
        let toolCalls = null;
        let finishReason = 'stop';
        for await (const delta of this.streamChat(messages, tools)) {
            if (delta.kind === 'text') {
                content += delta.delta;
            }
            else if (delta.kind === 'tool_calls') {
                toolCalls = toolCalls === null ? [...delta.calls] : toolCalls.concat(delta.calls);
            }
            else {
                finishReason = delta.finish_reason;
            }
        }
        return { content: content.length > 0 ? content : null, tool_calls: toolCalls, finish_reason: finishReason };
    }
    /** N-04: provider/model that served the last completed request, if any. */
    getLastUsedRoute() {
        return this.lastUsedRoute;
    }
    /** N-04: rule-based routing config, defaulting to a single-provider setup. */
    getRoutingConfig() {
        const raw = db_1.userConfig.get(llmRouting_1.ROUTING_CONFIG_KEY);
        if (!raw)
            return { enabled: false, rules: [] };
        try {
            const parsed = JSON.parse(raw);
            return {
                enabled: parsed.enabled === true,
                rules: Array.isArray(parsed.rules) ? parsed.rules : [],
            };
        }
        catch {
            return { enabled: false, rules: [] };
        }
    }
    /** N-04: turn rule-based routing on or off. */
    setRoutingEnabled(enabled) {
        const config = this.getRoutingConfig();
        db_1.userConfig.set(llmRouting_1.ROUTING_CONFIG_KEY, JSON.stringify({ ...config, enabled: Boolean(enabled) }));
    }
    /**
     * N-04: replace the routing rule list (sanitized against the LIVE provider
     * set: malformed rules are dropped, targets that don't name a configured
     * provider row are rejected, stable ids preserved or assigned). Defaults
     * stay disabled until the user turns routing on.
     */
    setRoutingRules(rawRules) {
        const rules = (0, llmRouting_1.sanitizeRoutingRules)(rawRules, llmProviderIds());
        const config = this.getRoutingConfig();
        db_1.userConfig.set(llmRouting_1.ROUTING_CONFIG_KEY, JSON.stringify({ ...config, rules }));
    }
    async validateProviderKey(providerName, apiKey) {
        if (!providerRegistry_1.providerRegistry.isKnownLlmProvider(providerName)) {
            throw new Error(`Unknown provider: ${providerName}`);
        }
        return this.getProvider(providerName).validateKey(apiKey);
    }
    async setApiKey(providerName, apiKey) {
        if (!providerRegistry_1.providerRegistry.isKnownLlmProvider(providerName)) {
            throw new Error(`Unknown provider: ${providerName}`);
        }
        providerRegistry_1.providerRegistry.setApiKey(providerName, apiKey);
    }
    removeApiKey(providerName) {
        if (!providerRegistry_1.providerRegistry.isKnownLlmProvider(providerName)) {
            throw new Error(`Unknown provider: ${providerName}`);
        }
        providerRegistry_1.providerRegistry.removeApiKey(providerName);
    }
    hasApiKey(providerName) {
        if (!providerRegistry_1.providerRegistry.isKnownLlmProvider(providerName)) {
            return false;
        }
        return providerRegistry_1.providerRegistry.hasApiKey(providerName);
    }
    getModel(providerName) {
        if (!providerRegistry_1.providerRegistry.isKnownLlmProvider(providerName)) {
            throw new Error(`Unknown provider: ${providerName}`);
        }
        return providerRegistry_1.providerRegistry.getConfiguredModel(providerName);
    }
    setModel(providerName, model) {
        if (!providerRegistry_1.providerRegistry.isKnownLlmProvider(providerName)) {
            throw new Error(`Unknown provider: ${providerName}`);
        }
        providerRegistry_1.providerRegistry.setConfiguredModel(providerName, model);
    }
    /**
     * Human-readable description of why an LLM error happened, for IPC callers
     * that just want a message to show. LLMProviderError messages are already
     * actionable; anything else gets wrapped so no raw stack traces leak.
     */
    describeError(err) {
        if (err instanceof providerErrors_1.LLMProviderError)
            return err.message;
        if (err instanceof Error)
            return err.message;
        return String(err);
    }
}
exports.llmRouter = new LLMRouter();
