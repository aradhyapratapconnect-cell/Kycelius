"use strict";
/**
 * OpenAI-compatible chat completions client (N-07) — one implementation shared
 * by Groq, OpenRouter, OpenAI, NVIDIA NIM, Together, Fireworks, Mistral,
 * DeepSeek, and any Custom / OpenAI-Compatible endpoint. Parameterized by
 * base_url, model, and key; streams tokens (T-26).
 *
 * Tool-calling fallback (Agent spec §3a): when a provider/model rejects the
 * `tools` field, the request is retried without it and the tool schemas are
 * described in the system prompt; a model JSON block is parsed back into a
 * tool-call proposal that flows through the exact same validation + permission
 * engine as a native tool call.
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
exports.OpenAICompatibleProvider = void 0;
exports.parseStructuredToolCall = parseStructuredToolCall;
exports.parseOpenAiChunk = parseOpenAiChunk;
const sse_1 = require("./sse");
const providerErrors_1 = require("./providerErrors");
const timeouts_1 = require("../utils/timeouts");
const MAX_TOKENS = 4096;
function chatCompletionsUrl(baseUrl) {
    return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}
function modelsUrl(baseUrl) {
    return `${baseUrl.replace(/\/+$/, '')}/models`;
}
function buildRequestBody(model, messages, tools, opts) {
    const streamMessages = opts.structuredPrompt
        ? [
            ...messages,
            {
                role: 'system',
                content: opts.structuredPrompt +
                    "\n\nOnly ever respond with a single fenced JSON block matching that shape. " +
                    'Do not add prose, markdown headings, or comments.',
            },
        ]
        : messages;
    return {
        model,
        messages: streamMessages,
        stream: opts.stream,
        tools: opts.includeTools && tools.length > 0 ? tools.map(t => t.function) : undefined,
        tool_choice: opts.includeTools && tools.length > 0 ? 'auto' : undefined,
        temperature: 0.3,
        max_tokens: MAX_TOKENS,
    };
}
async function postChat(baseUrl, apiKey, body) {
    try {
        // EF-10: enforced timeout so a hung provider socket cannot freeze the turn.
        return await (0, timeouts_1.fetchWithTimeout)(chatCompletionsUrl(baseUrl), {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            timeoutMs: timeouts_1.LLM_FETCH_TIMEOUT_MS,
        });
    }
    catch {
        throw (0, providerErrors_1.mapNetworkError)(baseUrl);
    }
}
/** True when a 400 response body suggests the model/provider rejects tools —
 *  the signal for the §3a structured-prompt fallback. */
function looksLikeToolUnsupported(status, apiMessage) {
    if (status !== 400)
        return false;
    if (!apiMessage)
        return true;
    return /(tools?|function[ _-]?calling|tool[ _-]?call)/i.test(apiMessage);
}
const TOOL_PROMPT_PREFIX = 'You are an agent that can call tools. Available tools:';
function buildStructuredToolPrompt(tools) {
    const schemas = tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
    }));
    return (`${TOOL_PROMPT_PREFIX}\n${JSON.stringify(schemas)}\n\n` +
        `To call a tool, respond with ONLY:\n\`\`\`json\n{"name": "<tool name>", "arguments": { ... }}\n\`\`\`\n` +
        'The arguments must match the tool\'s JSON schema exactly.');
}
/** Extracts the first `{"name":...,"arguments":{...}}` object from text. */
function parseStructuredToolCall(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = (fenced ? fenced[1] : text).trim();
    const start = candidate.indexOf('{');
    if (start === -1)
        return null;
    try {
        const parsed = JSON.parse(candidate.slice(start));
        if (typeof parsed.name !== 'string' || !parsed.name)
            return null;
        return {
            id: `call_${crypto.randomUUID().slice(0, 8)}`,
            type: 'function',
            function: {
                name: parsed.name,
                arguments: JSON.stringify(parsed.arguments ?? {}),
            },
        };
    }
    catch {
        return null;
    }
}
/** Parses one SSE `data:` payload into a streaming delta (text / finish). */
function parseOpenAiChunk(data) {
    if ((0, sse_1.isDoneData)(data))
        return { kind: 'done', finish_reason: 'stop' };
    let json;
    try {
        json = JSON.parse(data);
    }
    catch {
        return null;
    }
    const choice = json.choices?.[0];
    if (!choice)
        return null;
    if (typeof choice.delta?.content === 'string' && choice.delta.content.length > 0) {
        return { kind: 'text', delta: choice.delta.content };
    }
    if (choice.finish_reason) {
        return { kind: 'done', finish_reason: choice.finish_reason };
    }
    return null;
}
class OpenAICompatibleProvider {
    name;
    displayName;
    schema = 'openai_compatible';
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
        let includeTools = tools.length > 0;
        let structuredPrompt;
        let response = await postChat(baseUrl, apiKey, buildRequestBody(model, messages, tools, { stream: true, includeTools }));
        // §3a: native tool-calling rejected → retry with a structured prompt that
        // describes the schemas; the retried call flows through the same engine.
        if (!response.ok && tools.length > 0) {
            const body = (await response.json().catch(() => ({})));
            if (looksLikeToolUnsupported(response.status, body.error?.message)) {
                includeTools = false;
                structuredPrompt = buildStructuredToolPrompt(tools);
                response = await postChat(baseUrl, apiKey, buildRequestBody(model, messages, tools, { stream: true, includeTools, structuredPrompt }));
            }
        }
        if (!response.ok) {
            const body = (await response.json().catch(() => ({})));
            throw (0, providerErrors_1.mapHttpError)(this.name, response.status, body.error?.message, model);
        }
        const toolAccs = new Map();
        let tail = '';
        let finishReason = null;
        for await (const event of (0, sse_1.parseSseStream)(response)) {
            if (event.event !== 'message')
                continue;
            if ((0, sse_1.isDoneData)(event.data))
                break;
            let json;
            try {
                json = JSON.parse(event.data);
            }
            catch {
                continue;
            }
            const choice = json.choices?.[0];
            if (!choice)
                continue;
            const content = choice.delta?.content;
            if (typeof content === 'string' && content.length > 0) {
                tail += content;
                // Structured-prompt fallback buffers whole-text until we know whether
                // the reply is a tool call (avoids flashing text before it executes).
                if (!structuredPrompt)
                    yield { kind: 'text', delta: content };
            }
            const toolCalls = choice.delta?.tool_calls ?? [];
            for (const tc of toolCalls) {
                const index = tc.index ?? 0;
                const acc = toolAccs.get(index) ?? { index, id: '', name: '', arguments: '' };
                if (tc.id)
                    acc.id = tc.id;
                if (tc.name)
                    acc.name += tc.name;
                if (tc.arguments)
                    acc.arguments += tc.arguments;
                toolAccs.set(index, acc);
            }
            if (choice.finish_reason) {
                finishReason = choice.finish_reason;
            }
        }
        const calls = Array.from(toolAccs.values())
            .filter(a => a.name && a.arguments.length > 0)
            .map(a => ({
            id: a.id || `call_${crypto.randomUUID().slice(0, 8)}`,
            type: 'function',
            function: { name: a.name, arguments: a.arguments || '{}' },
        }));
        if (structuredPrompt) {
            // No native tool deltas expected here; the buffered reply is either a
            // fenced tool-call block or plain assistant text.
            const parsed = parseStructuredToolCall(tail);
            if (parsed)
                calls.push(parsed);
            if (calls.length > 0) {
                yield { kind: 'tool_calls', calls };
            }
            else if (tail.length > 0) {
                yield { kind: 'text', delta: tail };
            }
        }
        else if (calls.length > 0) {
            // Text deltas were already streamed live; surface the tool call.
            yield { kind: 'tool_calls', calls };
        }
        yield { kind: 'done', finish_reason: finishReason ?? 'stop' };
    }
    async validateKey(apiKey) {
        try {
            const baseUrl = this.getBaseUrl();
            const response = await fetch(modelsUrl(baseUrl), {
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            // Auth failures are invalid; a 404/405/501 (no /models route) still
            // means the key itself was accepted.
            return response.status !== 401 && response.status !== 403 && response.status !== 407;
        }
        catch {
            return false;
        }
    }
    /** Model list where the endpoint exposes /models; empty array otherwise. */
    async listModels() {
        try {
            const baseUrl = this.getBaseUrl();
            const apiKey = (await Promise.resolve().then(() => __importStar(require('./providerRegistry')))).getDecryptedApiKey(this.name);
            const response = await fetch(modelsUrl(baseUrl), {
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (!response.ok)
                return [];
            const json = (await response.json());
            return Array.isArray(json.data) ? json.data.map(d => d.id).slice(0, 500) : [];
        }
        catch {
            return [];
        }
    }
}
exports.OpenAICompatibleProvider = OpenAICompatibleProvider;
