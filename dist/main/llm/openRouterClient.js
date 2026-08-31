"use strict";
/**
 * OpenRouter LLM client — OpenAI-compatible /chat/completions with tool calling.
 * The model is read from user_config on every call, so a model change in
 * Settings takes effect on the next request without an app restart.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenRouterProvider = void 0;
const providerConfig_1 = require("./providerConfig");
const providerErrors_1 = require("./providerErrors");
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
async function postChat(apiKey, model, messages, tools, maxTokens) {
    try {
        return await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://kyclius.app',
                'X-Title': 'Kyclius',
            },
            body: JSON.stringify({
                model,
                messages,
                tools: tools.length > 0 ? tools : undefined,
                tool_choice: tools.length > 0 ? 'auto' : undefined,
                temperature: 0.3,
                max_tokens: maxTokens,
            }),
        });
    }
    catch {
        throw (0, providerErrors_1.mapNetworkError)('openrouter');
    }
}
class OpenRouterProvider {
    name = 'openrouter';
    async chatCompletion(messages, tools, modelOverride) {
        const apiKey = (0, providerConfig_1.getDecryptedApiKey)('openrouter');
        const model = modelOverride ?? (0, providerConfig_1.getConfiguredModel)('openrouter');
        const response = await postChat(apiKey, model, messages, tools, 4096);
        if (!response.ok) {
            const body = (await response.json().catch(() => ({})));
            throw (0, providerErrors_1.mapHttpError)('openrouter', response.status, body.error?.message, model);
        }
        const data = (await response.json());
        const choice = data.choices[0];
        return {
            content: choice.message.content || null,
            tool_calls: choice.message.tool_calls || null,
            finish_reason: choice.finish_reason,
        };
    }
    async validateKey(apiKey) {
        try {
            const response = await postChat(apiKey, (0, providerConfig_1.getConfiguredModel)('openrouter'), [{ role: 'user', content: 'test' }], [], 5);
            // A free-tier model can be temporarily unavailable while the key itself
            // is perfectly valid — treat auth failures as invalid, everything else
            // as "key accepted".
            return response.status !== 401 && response.status !== 403;
        }
        catch {
            return false;
        }
    }
}
exports.OpenRouterProvider = OpenRouterProvider;
