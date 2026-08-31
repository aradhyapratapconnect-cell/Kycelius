"use strict";
/**
 * Google Gemini native API client (N-07).
 *
 * Implements the same llmTypes contract via the native schema: roles are
 * `user`/`model`, tools are `functionDeclarations`, tool calls are
 * `functionCall` parts, results are `functionResponse` parts keyed by
 * function NAME (so chat.handlers must set `LLMMessage.name` on `tool`-role
 * results), and streaming uses `:streamGenerateContent?alt=sse` (T-26).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiProvider = void 0;
const providerErrors_1 = require("./providerErrors");
const sse_1 = require("./sse");
const MAX_TOKENS = 4096;
function generateUrl(baseUrl, model) {
    return `${baseUrl.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
}
function modelsUrl(baseUrl) {
    return `${baseUrl.replace(/\/+$/, '')}/v1beta/models`;
}
function buildContents(messages) {
    const systemParts = [];
    const contents = [];
    for (const msg of messages) {
        if (msg.role === 'system') {
            systemParts.push(msg.content);
            continue;
        }
        if (msg.role === 'user') {
            contents.push({ role: 'user', parts: [{ text: msg.content }] });
            continue;
        }
        if (msg.role === 'tool') {
            contents.push({
                role: 'user',
                parts: [
                    {
                        functionResponse: {
                            name: msg.name ?? msg.tool_call_id ?? '',
                            response: { result: parseTextPayload(msg.content) },
                        },
                    },
                ],
            });
            continue;
        }
        // assistant / model
        const parts = [];
        if (msg.content)
            parts.push({ text: msg.content });
        for (const call of msg.tool_calls ?? []) {
            parts.push({ functionCall: { name: call.function.name, args: parseArguments(call.function.arguments) } });
        }
        contents.push({ role: 'model', parts });
    }
    // Coalesce consecutive same-role turns (Gemini rejects user-user / model-model).
    const merged = [];
    for (const item of contents) {
        const prev = merged[merged.length - 1];
        if (prev && prev.role === item.role) {
            prev.parts.push(...item.parts);
        }
        else {
            merged.push(item);
        }
    }
    return { contents: merged, system: systemParts.join('\n\n') };
}
function parseArguments(raw) {
    if (!raw)
        return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : {};
    }
    catch {
        return {};
    }
}
/** Tool results arrive as JSON strings; keep them parseable for the model by
 *  preserving structure and falling back to a plain text payload. */
function parseTextPayload(content) {
    if (!content)
        return { t: content };
    try {
        return JSON.parse(content);
    }
    catch {
        return { t: content };
    }
}
function finishReasonToStandard(reason) {
    if (!reason)
        return 'stop';
    const map = {
        STOP: 'stop',
        MAX_TOKENS: 'length',
        SAFETY: 'content_filter',
        RECITATION: 'content_filter',
        OTHER: 'stop',
    };
    return map[reason] ?? reason;
}
async function postGenerate(baseUrl, model, apiKey, body) {
    try {
        return await fetch(generateUrl(baseUrl, model), {
            method: 'POST',
            headers: {
                'x-goog-api-key': apiKey,
                'content-type': 'application/json',
            },
            body: JSON.stringify(body),
        });
    }
    catch {
        throw (0, providerErrors_1.mapNetworkError)(baseUrl);
    }
}
class GeminiProvider {
    name;
    displayName;
    schema = 'gemini_native';
    baseUrl;
    defaultModel;
    constructor(config) {
        this.name = config.name;
        this.displayName = config.displayName;
        this.baseUrl = config.baseUrl;
        this.defaultModel = config.defaultModel;
    }
    getBaseUrl() {
        const baseUrl = this.baseUrl?.trim();
        if (!baseUrl) {
            throw new Error(`${this.displayName} has no base URL configured.`);
        }
        return baseUrl;
    }
    async *streamChat(messages, tools, modelOverride) {
        const baseUrl = this.getBaseUrl();
        const apiKey = (await Promise.resolve().then(() => __importStar(require('./providerRegistry')))).getDecryptedApiKey(this.name);
        const model = modelOverride ?? this.defaultModel;
        const { contents, system } = buildContents(messages);
        const body = {
            contents: contents,
            generationConfig: { temperature: 0.3, maxOutputTokens: MAX_TOKENS },
        };
        if (system.length > 0) {
            body.systemInstruction = { parts: [{ text: system }] };
        }
        if (tools.length > 0) {
            body.tools = [
                {
                    functionDeclarations: tools.map(t => ({
                        name: t.function.name,
                        description: t.function.description,
                        parameters: t.function.parameters,
                    })),
                },
            ];
        }
        const response = await postGenerate(baseUrl, model, apiKey, body);
        if (!response.ok) {
            const err = (await response.json().catch(() => ({})));
            throw (0, providerErrors_1.mapHttpError)(this.name, response.status, err.error?.message, model);
        }
        const calls = new Map();
        let finishReason = 'stop';
        let blocked = false;
        for await (const event of (0, sse_1.parseSseStream)(response)) {
            let payload;
            try {
                payload = JSON.parse(event.data);
            }
            catch {
                continue;
            }
            if (payload.promptFeedback?.blockReason)
                blocked = true;
            const candidate = payload.candidates?.[0];
            if (!candidate)
                continue;
            if (candidate.finishReason) {
                finishReason = finishReasonToStandard(candidate.finishReason);
            }
            const parts = candidate.content?.parts ?? [];
            for (const part of parts) {
                if (typeof part.text === 'string' && part.text.length > 0) {
                    yield { kind: 'text', delta: part.text };
                }
                if (part.functionCall) {
                    const name = part.functionCall.name;
                    const acc = calls.get(name) ?? { name, argsJson: '' };
                    if (part.functionCall.args) {
                        try {
                            acc.argsJson = JSON.stringify(part.functionCall.args);
                        }
                        catch {
                            /* fall through */
                        }
                    }
                    calls.set(name, acc);
                }
            }
        }
        if (calls.size > 0) {
            const toolCalls = Array.from(calls.values())
                .filter(c => c.name)
                .map(c => ({
                id: `call_${crypto.randomUUID().slice(0, 8)}`,
                type: 'function',
                function: { name: c.name, arguments: c.argsJson || '{}' },
            }));
            if (toolCalls.length > 0) {
                yield { kind: 'tool_calls', calls: toolCalls };
            }
        }
        if (blocked && !calls.size) {
            throw new Error(`${this.displayName} declined this request (safety filter). Try rephrasing or a different provider.`);
        }
        yield { kind: 'done', finish_reason: finishReason };
    }
    async validateKey(apiKey) {
        try {
            const baseUrl = this.getBaseUrl();
            const response = await fetch(modelsUrl(baseUrl), {
                headers: { 'x-goog-api-key': apiKey },
            });
            return response.status !== 401 && response.status !== 403 && response.status !== 407;
        }
        catch {
            return false;
        }
    }
}
exports.GeminiProvider = GeminiProvider;
