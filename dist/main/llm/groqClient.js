"use strict";
/**
 * Groq LLM client — OpenAI-compatible /chat/completions with tool calling.
 * The model is read from user_config on every call, so a model change in
 * Settings takes effect on the next request without an app restart.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroqProvider = void 0;
const providerConfig_1 = require("./providerConfig");
const providerErrors_1 = require("./providerErrors");
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
async function postChat(apiKey, model, messages, tools, maxTokens) {
    try {
        return await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
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
        throw (0, providerErrors_1.mapNetworkError)('groq');
    }
}
class GroqProvider {
    name = 'groq';
    async chatCompletion(messages, tools, modelOverride) {
        const apiKey = (0, providerConfig_1.getDecryptedApiKey)('groq');
        const model = modelOverride ?? (0, providerConfig_1.getConfiguredModel)('groq');
        const response = await postChat(apiKey, model, messages, tools, 4096);
        if (!response.ok) {
            const body = (await response.json().catch(() => ({})));
            throw (0, providerErrors_1.mapHttpError)('groq', response.status, body.error?.message, model);
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
        // Validated against the configured model so the check reflects what will
        // actually be used; failures are surfaced with specific mapped errors by
        // the caller if needed.
        try {
            const response = await postChat(apiKey, (0, providerConfig_1.getConfiguredModel)('groq'), [{ role: 'user', content: 'test' }], [], 5);
            return response.ok;
        }
        catch {
            return false;
        }
    }
}
exports.GroqProvider = GroqProvider;
